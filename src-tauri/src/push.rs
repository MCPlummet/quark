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

// ─── Tests ───────────────────────────────────────────────────────────────────

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

