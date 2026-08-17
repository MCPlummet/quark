//! Push-notification registration (Matrix pusher API).
//!
//! Registers this device with the homeserver so it POSTs to a push gateway
//! instead of relying on a live sync connection. The transport differs per
//! platform — UnifiedPush on Android, APNs on iOS — but both register the same
//! way and both ask for `event_id_only`, so the gateway (and Apple) only ever
//! see a room id, an event id and an unread count. Resolving that into a real
//! notification happens on-device, through the existing `notify` pipeline.

use serde::{Deserialize, Serialize};

/// Reverse-DNS prefix for every `app_id` we register. Matches the bundle id.
const APP_ID_PREFIX: &str = "tel.quark.app";

/// Which platform transport a pusher routes through.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PushTransport {
    /// Android. The pushkey is the distributor's endpoint URL; the gateway is
    /// discovered from it (or the UnifiedPush default).
    UnifiedPush,
    /// iOS. The pushkey is the APNs device token, base64-encoded; the gateway
    /// is our own Sygnal. Sandbox and production APNs are separate endpoints
    /// and therefore separate `app_id`s.
    Apns { sandbox: bool },
}

/// Everything the homeserver needs to route pushes to this device.
#[derive(Debug, Clone)]
pub struct PushRegistration {
    pub transport: PushTransport,
    /// Transport-specific address: a UnifiedPush endpoint URL, or a base64
    /// APNs device token.
    pub pushkey: String,
    /// Absolute URL of the push gateway. Must end in `/_matrix/push/v1/notify`
    /// or the homeserver rejects the pusher.
    pub gateway_url: String,
    /// Human-readable device label, shown in the user's pusher list.
    pub device_display_name: String,
    /// Stable per-install tag selecting which device-specific push rules apply.
    pub profile_tag: String,
    /// BCP-47 language tag for gateway-composed fallback text.
    pub lang: String,
}

impl PushTransport {
    /// The `app_id` this transport registers under. Sygnal keys its config
    /// literally by this string, so it is part of the deployment contract.
    pub fn app_id(&self) -> String {
        match self {
            PushTransport::UnifiedPush => format!("{APP_ID_PREFIX}.android"),
            PushTransport::Apns { sandbox: true } => format!("{APP_ID_PREFIX}.ios.dev"),
            PushTransport::Apns { sandbox: false } => format!("{APP_ID_PREFIX}.ios.prod"),
        }
    }

    /// Label shown in the user's pusher list on other clients.
    fn app_display_name(&self) -> &'static str {
        match self {
            PushTransport::UnifiedPush => "Quark (Android)",
            PushTransport::Apns { .. } => "Quark (iOS)",
        }
    }
}

/// Payload Sygnal sends verbatim to APNs. `mutable-content` is what makes iOS
/// hand the push to the notification service extension; without it the user
/// sees this placeholder alert instead of the real sender and room.
fn apns_default_payload() -> matrix_sdk::ruma::serde::JsonObject {
    use serde_json::json;
    let payload = json!({
        "default_payload": {
            "aps": {
                "mutable-content": 1,
                "alert": { "loc-key": "Notification", "loc-args": [] },
            }
        }
    });
    match payload {
        serde_json::Value::Object(map) => map,
        _ => unreachable!("literal above is an object"),
    }
}

impl PushRegistration {
    /// Build the wire-level pusher this registration describes.
    pub fn to_pusher(&self) -> matrix_sdk::ruma::api::client::push::Pusher {
        use matrix_sdk::ruma::{
            api::client::push::{PusherIds, PusherInit, PusherKind},
            push::{HttpPusherData, PushFormat},
        };

        let mut http = HttpPusherData::new(self.gateway_url.clone());
        // Never let message content reach the gateway: the homeserver sends
        // only the event id, room id and unread count, and the device resolves
        // the rest locally.
        http.format = Some(PushFormat::EventIdOnly);
        if let PushTransport::Apns { .. } = self.transport {
            http.data = apns_default_payload();
        }

        PusherInit {
            ids: PusherIds::new(self.pushkey.clone(), self.transport.app_id()),
            kind: PusherKind::Http(http),
            app_display_name: self.transport.app_display_name().to_owned(),
            device_display_name: self.device_display_name.clone(),
            profile_tag: Some(self.profile_tag.clone()),
            lang: self.lang.clone(),
        }
        .into()
    }
}

// ─── Persisted state ─────────────────────────────────────────────────────────

/// Push state filename within the config directory. JSON rather than TOML
/// because none of it is meant to be hand-edited.
pub const PUSH_STATE_FILENAME: &str = "push.json";

/// A pusher we told the homeserver about, remembered so it can be deleted when
/// the transport hands us a new address. Without this a rotated APNs token or
/// a re-subscribed UnifiedPush endpoint leaves the old pusher on the
/// homeserver, still being pushed to and never read.
///
/// The `user_id` is part of the identity: a pusher belongs to the account whose
/// access token created it, and no other token can replace or delete it. Two
/// accounts on one install offer the same transport address, so without this a
/// second login would see its own address already on record and never register.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RegisteredPusher {
    pub user_id: String,
    pub app_id: String,
    pub pushkey: String,
    pub gateway_url: String,
}

/// Everything about push that outlives a process but isn't a user preference.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PushState {
    /// Stable per-install tag. Selects which device-specific push rules apply,
    /// so it must survive re-registration.
    pub profile_tag: String,
    /// The pusher the homeserver is currently routing to, if any.
    #[serde(default)]
    pub last: Option<RegisteredPusher>,
    /// Pushers that may still exist on the homeserver and need deleting — a
    /// stale address a rotation could not clean up, an opt-out that happened
    /// while logged out, or a registration whose outcome we never learned.
    ///
    /// This list is the only thing standing between a failed delete and a
    /// pusher the homeserver wakes forever with nothing able to remove it, so
    /// entries are written *before* the round-trip that might create them and
    /// only cleared once a delete has actually been acknowledged. Deleting a
    /// pusher that never existed is a no-op, so retrying is always safe.
    #[serde(default)]
    pub pending_delete: Vec<RegisteredPusher>,
    /// The transport address the platform last handed us — a UnifiedPush
    /// endpoint URL, or an APNs token.
    ///
    /// Kept apart from `last.pushkey`, which records what the *homeserver* was
    /// told. The two differ exactly when registration has not caught up: the
    /// distributor rotates an endpoint while the app is not running, or the user
    /// enables push before a pusher exists. Storing the address the moment it
    /// arrives is what lets registration happen later, on the next launch,
    /// instead of being lost with the process that heard about it.
    #[serde(default)]
    pub endpoint: Option<String>,
}

impl PushState {
    fn fresh() -> Self {
        PushState {
            profile_tag: new_profile_tag(),
            last: None,
            pending_delete: Vec::new(),
            endpoint: None,
        }
    }
}

/// Record the transport address, returning whether it changed.
///
/// `false` means "already knew" — distributors re-announce the same endpoint on
/// every app start, and treating that as news would re-register a pusher per
/// launch. Everything else in the state is preserved: an endpoint rotation is
/// precisely when a stale pusher is owed a delete.
pub fn store_endpoint(config_dir: &std::path::Path, endpoint: &str) -> Result<bool, String> {
    let mut state = load_or_init_push_state(config_dir);
    if state.endpoint.as_deref() == Some(endpoint) {
        return Ok(false);
    }
    state.endpoint = Some(endpoint.to_owned());
    save_push_state_to(config_dir, &state)?;
    Ok(true)
}

/// Whether a session start should ask the transport for an address.
///
/// Registration is otherwise driven entirely by the transport volunteering an
/// endpoint, which it only does when asked — and the ask can fail. Enabling push
/// before installing a distributor is the ordinary way that happens, and without
/// this the user is left with a switch that reads "on" and a transport nobody
/// ever asked again.
pub fn should_request_endpoint(push_enabled: bool, has_endpoint: bool) -> bool {
    push_enabled && !has_endpoint
}

/// Forget the transport address, on `onUnregistered` or a transport opt-out.
///
/// Deliberately does not touch `pending_delete`: losing the address does not
/// remove the pusher already pointing at it, and that delete is still owed.
pub fn forget_endpoint(config_dir: &std::path::Path) -> Result<(), String> {
    let Some(mut state) = load_push_state(config_dir) else {
        return Ok(());
    };
    if state.endpoint.is_none() {
        return Ok(());
    }
    state.endpoint = None;
    save_push_state_to(config_dir, &state)
}

/// Read push state without creating or modifying anything.
///
/// `None` means "no usable state on disk" — a fresh install, or a file we could
/// not read. Callers that only report status use this; only [`register`] needs
/// a profile tag badly enough to mint one.
pub fn load_push_state(config_dir: &std::path::Path) -> Option<PushState> {
    let path = config_dir.join(PUSH_STATE_FILENAME);
    let content = match std::fs::read_to_string(&path) {
        Ok(content) => content,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return None,
        Err(e) => {
            tracing::error!("Failed to read {PUSH_STATE_FILENAME}: {e}");
            return None;
        }
    };
    match serde_json::from_str::<PushState>(&content) {
        Ok(state) => Some(state),
        Err(e) => {
            tracing::error!("Unparsable {PUSH_STATE_FILENAME}: {e}");
            None
        }
    }
}

/// Read push state, minting and persisting a profile tag on first use.
///
/// Never fails: a missing file is a fresh install, and an unreadable one is not
/// worth bricking push over. What it must not do is *destroy* an unreadable
/// file — it may name a pusher that is live on the homeserver, and once that
/// record is gone nothing can ever delete it. So the old file is moved aside
/// rather than overwritten, leaving the address recoverable by hand.
pub fn load_or_init_push_state(config_dir: &std::path::Path) -> PushState {
    if let Some(state) = load_push_state(config_dir) {
        return state;
    }
    quarantine_unreadable_state(config_dir);
    let state = PushState::fresh();
    if let Err(e) = save_push_state_to(config_dir, &state) {
        tracing::warn!("Failed to persist initial push state: {e}");
    }
    state
}

/// Move an unreadable `push.json` aside so replacing it loses nothing.
fn quarantine_unreadable_state(config_dir: &std::path::Path) {
    let path = config_dir.join(PUSH_STATE_FILENAME);
    if !path.exists() {
        return; // Fresh install, nothing to preserve.
    }
    let aside = config_dir.join(format!("{PUSH_STATE_FILENAME}.corrupt"));
    match std::fs::rename(&path, &aside) {
        Ok(()) => tracing::error!(
            "Could not read {PUSH_STATE_FILENAME}; kept it as {}. \
             Any pusher it named must be removed by hand.",
            aside.display()
        ),
        Err(e) => tracing::error!("Failed to set aside unreadable {PUSH_STATE_FILENAME}: {e}"),
    }
}

/// Write push state to `<config_dir>/push.json`.
///
/// Atomic: a half-written file here is one that can no longer name the pusher
/// it was tracking, so the content lands in a temp file and is renamed into
/// place. A crash mid-write leaves the previous state intact.
pub fn save_push_state_to(
    config_dir: &std::path::Path,
    state: &PushState,
) -> Result<(), String> {
    std::fs::create_dir_all(config_dir)
        .map_err(|e| format!("Failed to create config dir: {e}"))?;
    let content = serde_json::to_string_pretty(state)
        .map_err(|e| format!("Failed to serialize push state: {e}"))?;

    let tmp = config_dir.join(format!("{PUSH_STATE_FILENAME}.tmp"));
    std::fs::write(&tmp, content)
        .map_err(|e| format!("Failed to write {PUSH_STATE_FILENAME}: {e}"))?;
    std::fs::rename(&tmp, config_dir.join(PUSH_STATE_FILENAME))
        .map_err(|e| format!("Failed to replace {PUSH_STATE_FILENAME}: {e}"))
}

/// Move the live registration onto the pending-delete list.
///
/// Splitting this from the network call is what lets an opt-out taken while
/// logged out still be honoured: status stops reporting the device as
/// registered right away, and the delete is owed rather than lost.
fn mark_for_deletion(state: &mut PushState) {
    if let Some(last) = state.last.take() {
        if !state.pending_delete.contains(&last) {
            state.pending_delete.push(last);
        }
    }
}

/// 16 hex chars of randomness — unique enough per install, short enough to
/// read in a pusher list on another client.
fn new_profile_tag() -> String {
    use rand::Rng;
    let bytes: [u8; 8] = rand::thread_rng().gen();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// ─── Registration planning ───────────────────────────────────────────────────

/// What registering `next` requires, given what we last registered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PushAction {
    /// Already registered at this address — no round-trip needed.
    Unchanged,
    /// Register `next`, first deleting `stale` if the old pusher is at an
    /// address the new one will not overwrite.
    Register { stale: Option<RegisteredPusher> },
}

/// Decide what a registration attempt has to do.
///
/// The homeserver identifies a pusher by `(app_id, pushkey)` *within an
/// account*, so re-setting the same pair on the same account overwrites in
/// place and needs no cleanup. Only when that pair changes does the previous
/// pusher survive on its own and have to be deleted.
pub fn plan_registration(state: &PushState, next: &RegisteredPusher) -> PushAction {
    let Some(last) = &state.last else {
        return PushAction::Register { stale: None };
    };
    if last.user_id != next.user_id {
        // A different account. Its pusher is not ours to overwrite or delete —
        // this access token cannot reach it — but our own pusher does not exist
        // yet, so registering is mandatory. Skipping it here is how a re-login
        // or an account switch ends up with push silently doing nothing.
        return PushAction::Register { stale: None };
    }
    if last == next {
        return PushAction::Unchanged;
    }
    let same_pusher = last.app_id == next.app_id && last.pushkey == next.pushkey;
    PushAction::Register {
        stale: if same_pusher { None } else { Some(last.clone()) },
    }
}

/// The gateway to register with: the user's override when they set one,
/// otherwise whatever the transport discovered.
///
/// This is the whole point of `push_gateway_override` — a self-hoster whose
/// distributor doesn't advertise a Matrix gateway needs somewhere to say so.
pub fn resolve_gateway(config: &crate::notifications::NotificationConfig, discovered: String) -> String {
    match config.push_gateway_override.as_deref().map(str::trim) {
        Some(override_url) if !override_url.is_empty() => override_url.to_owned(),
        _ => discovered,
    }
}

// ─── Status snapshot ─────────────────────────────────────────────────────────

/// Whether this platform could have a push transport. Desktop holds a live
/// sync connection and has no use for one.
pub const PLATFORM_SUPPORTS_PUSH: bool =
    cfg!(any(target_os = "android", target_os = "ios"));

/// Whether this build actually wires a transport up to supply a pushkey.
///
/// Everything above this line is platform-agnostic: registration, persistence,
/// planning and status all work without knowing where the address comes from.
/// Supplying one is a per-platform job, and the platforms are not in step —
/// Android has UnifiedPush; iOS gets APNs in a later phase and must not
/// advertise a toggle that can only ever say "waiting" until then. Hence a
/// separate flag from [`PLATFORM_SUPPORTS_PUSH`]: capability and delivery are
/// different claims, and this is the one that has to stay honest.
pub const TRANSPORT_AVAILABLE: bool = cfg!(target_os = "android");

/// Whether Settings should offer push at all.
///
/// Both halves are required: the platform has to be capable, and the build has
/// to have something behind the switch.
pub const fn supports_push(platform: bool, transport: bool) -> bool {
    platform && transport
}

/// Which transport this platform pushes through, named for the UI.
///
/// Distinct from [`PushTransport`], which carries registration detail (the APNs
/// sandbox flag) that Settings has no use for. What Settings needs is what the
/// user has to have working — a distributor on Android, nothing on iOS — and it
/// needs it *before* a pusher exists, which is exactly when `app_id` is `None`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlatformTransport {
    /// Android: the user supplies the endpoint by installing a distributor.
    UnifiedPush,
    /// iOS: the OS supplies the token and the gateway is our own Sygnal, so
    /// there is nothing for the user to install.
    Apns,
}

/// The transport this build would register through, if any.
pub const fn platform_transport() -> Option<PlatformTransport> {
    if cfg!(target_os = "android") {
        Some(PlatformTransport::UnifiedPush)
    } else if cfg!(target_os = "ios") {
        Some(PlatformTransport::Apns)
    } else {
        None
    }
}

/// What the platform transport can tell us right now.
///
/// On Android this comes from the UnifiedPush plugin: which distributors are
/// installed, and which one we settled on. On iOS the OS *is* the transport,
/// so `available` is simply true and there is nothing to name.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransportStatus {
    /// Something on this device can deliver a push to us.
    pub available: bool,
    /// The transport in use, named for the UI. `None` when none is chosen.
    pub distributor: Option<String>,
}

/// How far along push actually is.
///
/// Four states, because collapsing any two of them produces the one failure
/// push cannot afford: telling a user it works while nothing delivers it.
/// "Enabled" and "working" are genuinely different things here — every step
/// between them involves software we do not control.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PushReadiness {
    /// The user has not switched it on.
    Off,
    /// Switched on, but nothing on this device can receive a push. On Android
    /// that means no distributor is installed — the most common reason push
    /// does nothing, and the only one the user can fix themselves.
    NoTransport,
    /// A transport exists but the chain is not complete: no address yet, or an
    /// address the homeserver has not accepted.
    Waiting,
    /// The homeserver holds a pusher pointing at this device.
    Ready,
}

/// What Settings shows about push. Distinct from [`PushState`], which is what
/// we persist — this is derived, read-only, and safe to hand the frontend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PushStatus {
    /// This platform has a push transport (mobile).
    pub supported: bool,
    /// The user's persisted preference.
    pub enabled: bool,
    /// A pusher is currently registered with the homeserver. False while push
    /// is on but the transport has not yet supplied an address.
    pub registered: bool,
    /// How this platform pushes. Set whether or not a pusher exists yet, so
    /// the UI can explain what is still missing without guessing.
    pub transport: Option<PlatformTransport>,
    /// The `app_id` of the registered pusher, if any.
    pub app_id: Option<String>,
    /// The gateway actually in use — so the user can tell whether discovery
    /// found their own server or fell back to the public one.
    pub gateway_url: Option<String>,
    /// How far along push is. What the UI should actually render.
    pub readiness: PushReadiness,
    /// The transport in use, named for the UI (e.g. the distributor).
    pub distributor: Option<String>,
}

/// Derive the Settings snapshot from the user's preference and what we last
/// registered.
///
/// `state` is `None` when nothing has been persisted yet — reporting status
/// must not be what creates the file, or every desktop install grows a
/// `push.json` from opening the Settings dialog on a platform that can never
/// support push.
pub fn status(
    config: &crate::notifications::NotificationConfig,
    state: Option<&PushState>,
    transport_status: &TransportStatus,
) -> PushStatus {
    // A registration left over from before push was switched off is stale, not
    // live — reporting it as registered would tell the user they are receiving
    // pushes they have turned off.
    let live = config
        .push_enabled
        .then(|| state.and_then(|s| s.last.as_ref()))
        .flatten();

    let readiness = if !config.push_enabled {
        PushReadiness::Off
    } else if !transport_status.available {
        PushReadiness::NoTransport
    } else if live.is_some() {
        PushReadiness::Ready
    } else {
        PushReadiness::Waiting
    };

    PushStatus {
        supported: supports_push(PLATFORM_SUPPORTS_PUSH, TRANSPORT_AVAILABLE),
        enabled: config.push_enabled,
        registered: live.is_some(),
        transport: platform_transport(),
        app_id: live.map(|p| p.app_id.clone()),
        gateway_url: live.map(|p| p.gateway_url.clone()),
        readiness,
        distributor: transport_status.distributor.clone(),
    }
}

// ─── Homeserver round-trips ──────────────────────────────────────────────────
//
// Thin glue over `client.pusher()`. Every decision these make is delegated to
// the pure functions above, which is where the tests are — an SDK call and a
// file write are all that is left here. End-to-end coverage is
// `GET /_matrix/client/v3/pushers` against a real homeserver.

/// Register this device's pusher, deleting whatever it replaces.
///
/// Safe to call on every launch: it returns `Ok(false)` without touching the
/// network when push is switched off or the address is unchanged. The
/// `push_enabled` check lives here rather than in each transport because push
/// hands a third-party gateway this device's address — the gate belongs on the
/// call that does the handing over, not on every caller remembering to ask.
///
/// `discovered_gateway` is what the transport found; a user override wins.
pub async fn register(
    client: &matrix_sdk::Client,
    config_dir: &std::path::Path,
    config: &crate::notifications::NotificationConfig,
    transport: PushTransport,
    pushkey: String,
    discovered_gateway: String,
    device_display_name: String,
) -> Result<bool, String> {
    if !config.push_enabled {
        return Ok(false);
    }
    let user_id = client.user_id().ok_or("Not logged in")?.to_string();
    let mut state = load_or_init_push_state(config_dir);

    // Settle debts before taking on new ones, so a delete that failed on the
    // last attempt doesn't outlive the address it belongs to.
    drain_pending_deletes(client, config_dir, &mut state).await;

    let next = RegisteredPusher {
        user_id,
        app_id: transport.app_id(),
        pushkey: pushkey.clone(),
        gateway_url: resolve_gateway(config, discovered_gateway),
    };

    let stale = match plan_registration(&state, &next) {
        PushAction::Unchanged => return Ok(false),
        PushAction::Register { stale } => stale,
    };

    // Delete first: the stale pusher is at an address this registration will
    // not overwrite, so leaving it would have the homeserver pushing to a dead
    // endpoint indefinitely. A failure here is not fatal — it becomes a debt to
    // retry rather than blocking the registration the user is waiting on.
    if let Some(stale) = stale {
        if let Err(e) = delete_pusher(client, &stale).await {
            tracing::warn!("Failed to delete stale pusher {}: {e}", stale.app_id);
            state.pending_delete.push(stale);
        }
    }

    // Write down the address *before* asking the homeserver to route to it.
    // Between that request and this file being saved is the one window where a
    // pusher can exist that nothing remembers — and an unremembered pusher can
    // never be deleted. Recorded as a pending delete it is merely cleaned up on
    // the next attempt, which then registers again from a known state.
    state.last = None;
    state.pending_delete.push(next.clone());
    save_push_state_to(config_dir, &state)?;

    let registration = PushRegistration {
        transport,
        pushkey,
        gateway_url: next.gateway_url.clone(),
        device_display_name,
        profile_tag: state.profile_tag.clone(),
        lang: "en".to_owned(),
    };
    let result = client.pusher().set(registration.to_pusher()).await;

    if result.is_ok() {
        state.pending_delete.retain(|p| p != &next);
        state.last = Some(next);
    }
    // On failure the entry stays pending: a timeout can't tell us whether the
    // homeserver accepted the pusher, and deleting one that was never created
    // is a no-op — so owing the delete is the only answer that is safe both ways.
    save_push_state_to(config_dir, &state)?;
    result.map_err(|e| format!("Failed to register pusher: {e}"))?;
    Ok(true)
}

/// Remove this device's pusher — on logout, or when the user turns push off.
///
/// Leaving it registered would have the homeserver push every message to an
/// endpoint that no longer resolves to a logged-in session.
pub async fn unregister(
    client: &matrix_sdk::Client,
    config_dir: &std::path::Path,
) -> Result<(), String> {
    let Some(mut state) = load_push_state(config_dir) else {
        return Ok(()); // Nothing was ever registered from this install.
    };
    mark_for_deletion(&mut state);
    // Persist the intent first: from here on status must not claim the device
    // is registered, whether or not the network agrees.
    save_push_state_to(config_dir, &state)?;

    match drain_pending_deletes(client, config_dir, &mut state).await {
        0 => Ok(()),
        failed => Err(format!("{failed} pusher(s) not yet removed; will retry")),
    }
}

/// Record that this device's pusher should be removed, without the network.
///
/// For turning push off while logged out or with a broken session: the opt-out
/// is honoured locally straight away, and the homeserver-side delete is owed
/// until [`retry_pending_deletes`] can pay it. Dropping it instead would leave
/// the gateway holding a live address for a user who said no.
pub fn defer_unregister(config_dir: &std::path::Path) -> Result<(), String> {
    let Some(mut state) = load_push_state(config_dir) else {
        return Ok(());
    };
    mark_for_deletion(&mut state);
    save_push_state_to(config_dir, &state)
}

/// Pay off deletes earlier attempts could not complete. Call once per
/// authenticated session start — it is a no-op when nothing is owed.
pub async fn retry_pending_deletes(
    client: &matrix_sdk::Client,
    config_dir: &std::path::Path,
) -> Result<(), String> {
    let Some(mut state) = load_push_state(config_dir) else {
        return Ok(());
    };
    if state.pending_delete.is_empty() {
        return Ok(());
    }
    match drain_pending_deletes(client, config_dir, &mut state).await {
        0 => Ok(()),
        failed => Err(format!("{failed} pusher(s) not yet removed; will retry")),
    }
}

/// Forget every local record of registration without contacting the server.
///
/// For a session that is already unusable (a token the homeserver rejected, a
/// wiped local session). The pushers went with the access token that created
/// them, and no token remains to delete them with — keeping the records would
/// only convince the next login that it is already registered.
pub fn forget_local_registrations(config_dir: &std::path::Path) {
    let Some(mut state) = load_push_state(config_dir) else {
        return;
    };
    if state.last.is_none() && state.pending_delete.is_empty() {
        return;
    }
    state.last = None;
    state.pending_delete.clear();
    if let Err(e) = save_push_state_to(config_dir, &state) {
        tracing::warn!("Failed to clear push state: {e}");
    }
}

/// Delete every pusher we owe a delete for, returning how many are still owed.
///
/// Best-effort by design: each failure stays on the list for the next attempt.
async fn drain_pending_deletes(
    client: &matrix_sdk::Client,
    config_dir: &std::path::Path,
    state: &mut PushState,
) -> usize {
    if state.pending_delete.is_empty() {
        return 0;
    }
    let current_user = client.user_id().map(|u| u.to_string());
    let mut still_owed = Vec::new();
    for pusher in std::mem::take(&mut state.pending_delete) {
        // Another account's pusher cannot be deleted with this token. Keep the
        // record — logging back in as that account is what clears it.
        if current_user.as_deref() != Some(pusher.user_id.as_str()) {
            still_owed.push(pusher);
            continue;
        }
        if let Err(e) = delete_pusher(client, &pusher).await {
            tracing::warn!("Failed to delete pusher {}: {e}", pusher.app_id);
            still_owed.push(pusher);
        }
    }
    let owed = still_owed.len();
    state.pending_delete = still_owed;
    if let Err(e) = save_push_state_to(config_dir, state) {
        tracing::warn!("Failed to persist push state after deletions: {e}");
    }
    owed
}

async fn delete_pusher(
    client: &matrix_sdk::Client,
    pusher: &RegisteredPusher,
) -> Result<(), String> {
    use matrix_sdk::ruma::api::client::push::PusherIds;
    client
        .pusher()
        .delete(PusherIds::new(pusher.pushkey.clone(), pusher.app_id.clone()))
        .await
        .map_err(|e| format!("Failed to delete pusher: {e}"))
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod status_tests {
    use super::*;
    use crate::notifications::NotificationConfig;

    fn config(push_enabled: bool) -> NotificationConfig {
        NotificationConfig { push_enabled, ..NotificationConfig::default() }
    }

    fn registered_state() -> PushState {
        PushState {
            profile_tag: "tag".into(),
            last: Some(RegisteredPusher {
                user_id: "@alice:example.com".into(),
                app_id: "tel.quark.app.android".into(),
                pushkey: "https://ntfy.example.org/up1".into(),
                gateway_url: "https://ntfy.example.org/_matrix/push/v1/notify".into(),
            }),
            pending_delete: Vec::new(),
            endpoint: None,
        }
    }

    fn empty_state() -> PushState {
        PushState { profile_tag: "tag".into(), last: None, pending_delete: Vec::new(), endpoint: None }
    }

    #[test]
    fn reports_the_persisted_preference() {
        assert!(status(&config(true), Some(&empty_state()), &TransportStatus::default()).enabled);
        assert!(!status(&config(false), Some(&empty_state()), &TransportStatus::default()).enabled);
    }

    /// Push can be switched on before the transport hands over an address —
    /// Settings has to distinguish "on" from "actually receiving pushes".
    #[test]
    fn is_not_registered_until_a_pusher_exists() {
        let snapshot = status(&config(true), Some(&empty_state()), &TransportStatus::default());
        assert!(!snapshot.registered);
        assert_eq!(snapshot.gateway_url, None);
        assert_eq!(snapshot.app_id, None);
    }

    /// Opening Settings must not be what creates `push.json`, so status has to
    /// answer without any state at all.
    #[test]
    fn reports_a_sane_status_with_nothing_persisted() {
        let snapshot = status(&config(true), None, &TransportStatus::default());
        assert!(snapshot.enabled);
        assert!(!snapshot.registered);
        assert_eq!(snapshot.app_id, None);
    }

    /// Surfacing the gateway is how a self-hoster can tell their own ntfy was
    /// discovered rather than the public fallback.
    #[test]
    fn surfaces_the_gateway_and_app_id_actually_registered() {
        let snapshot = status(&config(true), Some(&registered_state()), &TransportStatus::default());
        assert!(snapshot.registered);
        assert_eq!(
            snapshot.gateway_url.as_deref(),
            Some("https://ntfy.example.org/_matrix/push/v1/notify")
        );
        assert_eq!(snapshot.app_id.as_deref(), Some("tel.quark.app.android"));
    }

    /// A leftover registration from before push was turned off must not read
    /// as "receiving pushes".
    #[test]
    fn a_disabled_pusher_does_not_read_as_registered() {
        assert!(!status(&config(false), Some(&registered_state()), &TransportStatus::default()).registered);
    }

    /// A pusher whose delete is still owed is gone as far as the user is
    /// concerned — reporting it as live would offer nothing to act on.
    #[test]
    fn a_pusher_awaiting_deletion_does_not_read_as_registered() {
        let mut state = registered_state();
        mark_for_deletion(&mut state);

        assert!(!status(&config(true), Some(&state), &TransportStatus::default()).registered);
        assert_eq!(state.pending_delete.len(), 1);
    }

    /// The platform check alone is not enough. iOS is push-capable but has no
    /// transport until the APNs phase lands, so a build that advertised push
    /// there would offer a toggle that can never leave "waiting" — with a hint
    /// naming a distributor that iOS cannot use.
    #[test]
    fn a_platform_with_no_transport_does_not_offer_push() {
        assert!(!supports_push(true, false));
    }

    /// Android now has one. Only compiled there, but it is the assertion that
    /// keeps the const honest when a future edit reaches for it.
    #[cfg(target_os = "android")]
    #[test]
    fn android_has_a_transport_and_offers_push() {
        assert!(TRANSPORT_AVAILABLE);
        assert!(status(&config(true), Some(&empty_state()), &TransportStatus::default()).supported);
    }

    /// iOS is capable but not yet wired. Flipping this test is part of Phase 3.
    #[cfg(target_os = "ios")]
    #[test]
    fn ios_does_not_offer_push_until_apns_lands() {
        assert!(!TRANSPORT_AVAILABLE);
        assert!(!status(&config(true), Some(&empty_state()), &TransportStatus::default()).supported);
    }

    #[test]
    fn push_is_offered_once_a_transport_backs_the_platform() {
        assert!(supports_push(true, true));
    }

    /// Desktop holds a live sync connection, so no transport makes it eligible.
    #[test]
    fn desktop_never_offers_push() {
        assert!(!supports_push(false, false));
        assert!(!supports_push(false, true));
    }

    /// What the frontend mock mirrors: desktop offers nothing, whatever the
    /// transport flag says.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    #[test]
    fn desktop_builds_do_not_offer_push() {
        assert!(!status(&config(true), Some(&empty_state()), &TransportStatus::default()).supported);
    }

    /// The UI has to explain what push is waiting on *before* a pusher exists,
    /// which is exactly when `app_id` is None. Telling an iOS user to install
    /// an Android distributor sends them after a fix that doesn't exist.
    #[test]
    fn names_the_transport_even_with_nothing_registered() {
        let snapshot = status(&config(true), Some(&empty_state()), &TransportStatus::default());
        assert!(!snapshot.registered);
        assert_eq!(snapshot.transport, platform_transport());
    }

    /// Desktop has no transport at all, so the UI has nothing to explain.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    #[test]
    fn desktop_names_no_transport() {
        assert_eq!(platform_transport(), None);
    }

    #[cfg(target_os = "android")]
    #[test]
    fn android_pushes_through_unified_push() {
        assert_eq!(platform_transport(), Some(PlatformTransport::UnifiedPush));
    }

    #[cfg(target_os = "ios")]
    #[test]
    fn ios_pushes_through_apns() {
        assert_eq!(platform_transport(), Some(PlatformTransport::Apns));
    }
}

#[cfg(test)]
mod gateway_tests {
    use super::*;
    use crate::notifications::NotificationConfig;

    const DISCOVERED: &str = "https://matrix.gateway.unifiedpush.org/_matrix/push/v1/notify";

    fn config(override_url: Option<&str>) -> NotificationConfig {
        NotificationConfig {
            push_gateway_override: override_url.map(str::to_owned),
            ..NotificationConfig::default()
        }
    }

    #[test]
    fn uses_what_the_transport_discovered_by_default() {
        assert_eq!(resolve_gateway(&config(None), DISCOVERED.into()), DISCOVERED);
    }

    /// The escape hatch for a distributor that advertises no Matrix gateway.
    /// Without this the setting is documented but inert.
    #[test]
    fn an_override_wins_over_discovery() {
        let mine = "https://ntfy.example.org/_matrix/push/v1/notify";
        assert_eq!(resolve_gateway(&config(Some(mine)), DISCOVERED.into()), mine);
    }

    /// A cleared field in a hand-edited TOML is "unset", not "register with the
    /// empty string" — which the homeserver would reject.
    #[test]
    fn a_blank_override_falls_back_to_discovery() {
        assert_eq!(resolve_gateway(&config(Some("   ")), DISCOVERED.into()), DISCOVERED);
    }

    #[test]
    fn an_override_is_trimmed() {
        let mine = "https://ntfy.example.org/_matrix/push/v1/notify";
        let padded = format!("  {mine}\n");
        assert_eq!(resolve_gateway(&config(Some(&padded)), DISCOVERED.into()), mine);
    }
}

#[cfg(test)]
mod plan_tests {
    use super::*;

    const ALICE: &str = "@alice:example.com";

    fn state_with(last: Option<RegisteredPusher>) -> PushState {
        PushState { profile_tag: "tag".into(), last, pending_delete: Vec::new(), endpoint: None }
    }

    fn pusher(app_id: &str, pushkey: &str, gateway: &str) -> RegisteredPusher {
        pusher_for(ALICE, app_id, pushkey, gateway)
    }

    fn pusher_for(user: &str, app_id: &str, pushkey: &str, gateway: &str) -> RegisteredPusher {
        RegisteredPusher {
            user_id: user.into(),
            app_id: app_id.into(),
            pushkey: pushkey.into(),
            gateway_url: gateway.into(),
        }
    }

    fn android(pushkey: &str, gateway: &str) -> RegisteredPusher {
        pusher("tel.quark.app.android", pushkey, gateway)
    }

    /// Every launch re-offers the same endpoint. Re-registering it would be a
    /// pointless round-trip on a connection the user may be paying for.
    #[test]
    fn re_offering_the_same_address_is_a_no_op() {
        let next = android("https://ntfy.example.org/up1", "https://gw/_matrix/push/v1/notify");
        assert_eq!(
            plan_registration(&state_with(Some(next.clone())), &next),
            PushAction::Unchanged
        );
    }

    #[test]
    fn a_first_registration_has_nothing_to_delete() {
        let next = android("https://ntfy.example.org/up1", "https://gw/_matrix/push/v1/notify");
        assert_eq!(
            plan_registration(&state_with(None), &next),
            PushAction::Register { stale: None }
        );
    }

    /// A new pushkey is a different pusher as far as the homeserver is
    /// concerned, so the old one survives unless we delete it explicitly.
    #[test]
    fn a_rotated_pushkey_deletes_the_pusher_it_replaces() {
        let old = android("https://ntfy.example.org/up1", "https://gw/_matrix/push/v1/notify");
        let next = android("https://ntfy.example.org/up2", "https://gw/_matrix/push/v1/notify");
        assert_eq!(
            plan_registration(&state_with(Some(old.clone())), &next),
            PushAction::Register { stale: Some(old) }
        );
    }

    /// Moving a debug build to TestFlight keeps the device token but changes
    /// the app_id, which the homeserver treats as a separate pusher.
    #[test]
    fn switching_apns_environment_deletes_the_old_app_ids_pusher() {
        let old = pusher("tel.quark.app.ios.dev", "dG9rZW4=", "https://push.quark.tel/_matrix/push/v1/notify");
        let next = pusher("tel.quark.app.ios.prod", "dG9rZW4=", "https://push.quark.tel/_matrix/push/v1/notify");
        assert_eq!(
            plan_registration(&state_with(Some(old.clone())), &next),
            PushAction::Register { stale: Some(old) }
        );
    }

    /// Same app_id and pushkey, new gateway — the user stood up their own
    /// ntfy. `set` overwrites in place, so deleting first would be wrong: it
    /// would briefly leave the device with no pusher at all.
    #[test]
    fn a_changed_gateway_overwrites_in_place() {
        let old = android("https://ntfy.example.org/up1", "https://matrix.gateway.unifiedpush.org/_matrix/push/v1/notify");
        let next = android("https://ntfy.example.org/up1", "https://ntfy.example.org/_matrix/push/v1/notify");
        assert_eq!(
            plan_registration(&state_with(Some(old)), &next),
            PushAction::Register { stale: None }
        );
    }

    /// The homeserver deletes a pusher along with the access token that made
    /// it, so a re-login owns nothing — but the transport offers the same
    /// address, which used to read as "already registered" and skip the round
    /// trip entirely. Push then appeared on in Settings and never arrived.
    #[test]
    fn a_second_account_registers_despite_the_same_address() {
        let gw = "https://matrix.gateway.unifiedpush.org/_matrix/push/v1/notify";
        let alices = pusher_for(ALICE, "tel.quark.app.android", "https://ntfy.example.org/up1", gw);
        let bobs = pusher_for("@bob:example.com", "tel.quark.app.android", "https://ntfy.example.org/up1", gw);

        assert_eq!(
            plan_registration(&state_with(Some(alices)), &bobs),
            PushAction::Register { stale: None }
        );
    }

    /// Bob's token cannot delete Alice's pusher, so asking would only fail.
    /// Logging back in as Alice is what clears it.
    #[test]
    fn another_accounts_pusher_is_not_ours_to_delete() {
        let gw = "https://matrix.gateway.unifiedpush.org/_matrix/push/v1/notify";
        let alices = pusher_for(ALICE, "tel.quark.app.ios.dev", "dG9rZW4=", gw);
        let bobs = pusher_for("@bob:example.com", "tel.quark.app.android", "https://ntfy.example.org/up1", gw);

        assert_eq!(
            plan_registration(&state_with(Some(alices)), &bobs),
            PushAction::Register { stale: None }
        );
    }
}

#[cfg(test)]
mod pending_delete_tests {
    use super::*;

    fn registered() -> RegisteredPusher {
        RegisteredPusher {
            user_id: "@alice:example.com".into(),
            app_id: "tel.quark.app.android".into(),
            pushkey: "https://ntfy.example.org/up1".into(),
            gateway_url: "https://ntfy.example.org/_matrix/push/v1/notify".into(),
        }
    }

    fn state_with(last: Option<RegisteredPusher>) -> PushState {
        PushState { profile_tag: "tag".into(), last, pending_delete: Vec::new(), endpoint: None }
    }

    /// Turning push off while logged out has to leave a record: the pusher is
    /// live on the homeserver and the user has opted out, so the delete is owed
    /// rather than lost. Dropping it kept the gateway holding a live address
    /// with nothing left in the UI to act on.
    #[test]
    fn an_offline_opt_out_still_owes_the_delete() {
        let mut state = state_with(Some(registered()));

        mark_for_deletion(&mut state);

        assert_eq!(state.last, None, "no longer claims to be registered");
        assert_eq!(state.pending_delete, vec![registered()]);
    }

    #[test]
    fn nothing_is_owed_when_nothing_was_registered() {
        let mut state = state_with(None);

        mark_for_deletion(&mut state);

        assert!(state.pending_delete.is_empty());
    }

    /// Toggling push off, on, and off again must not queue the same delete
    /// twice — each retry would then fire a redundant round-trip forever.
    #[test]
    fn the_same_pusher_is_only_owed_once() {
        let mut state = state_with(Some(registered()));
        mark_for_deletion(&mut state);
        state.last = Some(registered());

        mark_for_deletion(&mut state);

        assert_eq!(state.pending_delete.len(), 1);
    }

    #[test]
    fn owed_deletes_survive_a_reload() {
        let dir = tempfile::tempdir().unwrap();
        let mut state = load_or_init_push_state(dir.path());
        state.last = Some(registered());
        mark_for_deletion(&mut state);
        save_push_state_to(dir.path(), &state).unwrap();

        assert_eq!(
            load_or_init_push_state(dir.path()).pending_delete,
            vec![registered()]
        );
    }
}

#[cfg(test)]
mod readiness_tests {
    use super::*;
    use crate::notifications::NotificationConfig;

    fn config(push_enabled: bool) -> NotificationConfig {
        NotificationConfig { push_enabled, ..NotificationConfig::default() }
    }

    fn state(endpoint: Option<&str>, registered: bool) -> PushState {
        PushState {
            profile_tag: "tag".into(),
            last: registered.then(|| RegisteredPusher {
                user_id: "@alice:example.com".into(),
                app_id: "tel.quark.app.android".into(),
                pushkey: "https://ntfy.example.org/up1".into(),
                gateway_url: "https://ntfy.example.org/_matrix/push/v1/notify".into(),
            }),
            pending_delete: Vec::new(),
            endpoint: endpoint.map(str::to_owned),
        }
    }

    fn transport(distributor: Option<&str>, any_installed: bool) -> TransportStatus {
        TransportStatus {
            available: any_installed,
            distributor: distributor.map(str::to_owned),
        }
    }

    /// The four states Settings has to tell apart. Collapsing any two of them
    /// produces the failure mode push cannot afford: a user who is told push is
    /// working while nothing is delivering it.
    #[test]
    fn push_is_off_when_the_user_has_not_enabled_it() {
        let status = status(&config(false), Some(&state(None, false)), &transport(None, true));
        assert_eq!(status.readiness, PushReadiness::Off);
    }

    #[test]
    fn without_a_distributor_installed_there_is_nothing_to_push_through() {
        // The single most likely reason push does nothing on Android, and the
        // only one the user can actually fix — so it must be its own state.
        let status = status(&config(true), Some(&state(None, false)), &transport(None, false));
        assert_eq!(status.readiness, PushReadiness::NoTransport);
    }

    #[test]
    fn a_chosen_distributor_with_no_endpoint_yet_is_still_waiting() {
        let status = status(&config(true), Some(&state(None, false)), &transport(Some("ntfy"), true));
        assert_eq!(status.readiness, PushReadiness::Waiting);
        assert_eq!(status.distributor.as_deref(), Some("ntfy"));
    }

    #[test]
    fn an_endpoint_that_has_not_reached_the_homeserver_is_also_waiting() {
        // The distributor has done its part; the pusher round-trip has not
        // happened or failed. Reporting this as ready would be a lie.
        let status = status(
            &config(true),
            Some(&state(Some("https://ntfy.example.org/up1"), false)),
            &transport(Some("ntfy"), true),
        );
        assert_eq!(status.readiness, PushReadiness::Waiting);
    }

    #[test]
    fn push_is_ready_once_the_homeserver_has_the_pusher() {
        let status = status(
            &config(true),
            Some(&state(Some("https://ntfy.example.org/up1"), true)),
            &transport(Some("ntfy"), true),
        );
        assert_eq!(status.readiness, PushReadiness::Ready);
        assert!(status.registered);
        assert_eq!(
            status.gateway_url.as_deref(),
            Some("https://ntfy.example.org/_matrix/push/v1/notify")
        );
    }

    #[test]
    fn a_registration_left_over_from_before_the_toggle_went_off_is_not_ready() {
        // push.json still names a pusher, but the user has opted out and the
        // delete may only be owed. Ready here would contradict the toggle.
        let status = status(
            &config(false),
            Some(&state(Some("https://ntfy.example.org/up1"), true)),
            &transport(Some("ntfy"), true),
        );
        assert_eq!(status.readiness, PushReadiness::Off);
        assert!(!status.registered);
    }

    #[test]
    fn a_fresh_install_with_push_on_is_waiting_not_ready() {
        let status = status(&config(true), None, &transport(Some("ntfy"), true));
        assert_eq!(status.readiness, PushReadiness::Waiting);
    }
}

#[cfg(test)]
mod endpoint_request_tests {
    use super::*;

    /// The case this exists for: push switched on before any distributor was
    /// installed. `subscribe` failed then and nothing ever asked again, so
    /// installing one afterwards left push silently dead forever.
    #[test]
    fn a_session_start_asks_again_when_push_is_on_but_no_address_arrived() {
        assert!(should_request_endpoint(true, false));
    }

    #[test]
    fn an_address_we_already_have_is_not_re_requested() {
        // Re-registering on every launch would churn the distributor and the
        // homeserver for an address that has not changed.
        assert!(!should_request_endpoint(true, true));
    }

    #[test]
    fn push_switched_off_asks_for_nothing() {
        assert!(!should_request_endpoint(false, false));
        assert!(!should_request_endpoint(false, true));
    }
}

#[cfg(test)]
mod endpoint_tests {
    use super::*;

    fn registered() -> RegisteredPusher {
        RegisteredPusher {
            user_id: "@alice:example.com".into(),
            app_id: "tel.quark.app.android".into(),
            pushkey: "https://ntfy.example.org/old".into(),
            gateway_url: "https://ntfy.example.org/_matrix/push/v1/notify".into(),
        }
    }

    #[test]
    fn an_endpoint_survives_a_reload() {
        // The distributor hands the endpoint over once. Losing it means push is
        // dead until the user notices and re-registers by hand.
        let dir = tempfile::tempdir().unwrap();
        store_endpoint(dir.path(), "https://ntfy.example.org/UPabc").unwrap();
        assert_eq!(
            load_push_state(dir.path()).unwrap().endpoint.as_deref(),
            Some("https://ntfy.example.org/UPabc")
        );
    }

    #[test]
    fn storing_an_endpoint_keeps_what_the_state_already_owed() {
        // An endpoint rotation is exactly when a stale pusher needs deleting, so
        // clobbering the debts here would strand the pusher it names forever.
        let dir = tempfile::tempdir().unwrap();
        let mut state = load_or_init_push_state(dir.path());
        let tag = state.profile_tag.clone();
        state.pending_delete.push(registered());
        save_push_state_to(dir.path(), &state).unwrap();

        store_endpoint(dir.path(), "https://ntfy.example.org/UPnew").unwrap();

        let reloaded = load_push_state(dir.path()).unwrap();
        assert_eq!(reloaded.pending_delete, vec![registered()]);
        assert_eq!(reloaded.profile_tag, tag, "the tag must not be reminted");
        assert_eq!(reloaded.endpoint.as_deref(), Some("https://ntfy.example.org/UPnew"));
    }

    #[test]
    fn re_storing_the_same_endpoint_reports_no_change() {
        // Distributors re-announce the same endpoint on every app start. Acting
        // on that as if it were new would re-register a pusher per launch.
        let dir = tempfile::tempdir().unwrap();
        assert!(store_endpoint(dir.path(), "https://ntfy.example.org/UPabc").unwrap());
        assert!(!store_endpoint(dir.path(), "https://ntfy.example.org/UPabc").unwrap());
        assert!(store_endpoint(dir.path(), "https://ntfy.example.org/UPother").unwrap());
    }

    #[test]
    fn forgetting_the_endpoint_leaves_the_owed_deletes_behind() {
        // onUnregistered means the address is gone, not that the pusher already
        // pointing at it is. That delete still has to happen.
        let dir = tempfile::tempdir().unwrap();
        store_endpoint(dir.path(), "https://ntfy.example.org/UPabc").unwrap();
        let mut state = load_push_state(dir.path()).unwrap();
        state.pending_delete.push(registered());
        save_push_state_to(dir.path(), &state).unwrap();

        forget_endpoint(dir.path()).unwrap();

        let reloaded = load_push_state(dir.path()).unwrap();
        assert_eq!(reloaded.endpoint, None);
        assert_eq!(reloaded.pending_delete, vec![registered()]);
    }

    #[test]
    fn a_fresh_install_has_no_endpoint() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load_or_init_push_state(dir.path()).endpoint, None);
    }
}

#[cfg(test)]
mod state_tests {
    use super::*;

    fn registered() -> RegisteredPusher {
        RegisteredPusher {
            user_id: "@alice:example.com".into(),
            app_id: "tel.quark.app.android".into(),
            pushkey: "https://ntfy.example.org/up1234".into(),
            gateway_url: "https://ntfy.example.org/_matrix/push/v1/notify".into(),
        }
    }

    /// The tag selects which device-specific push rules apply. Minting a new
    /// one on every launch would orphan the rules attached to the old one.
    #[test]
    fn profile_tag_survives_a_reload() {
        let dir = tempfile::tempdir().unwrap();
        let first = load_or_init_push_state(dir.path()).profile_tag;
        let second = load_or_init_push_state(dir.path()).profile_tag;
        assert!(!first.is_empty());
        assert_eq!(first, second);
    }

    #[test]
    fn separate_installs_get_separate_profile_tags() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        assert_ne!(
            load_or_init_push_state(a.path()).profile_tag,
            load_or_init_push_state(b.path()).profile_tag
        );
    }

    /// A rotated APNs token or re-subscribed UnifiedPush endpoint has to
    /// delete the pusher it replaces, or the homeserver keeps pushing to an
    /// address nothing listens on.
    #[test]
    fn remembers_the_last_registration_across_a_reload() {
        let dir = tempfile::tempdir().unwrap();
        let mut state = load_or_init_push_state(dir.path());
        state.last = Some(registered());
        save_push_state_to(dir.path(), &state).unwrap();

        assert_eq!(load_or_init_push_state(dir.path()).last, Some(registered()));
    }

    #[test]
    fn a_fresh_install_has_registered_nothing() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load_or_init_push_state(dir.path()).last, None);
    }

    /// A corrupt state file must not brick push — worst case we mint a new tag.
    #[test]
    fn unparsable_state_falls_back_to_a_fresh_one() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(PUSH_STATE_FILENAME), "{ not json").unwrap();

        let state = load_or_init_push_state(dir.path());
        assert!(!state.profile_tag.is_empty());
        assert_eq!(state.last, None);
    }

    /// The file that could not be read may be the only record of a live pusher.
    /// Overwriting it makes that pusher undeletable — the homeserver would push
    /// to it forever with nothing able to say stop. Keeping it aside is what
    /// makes the address recoverable.
    #[test]
    fn unparsable_state_is_kept_rather_than_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(PUSH_STATE_FILENAME), "{ \"last\": tr").unwrap();

        load_or_init_push_state(dir.path());

        let kept = dir.path().join(format!("{PUSH_STATE_FILENAME}.corrupt"));
        assert_eq!(std::fs::read_to_string(kept).unwrap(), "{ \"last\": tr");
    }

    /// A fresh install has nothing to preserve, so it must not litter the
    /// config dir with an empty `.corrupt` file.
    #[test]
    fn a_fresh_install_quarantines_nothing() {
        let dir = tempfile::tempdir().unwrap();

        load_or_init_push_state(dir.path());

        assert!(!dir.path().join(format!("{PUSH_STATE_FILENAME}.corrupt")).exists());
    }

    /// Reporting status must not be what creates the file — on desktop that is
    /// a `push.json` minted purely by opening Settings, for a platform where
    /// push can never work.
    #[test]
    fn reading_state_never_creates_it() {
        let dir = tempfile::tempdir().unwrap();

        assert_eq!(load_push_state(dir.path()), None);
        assert!(!dir.path().join(PUSH_STATE_FILENAME).exists());
    }

    #[test]
    fn reading_state_returns_what_was_saved() {
        let dir = tempfile::tempdir().unwrap();
        let mut state = load_or_init_push_state(dir.path());
        state.last = Some(registered());
        save_push_state_to(dir.path(), &state).unwrap();

        assert_eq!(load_push_state(dir.path()), Some(state));
    }

    /// A session the homeserver has stopped honouring took its pushers with it.
    /// Keeping the record would convince the next login it is already
    /// registered — the same silent no-push as an account switch.
    #[test]
    fn forgetting_clears_the_record_but_keeps_the_profile_tag() {
        let dir = tempfile::tempdir().unwrap();
        let mut state = load_or_init_push_state(dir.path());
        let tag = state.profile_tag.clone();
        state.last = Some(registered());
        state.pending_delete.push(registered());
        save_push_state_to(dir.path(), &state).unwrap();

        forget_local_registrations(dir.path());

        let after = load_push_state(dir.path()).unwrap();
        assert_eq!(after.last, None);
        assert!(after.pending_delete.is_empty());
        assert_eq!(after.profile_tag, tag, "device rules stay attached to this install");
    }

    /// Nothing on disk means nothing to forget — and no file to create.
    #[test]
    fn forgetting_on_a_fresh_install_is_a_no_op() {
        let dir = tempfile::tempdir().unwrap();

        forget_local_registrations(dir.path());

        assert!(!dir.path().join(PUSH_STATE_FILENAME).exists());
    }

    /// A half-written file can no longer name the pusher it was tracking, so
    /// the write has to be all-or-nothing.
    #[test]
    fn saving_leaves_no_partial_file_behind() {
        let dir = tempfile::tempdir().unwrap();
        let mut state = PushState::fresh();
        state.last = Some(registered());

        save_push_state_to(dir.path(), &state).unwrap();

        assert!(!dir.path().join(format!("{PUSH_STATE_FILENAME}.tmp")).exists());
        assert_eq!(load_push_state(dir.path()), Some(state));
    }

    #[test]
    fn saving_creates_the_config_dir_if_it_is_missing() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("does/not/exist");
        let state = PushState { profile_tag: "tag".into(), last: None, pending_delete: Vec::new(), endpoint: None };

        save_push_state_to(&nested, &state).unwrap();

        assert_eq!(load_or_init_push_state(&nested), state);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unified_push() -> PushRegistration {
        PushRegistration {
            transport: PushTransport::UnifiedPush,
            pushkey: "https://ntfy.example.org/up1234".into(),
            gateway_url: "https://ntfy.example.org/_matrix/push/v1/notify".into(),
            device_display_name: "Pixel 8".into(),
            profile_tag: "abcd1234".into(),
            lang: "en".into(),
        }
    }

    fn apns(sandbox: bool) -> PushRegistration {
        PushRegistration {
            transport: PushTransport::Apns { sandbox },
            pushkey: "dG9rZW4=".into(),
            gateway_url: "https://push.quark.tel/_matrix/push/v1/notify".into(),
            device_display_name: "iPhone".into(),
            profile_tag: "abcd1234".into(),
            lang: "en".into(),
        }
    }

    /// Serialise the way `client.pusher().set()` will, so the assertions below
    /// are about the bytes the homeserver actually receives.
    fn wire(reg: &PushRegistration) -> serde_json::Value {
        serde_json::to_value(reg.to_pusher()).expect("pusher serialises")
    }

    #[test]
    fn requests_event_id_only_so_no_content_reaches_the_gateway() {
        assert_eq!(wire(&unified_push())["data"]["format"], "event_id_only");
        assert_eq!(wire(&apns(false))["data"]["format"], "event_id_only");
    }

    #[test]
    fn routes_to_the_gateway_url_and_pushkey_it_was_given() {
        let json = wire(&unified_push());
        assert_eq!(json["data"]["url"], "https://ntfy.example.org/_matrix/push/v1/notify");
        assert_eq!(json["pushkey"], "https://ntfy.example.org/up1234");
        assert_eq!(json["kind"], "http");
    }

    #[test]
    fn apns_app_id_distinguishes_sandbox_from_production() {
        assert_eq!(wire(&apns(true))["app_id"], "tel.quark.app.ios.dev");
        assert_eq!(wire(&apns(false))["app_id"], "tel.quark.app.ios.prod");
    }

    #[test]
    fn unified_push_registers_under_the_android_app_id() {
        assert_eq!(wire(&unified_push())["app_id"], "tel.quark.app.android");
    }

    /// Without `mutable-content` iOS never invokes the notification service
    /// extension, so the user sees the untouched placeholder alert instead of
    /// the real sender and room.
    #[test]
    fn apns_asks_for_mutable_content_so_the_extension_runs() {
        assert_eq!(wire(&apns(false))["data"]["default_payload"]["aps"]["mutable-content"], 1);
    }

    /// APNs-shaped payload on an Android pusher would be dead weight the
    /// homeserver forwards to the UnifiedPush gateway on every message.
    #[test]
    fn unified_push_carries_no_apns_payload() {
        assert!(wire(&unified_push())["data"].get("default_payload").is_none());
    }

    #[test]
    fn carries_the_profile_tag_and_device_name() {
        let json = wire(&unified_push());
        assert_eq!(json["profile_tag"], "abcd1234");
        assert_eq!(json["device_display_name"], "Pixel 8");
        assert_eq!(json["lang"], "en");
    }
}

