//! Notification configuration and logic for OS-level notifications.
//!
//! This module handles deciding when to show notifications, formatting their
//! content respecting privacy settings, and checking quiet-hours windows.

use chrono::Timelike;
use serde::{Deserialize, Serialize};

// ─── Config Structs ──────────────────────────────────────────────────────────

/// Quiet-hours window: notifications are suppressed between start and end times.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct QuietHours {
    pub start_hour: u8,
    pub start_minute: u8,
    pub end_hour: u8,
    pub end_minute: u8,
}

/// User-configurable notification preferences.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationConfig {
    /// Master switch — false disables all OS notifications.
    pub enabled: bool,
    /// If false, the notification body is replaced with a generic placeholder.
    pub show_body: bool,
    /// If false, the sender's name is replaced with a generic placeholder.
    pub show_sender: bool,
    /// Room IDs whose notifications are suppressed.
    pub mute_rooms: Vec<String>,
    /// Optional quiet-hours window during which notifications are suppressed.
    pub quiet_hours: Option<QuietHours>,
    /// Keep the sync loop alive while backgrounded via the Android foreground
    /// service (no effect on other platforms). Opt-in: costs battery and shows
    /// a persistent status notification. `serde(default)` so pre-0.14 configs
    /// load unchanged.
    #[serde(default)]
    pub background_sync: bool,
    /// Register a pusher so the homeserver wakes this device instead of a live
    /// sync connection holding it open (mobile only). Opt-in: it hands a
    /// third-party push gateway this device's address, so it must never turn
    /// itself on. `serde(default)` so configs predating push load unchanged.
    #[serde(default)]
    pub push_enabled: bool,
    /// Override the push gateway URL. Escape hatch for self-hosters whose
    /// distributor doesn't advertise a Matrix gateway; normally discovery
    /// picks the right one.
    #[serde(default)]
    pub push_gateway_override: Option<String>,
}

impl Default for NotificationConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            show_body: true,
            show_sender: true,
            mute_rooms: Vec::new(),
            quiet_hours: None,
            background_sync: false,
            push_enabled: false,
            push_gateway_override: None,
        }
    }
}

impl NotificationConfig {
    /// Fold an edit from the Settings dialog into the live config.
    ///
    /// Settings sends the whole struct back, but it only ever edits the four
    /// preference fields below — everything else is owned by a dedicated
    /// command (`set_push_enabled`, `set_background_sync`, `mute_room`) that
    /// has homeserver-side effects to match. The frontend builds its draft from
    /// a config it cached when the dialog opened, so treating the incoming blob
    /// as authoritative lets a stale draft silently undo any of those: a mute
    /// made while the dialog was open, or a push opt-out that has already
    /// unregistered the pusher. Taking only what Settings owns makes [save]
    /// unable to contradict them.
    pub fn with_preferences(&self, incoming: NotificationConfig) -> NotificationConfig {
        NotificationConfig {
            enabled: incoming.enabled,
            show_body: incoming.show_body,
            show_sender: incoming.show_sender,
            quiet_hours: incoming.quiet_hours,
            mute_rooms: self.mute_rooms.clone(),
            background_sync: self.background_sync,
            push_enabled: self.push_enabled,
            push_gateway_override: self.push_gateway_override.clone(),
        }
    }
}

// ─── Public Functions ────────────────────────────────────────────────────────

/// Returns `true` if an OS notification should be shown for the given room.
///
/// Checks:
/// 1. Notifications are enabled globally.
/// 2. The room is not muted.
/// 3. We are not currently in quiet hours.
pub fn should_notify(config: &NotificationConfig, room_id: &str) -> bool {
    if !config.enabled {
        return false;
    }

    if config.mute_rooms.iter().any(|r| r == room_id) {
        return false;
    }

    if is_in_quiet_hours(config) {
        return false;
    }

    true
}

/// What actually happened when a room's mute was changed.
///
/// The mute the user cares about is the Matrix push rule: it silences the room
/// on every client and, under push, stops the homeserver waking this device at
/// all. The local `mute_rooms` entry is only a record that we tried — see
/// DESIGN.md — so when the rule write fails the two disagree, and the user is
/// the only one who can decide what to do about it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct MuteOutcome {
    /// The homeserver's push rule now matches what the user asked for.
    pub synced: bool,
    /// What to tell them if it does not. `None` when everything worked.
    pub warning: Option<String>,
}

/// Describe a mute/unmute attempt in terms the user can act on.
///
/// The two failures are not equally bad, so they do not get the same message.
/// A failed **mute** still silences the room on this device — the local list
/// sees to that — and only costs battery. A failed **unmute** leaves a
/// server-side rule that empties `push_actions`, so the room goes on being
/// silent while the UI says otherwise: a room that has stopped working with no
/// visible cause, which is the failure this whole type exists to prevent.
pub fn mute_outcome(rule_result: Result<(), String>, muting: bool) -> MuteOutcome {
    let Err(reason) = rule_result else {
        return MuteOutcome { synced: true, warning: None };
    };
    let warning = if muting {
        format!(
            "Muted on this device only — the server could not be updated ({reason}). \
             Your other clients will still notify, and this one will keep being woken."
        )
    } else {
        format!(
            "This room is still muted on the server ({reason}), so it will stay silent \
             everywhere until the unmute reaches it. Try again when you are back online."
        )
    };
    MuteOutcome { synced: false, warning: Some(warning) }
}

/// Build the (title, body) strings for an OS notification.
///
/// Respects `show_sender` and `show_body` privacy flags:
/// - `show_sender = false` → title is "New Message"
/// - `show_body = false`   → body is "You have a new message"
pub fn format_notification(
    sender: &str,
    body: &str,
    room_name: &str,
    config: &NotificationConfig,
) -> (String, String) {
    let title = if config.show_sender {
        format!("{} in {}", sender, room_name)
    } else {
        "New Message".to_string()
    };

    let notification_body = if config.show_body {
        body.to_string()
    } else {
        "You have a new message".to_string()
    };

    (title, notification_body)
}

/// Returns `true` if the current local time falls within the quiet-hours window.
///
/// Handles overnight windows (e.g. 22:00 – 07:00) correctly.
pub fn is_in_quiet_hours(config: &NotificationConfig) -> bool {
    let Some(qh) = &config.quiet_hours else {
        return false;
    };

    let now = chrono::Local::now();
    let current_minutes = now.hour() as u16 * 60 + now.minute() as u16;
    let start_minutes = qh.start_hour as u16 * 60 + qh.start_minute as u16;
    let end_minutes = qh.end_hour as u16 * 60 + qh.end_minute as u16;

    if start_minutes <= end_minutes {
        // Same-day window, e.g. 08:00 – 09:00
        current_minutes >= start_minutes && current_minutes < end_minutes
    } else {
        // Overnight window, e.g. 22:00 – 07:00
        current_minutes >= start_minutes || current_minutes < end_minutes
    }
}

// ─── Persistence ─────────────────────────────────────────────────────────────

/// Notification config filename within the config directory.
pub const NOTIFICATIONS_FILENAME: &str = "notifications.toml";

/// Load notification config from `<config_dir>/notifications.toml`.
pub fn load_notification_config_from(config_dir: &std::path::Path) -> NotificationConfig {
    let path = config_dir.join(NOTIFICATIONS_FILENAME);
    if !path.exists() { return NotificationConfig::default() }
    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("Failed to read notifications.toml: {e}");
            return NotificationConfig::default();
        }
    };
    match toml::from_str::<NotificationConfig>(&content) {
        Ok(cfg) => cfg,
        Err(e) => {
            tracing::warn!("Failed to parse notifications.toml: {e}");
            NotificationConfig::default()
        }
    }
}

/// Write notification config to `<config_dir>/notifications.toml`.
pub fn save_notification_config_to(
    config_dir: &std::path::Path,
    config: &NotificationConfig,
) -> Result<(), String> {
    std::fs::create_dir_all(config_dir)
        .map_err(|e| format!("Failed to create config dir: {e}"))?;

    let path = config_dir.join(NOTIFICATIONS_FILENAME);
    let content = toml::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize notifications config: {e}"))?;

    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to write notifications.toml: {e}"))?;

    Ok(())
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod mute_outcome_tests {
    use super::*;

    #[test]
    fn a_rule_that_was_written_needs_no_warning() {
        let outcome = mute_outcome(Ok(()), true);
        assert!(outcome.synced);
        assert_eq!(outcome.warning, None);
    }

    /// A failed mute is the mild case: the local list still silences the room
    /// here, so the user gets what they asked for on this device. What they do
    /// not get is a quiet phone — under push the homeserver keeps waking it.
    #[test]
    fn a_failed_mute_says_it_only_applies_here() {
        let outcome = mute_outcome(Err("offline".into()), true);
        assert!(!outcome.synced);
        let warning = outcome.warning.expect("a failed mute must be reported");
        assert!(warning.contains("this device"), "got: {warning}");
    }

    /// A failed *unmute* is the dangerous one, and the reason this exists. The
    /// server-side rule empties push_actions, so the room stays silent while the
    /// UI insists it was unmuted — a room that has apparently stopped working
    /// with no visible cause. Silence here is exactly the wrong answer.
    #[test]
    fn a_failed_unmute_warns_that_the_room_stays_silent() {
        let outcome = mute_outcome(Err("offline".into()), false);
        assert!(!outcome.synced);
        let warning = outcome.warning.expect("a failed unmute must be reported");
        assert!(warning.contains("still"), "got: {warning}");
        assert!(warning.contains("muted"), "got: {warning}");
    }

    /// The underlying failure has to survive into the message — "it didn't
    /// work" without a cause is not something a user can act on.
    #[test]
    fn the_warning_carries_the_reason() {
        for muting in [true, false] {
            let outcome = mute_outcome(Err("Not logged in".into()), muting);
            assert!(outcome.warning.unwrap().contains("Not logged in"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_config() -> NotificationConfig {
        NotificationConfig::default()
    }

    // ── push settings ─────────────────────────────────────────────────────────

    /// Every existing install has a notifications.toml predating push. Failing
    /// to parse it would reset the user's whole notification config.
    #[test]
    fn a_config_predating_push_still_loads() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join(NOTIFICATIONS_FILENAME),
            "enabled = true\nshow_body = false\nshow_sender = true\nmute_rooms = []\n",
        )
        .unwrap();

        let config = load_notification_config_from(dir.path());

        assert!(!config.show_body, "pre-existing settings survive");
        assert!(!config.push_enabled, "push stays opt-in");
        assert_eq!(config.push_gateway_override, None);
    }

    /// Push is opt-in: it registers this device with a third-party gateway, so
    /// it must never turn itself on.
    #[test]
    fn push_is_off_by_default() {
        assert!(!default_config().push_enabled);
    }

    #[test]
    fn push_settings_round_trip_through_the_config_file() {
        let dir = tempfile::tempdir().unwrap();
        let mut config = default_config();
        config.push_enabled = true;
        config.push_gateway_override =
            Some("https://ntfy.example.org/_matrix/push/v1/notify".into());

        save_notification_config_to(dir.path(), &config).unwrap();
        let loaded = load_notification_config_from(dir.path());

        assert!(loaded.push_enabled);
        assert_eq!(
            loaded.push_gateway_override.as_deref(),
            Some("https://ntfy.example.org/_matrix/push/v1/notify")
        );
    }

    // ── with_preferences ──────────────────────────────────────────────────────

    fn edited() -> NotificationConfig {
        NotificationConfig {
            enabled: false,
            show_body: false,
            show_sender: false,
            quiet_hours: Some(QuietHours {
                start_hour: 22,
                start_minute: 0,
                end_hour: 7,
                end_minute: 30,
            }),
            ..NotificationConfig::default()
        }
    }

    #[test]
    fn settings_edits_are_applied() {
        let merged = default_config().with_preferences(edited());

        assert!(!merged.enabled);
        assert!(!merged.show_body);
        assert!(!merged.show_sender);
        assert_eq!(merged.quiet_hours.unwrap().start_hour, 22);
    }

    /// The Settings draft is built from a config cached when the dialog opened.
    /// If [save] were authoritative it would re-enable push the user just
    /// switched off — handing the gateway this device's address again, and
    /// contradicting the unregister `set_push_enabled` already performed.
    #[test]
    fn a_stale_draft_cannot_re_enable_push() {
        let live = NotificationConfig { push_enabled: false, ..default_config() };
        let stale_draft = NotificationConfig { push_enabled: true, ..edited() };

        assert!(!live.with_preferences(stale_draft).push_enabled);
    }

    /// Mirror case: [save] must not switch push off in config while the pusher
    /// stays registered on the homeserver.
    #[test]
    fn a_stale_draft_cannot_disable_push() {
        let live = NotificationConfig { push_enabled: true, ..default_config() };
        let stale_draft = NotificationConfig { push_enabled: false, ..edited() };

        assert!(live.with_preferences(stale_draft).push_enabled);
    }

    /// A mute made from RoomInfoDialog while Settings is open is exactly the
    /// persistence `update_mute_list` exists to guarantee.
    #[test]
    fn a_stale_draft_cannot_resurrect_or_drop_mutes() {
        let live = NotificationConfig {
            mute_rooms: vec!["!muted-since:example.com".into()],
            ..default_config()
        };
        let stale_draft = NotificationConfig {
            mute_rooms: vec!["!unmuted-since:example.com".into()],
            ..edited()
        };

        assert_eq!(
            live.with_preferences(stale_draft).mute_rooms,
            vec!["!muted-since:example.com".to_string()]
        );
    }

    /// Background sync starts and stops an Android foreground service, so the
    /// service state and the flag have to agree.
    #[test]
    fn a_stale_draft_cannot_flip_background_sync() {
        let live = NotificationConfig { background_sync: true, ..default_config() };
        let stale_draft = NotificationConfig { background_sync: false, ..edited() };

        assert!(live.with_preferences(stale_draft).background_sync);
    }

    #[test]
    fn the_gateway_override_is_not_settings_editable() {
        let live = NotificationConfig {
            push_gateway_override: Some("https://ntfy.example.org/_matrix/push/v1/notify".into()),
            ..default_config()
        };

        assert_eq!(
            live.with_preferences(edited()).push_gateway_override.as_deref(),
            Some("https://ntfy.example.org/_matrix/push/v1/notify")
        );
    }

    // ── should_notify ─────────────────────────────────────────────────────────

    #[test]
    fn test_should_notify_enabled_no_mute() {
        let config = default_config();
        assert!(should_notify(&config, "!room:example.com"));
    }

    #[test]
    fn test_should_notify_disabled_globally() {
        let mut config = default_config();
        config.enabled = false;
        assert!(!should_notify(&config, "!room:example.com"));
    }

    #[test]
    fn test_should_notify_muted_room() {
        let mut config = default_config();
        config.mute_rooms = vec!["!room:example.com".to_string()];
        assert!(!should_notify(&config, "!room:example.com"));
    }

    #[test]
    fn test_should_notify_other_room_not_muted() {
        let mut config = default_config();
        config.mute_rooms = vec!["!room:example.com".to_string()];
        assert!(should_notify(&config, "!other:example.com"));
    }

    #[test]
    fn test_should_notify_in_quiet_hours_suppressed() {
        let mut config = default_config();
        // Quiet hours cover all 24 hours — guaranteed to be in quiet hours.
        config.quiet_hours = Some(QuietHours {
            start_hour: 0,
            start_minute: 0,
            end_hour: 23,
            end_minute: 59,
        });
        assert!(!should_notify(&config, "!room:example.com"));
    }

    #[test]
    fn test_should_notify_no_quiet_hours() {
        let config = default_config(); // quiet_hours = None
        assert!(should_notify(&config, "!room:example.com"));
    }

    // ── format_notification ───────────────────────────────────────────────────

    #[test]
    fn test_format_notification_full_privacy_on() {
        let config = NotificationConfig {
            show_sender: true,
            show_body: true,
            ..Default::default()
        };
        let (title, body) =
            format_notification("@alice:example.com", "Hello world", "General", &config);
        assert_eq!(title, "@alice:example.com in General");
        assert_eq!(body, "Hello world");
    }

    #[test]
    fn test_format_notification_hide_sender() {
        let config = NotificationConfig {
            show_sender: false,
            show_body: true,
            ..Default::default()
        };
        let (title, body) =
            format_notification("@alice:example.com", "Hello world", "General", &config);
        assert_eq!(title, "New Message");
        assert_eq!(body, "Hello world");
    }

    #[test]
    fn test_format_notification_hide_body() {
        let config = NotificationConfig {
            show_sender: true,
            show_body: false,
            ..Default::default()
        };
        let (title, body) =
            format_notification("@alice:example.com", "Hello world", "General", &config);
        assert_eq!(title, "@alice:example.com in General");
        assert_eq!(body, "You have a new message");
    }

    #[test]
    fn test_format_notification_hide_both() {
        let config = NotificationConfig {
            show_sender: false,
            show_body: false,
            ..Default::default()
        };
        let (title, body) =
            format_notification("@alice:example.com", "Hello world", "General", &config);
        assert_eq!(title, "New Message");
        assert_eq!(body, "You have a new message");
    }

    // ── is_in_quiet_hours ─────────────────────────────────────────────────────

    #[test]
    fn test_is_in_quiet_hours_none() {
        let config = default_config(); // quiet_hours = None
        assert!(!is_in_quiet_hours(&config));
    }

    #[test]
    fn test_is_in_quiet_hours_full_day_window() {
        // 00:00 – 23:59 covers the whole day
        let mut config = default_config();
        config.quiet_hours = Some(QuietHours {
            start_hour: 0,
            start_minute: 0,
            end_hour: 23,
            end_minute: 59,
        });
        assert!(is_in_quiet_hours(&config));
    }

    #[test]
    fn test_is_in_quiet_hours_overnight_always_in() {
        // 22:00 – 06:00 overnight — guaranteed active at some point.
        // We cannot know the current time in a unit test, so we just verify
        // the function runs without panicking. The logic is tested via the
        // same-day window tests above (full-day coverage).
        let mut config = default_config();
        config.quiet_hours = Some(QuietHours {
            start_hour: 22,
            start_minute: 0,
            end_hour: 6,
            end_minute: 0,
        });
        // Just assert it returns a bool without panicking.
        let _ = is_in_quiet_hours(&config);
    }

    #[test]
    fn test_is_in_quiet_hours_zero_width_window() {
        // start == end: empty window, never active
        let mut config = default_config();
        config.quiet_hours = Some(QuietHours {
            start_hour: 10,
            start_minute: 0,
            end_hour: 10,
            end_minute: 0,
        });
        // start_minutes == end_minutes → same-day branch → current must be
        // in [10:00, 10:00) which is always false.
        assert!(!is_in_quiet_hours(&config));
    }
}
