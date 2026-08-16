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

/// Everything the collecting event handlers need. No `AppHandle` — that is the
/// entire point of this path.
#[derive(Clone)]
struct Collector {
    config: std::sync::Arc<crate::notifications::NotificationConfig>,
    out: std::sync::Arc<std::sync::Mutex<Vec<crate::notify::NotificationSpec>>>,
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

    let session = crate::secrets::load_session(data_dir)?.ok_or("No stored session")?;
    let store_key = crate::secrets::get_store_key(data_dir)?.ok_or("No store-encryption key")?;

    let client = crate::matrix::client::build_client(
        &session.homeserver_url,
        data_dir.to_path_buf(),
        &store_key,
    )
    .await?;
    crate::matrix::client::restore_session_from_info(&client, &session).await?;

    let out = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    register_collectors(&client, Collector { config: std::sync::Arc::new(config), out: out.clone() });

    // `timeout(0)` asks the homeserver to answer with whatever it has instead of
    // long-polling. The push already told us there is something there, and a
    // long poll on a woken device is battery spent waiting for nothing.
    let settings = SyncSettings::default().timeout(std::time::Duration::from_secs(0));
    client
        .sync_once(settings)
        .await
        .map_err(|e| format!("Push sync failed: {e}"))?;

    let specs = out.lock().map_err(|_| "Collector lock poisoned")?.clone();
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
        room_name: room.name().unwrap_or(room_id),
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
