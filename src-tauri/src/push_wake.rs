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
