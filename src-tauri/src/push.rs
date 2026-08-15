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

/// A pusher we successfully registered, remembered so it can be deleted when
/// the transport hands us a new address. Without this a rotated APNs token or
/// a re-subscribed UnifiedPush endpoint leaves the old pusher on the
/// homeserver, still being pushed to and never read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RegisteredPusher {
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
    /// The last pusher we registered, if any.
    #[serde(default)]
    pub last: Option<RegisteredPusher>,
}

/// Read push state, minting and persisting a profile tag on first use.
///
/// Never fails: a missing file is a fresh install, and a corrupt one is not
/// worth bricking push over — the cost of starting again is an orphaned set of
/// per-device push rules, not a broken client.
pub fn load_or_init_push_state(config_dir: &std::path::Path) -> PushState {
    let path = config_dir.join(PUSH_STATE_FILENAME);
    if let Ok(content) = std::fs::read_to_string(&path) {
        match serde_json::from_str::<PushState>(&content) {
            Ok(state) => return state,
            Err(e) => tracing::warn!("Ignoring unparsable {PUSH_STATE_FILENAME}: {e}"),
        }
    }
    let state = PushState { profile_tag: new_profile_tag(), last: None };
    if let Err(e) = save_push_state_to(config_dir, &state) {
        tracing::warn!("Failed to persist initial push state: {e}");
    }
    state
}

/// Write push state to `<config_dir>/push.json`.
pub fn save_push_state_to(
    config_dir: &std::path::Path,
    state: &PushState,
) -> Result<(), String> {
    std::fs::create_dir_all(config_dir)
        .map_err(|e| format!("Failed to create config dir: {e}"))?;
    let content = serde_json::to_string_pretty(state)
        .map_err(|e| format!("Failed to serialize push state: {e}"))?;
    std::fs::write(config_dir.join(PUSH_STATE_FILENAME), content)
        .map_err(|e| format!("Failed to write {PUSH_STATE_FILENAME}: {e}"))
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
/// The homeserver identifies a pusher by `(app_id, pushkey)`, so re-setting
/// the same pair overwrites in place and needs no cleanup. Only when that pair
/// changes does the previous pusher survive on its own and have to be deleted.
pub fn plan_registration(state: &PushState, next: &RegisteredPusher) -> PushAction {
    let Some(last) = &state.last else {
        return PushAction::Register { stale: None };
    };
    if last == next {
        return PushAction::Unchanged;
    }
    let same_pusher = last.app_id == next.app_id && last.pushkey == next.pushkey;
    PushAction::Register {
        stale: if same_pusher { None } else { Some(last.clone()) },
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod plan_tests {
    use super::*;

    fn state_with(last: Option<RegisteredPusher>) -> PushState {
        PushState { profile_tag: "tag".into(), last }
    }

    fn pusher(app_id: &str, pushkey: &str, gateway: &str) -> RegisteredPusher {
        RegisteredPusher {
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
}

#[cfg(test)]
mod state_tests {
    use super::*;

    fn registered() -> RegisteredPusher {
        RegisteredPusher {
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

    #[test]
    fn saving_creates_the_config_dir_if_it_is_missing() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("does/not/exist");
        let state = PushState { profile_tag: "tag".into(), last: None };

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

