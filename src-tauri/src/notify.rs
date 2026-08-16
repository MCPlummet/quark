//! Transport-agnostic notification pipeline.
//!
//! `evaluate()` turns a sync event (`NotificationInput`) into a renderable
//! `NotificationSpec` (or `None`); `deliver()` posts the spec through the
//! platform arm (rich grouped notification on mobile, plain title/body on
//! desktop, where the plugin drops everything else anyway).
//!
//! The pipeline is deliberately independent of *what drives sync*. Today the
//! long-lived sync loop produces events (kept alive on Android by the
//! foreground sync service); a future UnifiedPush transport would wake the
//! process, run a bounded sync, and the same handlers feed the same pipeline —
//! nothing in this module changes.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

use tauri_plugin_notification::NotificationExt;

use crate::notifications::{format_notification, should_notify, NotificationConfig};

// ─── Channel / action identifiers ─────────────────────────────────────────────

/// Android channel for ordinary room messages.
pub const CHANNEL_MESSAGES: &str = "messages";
/// Android channel for highlights (mentions, keywords) — separate so users can
/// give mentions their own sound/importance in OS settings.
pub const CHANNEL_MENTIONS: &str = "mentions";
/// Android channel for the foreground sync service's persistent notification.
pub const CHANNEL_BACKGROUND: &str = "background_sync";
/// Action type carrying the Reply / Mark-as-read quick actions. Registered
/// from the frontend (the plugin's Rust `ActionType` has no public
/// constructor in 2.3.3, so registration must go through the JS API).
pub const ACTION_TYPE_MESSAGE: &str = "quark_message";

// ─── Pipeline types ───────────────────────────────────────────────────────────

/// Outcome of the push-rule evaluation matrix-sdk performs for every timeline
/// event under plain sync (delivered to event handlers as a `Vec<Action>`).
#[derive(Debug, Clone, Copy, Default)]
pub struct PushEval {
    /// A matching rule said notify. Empty actions mean either "an override
    /// muted this room" (the Matrix-native room mute) or "no push context yet"
    /// (rare: a just-joined room mid-first-sync) — both map to `false`, same
    /// as matrix-sdk's own notification stream.
    pub notify: bool,
    /// A matching rule set the highlight tweak (mention, keyword, @room).
    pub highlight: bool,
}

impl PushEval {
    pub fn from_actions(actions: &[matrix_sdk::ruma::push::Action]) -> Self {
        Self {
            notify: actions.iter().any(|a| a.should_notify()),
            highlight: actions.iter().any(|a| a.is_highlight()),
        }
    }
}

/// Everything `evaluate()` needs to decide whether — and how — to notify.
#[derive(Debug, Clone)]
pub struct NotificationInput {
    pub room_id: String,
    pub room_name: String,
    pub event_id: String,
    /// Sender label for the title: display name when known, MXID otherwise.
    pub sender: String,
    pub body: String,
    pub is_edit: bool,
    pub is_own: bool,
    pub window_focused: bool,
    pub pre_startup: bool,
    pub push: PushEval,
}

/// A fully-rendered notification, ready for any delivery transport.
///
/// Serializable because delivery is not always Tauri's job: a push that wakes a
/// cold process has no `AppHandle` to post through, so the spec crosses to
/// Kotlin as JSON and `PushSyncService` posts it with `NotificationCompat`. The
/// camelCase field names are that wire contract — they are read by name on the
/// other side, where a rename fails silently rather than at compile time.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationSpec {
    /// Stable per-event notification id (fnv1a of the event id), so a
    /// re-delivered event replaces rather than duplicates.
    pub id: i32,
    /// Stable per-room id for the Android group-summary notification.
    pub summary_id: i32,
    pub title: String,
    pub body: String,
    pub channel: &'static str,
    /// Notification group key — the room id, one conversation per group.
    pub group: String,
    pub room_id: String,
    pub event_id: String,
    pub room_name: String,
    pub highlight: bool,
}

/// Decide whether an event warrants an OS notification and render it.
///
/// Pure (no platform calls) so the decision matrix is unit-testable. Returns
/// `None` for: own messages, focused window, initial-sync catch-up events,
/// edits (a replacement is not a new message), rooms muted locally or by
/// config (quiet hours, master switch), and events the push rules silenced.
pub fn evaluate(input: &NotificationInput, config: &NotificationConfig) -> Option<NotificationSpec> {
    if input.is_own || input.window_focused || input.pre_startup || input.is_edit {
        return None;
    }
    if !should_notify(config, &input.room_id) {
        return None;
    }
    if !input.push.notify {
        return None;
    }

    let (title, body) = format_notification(&input.sender, &input.body, &input.room_name, config);
    Some(NotificationSpec {
        id: stable_id(&input.event_id),
        summary_id: stable_id(&input.room_id),
        title,
        body,
        channel: if input.push.highlight { CHANNEL_MENTIONS } else { CHANNEL_MESSAGES },
        group: input.room_id.clone(),
        room_id: input.room_id.clone(),
        event_id: input.event_id.clone(),
        room_name: input.room_name.clone(),
        highlight: input.push.highlight,
    })
}

/// FNV-1a 32-bit over the string, as an `i32` notification id. The Android
/// plugin uses `Int.MIN_VALUE` as its "no notification" intent sentinel, so
/// that one value is remapped.
fn stable_id(s: &str) -> i32 {
    let mut hash: u32 = 0x811c_9dc5;
    for byte in s.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    let id = hash as i32;
    if id == i32::MIN { i32::MIN + 1 } else { id }
}

// ─── Active-notification registry ─────────────────────────────────────────────

/// Tracks the OS notification ids posted per room so they can be dismissed
/// when the room is read — locally or via a receipt from another device.
#[derive(Default)]
pub struct NotificationRegistry(Mutex<HashMap<String, Vec<i32>>>);

impl NotificationRegistry {
    pub fn record(&self, room_id: &str, id: i32) {
        if let Ok(mut map) = self.0.lock() {
            let ids = map.entry(room_id.to_string()).or_default();
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
    }

    /// Number of live notifications for the room (summary excluded by the
    /// caller's bookkeeping — it records message ids before the summary).
    pub fn count(&self, room_id: &str) -> usize {
        self.0
            .lock()
            .ok()
            .and_then(|map| map.get(room_id).map(Vec::len))
            .unwrap_or(0)
    }

    /// Remove and return all ids for the room.
    pub fn take_room(&self, room_id: &str) -> Vec<i32> {
        self.0
            .lock()
            .ok()
            .and_then(|mut map| map.remove(room_id))
            .unwrap_or_default()
    }
}

// ─── Delivery ─────────────────────────────────────────────────────────────────

/// Post a spec through the platform-appropriate transport.
pub fn deliver(app: &tauri::AppHandle, spec: &NotificationSpec) {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    deliver_mobile(app, spec);
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        // Desktop arm: notify-rust only carries title/body/icon/sound — the
        // plugin silently drops group/extra/actions there, and exposes no
        // click events, so the rich fields would be wasted.
        if let Err(e) = app
            .notification()
            .builder()
            .title(&spec.title)
            .body(&spec.body)
            .show()
        {
            tracing::error!("Failed to send OS notification: {e}");
        }
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn deliver_mobile(app: &tauri::AppHandle, spec: &NotificationSpec) {
    use tauri::Manager;

    let registry = app.state::<NotificationRegistry>();
    let result = app
        .notification()
        .builder()
        .id(spec.id)
        .channel_id(spec.channel) // ignored on iOS (no channel concept)
        .title(&spec.title)
        .body(&spec.body)
        .group(&spec.group)
        .extra("room_id", &spec.room_id)
        .extra("event_id", &spec.event_id)
        .action_type_id(ACTION_TYPE_MESSAGE)
        .auto_cancel()
        .show();
    match result {
        Ok(()) => registry.record(&spec.room_id, spec.id),
        Err(e) => {
            tracing::error!("Failed to send OS notification: {e}");
            return;
        }
    }

    // Android stacks the per-room conversation under a group summary; post it
    // once a second message arrives. (iOS has no group-summary concept.)
    #[cfg(target_os = "android")]
    {
        let count = registry.count(&spec.room_id);
        if count > 1 {
            let summary = app
                .notification()
                .builder()
                .id(spec.summary_id)
                .channel_id(spec.channel)
                .title(&spec.room_name)
                .body(format!("{count} new messages"))
                .group(&spec.group)
                .group_summary()
                .extra("room_id", &spec.room_id)
                .action_type_id(ACTION_TYPE_MESSAGE)
                .auto_cancel()
                .show();
            match summary {
                Ok(()) => registry.record(&spec.room_id, spec.summary_id),
                Err(e) => tracing::warn!("Failed to post group summary: {e}"),
            }
        }
    }
}

/// Dismiss all live notifications for a room (read locally or on another
/// device). No-op on desktop — the plugin has no removal API there.
pub fn cancel_room(app: &tauri::AppHandle, room_id: &str) {
    use tauri::Manager;

    let ids = app.state::<NotificationRegistry>().take_room(room_id);
    if ids.is_empty() {
        return;
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        if let Err(e) = app.notification().remove_active(ids) {
            tracing::warn!("Failed to clear notifications for {room_id}: {e}");
        }
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let _ = ids;
}

// ─── Cold-start action replay ─────────────────────────────────────────────────

/// A notification tap/action captured by `MainActivity` while no JS listener
/// was alive. The plugin's `actionPerformed` event is silently dropped when it
/// fires before the frontend registers its listener (cold start, or a tap
/// relaunching the webview while the foreground service kept the process
/// alive) — MainActivity writes the intent's extras to a file instead, and the
/// frontend replays it at boot via `take_pending_notification_action`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingNotificationAction {
    /// ms since epoch when the intent arrived (stamped by MainActivity).
    pub ts: u64,
    pub action_id: Option<String>,
    pub input_value: Option<String>,
    /// The full notification JSON the plugin attached to the intent
    /// (carries `extra.room_id`). Kept raw — the frontend parses it with the
    /// same code as the warm-path event.
    pub notification: Option<serde_json::Value>,
}

/// Filename within the Android app data dir (`Context.dataDir` — the same
/// directory Tauri's `app_data_dir()` resolves to on Android).
pub const PENDING_ACTION_FILENAME: &str = "pending_notification.json";

/// Maximum age before a pending action is considered stale and discarded —
/// a tap from hours ago shouldn't navigate today's launch.
const PENDING_ACTION_MAX_AGE_MS: u64 = 5 * 60 * 1000;

/// Read-and-delete the pending-action file. Returns `None` when the file is
/// missing, unparsable, or stale.
pub fn take_pending_action_from(
    path: &std::path::Path,
    now_ms: u64,
) -> Option<PendingNotificationAction> {
    let data = std::fs::read_to_string(path).ok()?;
    let _ = std::fs::remove_file(path);
    let action: PendingNotificationAction = serde_json::from_str(&data).ok()?;
    if now_ms.saturating_sub(action.ts) > PENDING_ACTION_MAX_AGE_MS {
        return None;
    }
    Some(action)
}

// ─── Channel setup ────────────────────────────────────────────────────────────

/// Create the Android notification channels and no-op elsewhere. Called from
/// the frontend's notification init (a command, not app setup, because the
/// mobile plugin's Kotlin side only becomes callable once the webview loads).
/// Channel creation is idempotent on Android.
pub fn setup_channels(app: &tauri::AppHandle) {
    #[cfg(target_os = "android")]
    {
        use tauri_plugin_notification::{Channel, Importance};
        let channels = [
            Channel::builder(CHANNEL_MESSAGES, "Messages")
                .description("New messages in your rooms")
                .importance(Importance::High)
                .vibration(true)
                .build(),
            Channel::builder(CHANNEL_MENTIONS, "Mentions")
                .description("Messages that mention you")
                .importance(Importance::High)
                .vibration(true)
                .lights(true)
                .build(),
            Channel::builder(CHANNEL_BACKGROUND, "Background sync")
                .description("Keeps the connection to your homeserver alive")
                .importance(Importance::Min)
                .build(),
        ];
        for channel in channels {
            if let Err(e) = app.notification().create_channel(channel) {
                tracing::warn!("create_channel failed: {e}");
            }
        }
    }
    #[cfg(not(target_os = "android"))]
    let _ = app;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> NotificationInput {
        NotificationInput {
            room_id: "!room:example.com".into(),
            room_name: "General".into(),
            event_id: "$event1".into(),
            sender: "Alice".into(),
            body: "hello".into(),
            is_edit: false,
            is_own: false,
            window_focused: false,
            pre_startup: false,
            push: PushEval { notify: true, highlight: false },
        }
    }

    fn config() -> NotificationConfig {
        NotificationConfig::default()
    }

    #[test]
    fn evaluate_notifies_for_plain_message() {
        let spec = evaluate(&input(), &config()).expect("should notify");
        assert_eq!(spec.title, "Alice in General");
        assert_eq!(spec.body, "hello");
        assert_eq!(spec.channel, CHANNEL_MESSAGES);
        assert_eq!(spec.group, "!room:example.com");
        assert!(!spec.highlight);
    }

    #[test]
    fn evaluate_skips_own_messages() {
        let mut i = input();
        i.is_own = true;
        assert!(evaluate(&i, &config()).is_none());
    }

    #[test]
    fn evaluate_skips_when_window_focused() {
        let mut i = input();
        i.window_focused = true;
        assert!(evaluate(&i, &config()).is_none());
    }

    #[test]
    fn evaluate_skips_pre_startup_catchup() {
        let mut i = input();
        i.pre_startup = true;
        assert!(evaluate(&i, &config()).is_none());
    }

    #[test]
    fn evaluate_skips_edits() {
        let mut i = input();
        i.is_edit = true;
        assert!(evaluate(&i, &config()).is_none());
    }

    #[test]
    fn evaluate_respects_local_room_mute() {
        let mut c = config();
        c.mute_rooms = vec!["!room:example.com".into()];
        assert!(evaluate(&input(), &c).is_none());
    }

    #[test]
    fn evaluate_respects_master_switch() {
        let mut c = config();
        c.enabled = false;
        assert!(evaluate(&input(), &c).is_none());
    }

    #[test]
    fn evaluate_respects_push_rule_silence() {
        let mut i = input();
        i.push = PushEval { notify: false, highlight: false };
        assert!(evaluate(&i, &config()).is_none());
    }

    #[test]
    fn evaluate_routes_highlights_to_mentions_channel() {
        let mut i = input();
        i.push = PushEval { notify: true, highlight: true };
        let spec = evaluate(&i, &config()).expect("should notify");
        assert_eq!(spec.channel, CHANNEL_MENTIONS);
        assert!(spec.highlight);
    }

    #[test]
    fn evaluate_applies_privacy_flags() {
        let mut c = config();
        c.show_sender = false;
        c.show_body = false;
        let spec = evaluate(&input(), &c).expect("should notify");
        assert_eq!(spec.title, "New Message");
        assert_eq!(spec.body, "You have a new message");
    }

    #[test]
    fn spec_serialises_for_a_non_tauri_notifier() {
        // The cold push path has no AppHandle, so Kotlin posts the notification
        // itself from this JSON. These key names are the wire contract with
        // PushSyncService — renaming a field here silently drops it there.
        let spec = evaluate(&input(), &config()).expect("should notify");
        let json = serde_json::to_value(&spec).expect("spec must serialise");
        assert_eq!(json["id"], spec.id);
        assert_eq!(json["summaryId"], spec.summary_id);
        assert_eq!(json["title"], "Alice in General");
        assert_eq!(json["body"], "hello");
        assert_eq!(json["channel"], CHANNEL_MESSAGES);
        assert_eq!(json["group"], "!room:example.com");
        assert_eq!(json["roomId"], "!room:example.com");
        assert_eq!(json["eventId"], "$event1");
        assert_eq!(json["roomName"], "General");
        assert_eq!(json["highlight"], false);
    }

    #[test]
    fn stable_id_is_deterministic_and_distinct() {
        assert_eq!(stable_id("$event1"), stable_id("$event1"));
        assert_ne!(stable_id("$event1"), stable_id("$event2"));
        assert_ne!(stable_id("$event1"), stable_id("!room:example.com"));
    }

    #[test]
    fn spec_ids_are_stable_per_event_and_room() {
        let a = evaluate(&input(), &config()).unwrap();
        let b = evaluate(&input(), &config()).unwrap();
        assert_eq!(a.id, b.id);
        assert_eq!(a.summary_id, b.summary_id);
        let mut other = input();
        other.event_id = "$event2".into();
        let c = evaluate(&other, &config()).unwrap();
        assert_ne!(a.id, c.id);
        assert_eq!(a.summary_id, c.summary_id); // same room
    }

    #[test]
    fn push_eval_from_actions() {
        use matrix_sdk::ruma::push::{Action, Tweak};
        let eval = PushEval::from_actions(&[Action::Notify, Action::SetTweak(Tweak::Highlight(true))]);
        assert!(eval.notify);
        assert!(eval.highlight);

        let silent = PushEval::from_actions(&[]);
        assert!(!silent.notify);
        assert!(!silent.highlight);

        let plain = PushEval::from_actions(&[Action::Notify]);
        assert!(plain.notify);
        assert!(!plain.highlight);
    }

    #[test]
    fn pending_action_take_once_and_staleness() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join(PENDING_ACTION_FILENAME);

        // Missing file → None.
        assert!(take_pending_action_from(&path, 1_000).is_none());

        // Fresh entry → returned, and the file is consumed.
        std::fs::write(
            &path,
            r#"{"ts":1000,"actionId":"tap","inputValue":null,"notification":{"extra":{"room_id":"!a:x"}}}"#,
        )
        .unwrap();
        let action = take_pending_action_from(&path, 2_000).expect("fresh action");
        assert_eq!(action.action_id.as_deref(), Some("tap"));
        assert_eq!(
            action.notification.unwrap()["extra"]["room_id"],
            serde_json::json!("!a:x")
        );
        assert!(!path.exists(), "file must be consumed");
        assert!(take_pending_action_from(&path, 2_000).is_none());

        // Stale entry (>5 min) → discarded, file still consumed.
        std::fs::write(&path, r#"{"ts":1000,"actionId":"tap"}"#).unwrap();
        assert!(take_pending_action_from(&path, 1000 + 5 * 60 * 1000 + 1).is_none());
        assert!(!path.exists());

        // Garbage → None, file consumed.
        std::fs::write(&path, "not json").unwrap();
        assert!(take_pending_action_from(&path, 1_000).is_none());
        assert!(!path.exists());
    }

    #[test]
    fn registry_records_dedupes_and_takes() {
        let reg = NotificationRegistry::default();
        reg.record("!a:x", 1);
        reg.record("!a:x", 2);
        reg.record("!a:x", 1); // duplicate
        reg.record("!b:x", 3);
        assert_eq!(reg.count("!a:x"), 2);
        assert_eq!(reg.take_room("!a:x"), vec![1, 2]);
        assert_eq!(reg.count("!a:x"), 0);
        assert_eq!(reg.count("!b:x"), 1);
        assert!(reg.take_room("!missing:x").is_empty());
    }
}
