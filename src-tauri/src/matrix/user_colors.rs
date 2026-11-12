//! User colors (#45) over the wire: the `tel.quark.usercolor` field of a
//! user's public profile (Matrix 1.16 extended profiles / MSC4133).

use matrix_sdk::config::RequestConfig;
use matrix_sdk::ruma::api::client::error::ErrorKind;
use matrix_sdk::ruma::UserId;
use matrix_sdk::{Client, HttpError};
use serde::Serialize;
use serde_json::Value as JsonValue;

use crate::config::user_colors::normalize_color;

/// The profile field a user's color lives in.
pub const FIELD: &str = "tel.quark.usercolor";

/// What saving says when the homeserver has no extended profiles at all.
pub const UNSUPPORTED: &str = "Your homeserver doesn't support custom profile fields.";

/// Stable capability name (Matrix 1.16), then MSC4133's unstable one.
const CAPABILITIES: [&str; 2] = ["m.profile_fields", "uk.tcpip.msc4133.profile_fields"];

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
    /// Network trouble, rate limiting, 5xx: try again later.
    Transient(String),
}

fn classify(e: &HttpError) -> FetchError {
    match e.client_api_error_kind() {
        Some(ErrorKind::NotFound) => FetchError::NotFound,
        Some(ErrorKind::Unrecognized) => FetchError::Unrecognized,
        Some(ErrorKind::Forbidden { .. }) => FetchError::Forbidden,
        _ => match e.as_client_api_error().map(|api| api.status_code.as_u16()) {
            // A bare 405 (no errcode) is a proxy or server that has the path
            // for other methods only — the route isn't there for this one.
            Some(405) => FetchError::Unrecognized,
            Some(404) => FetchError::NotFound,
            _ => FetchError::Transient(e.to_string()),
        },
    }
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

/// The account's own color and whether it can be changed, for the editor.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct OwnUserColor {
    pub color: Option<String>,
    pub can_set: Option<bool>,
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
    async fn fetch_reports_transient_errors() {
        let hs = TestHomeserver::new().await;
        let body = json!({ "errcode": "M_UNKNOWN", "error": "boom" });
        mount(&hs, "GET", "/_matrix/client/v3/profile/@flaky:example.org", 500, body).await;
        let got = fetch_color(&hs.client, &uid("@flaky:example.org")).await;
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
}
