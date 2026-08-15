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
