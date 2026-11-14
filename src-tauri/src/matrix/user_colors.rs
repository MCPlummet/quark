//! User colors (#45) over the wire: the `tel.quark.usercolor` field of a
//! user's public profile (Matrix 1.16 extended profiles / MSC4133).

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use matrix_sdk::config::RequestConfig;
use matrix_sdk::ruma::api::client::error::{ErrorKind, RetryAfter};
use matrix_sdk::ruma::UserId;
use matrix_sdk::{Client, HttpError};
use serde::{Deserialize, Serialize};
use tokio::sync::Semaphore;
use serde_json::Value as JsonValue;

use crate::config::user_colors::normalize_color;

/// The profile field a user's color lives in.
pub const FIELD: &str = "tel.quark.usercolor";

/// What saving says when the homeserver has no extended profiles at all.
pub const UNSUPPORTED: &str = "Your homeserver doesn't support custom profile fields.";

/// Stable capability name (Matrix 1.16), then MSC4133's unstable one.
const CAPABILITIES: [&str; 2] = ["m.profile_fields", "uk.tcpip.msc4133.profile_fields"];

/// The spec version that added extended profiles, as `/versions` lists it.
const FIRST_VERSION_WITH_FIELDS: (u32, u32) = (1, 16);
/// `/versions` unstable features that mean MSC4133 is there.
const UNSTABLE_FEATURES: [&str; 2] = ["uk.tcpip.msc4133", "uk.tcpip.msc4133.stable"];

// ── Endpoints ────────────────────────────────────────────────────────────────
//
// ruma 0.12 predates extended profiles, so the endpoints are declared here —
// by hand rather than with ruma's `#[request]` macros, which only emit their
// trait impls behind a `client` cargo feature this crate doesn't have.
//
// The stable variants list their path under `1.0` so ruma always picks it,
// whatever the server advertises in `/versions`: whether the server knows the
// route is decided by trying it (`M_UNRECOGNIZED` falls back to unstable).

mod wire {
    use std::marker::PhantomData;

    use matrix_sdk::ruma::api::client::Error as ApiError;
    use matrix_sdk::ruma::api::error::{FromHttpResponseError, IntoHttpError};
    use matrix_sdk::ruma::api::{
        EndpointError, IncomingResponse, MatrixVersion, Metadata, OutgoingRequest, SendAccessToken,
    };
    use matrix_sdk::ruma::exports::bytes::BufMut;
    use matrix_sdk::ruma::exports::http;
    use matrix_sdk::ruma::serde::json_to_buf;
    use matrix_sdk::ruma::{metadata, OwnedUserId};
    use serde_json::{Map, Value};

    /// One profile endpoint: method, path and auth.
    pub trait Endpoint: Clone + std::fmt::Debug + Send + Sync + 'static {
        const METADATA: Metadata;
    }

    /// `GET /_matrix/client/v3/profile/{userId}` — every server has it; one
    /// without extended profiles just leaves custom fields out, so reads need
    /// no unstable fallback.
    #[derive(Clone, Debug)]
    pub struct GetProfile;
    impl Endpoint for GetProfile {
        const METADATA: Metadata = metadata! {
            method: GET,
            rate_limited: false,
            authentication: AccessToken,
            history: { 1.0 => "/_matrix/client/v3/profile/:user_id", }
        };
    }

    macro_rules! field_endpoint {
        ($name:ident, $method:ident, $($history:tt)*) => {
            #[derive(Clone, Debug)]
            pub struct $name;
            impl Endpoint for $name {
                const METADATA: Metadata = metadata! {
                    method: $method,
                    rate_limited: true,
                    authentication: AccessToken,
                    history: { $($history)* }
                };
            }
        };
    }

    field_endpoint!(SetStable, PUT,
        1.0 => "/_matrix/client/v3/profile/:user_id/tel.quark.usercolor",);
    field_endpoint!(SetUnstable, PUT,
        unstable => "/_matrix/client/unstable/uk.tcpip.msc4133/profile/:user_id/tel.quark.usercolor",);
    field_endpoint!(DeleteStable, DELETE,
        1.0 => "/_matrix/client/v3/profile/:user_id/tel.quark.usercolor",);
    field_endpoint!(DeleteUnstable, DELETE,
        unstable => "/_matrix/client/unstable/uk.tcpip.msc4133/profile/:user_id/tel.quark.usercolor",);

    /// A request to endpoint `E` about `user_id`, with an optional JSON body.
    #[derive(Clone, Debug)]
    pub struct ProfileRequest<E> {
        user_id: OwnedUserId,
        body: Option<Value>,
        endpoint: PhantomData<E>,
    }

    impl<E> ProfileRequest<E> {
        pub fn new(user_id: OwnedUserId, body: Option<Value>) -> Self {
            Self { user_id, body, endpoint: PhantomData }
        }
    }

    impl<E: Endpoint> OutgoingRequest for ProfileRequest<E> {
        type EndpointError = ApiError;
        type IncomingResponse = ProfileResponse;
        const METADATA: Metadata = E::METADATA;

        fn try_into_http_request<T: Default + BufMut>(
            self,
            base_url: &str,
            access_token: SendAccessToken<'_>,
            considering_versions: &'_ [MatrixVersion],
        ) -> Result<http::Request<T>, IntoHttpError> {
            let url = E::METADATA.make_endpoint_url(considering_versions, base_url, &[&self.user_id], "")?;
            let mut request = http::Request::builder()
                .method(E::METADATA.method)
                .uri(url)
                .header(http::header::CONTENT_TYPE, "application/json");
            if let Some((name, value)) = E::METADATA.authorization_header(access_token)? {
                request = request.header(name, value);
            }
            let body = match &self.body {
                Some(json) => json_to_buf(json)?,
                None => T::default(),
            };
            Ok(request.body(body)?)
        }
    }

    /// Any of these endpoints' replies, kept as raw JSON.
    #[derive(Debug)]
    pub struct ProfileResponse {
        pub body: Map<String, Value>,
    }

    impl IncomingResponse for ProfileResponse {
        type EndpointError = ApiError;

        fn try_from_http_response<T: AsRef<[u8]>>(
            response: http::Response<T>,
        ) -> Result<Self, FromHttpResponseError<ApiError>> {
            if response.status().as_u16() >= 400 {
                return Err(FromHttpResponseError::Server(ApiError::from_http_response(response)));
            }
            let bytes = response.body().as_ref();
            let body = if bytes.is_empty() { Map::new() } else { serde_json::from_slice(bytes)? };
            Ok(Self { body })
        }
    }
}

use wire::{DeleteStable, DeleteUnstable, GetProfile, ProfileRequest, SetStable, SetUnstable};

// ── Errors ───────────────────────────────────────────────────────────────────

/// How a profile request failed, as far as caching and fallback care.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FetchError {
    /// No such profile or field: an answer, cached like a color.
    NotFound,
    /// The server doesn't know the route.
    Unrecognized,
    /// The server won't show this profile (e.g. no shared room): an answer too.
    Forbidden,
    /// The server asked to slow down (429) or is failing (5xx): pause every
    /// lookup, for the delay in seconds when it named one.
    Overloaded(Option<u64>),
    /// Network trouble or anything else unexpected: try this user again later.
    Transient(String),
}

fn classify(e: &HttpError) -> FetchError {
    match e.client_api_error_kind() {
        Some(ErrorKind::NotFound) => FetchError::NotFound,
        Some(ErrorKind::Unrecognized) => FetchError::Unrecognized,
        Some(ErrorKind::Forbidden { .. }) => FetchError::Forbidden,
        Some(ErrorKind::LimitExceeded { retry_after }) => FetchError::Overloaded(retry_after.as_ref().map(retry_secs)),
        _ => match e.as_client_api_error().map(|api| api.status_code.as_u16()) {
            // A bare 405 (no errcode) is a proxy or server that has the path
            // for other methods only — the route isn't there for this one.
            Some(405) => FetchError::Unrecognized,
            Some(404) => FetchError::NotFound,
            Some(429) => FetchError::Overloaded(None),
            Some(status) if status >= 500 => FetchError::Overloaded(None),
            _ => FetchError::Transient(e.to_string()),
        },
    }
}

/// A `retry_after` as whole seconds from now, rounded up.
fn retry_secs(after: &RetryAfter) -> u64 {
    let wait = match after {
        RetryAfter::Delay(d) => *d,
        RetryAfter::DateTime(at) => at.duration_since(std::time::SystemTime::now()).unwrap_or_default(),
    };
    wait.as_secs() + u64::from(wait.subsec_nanos() > 0)
}

/// No SDK-side retry loop: the color cache owns backoff (see `RETRY_SECS`),
/// and a retrying request would hold a concurrency permit while it waits.
fn once() -> Option<RequestConfig> {
    Some(RequestConfig::default().disable_retry())
}

// ── Reading ──────────────────────────────────────────────────────────────────

/// A user's published color: `Ok(None)` when they have none, when the value
/// isn't a valid color, or when the profile doesn't exist.
pub async fn fetch_color(client: &Client, user_id: &UserId) -> Result<Option<String>, FetchError> {
    let request = ProfileRequest::<GetProfile>::new(user_id.to_owned(), None);
    match client.send(request, once()).await {
        Ok(response) => Ok(response
            .body
            .get(FIELD)
            .and_then(JsonValue::as_str)
            .and_then(normalize_color)),
        Err(e) => match classify(&e) {
            FetchError::NotFound => Ok(None),
            other => Err(other),
        },
    }
}

// ── Writing ──────────────────────────────────────────────────────────────────

/// Whether the account may set `FIELD`, from a `profile_fields` capability:
/// `None` when the server doesn't advertise one (then saving is tried, and an
/// unrecognized route reports `UNSUPPORTED`).
pub fn can_set_from_capability(cap: Option<&JsonValue>) -> Option<bool> {
    let cap = cap?;
    if !cap.get("enabled").and_then(JsonValue::as_bool).unwrap_or(false) {
        return Some(false);
    }
    let lists = |key: &str| {
        cap.get(key)
            .and_then(JsonValue::as_array)
            .map(|items| items.iter().any(|v| v.as_str() == Some(FIELD)))
    };
    if lists("allowed") == Some(false) || lists("disallowed") == Some(true) {
        return Some(false);
    }
    Some(true)
}

/// `can_set_from_capability` for this account's homeserver; `None` on any error.
pub async fn own_can_set(client: &Client) -> Option<bool> {
    use matrix_sdk::ruma::api::client::discovery::get_capabilities::v3::Request;
    let response = client.send(Request::new(), once()).await.ok()?;
    let caps = &response.capabilities;
    CAPABILITIES
        .iter()
        .find_map(|name| caps.get(name))
        .and_then(|cap| can_set_from_capability(Some(&cap)))
}

/// Publish (or, with `None`, remove) the account's color. Returns the color
/// as stored. An invalid color is refused before any request is made.
pub async fn set_own_color(client: &Client, color: Option<&str>) -> Result<Option<String>, String> {
    let color = match color {
        Some(raw) => Some(normalize_color(raw).ok_or_else(|| format!("Not a color: {raw}"))?),
        None => None,
    };
    let me = client.user_id().ok_or("Not logged in")?.to_owned();

    let body = color.as_ref().map(|c| serde_json::json!({ FIELD: c }));
    let send = |unstable: bool| {
        let (client, me, body) = (client.clone(), me.clone(), body.clone());
        async move {
            match (body, unstable) {
                (Some(b), false) => client.send(ProfileRequest::<SetStable>::new(me, Some(b)), once()).await,
                (Some(b), true) => client.send(ProfileRequest::<SetUnstable>::new(me, Some(b)), once()).await,
                (None, false) => client.send(ProfileRequest::<DeleteStable>::new(me, None), once()).await,
                (None, true) => client.send(ProfileRequest::<DeleteUnstable>::new(me, None), once()).await,
            }
            .map(|_| ())
        }
    };
    let outcome = match send(false).await {
        Err(e) if classify(&e) == FetchError::Unrecognized => send(true).await,
        other => other,
    };
    match outcome {
        Ok(()) => Ok(color),
        // Clearing a color that was never set.
        Err(e) if color.is_none() && classify(&e) == FetchError::NotFound => Ok(None),
        Err(e) if classify(&e) == FetchError::Unrecognized => Err(UNSUPPORTED.to_string()),
        Err(e) => Err(format!("Failed to save your color: {e}")),
    }
}

// ── Support ──────────────────────────────────────────────────────────────────

/// Does a `/versions` answer advertise extended profiles — Matrix 1.16 or
/// later, or MSC4133 as an unstable feature?
pub fn versions_advertise_fields(versions: &[String], unstable: &BTreeMap<String, bool>) -> bool {
    let spec_has_them = versions.iter().any(|v| {
        let Some((major, minor)) = v.strip_prefix('v').and_then(|v| v.split_once('.')) else { return false };
        match (major.parse::<u32>(), minor.parse::<u32>()) {
            (Ok(major), Ok(minor)) => (major, minor) >= FIRST_VERSION_WITH_FIELDS,
            _ => false,
        }
    });
    spec_has_them || UNSTABLE_FEATURES.iter().any(|f| unstable.get(*f) == Some(&true))
}

/// Whether this account's homeserver has extended profiles at all, from what
/// it advertises: its `/versions`, then a `profile_fields` capability (present
/// at all, even disabled, means fields can be read). `None` when it couldn't
/// be asked. A server without them never returns anyone's color, so asking
/// it about every sender would be load with no possible answer.
pub async fn server_supports_fields(client: &Client) -> Option<bool> {
    use matrix_sdk::ruma::api::client::discovery::{get_capabilities, get_supported_versions};
    let versions = client.send(get_supported_versions::Request::new(), once()).await.ok()?;
    if versions_advertise_fields(&versions.versions, &versions.unstable_features) {
        return Some(true);
    }
    let caps = client.send(get_capabilities::v3::Request::new(), once()).await.ok()?;
    Some(CAPABILITIES.iter().any(|name| caps.capabilities.get(name).is_some()))
}

/// The account's own color and whether it can be changed, for the editor.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct OwnUserColor {
    pub color: Option<String>,
    pub can_set: Option<bool>,
}

// ── Cache ────────────────────────────────────────────────────────────────────
//
// Colors are read lazily, for senders actually on screen, and an early Quark
// once flooded its homeserver with concurrent requests — so this is where
// rate-safety lives: one request per user in flight, at most MAX_CONCURRENT at
// once, every answer (including "no color") kept for TTL_SECS and persisted so
// a relaunch doesn't re-ask, failures backed off for RETRY_SECS, every lookup
// paused when the server answers 429 (for its retry-after) or 5xx (RETRY_SECS),
// and nothing asked at all, for the session, of a server without extended
// profiles. Answers that land after the account changed are dropped.

/// Concurrent profile lookups, at most.
pub const MAX_CONCURRENT: usize = 4;
/// How long an answer is trusted before it's refreshed (stale is still shown).
pub const TTL_SECS: u64 = 24 * 60 * 60;
/// How long a failed lookup waits before it's tried again.
pub const RETRY_SECS: u64 = 5 * 60;
/// Emitted with `{ user_id, color }` when a lookup changes what's known.
pub const EVENT: &str = "quark://user-color";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Entry {
    color: Option<String>,
    fetched_at: u64,
}

#[derive(Serialize, Deserialize)]
struct Persisted {
    account: String,
    entries: HashMap<String, Entry>,
}

#[derive(Default)]
struct Inner {
    account: Option<String>,
    entries: HashMap<String, Entry>,
    in_flight: HashSet<String>,
    retry_after: HashMap<String, u64>,
    /// No lookup is sent before this (a 429 or 5xx asked for a pause).
    paused_until: u64,
    /// Whether the homeserver has extended profiles; `None` until known.
    supported: Option<bool>,
}

/// Other users' colors, for one account at a time.
pub struct UserColorCache {
    inner: Mutex<Inner>,
    permits: Arc<Semaphore>,
    /// Held while the homeserver's support is being asked, so concurrent
    /// batches wait for one answer instead of each asking.
    probing: tokio::sync::Mutex<()>,
    /// Held across a persist's snapshot, write and rename, so writes land in
    /// snapshot order (the last is the newest) and never share the temp file.
    persisting: Mutex<()>,
    path: Option<PathBuf>,
}

/// The payload of `EVENT`.
#[derive(Debug, Clone, Serialize)]
pub struct UserColorUpdate {
    pub user_id: String,
    pub color: Option<String>,
}

impl UserColorCache {
    /// A cache persisted at `path` (`None`: memory only).
    pub fn new(path: Option<PathBuf>) -> Self {
        Self {
            inner: Mutex::new(Inner::default()),
            permits: Arc::new(Semaphore::new(MAX_CONCURRENT)),
            probing: tokio::sync::Mutex::new(()),
            persisting: Mutex::new(()),
            path,
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        // A poisoned lock only means a panic mid-update of plain maps; the
        // worst left behind is a stale entry, so carry on with it.
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Serve `account`'s cache: loads it from disk the first time, and drops
    /// whatever another account left in memory. A file written for a
    /// different account is ignored.
    pub fn ensure_account(&self, account: &str) {
        let mut inner = self.lock();
        if inner.account.as_deref() == Some(account) {
            return;
        }
        *inner = Inner { account: Some(account.to_string()), ..Inner::default() };
        if let Some(saved) = self.read_file() {
            if saved.account == account {
                inner.entries = saved.entries;
            }
        }
    }

    fn read_file(&self) -> Option<Persisted> {
        let text = std::fs::read_to_string(self.path.as_ref()?).ok()?;
        let mut saved: Persisted = serde_json::from_str(&text).ok()?;
        // The file is ours, but it is still not trusted to hold valid colors.
        for entry in saved.entries.values_mut() {
            entry.color = entry.color.as_deref().and_then(normalize_color);
        }
        Some(saved)
    }

    /// What's known about `ids`, stale or not; unknown IDs are absent.
    pub fn snapshot(&self, ids: &[String]) -> HashMap<String, Option<String>> {
        let inner = self.lock();
        ids.iter()
            .filter_map(|id| inner.entries.get(id).map(|e| (id.clone(), e.color.clone())))
            .collect()
    }

    /// The IDs among `ids` worth a request now — unknown or stale, not
    /// already being fetched and not backing off — marked as in flight. None,
    /// once the homeserver is known to have no extended profiles.
    pub fn take_due(&self, ids: &[String], now: u64) -> Vec<String> {
        let mut inner = self.lock();
        if inner.supported == Some(false) || now < inner.paused_until {
            return Vec::new();
        }
        let mut due = Vec::new();
        for id in ids {
            if inner.in_flight.contains(id) {
                continue;
            }
            if inner.retry_after.get(id).is_some_and(|&t| now < t) {
                continue;
            }
            if inner.entries.get(id).is_some_and(|e| now < e.fetched_at.saturating_add(TTL_SECS)) {
                continue;
            }
            inner.in_flight.insert(id.clone());
            due.push(id.clone());
        }
        due
    }

    /// Store the outcome of a lookup made for `account`. Returns `Some(color)`
    /// when that changes what's known (a first answer counts), `None`
    /// otherwise. An answer for an account the cache no longer serves (it
    /// logged out while the lookup ran) is dropped: it says nothing about the
    /// account now served, whose own lookup of that user may be in flight.
    pub fn record(&self, account: &str, id: &str, outcome: Result<Option<String>, FetchError>, now: u64) -> Option<Option<String>> {
        let mut inner = self.lock();
        if inner.account.as_deref() != Some(account) {
            return None;
        }
        inner.in_flight.remove(id);
        let color = match outcome {
            Ok(color) => color,
            Err(FetchError::NotFound | FetchError::Forbidden) => None,
            Err(FetchError::Overloaded(after)) => {
                let until = now.saturating_add(after.unwrap_or(RETRY_SECS).max(1));
                inner.paused_until = inner.paused_until.max(until);
                inner.retry_after.insert(id.to_string(), now.saturating_add(RETRY_SECS));
                return None;
            }
            Err(FetchError::Unrecognized | FetchError::Transient(_)) => {
                inner.retry_after.insert(id.to_string(), now.saturating_add(RETRY_SECS));
                return None;
            }
        };
        inner.retry_after.remove(id);
        let previous = inner.entries.insert(id.to_string(), Entry { color: color.clone(), fetched_at: now });
        match previous {
            Some(prev) if prev.color == color => None,
            _ => Some(color),
        }
    }

    /// May a lookup for `account` go out now? Not once the cache serves
    /// another account, nor while paused.
    fn may_send(&self, account: &str, now: u64) -> bool {
        let inner = self.lock();
        inner.account.as_deref() == Some(account) && now >= inner.paused_until
    }

    /// What's known of the homeserver having extended profiles.
    fn supported(&self) -> Option<bool> {
        self.lock().supported
    }

    /// Record whether `account`'s homeserver has extended profiles — dropped
    /// when the cache has moved on to another account since it was asked.
    fn set_supported(&self, account: &str, supported: bool) {
        let mut inner = self.lock();
        if inner.account.as_deref() == Some(account) {
            inner.supported = Some(supported);
        }
    }

    /// Let `ids` (from `take_due` for `account`) go unanswered, no longer in
    /// flight.
    fn release(&self, account: &str, ids: &[String]) {
        let mut inner = self.lock();
        if inner.account.as_deref() != Some(account) {
            return;
        }
        for id in ids {
            inner.in_flight.remove(id);
        }
    }

    /// The account's own color, known first-hand (just read or just saved).
    pub fn put_own(&self, id: &str, color: Option<String>, now: u64) {
        let mut inner = self.lock();
        inner.entries.insert(id.to_string(), Entry { color, fetched_at: now });
    }

    /// Write the cache to disk (temp file + rename, so a crash can't leave
    /// half a file). Best-effort: a failure only costs re-fetching next launch.
    pub fn persist(&self) {
        let Some(path) = &self.path else { return };
        let _writing = self.persisting.lock().unwrap_or_else(|p| p.into_inner());
        let json = {
            let inner = self.lock();
            let Some(account) = inner.account.clone() else { return };
            match serde_json::to_string(&Persisted { account, entries: inner.entries.clone() }) {
                Ok(json) => json,
                Err(_) => return,
            }
        };
        let tmp = path.with_extension("json.tmp");
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(&tmp, path);
        }
    }

    /// Forget everything, on disk too (logout).
    pub fn clear(&self) {
        // After any write in progress, which would otherwise put the file back.
        let _writing = self.persisting.lock().unwrap_or_else(|p| p.into_inner());
        *self.lock() = Inner::default();
        if let Some(path) = &self.path {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// Managed state for the color cache.
pub struct UserColorState(pub Arc<UserColorCache>);

/// Seconds since the Unix epoch.
pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Does this account's homeserver have extended profiles? Asked once per
/// session; when it can't be told, lookups go ahead as if it did.
async fn ensure_supported(client: &Client, cache: &UserColorCache) -> bool {
    if let Some(known) = cache.supported() {
        return known;
    }
    let _probing = cache.probing.lock().await;
    if let Some(known) = cache.supported() {
        return known;
    }
    let Some(account) = client.user_id().map(|u| u.to_string()) else { return true };
    match server_supports_fields(client).await {
        Some(verdict) => {
            cache.set_supported(&account, verdict);
            verdict
        }
        None => true,
    }
}

/// Look up `ids` (from `take_due`), at most `MAX_CONCURRENT` at a time,
/// recording each answer and calling `emit` for those that change something.
/// Persists once, at the end. Nothing is looked up from a homeserver without
/// extended profiles, and a 429 or 5xx stops the lookups still queued (they
/// are due again once the pause ends).
pub async fn refresh<F>(client: Client, cache: Arc<UserColorCache>, ids: Vec<String>, emit: F)
where
    F: Fn(&str, Option<String>) + Send + Sync + 'static,
{
    // The account these lookups are for: the one this client is logged in as.
    let Some(account) = client.user_id().map(|u| u.to_string()) else { return };
    if !ensure_supported(&client, &cache).await {
        cache.release(&account, &ids);
        return;
    }
    let emit = Arc::new(emit);
    let lookups = ids.into_iter().map(|id| {
        let (client, cache, emit, account) = (client.clone(), cache.clone(), emit.clone(), account.clone());
        async move {
            let outcome = match UserId::parse(id.as_str()) {
                Ok(user_id) => {
                    let Ok(_permit) = cache.permits.clone().acquire_owned().await else { return };
                    // Re-checked after the wait: a 429 or 5xx while this one
                    // queued pauses the rest of the batch, and a logout ends it.
                    if !cache.may_send(&account, now_secs()) {
                        cache.release(&account, std::slice::from_ref(&id));
                        return;
                    }
                    fetch_color(&client, &user_id).await
                }
                Err(_) => Ok(None),
            };
            if let Some(color) = cache.record(&account, &id, outcome, now_secs()) {
                emit(&id, color);
            }
        }
    });
    futures_util::future::join_all(lookups).await;
    cache.persist();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::matrix::test_support::{TestHomeserver, ME};
    use matrix_sdk::ruma::OwnedUserId;
    use serde_json::json;
    use wiremock::matchers::{body_json, method, path};
    use wiremock::{Mock, ResponseTemplate};

    const STABLE_ME: &str = "/_matrix/client/v3/profile/@me:example.org/tel.quark.usercolor";
    const UNSTABLE_ME: &str =
        "/_matrix/client/unstable/uk.tcpip.msc4133/profile/@me:example.org/tel.quark.usercolor";

    fn uid(s: &str) -> OwnedUserId {
        UserId::parse(s).expect("user id")
    }

    async fn mount(hs: &TestHomeserver, verb: &str, at: &str, status: u16, body: serde_json::Value) {
        Mock::given(method(verb))
            .and(path(at))
            .respond_with(ResponseTemplate::new(status).set_body_json(body))
            .mount(&hs.server)
            .await;
    }

    #[test]
    fn capability_absent_is_unknown() {
        assert_eq!(can_set_from_capability(None), None);
    }

    #[test]
    fn capability_disabled_blocks() {
        assert_eq!(can_set_from_capability(Some(&json!({ "enabled": false }))), Some(false));
    }

    #[test]
    fn capability_allowed_list_without_field_blocks() {
        let cap = json!({ "enabled": true, "allowed": ["m.tz"] });
        assert_eq!(can_set_from_capability(Some(&cap)), Some(false));
    }

    #[test]
    fn capability_disallowed_field_blocks() {
        let cap = json!({ "enabled": true, "disallowed": [FIELD] });
        assert_eq!(can_set_from_capability(Some(&cap)), Some(false));
    }

    #[test]
    fn capability_enabled_allows() {
        assert_eq!(can_set_from_capability(Some(&json!({ "enabled": true }))), Some(true));
        let listed = json!({ "enabled": true, "allowed": [FIELD] });
        assert_eq!(can_set_from_capability(Some(&listed)), Some(true));
    }

    #[tokio::test]
    async fn fetch_reads_and_normalizes_the_field() {
        let hs = TestHomeserver::new().await;
        let body = json!({ "displayname": "A", FIELD: "#ABC" });
        mount(&hs, "GET", "/_matrix/client/v3/profile/@fetch-a:example.org", 200, body).await;
        let got = fetch_color(&hs.client, &uid("@fetch-a:example.org")).await;
        assert_eq!(got.ok().flatten().as_deref(), Some("#aabbcc"));
    }

    #[tokio::test]
    async fn fetch_ignores_non_string_and_invalid_values() {
        let hs = TestHomeserver::new().await;
        mount(&hs, "GET", "/_matrix/client/v3/profile/@num:example.org", 200, json!({ FIELD: 42 })).await;
        mount(&hs, "GET", "/_matrix/client/v3/profile/@css:example.org", 200, json!({ FIELD: "url(x)" })).await;
        mount(&hs, "GET", "/_matrix/client/v3/profile/@none:example.org", 200, json!({ "displayname": "N" }))
            .await;
        for who in ["@num:example.org", "@css:example.org", "@none:example.org"] {
            assert!(matches!(fetch_color(&hs.client, &uid(who)).await, Ok(None)), "{who}");
        }
    }

    #[tokio::test]
    async fn fetch_maps_404_to_none() {
        let hs = TestHomeserver::new().await;
        let body = json!({ "errcode": "M_NOT_FOUND", "error": "Profile was not found" });
        mount(&hs, "GET", "/_matrix/client/v3/profile/@gone:example.org", 404, body).await;
        assert!(matches!(fetch_color(&hs.client, &uid("@gone:example.org")).await, Ok(None)));
    }

    #[tokio::test]
    async fn fetch_reports_server_errors_as_overload() {
        let hs = TestHomeserver::new().await;
        let body = json!({ "errcode": "M_UNKNOWN", "error": "boom" });
        mount(&hs, "GET", "/_matrix/client/v3/profile/@flaky:example.org", 500, body).await;
        let got = fetch_color(&hs.client, &uid("@flaky:example.org")).await;
        assert_eq!(got, Err(FetchError::Overloaded(None)));
    }

    #[tokio::test]
    async fn fetch_reports_rate_limits_with_their_delay() {
        let hs = TestHomeserver::new().await;
        let body = json!({ "errcode": "M_LIMIT_EXCEEDED", "error": "slow down", "retry_after_ms": 2_500 });
        mount(&hs, "GET", "/_matrix/client/v3/profile/@limited:example.org", 429, body).await;
        let got = fetch_color(&hs.client, &uid("@limited:example.org")).await;
        assert_eq!(got, Err(FetchError::Overloaded(Some(3))), "rounded up to whole seconds");
    }

    #[tokio::test]
    async fn fetch_reports_other_failures_as_transient() {
        let hs = TestHomeserver::new().await;
        let body = json!({ "errcode": "M_UNKNOWN", "error": "odd" });
        mount(&hs, "GET", "/_matrix/client/v3/profile/@odd:example.org", 400, body).await;
        let got = fetch_color(&hs.client, &uid("@odd:example.org")).await;
        assert!(matches!(got, Err(FetchError::Transient(_))), "{got:?}");
    }

    #[tokio::test]
    async fn set_uses_the_stable_path() {
        let hs = TestHomeserver::new().await;
        Mock::given(method("PUT"))
            .and(path(STABLE_ME))
            .and(body_json(json!({ FIELD: "#ffffff" })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
            .mount(&hs.server)
            .await;
        assert_eq!(set_own_color(&hs.client, Some("#FFF")).await, Ok(Some("#ffffff".into())));
        assert_eq!(hs.requests_to(STABLE_ME).await, 1);
        assert_eq!(ME, "@me:example.org");
    }

    #[tokio::test]
    async fn set_falls_back_to_unstable() {
        let hs = TestHomeserver::new().await;
        let unrecognized = json!({ "errcode": "M_UNRECOGNIZED", "error": "Unrecognized request" });
        mount(&hs, "PUT", STABLE_ME, 404, unrecognized).await;
        mount(&hs, "PUT", UNSTABLE_ME, 200, json!({})).await;
        assert_eq!(set_own_color(&hs.client, Some("#00ff41")).await, Ok(Some("#00ff41".into())));
        assert_eq!(hs.requests_to(UNSTABLE_ME).await, 1);
    }

    #[tokio::test]
    async fn set_reports_unsupported_server() {
        let hs = TestHomeserver::new().await;
        let unrecognized = json!({ "errcode": "M_UNRECOGNIZED", "error": "Unrecognized request" });
        mount(&hs, "PUT", STABLE_ME, 404, unrecognized.clone()).await;
        mount(&hs, "PUT", UNSTABLE_ME, 404, unrecognized).await;
        assert_eq!(set_own_color(&hs.client, Some("#00ff41")).await, Err(UNSUPPORTED.to_string()));
    }

    #[tokio::test]
    async fn clear_sends_delete_and_tolerates_not_found() {
        let hs = TestHomeserver::new().await;
        let not_found = json!({ "errcode": "M_NOT_FOUND", "error": "No such field" });
        mount(&hs, "DELETE", STABLE_ME, 404, not_found).await;
        assert_eq!(set_own_color(&hs.client, None).await, Ok(None));
        assert_eq!(hs.requests_to(STABLE_ME).await, 1);
    }

    #[tokio::test]
    async fn set_rejects_invalid_color_without_a_request() {
        let hs = TestHomeserver::new().await;
        let err = set_own_color(&hs.client, Some("red")).await.expect_err("invalid");
        assert!(err.starts_with("Not a color"), "{err}");
        assert_eq!(hs.requests_to("tel.quark.usercolor").await, 0);
    }

    // ── Cache ────────────────────────────────────────────────────────────────

    const T: u64 = 1_000_000;

    fn ids(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    fn cache_for(account: &str) -> UserColorCache {
        let cache = UserColorCache::new(None);
        cache.ensure_account(account);
        cache
    }

    #[test]
    fn fresh_entries_are_not_due() {
        let cache = cache_for(ME);
        assert_eq!(cache.take_due(&ids(&["@a:x.org"]), T), ids(&["@a:x.org"]));
        cache.record(ME, "@a:x.org", Ok(Some("#ff4466".into())), T);
        assert!(cache.take_due(&ids(&["@a:x.org"]), T + TTL_SECS - 1).is_empty());
    }

    #[test]
    fn stale_entries_are_due_but_still_served() {
        let cache = cache_for(ME);
        cache.take_due(&ids(&["@a:x.org"]), T);
        cache.record(ME, "@a:x.org", Ok(Some("#ff4466".into())), T);
        assert_eq!(cache.take_due(&ids(&["@a:x.org"]), T + TTL_SECS), ids(&["@a:x.org"]));
        assert_eq!(cache.snapshot(&ids(&["@a:x.org"]))["@a:x.org"].as_deref(), Some("#ff4466"));
    }

    #[test]
    fn negative_results_are_cached() {
        let cache = cache_for(ME);
        cache.take_due(&ids(&["@a:x.org", "@b:x.org"]), T);
        cache.record(ME, "@a:x.org", Err(FetchError::NotFound), T);
        cache.record(ME, "@b:x.org", Err(FetchError::Forbidden), T);
        let snap = cache.snapshot(&ids(&["@a:x.org", "@b:x.org"]));
        assert_eq!(snap.get("@a:x.org"), Some(&None));
        assert_eq!(snap.get("@b:x.org"), Some(&None));
        assert!(cache.take_due(&ids(&["@a:x.org", "@b:x.org"]), T + 1).is_empty());
    }

    #[test]
    fn transient_errors_back_off() {
        let cache = cache_for(ME);
        cache.take_due(&ids(&["@a:x.org"]), T);
        cache.record(ME, "@a:x.org", Err(FetchError::Transient("boom".into())), T);
        assert!(cache.snapshot(&ids(&["@a:x.org"])).is_empty(), "nothing known yet");
        assert!(cache.take_due(&ids(&["@a:x.org"]), T + RETRY_SECS - 1).is_empty());
        assert_eq!(cache.take_due(&ids(&["@a:x.org"]), T + RETRY_SECS), ids(&["@a:x.org"]));
    }

    #[test]
    fn in_flight_ids_are_not_handed_out_twice() {
        let cache = cache_for(ME);
        assert_eq!(cache.take_due(&ids(&["@a:x.org", "@a:x.org"]), T), ids(&["@a:x.org"]));
        assert!(cache.take_due(&ids(&["@a:x.org"]), T).is_empty());
    }

    #[test]
    fn record_reports_only_changes() {
        let cache = cache_for(ME);
        assert_eq!(cache.record(ME, "@a:x.org", Ok(None), T), Some(None), "first answer is news");
        assert_eq!(cache.record(ME, "@a:x.org", Ok(None), T + 1), None);
        assert_eq!(cache.record(ME, "@a:x.org", Ok(Some("#ffffff".into())), T + 2), Some(Some("#ffffff".into())));
        assert_eq!(cache.record(ME, "@a:x.org", Ok(Some("#ffffff".into())), T + 3), None);
    }

    #[test]
    fn persist_and_reload_same_account() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("user_colors.json");
        let first = UserColorCache::new(Some(path.clone()));
        first.ensure_account(ME);
        first.record(ME, "@a:x.org", Ok(Some("#ff4466".into())), T);
        first.record(ME, "@b:x.org", Ok(None), T);
        first.persist();

        let second = UserColorCache::new(Some(path));
        second.ensure_account(ME);
        assert_eq!(
            second.snapshot(&ids(&["@a:x.org", "@b:x.org"])),
            first.snapshot(&ids(&["@a:x.org", "@b:x.org"]))
        );
        assert!(second.take_due(&ids(&["@a:x.org"]), T + 1).is_empty(), "fetched_at survives");
    }

    #[test]
    fn other_account_discards_disk_cache() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("user_colors.json");
        let first = UserColorCache::new(Some(path.clone()));
        first.ensure_account(ME);
        first.record(ME, "@a:x.org", Ok(Some("#ff4466".into())), T);
        first.persist();

        let second = UserColorCache::new(Some(path));
        second.ensure_account("@other:x.org");
        assert!(second.snapshot(&ids(&["@a:x.org"])).is_empty());
        // And switching accounts on a live cache drops what it held.
        first.ensure_account("@other:x.org");
        assert!(first.snapshot(&ids(&["@a:x.org"])).is_empty());
    }

    #[test]
    fn clear_deletes_the_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("user_colors.json");
        let cache = UserColorCache::new(Some(path.clone()));
        cache.ensure_account(ME);
        cache.record(ME, "@a:x.org", Ok(Some("#ff4466".into())), T);
        cache.persist();
        assert!(path.exists());
        cache.clear();
        assert!(!path.exists());
        assert!(cache.snapshot(&ids(&["@a:x.org"])).is_empty());
    }

    #[test]
    fn a_lookup_finishing_after_an_account_switch_is_dropped() {
        const OTHER: &str = "@other:x.org";
        let cache = cache_for(ME);
        cache.take_due(&ids(&["@a:x.org"]), T);
        cache.ensure_account(OTHER); // logout + login while ME's lookup runs
        assert_eq!(cache.take_due(&ids(&["@a:x.org"]), T), ids(&["@a:x.org"]));
        // ME's slow answer (Forbidden is about ME's rooms, not OTHER's) lands now.
        assert_eq!(cache.record(ME, "@a:x.org", Err(FetchError::Forbidden), T), None);
        assert!(cache.snapshot(&ids(&["@a:x.org"])).is_empty());
        assert!(cache.take_due(&ids(&["@a:x.org"]), T).is_empty(), "OTHER's own lookup is still in flight");
    }

    #[test]
    fn concurrent_persists_leave_the_newest_whole_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("user_colors.json");
        for round in 0..20 {
            let cache = Arc::new(UserColorCache::new(Some(path.clone())));
            cache.ensure_account(ME);
            let writers: Vec<_> = (0..8)
                .map(|i| {
                    let cache = cache.clone();
                    std::thread::spawn(move || {
                        cache.record(ME, &format!("@u{i}:x.org"), Ok(None), T);
                        cache.persist();
                    })
                })
                .collect();
            for w in writers {
                w.join().unwrap();
            }
            let reloaded = UserColorCache::new(Some(path.clone()));
            reloaded.ensure_account(ME);
            let all: Vec<String> = (0..8).map(|i| format!("@u{i}:x.org")).collect();
            assert_eq!(reloaded.snapshot(&all).len(), 8, "round {round}: a stale or torn write won");
        }
    }

    #[tokio::test]
    async fn rate_limiting_pauses_the_whole_batch() {
        let hs = TestHomeserver::new().await;
        let users: Vec<String> = (0..10).map(|i| format!("@busy{i}:example.org")).collect();
        let limited = ResponseTemplate::new(429)
            .set_body_json(json!({ "errcode": "M_LIMIT_EXCEEDED", "error": "Too many", "retry_after_ms": 30_000 }))
            .set_delay(std::time::Duration::from_millis(50));
        for u in &users {
            Mock::given(method("GET"))
                .and(path(format!("/_matrix/client/v3/profile/{u}")))
                .respond_with(limited.clone())
                .mount(&hs.server)
                .await;
        }
        let cache = Arc::new(cache_for(ME));
        let due = cache.take_due(&users, now_secs());
        refresh(hs.client.clone(), cache.clone(), due, |_: &str, _: Option<String>| {}).await;
        // The first wave was already on the wire; nothing after the 429 went out.
        assert!(hs.requests_to("/profile/").await <= MAX_CONCURRENT);
        let later = ids(&["@new:example.org"]);
        assert!(cache.take_due(&later, now_secs()).is_empty(), "paused for retry_after_ms");
        assert_eq!(cache.take_due(&later, now_secs() + 31), later);
        // The users that were never sent are due again once the pause ends.
        let resumed = cache.take_due(&users, now_secs() + 31);
        assert_eq!(resumed.len() + hs.requests_to("/profile/").await, users.len());
    }

    #[tokio::test]
    async fn a_server_error_pauses_lookups_too() {
        let hs = TestHomeserver::new().await;
        mount(&hs, "GET", "/_matrix/client/v3/profile/@down:example.org", 503, json!({})).await;
        let cache = Arc::new(cache_for(ME));
        let due = cache.take_due(&ids(&["@down:example.org"]), now_secs());
        refresh(hs.client.clone(), cache.clone(), due, |_: &str, _: Option<String>| {}).await;
        assert!(cache.take_due(&ids(&["@next:example.org"]), now_secs()).is_empty());
        assert_eq!(
            cache.take_due(&ids(&["@next:example.org"]), now_secs() + RETRY_SECS + 1),
            ids(&["@next:example.org"])
        );
    }

    #[tokio::test]
    async fn refresh_fetches_each_user_once_even_when_asked_twice() {
        let hs = TestHomeserver::new().await;
        Mock::given(method("GET"))
            .and(path("/_matrix/client/v3/profile/@twice:example.org"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({ FIELD: "#ff4466" }))
                    .set_delay(std::time::Duration::from_millis(200)),
            )
            .mount(&hs.server)
            .await;
        let cache = std::sync::Arc::new(cache_for(ME));
        let asked = ids(&["@twice:example.org"]);
        let first = cache.take_due(&asked, T);
        let second = cache.take_due(&asked, T);
        let emitted = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = emitted.clone();
        let emit = move |id: &str, c: Option<String>| sink.lock().unwrap().push((id.to_string(), c));
        tokio::join!(
            refresh(hs.client.clone(), cache.clone(), first, emit.clone()),
            refresh(hs.client.clone(), cache.clone(), second, emit),
        );
        assert_eq!(hs.requests_to("@twice:example.org").await, 1);
        assert_eq!(
            emitted.lock().unwrap().as_slice(),
            &[("@twice:example.org".to_string(), Some("#ff4466".to_string()))]
        );
    }

    #[tokio::test]
    async fn refresh_never_exceeds_the_concurrency_cap() {
        let hs = TestHomeserver::new().await;
        let delay = std::time::Duration::from_millis(200);
        let users: Vec<String> = (0..10).map(|i| format!("@cap{i}:example.org")).collect();
        for u in &users {
            Mock::given(method("GET"))
                .and(path(format!("/_matrix/client/v3/profile/{u}")))
                .respond_with(ResponseTemplate::new(200).set_body_json(json!({})).set_delay(delay))
                .mount(&hs.server)
                .await;
        }
        let cache = std::sync::Arc::new(cache_for(ME));
        let due = cache.take_due(&users, T);
        let started = std::time::Instant::now();
        refresh(hs.client.clone(), cache.clone(), due, |_: &str, _: Option<String>| {}).await;
        let took = started.elapsed();
        // 10 requests, 4 at a time: three rounds of the delay — two would mean
        // the cap is 5 or more; ten would mean nothing ran in parallel.
        assert!(took >= delay * 3 - std::time::Duration::from_millis(50), "{took:?}");
        assert!(took < delay * 6, "{took:?}");
        assert_eq!(MAX_CONCURRENT, 4);
        assert_eq!(cache.snapshot(&users).len(), 10);
    }

    // ── Servers without extended profiles ───────────────────────────────────

    fn features(list: &[(&str, bool)]) -> BTreeMap<String, bool> {
        list.iter().map(|(k, v)| (k.to_string(), *v)).collect()
    }

    #[test]
    fn versions_advertise_extended_profiles() {
        let none = features(&[]);
        assert!(!versions_advertise_fields(&ids(&["r0.6.1", "v1.1", "v1.15"]), &none));
        assert!(versions_advertise_fields(&ids(&["v1.16"]), &none));
        assert!(versions_advertise_fields(&ids(&["v1.17"]), &none));
        assert!(versions_advertise_fields(&ids(&["v2.0"]), &none));
        let v = ids(&["v1.11"]);
        assert!(versions_advertise_fields(&v, &features(&[("uk.tcpip.msc4133", true)])));
        assert!(versions_advertise_fields(&v, &features(&[("uk.tcpip.msc4133.stable", true)])));
        assert!(!versions_advertise_fields(&v, &features(&[("uk.tcpip.msc4133", false)])));
        assert!(!versions_advertise_fields(&ids(&["v1.1x", "vNaN"]), &none));
    }

    async fn mount_versions(hs: &TestHomeserver, versions: &[&str], unstable: serde_json::Value) {
        mount(hs, "GET", "/_matrix/client/versions", 200, json!({ "versions": versions, "unstable_features": unstable })).await;
    }

    async fn mount_capabilities(hs: &TestHomeserver, caps: serde_json::Value) {
        mount(hs, "GET", "/_matrix/client/v3/capabilities", 200, json!({ "capabilities": caps })).await;
    }

    async fn mount_profile(hs: &TestHomeserver, user: &str) {
        mount(hs, "GET", &format!("/_matrix/client/v3/profile/{user}"), 200, json!({ FIELD: "#ff4466" })).await;
    }

    #[tokio::test]
    async fn refresh_stops_asking_a_server_without_extended_profiles() {
        let hs = TestHomeserver::new().await;
        mount_versions(&hs, &["v1.11"], json!({})).await;
        mount_capabilities(&hs, json!({ "m.change_password": { "enabled": true } })).await;
        mount_profile(&hs, "@nofields:example.org").await;
        let cache = Arc::new(cache_for(ME));
        let asked = ids(&["@nofields:example.org"]);
        let due = cache.take_due(&asked, T);
        refresh(hs.client.clone(), cache.clone(), due, |_: &str, _: Option<String>| {}).await;
        assert_eq!(hs.requests_to("/profile/").await, 0);
        // Nothing more is due this session — not these users, not new ones.
        assert!(cache.take_due(&asked, T + TTL_SECS + 1).is_empty());
        assert!(cache.take_due(&ids(&["@later:example.org"]), T).is_empty());
        assert_eq!(hs.requests_to("/versions").await, 1);
    }

    #[tokio::test]
    async fn refresh_asks_when_the_server_advertises_profile_fields() {
        for (versions, unstable, caps) in [
            (["v1.16"], json!({}), json!({})),
            (["v1.11"], json!({ "uk.tcpip.msc4133": true }), json!({})),
            (["v1.11"], json!({}), json!({ "uk.tcpip.msc4133.profile_fields": { "enabled": false } })),
        ] {
            let hs = TestHomeserver::new().await;
            mount_versions(&hs, &versions, unstable).await;
            mount_capabilities(&hs, caps).await;
            mount_profile(&hs, "@fields:example.org").await;
            let cache = Arc::new(cache_for(ME));
            let due = cache.take_due(&ids(&["@fields:example.org"]), T);
            refresh(hs.client.clone(), cache.clone(), due, |_: &str, _: Option<String>| {}).await;
            assert_eq!(hs.requests_to("/profile/").await, 1);
            assert_eq!(
                cache.snapshot(&ids(&["@fields:example.org"])).get("@fields:example.org"),
                Some(&Some("#ff4466".to_string()))
            );
        }
    }

    #[tokio::test]
    async fn refresh_asks_when_support_cant_be_told() {
        let hs = TestHomeserver::new().await;
        mount(&hs, "GET", "/_matrix/client/versions", 502, json!({})).await;
        mount_profile(&hs, "@unsure:example.org").await;
        let cache = Arc::new(cache_for(ME));
        let due = cache.take_due(&ids(&["@unsure:example.org"]), T);
        refresh(hs.client.clone(), cache.clone(), due, |_: &str, _: Option<String>| {}).await;
        assert_eq!(hs.requests_to("/profile/").await, 1);
    }

    #[test]
    fn another_account_gets_its_own_verdict() {
        let cache = cache_for(ME);
        cache.set_supported(ME, false);
        assert!(cache.take_due(&ids(&["@a:x.org"]), T).is_empty());
        // A verdict for an account no longer being served is dropped.
        cache.ensure_account("@other:x.org");
        cache.set_supported(ME, false);
        assert_eq!(cache.take_due(&ids(&["@a:x.org"]), T), ids(&["@a:x.org"]));
    }
}
