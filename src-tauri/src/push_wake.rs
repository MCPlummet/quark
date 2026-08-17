//! Handling an inbound push: what a wake-up means, and who is allowed to act on
//! it.
//!
//! Transport-agnostic on purpose. What arrives on the wire is the Matrix Push
//! Gateway API's notification body — UnifiedPush's Matrix gateway forwards it
//! verbatim, and Sygnal derives its APNs payload from the same object — so
//! everything here is about the *protocol*, not about Android. The Android glue
//! that receives it lives in `unifiedpush.rs`.

use std::sync::atomic::{AtomicBool, Ordering};

// ─── What a push is asking for ───────────────────────────────────────────────

/// The actionable content of a push.
///
/// Under `event_id_only` (the only format we register — see `push.rs`) a push
/// carries no sender, body or room name. Everything the user eventually sees is
/// resolved on-device afterwards; this is just the address to resolve.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PushWake {
    /// An event happened. Sync and let the existing pipeline decide whether it
    /// is worth showing — the push rules already said it might be, but quiet
    /// hours, focus and mutes have not been consulted yet.
    Event { room_id: String, event_id: String },
    /// A counts-only push: the unread count moved with no event to show. Sent
    /// when notifications are read elsewhere, so the answer is never "notify".
    Clear,
}

/// Parse a push gateway notification body.
///
/// `Err` is reserved for a payload that is not a notification at all — a
/// distributor's own test message, or a truncated body. Anything shaped like a
/// notification but missing the ids is a [`PushWake::Clear`]: the spec allows
/// exactly that, and erroring would log noise on every read receipt.
pub fn parse_wake(payload: &str) -> Result<PushWake, String> {
    let value: serde_json::Value =
        serde_json::from_str(payload).map_err(|e| format!("Unparsable push payload: {e}"))?;
    let notification = value
        .get("notification")
        .ok_or("Push payload has no `notification` object")?;

    let room_id = notification.get("room_id").and_then(|v| v.as_str());
    let event_id = notification.get("event_id").and_then(|v| v.as_str());

    match (room_id, event_id) {
        (Some(room_id), Some(event_id)) if !room_id.is_empty() && !event_id.is_empty() => {
            Ok(PushWake::Event {
                room_id: room_id.to_owned(),
                event_id: event_id.to_owned(),
            })
        }
        _ => Ok(PushWake::Clear),
    }
}

// ─── Deciding whether to act ─────────────────────────────────────────────────

/// What a wake-up should do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WakePlan {
    /// Run a bounded sync and let the notification pipeline decide the rest.
    Sync,
    /// Stand down. The reason is kept because these are the interesting lines
    /// in a bug report about push that "does nothing".
    Ignore(IgnoreReason),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IgnoreReason {
    /// The user turned push off. A pusher can outlive the preference — an
    /// opt-out we could not deliver to the homeserver is owed, not applied —
    /// so pushes keep arriving for a while afterwards.
    PushDisabled,
    /// The app's own sync loop is live and will deliver this event itself.
    WarmSyncRunning,
    /// A counts-only push. There is nothing to render.
    NothingToShow,
}

/// Decide what to do about a wake-up, before any network or store access.
pub fn plan_wake(wake: &PushWake, push_enabled: bool, warm_sync_active: bool) -> WakePlan {
    if !push_enabled {
        return WakePlan::Ignore(IgnoreReason::PushDisabled);
    }
    if warm_sync_active {
        return WakePlan::Ignore(IgnoreReason::WarmSyncRunning);
    }
    match wake {
        PushWake::Event { .. } => WakePlan::Sync,
        PushWake::Clear => WakePlan::Ignore(IgnoreReason::NothingToShow),
    }
}

// ─── Coalescing concurrent wakes ─────────────────────────────────────────────

/// Admits one push sync at a time, process-wide.
///
/// A burst of pushes — five messages arriving at once, or a distributor
/// re-delivering an unacknowledged one — must not become five concurrent syncs
/// against the homeserver. That failure mode has taken this homeserver down
/// before, and the cold path is the worst place for it: nothing else is running
/// to notice. One sync sees every event in the burst anyway, so the losers have
/// nothing to do but stand down.
#[derive(Default)]
pub struct WakeGuard(AtomicBool);

/// Proof that the holder is the one sync allowed to run. Releases on drop, so
/// an early return or a panic cannot wedge the guard shut for the rest of the
/// process's life.
pub struct WakeLease<'a>(&'a WakeGuard);

impl WakeGuard {
    pub const fn new() -> Self {
        WakeGuard(AtomicBool::new(false))
    }

    /// Take the lease, or `None` if a sync is already running.
    pub fn try_enter(&self) -> Option<WakeLease<'_>> {
        self.0
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| WakeLease(self))
    }
}

impl Drop for WakeLease<'_> {
    fn drop(&mut self) {
        self.0 .0.store(false, Ordering::Release);
    }
}

// ─── Is the app already syncing? ─────────────────────────────────────────────

/// The running app, if there is one.
///
/// Push work is reached from Kotlin, not from a Tauri command, so it arrives
/// with no `AppHandle` and no way to ask what this process already has. Set once
/// during app setup; absent means no Tauri is running here — which is itself the
/// answer to the question that matters most, "could another `Client` exist?"
static APP_HANDLE: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

/// Publish the app handle for the push paths. Called once from app setup.
pub fn set_app_handle(app: tauri::AppHandle) {
    let _ = APP_HANDLE.set(app);
}

pub fn app_handle() -> Option<&'static tauri::AppHandle> {
    APP_HANDLE.get()
}

/// A Matrix client for work with no `AppHandle` behind it.
///
/// Prefers the app's own client, and this is not an optimisation: two `Client`s
/// over one store means two `OlmMachine`s, which is the documented cause of
/// Olm-account corruption when an app and an extension share a store
/// (element-ios#3817). Building a fresh one is safe only in the case this
/// reaches it — no Tauri in the process, so no other client can exist.
pub async fn background_client(data_dir: &std::path::Path) -> Result<matrix_sdk::Client, String> {
    use tauri::Manager;

    if let Some(app) = app_handle() {
        let existing = app
            .try_state::<crate::matrix::client::MatrixState>()
            .and_then(|state| state.0.lock().ok().and_then(|guard| guard.clone()));
        return existing.ok_or_else(|| "The app is running but not logged in".to_string());
    }

    let session = crate::secrets::load_session(data_dir)?.ok_or("No stored session")?;
    let store_key = crate::secrets::get_store_key(data_dir)?.ok_or("No store-encryption key")?;
    let client = crate::matrix::client::build_client(
        &session.homeserver_url,
        data_dir.to_path_buf(),
        &store_key,
    )
    .await?;
    crate::matrix::client::restore_session_from_info(&client, &session).await?;
    Ok(client)
}

/// Set while the app's own sync loop is running.
///
/// Process-wide rather than Tauri-managed on purpose: the push service runs in
/// the same process as the app but has no `AppHandle` to ask, and this is the
/// one question it must be able to answer before opening a second connection to
/// the homeserver.
static WARM_SYNC_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Record whether the long-lived sync loop is running. Called by `start_sync`
/// and by the paths that abort it.
pub fn set_warm_sync_active(active: bool) {
    WARM_SYNC_ACTIVE.store(active, Ordering::Release);
}

pub fn warm_sync_active() -> bool {
    WARM_SYNC_ACTIVE.load(Ordering::Acquire)
}

/// The one wake allowed to sync at a time, for the life of the process.
pub static WAKE_GUARD: WakeGuard = WakeGuard::new();

// ─── Running the wake ────────────────────────────────────────────────────────

/// Wall-clock ceiling for the whole wake, from cold client to rendered specs.
///
/// Android's `shortService` allows about 30 s before it force-stops the service,
/// and being force-stopped mid-sync is worse than returning nothing: it can
/// interrupt a store write. Finish early and leave headroom for Kotlin to post
/// what we found.
const WAKE_BUDGET: std::time::Duration = std::time::Duration::from_secs(20);

/// Most notifications one wake will post.
///
/// A wake syncs a *batch*, not the single event the push named, so a device
/// that has been off for a while can come back to a great many notifiable
/// events at once. Past a handful they stop being information and start being
/// a wall to swipe away; the room list and unread counts carry the rest.
const MAX_WAKE_NOTIFICATIONS: usize = 8;

/// Whether an event predates the user's read marker in its room.
///
/// The marker moves when the room is read on *any* device, which is what makes
/// this the right question to ask: "never delivered to this phone" and "never
/// seen by this person" are different things, and only the second one should
/// produce a notification.
///
/// No marker means no evidence either way, so the event still notifies —
/// suppressing there would silence precisely the rooms never opened.
pub fn already_seen(event_ts: u64, read_marker_ts: Option<u64>) -> bool {
    read_marker_ts.is_some_and(|marker| event_ts <= marker)
}

/// Trim a wake to [`MAX_WAKE_NOTIFICATIONS`], keeping the newest, and report
/// how many were dropped so the caller can say so rather than silently truncate.
pub fn cap_wake_notifications(
    mut specs: Vec<crate::notify::NotificationSpec>,
) -> (Vec<crate::notify::NotificationSpec>, usize) {
    if specs.len() <= MAX_WAKE_NOTIFICATIONS {
        return (specs, 0);
    }
    // Sync order is chronological, so the tail is the most recent.
    let dropped = specs.len() - MAX_WAKE_NOTIFICATIONS;
    specs.drain(..dropped);
    (specs, dropped)
}

/// Everything the collecting event handlers need. No `AppHandle` — that is the
/// entire point of this path.
#[derive(Clone)]
struct Collector {
    config: std::sync::Arc<crate::notifications::NotificationConfig>,
    out: std::sync::Arc<std::sync::Mutex<Vec<crate::notify::NotificationSpec>>>,
    /// Read-marker timestamp per room, so a batch of events in one room costs
    /// one store lookup rather than one per event.
    read_markers:
        std::sync::Arc<tokio::sync::Mutex<std::collections::HashMap<String, Option<u64>>>>,
}

impl Collector {
    /// When the user last read this room, on any device.
    async fn read_marker(&self, room: &matrix_sdk::Room) -> Option<u64> {
        use matrix_sdk::ruma::events::receipt::{ReceiptThread, ReceiptType};

        let room_id = room.room_id().to_string();
        if let Some(cached) = self.read_markers.lock().await.get(&room_id) {
            return *cached;
        }
        let marker = room
            .load_user_receipt(ReceiptType::Read, ReceiptThread::Unthreaded, room.own_user_id())
            .await
            .ok()
            .flatten()
            .and_then(|(_, receipt)| receipt.ts)
            .map(|ts| u64::from(ts.0));
        self.read_markers.lock().await.insert(room_id, marker);
        marker
    }
}

/// Wake up, sync once, and render whatever the notification pipeline selects.
///
/// `data_dir` is Android's `Context.dataDir`, which is what Tauri's
/// `app_data_dir()` *and* `app_config_dir()` both resolve to there — so the
/// store, the secrets and `notifications.toml` are all under this one path.
///
/// Deliberately runs a real (if bounded) sync rather than fetching the single
/// event the push named. The SDK's `Vec<Action>` extractor hands the handler the
/// server's own push-rule evaluation, which means `notify::evaluate` sees
/// *identical* inputs to the warm path — same mute rules, same highlight
/// decision, no second implementation to drift. It also picks up everything else
/// that arrived in the same window, which is why a burst coalesces cleanly.
pub async fn run_wake(
    data_dir: &std::path::Path,
    wake: &PushWake,
) -> Result<Vec<crate::notify::NotificationSpec>, String> {
    let config = crate::notifications::load_notification_config_from(data_dir);
    match plan_wake(wake, config.push_enabled, warm_sync_active()) {
        WakePlan::Sync => {}
        WakePlan::Ignore(reason) => {
            tracing::info!("Push wake ignored: {reason:?}");
            return Ok(Vec::new());
        }
    }

    // Losing this race is a success, not an error: the sync that holds the
    // lease covers this event too.
    let Some(_lease) = WAKE_GUARD.try_enter() else {
        tracing::info!("Push wake coalesced into the sync already running");
        return Ok(Vec::new());
    };

    tokio::time::timeout(WAKE_BUDGET, sync_and_collect(data_dir, config))
        .await
        .map_err(|_| "Push sync exceeded its time budget".to_string())?
}

async fn sync_and_collect(
    data_dir: &std::path::Path,
    config: crate::notifications::NotificationConfig,
) -> Result<Vec<crate::notify::NotificationSpec>, String> {
    use matrix_sdk::config::SyncSettings;

    let client = background_client(data_dir).await?;

    let out = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    register_collectors(
        &client,
        Collector {
            config: std::sync::Arc::new(config),
            out: out.clone(),
            read_markers: Default::default(),
        },
    );

    // `timeout(0)` asks the homeserver to answer with whatever it has instead of
    // long-polling. The push already told us there is something there, and a
    // long poll on a woken device is battery spent waiting for nothing.
    let settings = SyncSettings::default().timeout(std::time::Duration::from_secs(0));
    client
        .sync_once(settings)
        .await
        .map_err(|e| format!("Push sync failed: {e}"))?;

    let collected = out.lock().map_err(|_| "Collector lock poisoned")?.clone();
    let (specs, dropped) = cap_wake_notifications(collected);
    if dropped > 0 {
        tracing::info!("Push wake capped at {MAX_WAKE_NOTIFICATIONS}; dropped {dropped} older");
    }
    tracing::info!("Push wake rendered {} notification(s)", specs.len());
    Ok(specs)
}

/// Register the same event handlers the warm path uses, differing only in where
/// the rendered spec goes.
fn register_collectors(client: &matrix_sdk::Client, collector: Collector) {
    use matrix_sdk::{
        event_handler::Ctx,
        ruma::events::{
            room::message::SyncRoomMessageEvent, sticker::StickerEventContent, SyncMessageLikeEvent,
        },
        Room,
    };

    client.add_event_handler_context(collector);

    client.add_event_handler(
        |ev: SyncRoomMessageEvent,
         room: Room,
         Ctx(collector): Ctx<Collector>,
         push_actions: Vec<matrix_sdk::ruma::push::Action>| async move {
            let SyncRoomMessageEvent::Original(original) = ev else { return };
            let sender_id = original.sender.clone();
            let Some(event) = crate::events::convert_room_message_event(original) else { return };
            collect(&collector, &room, &sender_id, &event, &push_actions).await;
        },
    );

    client.add_event_handler(
        |ev: SyncMessageLikeEvent<StickerEventContent>,
         room: Room,
         Ctx(collector): Ctx<Collector>,
         push_actions: Vec<matrix_sdk::ruma::push::Action>| async move {
            let SyncMessageLikeEvent::Original(original) = ev else { return };
            let sender_id = original.sender.clone();
            let event = crate::matrix::timeline::convert_sync_sticker_event(original);
            collect(&collector, &room, &sender_id, &event, &push_actions).await;
        },
    );
}

/// The cold-path twin of `events::maybe_notify`: identical inputs into
/// `notify::evaluate`, but the spec is collected for Kotlin instead of posted
/// through Tauri.
async fn collect(
    collector: &Collector,
    room: &matrix_sdk::Room,
    sender_id: &matrix_sdk::ruma::UserId,
    event: &crate::matrix::timeline::TimelineEvent,
    push_actions: &[matrix_sdk::ruma::push::Action],
) {
    let room_id = room.room_id().to_string();
    let is_own = room.own_user_id() == sender_id;

    // A wake syncs a batch, so most of what arrives may already have been read
    // on another device. Delivered-to-this-phone and seen-by-this-person are
    // different things, and only the second earns silence.
    if already_seen(event.timestamp, collector.read_marker(room).await) {
        return;
    }

    let sender = if is_own {
        event.sender.clone()
    } else {
        room.get_member_no_sync(sender_id)
            .await
            .ok()
            .flatten()
            .and_then(|m| m.display_name().map(str::to_string))
            .unwrap_or_else(|| event.sender.clone())
    };

    let input = crate::notify::NotificationInput {
        room_id: room_id.clone(),
        room_name: crate::notify::resolve_room_title(room).await,
        event_id: event.event_id.clone(),
        sender,
        body: event.body.clone(),
        is_edit: event.is_edit,
        is_own,
        // No window exists on this path, and nothing here is catch-up replay:
        // the stored sync token means these events have never been seen.
        window_focused: false,
        pre_startup: false,
        push: crate::notify::PushEval::from_actions(push_actions),
    };

    let Some(spec) = crate::notify::evaluate(&input, &collector.config) else { return };
    // Shares the warm path's dedup ring, so a push that arrives for an event the
    // app already showed before its webview died does not show it twice.
    if !crate::events::claim_notification(&spec.event_id) {
        return;
    }
    if let Ok(mut out) = collector.out.lock() {
        out.push(spec);
    }
}

// ─── Self-test ───────────────────────────────────────────────────────────────

/// Render a notification from a synthetic event, touching neither the network
/// nor the session store.
///
/// A real wake needs a logged-in device, and until one exists the whole
/// render-and-post half of the cold path — spec serialisation, the JSON
/// crossing back to Kotlin, `NotificationCompat`, the channel ids, the tap
/// intent — is unexercised. This makes that half provable on its own, which
/// matters because the JNI boundary is the part with no test coverage at all.
///
/// It deliberately reads the *real* config and runs the *real* `evaluate`, so a
/// notification that fails to appear because of quiet hours or a disabled master
/// switch reports that rather than looking like a broken bridge.
pub fn self_test_spec(
    data_dir: &std::path::Path,
) -> Result<crate::notify::NotificationSpec, String> {
    let config = crate::notifications::load_notification_config_from(data_dir);
    let input = crate::notify::NotificationInput {
        room_id: "!quark-self-test:localhost".to_owned(),
        room_name: "Quark self-test".to_owned(),
        event_id: "$quark-self-test".to_owned(),
        sender: "Quark".to_owned(),
        body: "Push reached this device and rendered a notification.".to_owned(),
        is_edit: false,
        is_own: false,
        window_focused: false,
        pre_startup: false,
        push: crate::notify::PushEval { notify: true, highlight: false },
    };
    crate::notify::evaluate(&input, &config).ok_or_else(|| {
        "The push bridge worked, but your notification settings suppressed the result \
         (notifications disabled, quiet hours, or this room muted)."
            .to_owned()
    })
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_an_event_id_only_notification() {
        // Exactly what a homeserver sends for a pusher registered with
        // `format: event_id_only` — no sender, no body, no room name.
        let payload = r#"{
            "notification": {
                "event_id": "$3957tyerfgewrf384",
                "room_id": "!slw48wfj34rpdEwuS:example.com",
                "counts": { "unread": 2 },
                "devices": [{ "app_id": "tel.quark.app.android", "pushkey": "https://ntfy.sh/x" }]
            }
        }"#;
        assert_eq!(
            parse_wake(payload).expect("valid notification"),
            PushWake::Event {
                room_id: "!slw48wfj34rpdEwuS:example.com".into(),
                event_id: "$3957tyerfgewrf384".into(),
            }
        );
    }

    #[test]
    fn a_counts_only_notification_is_a_clear_not_an_event() {
        // Sent when the unread count drops (read on another device). There is
        // no event to show, and notifying would resurrect a dismissed room.
        let payload = r#"{
            "notification": {
                "counts": { "unread": 0 },
                "devices": [{ "app_id": "tel.quark.app.android", "pushkey": "https://ntfy.sh/x" }]
            }
        }"#;
        assert_eq!(parse_wake(payload).expect("valid notification"), PushWake::Clear);
    }

    #[test]
    fn a_room_without_an_event_is_a_clear() {
        let payload = r#"{"notification": {"room_id": "!a:x", "counts": {"unread": 0}}}"#;
        assert_eq!(parse_wake(payload).expect("valid notification"), PushWake::Clear);
    }

    #[test]
    fn ignores_the_extra_fields_a_full_format_push_would_carry() {
        // We never register for this format, but a pusher left over from another
        // client — or a homeserver that ignores the format — must not break us.
        let payload = r#"{
            "notification": {
                "event_id": "$abc",
                "room_id": "!a:x",
                "type": "m.room.message",
                "sender": "@alice:x",
                "room_name": "General",
                "content": { "msgtype": "m.text", "body": "secret" },
                "counts": { "unread": 1 }
            }
        }"#;
        assert_eq!(
            parse_wake(payload).expect("valid notification"),
            PushWake::Event { room_id: "!a:x".into(), event_id: "$abc".into() }
        );
    }

    #[test]
    fn rejects_a_payload_that_is_not_a_notification() {
        // Distributors deliver their own test messages through the same channel.
        assert!(parse_wake("not json").is_err());
        assert!(parse_wake(r#"{"hello": "world"}"#).is_err());
        assert!(parse_wake("").is_err());
    }

    #[test]
    fn empty_ids_are_treated_as_absent() {
        let payload = r#"{"notification": {"room_id": "", "event_id": ""}}"#;
        assert_eq!(parse_wake(payload).expect("valid notification"), PushWake::Clear);
    }

    #[test]
    fn an_event_push_syncs() {
        let wake = PushWake::Event { room_id: "!a:x".into(), event_id: "$e".into() };
        assert_eq!(plan_wake(&wake, true, false), WakePlan::Sync);
    }

    #[test]
    fn a_push_arriving_after_the_user_turned_push_off_is_ignored() {
        // The pusher outlives the preference: an opt-out we could not deliver to
        // the homeserver (offline, broken session) leaves it pushing for a
        // while. Syncing here would be doing the exact work they switched off.
        let wake = PushWake::Event { room_id: "!a:x".into(), event_id: "$e".into() };
        assert_eq!(plan_wake(&wake, false, false), WakePlan::Ignore(IgnoreReason::PushDisabled));
    }

    #[test]
    fn a_push_is_ignored_while_the_app_is_already_syncing() {
        // The warm loop will deliver this event through the same pipeline. A
        // second sync would duplicate the notification and — worse — put two
        // concurrent syncs on the homeserver from one device.
        let wake = PushWake::Event { room_id: "!a:x".into(), event_id: "$e".into() };
        assert_eq!(plan_wake(&wake, true, true), WakePlan::Ignore(IgnoreReason::WarmSyncRunning));
    }

    #[test]
    fn the_preference_is_checked_before_the_sync_state() {
        // Both apply; the user's explicit "off" is the more informative reason
        // to report, and it holds whether or not the app happens to be running.
        let wake = PushWake::Event { room_id: "!a:x".into(), event_id: "$e".into() };
        assert_eq!(plan_wake(&wake, false, true), WakePlan::Ignore(IgnoreReason::PushDisabled));
    }

    #[test]
    fn a_clear_push_does_not_wake_the_network() {
        // Nothing to show, and no room id to dismiss against — spending a sync
        // on it would burn battery for a push whose whole meaning is "less".
        assert_eq!(plan_wake(&PushWake::Clear, true, false), WakePlan::Ignore(IgnoreReason::NothingToShow));
    }

    #[test]
    fn the_self_test_renders_a_notification_without_a_session() {
        // The point of the self-test: prove the render-and-post half works on a
        // device that has never logged in, where a real wake declines long
        // before it would reach a notification.
        let dir = tempfile::tempdir().unwrap();
        let spec = self_test_spec(dir.path()).expect("a default config should notify");
        assert!(spec.title.contains("Quark"), "got: {}", spec.title);
        assert_eq!(spec.channel, crate::notify::CHANNEL_MESSAGES);
    }

    #[test]
    fn the_self_test_explains_a_config_that_suppresses_it() {
        // Otherwise "I ran the self-test and nothing appeared" is independently
        // consistent with a broken JNI boundary and with notifications simply
        // being switched off — and those need opposite investigations.
        let dir = tempfile::tempdir().unwrap();
        let mut config = crate::notifications::NotificationConfig::default();
        config.enabled = false;
        crate::notifications::save_notification_config_to(dir.path(), &config).unwrap();

        let err = self_test_spec(dir.path()).expect_err("a disabled config must not notify");
        assert!(err.contains("notifications"), "got: {err}");
    }

    #[test]
    fn an_event_the_user_already_read_elsewhere_is_not_notified() {
        // The whole point. A cold wake syncs a batch, not one event, so without
        // this it re-notifies everything read on another device since the app
        // last ran — the flood this filter exists to stop.
        assert!(already_seen(1_000, Some(2_000)));
        assert!(already_seen(1_000, Some(1_000)), "read marker on the event itself");
    }

    #[test]
    fn an_event_newer_than_the_read_marker_still_notifies() {
        assert!(!already_seen(2_000, Some(1_000)));
    }

    #[test]
    fn a_room_that_was_never_read_still_notifies() {
        // No marker is not evidence of having seen anything. Suppressing here
        // would silence exactly the rooms the user has never opened.
        assert!(!already_seen(1_000, None));
    }

    #[test]
    fn a_wake_keeps_the_newest_notifications_when_there_are_too_many() {
        // Sync order is chronological, so the tail is the most recent — the
        // part a person woken by their phone actually wants.
        let specs: Vec<_> = (0..MAX_WAKE_NOTIFICATIONS + 3)
            .map(|i| spec_named(&format!("$e{i}")))
            .collect();

        let (kept, dropped) = cap_wake_notifications(specs);

        assert_eq!(kept.len(), MAX_WAKE_NOTIFICATIONS);
        assert_eq!(dropped, 3);
        assert_eq!(kept.last().unwrap().event_id, format!("$e{}", MAX_WAKE_NOTIFICATIONS + 2));
    }

    #[test]
    fn a_wake_under_the_cap_is_left_alone() {
        let specs = vec![spec_named("$a"), spec_named("$b")];
        let (kept, dropped) = cap_wake_notifications(specs);
        assert_eq!(kept.len(), 2);
        assert_eq!(dropped, 0);
    }

    fn spec_named(event_id: &str) -> crate::notify::NotificationSpec {
        crate::notify::NotificationSpec {
            id: 1,
            summary_id: 2,
            title: "t".into(),
            body: "b".into(),
            channel: crate::notify::CHANNEL_MESSAGES,
            group: "!r:x".into(),
            room_id: "!r:x".into(),
            event_id: event_id.into(),
            room_name: "r".into(),
            highlight: false,
        }
    }

    #[test]
    fn only_one_wake_may_sync_at_a_time() {
        let guard = WakeGuard::new();
        let first = guard.try_enter().expect("first wake runs");
        assert!(guard.try_enter().is_none(), "a burst must coalesce, not stack");
        drop(first);
        assert!(guard.try_enter().is_some(), "the guard reopens once the sync ends");
    }

    #[test]
    fn the_guard_reopens_even_if_the_sync_panics() {
        let guard = WakeGuard::new();
        // The panic below is the point of the test, not a failure — silence the
        // default hook so it doesn't print a backtrace into a passing run.
        let hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _lease = guard.try_enter().expect("first wake runs");
            panic!("sync blew up");
        }));
        std::panic::set_hook(hook);
        assert!(result.is_err(), "the panic must actually happen");
        assert!(
            guard.try_enter().is_some(),
            "a panicking sync must not wedge push shut for the process's life"
        );
    }
}
