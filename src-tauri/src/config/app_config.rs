//! Application configuration — persisted to `~/.config/quark/config.toml`.
//!
//! Covers [general], [sync], [media], [gif], and [emoji] sections as defined
//! in DESIGN.md. Notification preferences live separately in notifications.rs.

use serde::{Deserialize, Serialize};

// ─── Section structs ─────────────────────────────────────────────────────────

/// What the Enter key does in the compose box. Serialized lowercase so it reads
/// naturally in config.toml.
///   - `auto`    — platform default: Enter sends on desktop, inserts a newline on
///                 mobile (where a dedicated send button is shown instead).
///   - `enter`   — Enter always sends (Shift+Enter inserts a newline).
///   - `newline` — Enter always inserts a newline; send via the button or
///                 Ctrl/Cmd+Enter.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SendKeyBehavior {
    Auto,
    Enter,
    Newline,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GeneralConfig {
    /// Name of the active theme (built-in slug or path).
    #[serde(default = "default_theme_name")]
    pub theme: String,
    /// Master notifications switch (also reflected in NotificationConfig.enabled).
    #[serde(default = "bool_true")]
    pub notifications: bool,
    /// Ask for confirmation before redacting a message.
    #[serde(default = "bool_true")]
    pub confirm_redact: bool,
    /// CSS border-radius for space/room icons (e.g. "50%" for circles, "8px" for rounded squares, "0" for square).
    #[serde(default = "default_icon_radius")]
    pub icon_radius: String,
    /// Enable vim-style modal editing (Normal/Insert/Command/Visual modes).
    /// When false, the app behaves like a standard text input — always in Insert mode.
    #[serde(default = "bool_true")]
    pub vim_mode: bool,
    /// Send public read receipts (`m.read`) so other users see your read
    /// position. When false, only a private receipt is sent (unread counts still
    /// clear, but your position is not broadcast).
    #[serde(default = "bool_true")]
    pub send_read_receipts: bool,
    /// Show other users' read receipts as shifting avatars in the timeline.
    #[serde(default = "bool_true")]
    pub show_read_receipts: bool,
    /// Prompt to verify a new/unverified session on startup, until it is verified
    /// or the user opts out ("Never ask").
    #[serde(default = "bool_true")]
    pub prompt_session_verification: bool,
    /// What the Enter key does in the compose box (see [`SendKeyBehavior`]).
    #[serde(default = "default_send_key_behavior")]
    pub send_key_behavior: SendKeyBehavior,
}

/// Note: no `deny_unknown_fields` here (nor on any config struct) — that is
/// what lets keys retired from the app, such as the never-wired
/// `sliding_sync` (issue #75), be dropped without a config written by an older
/// build failing to parse and silently resetting every other setting.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SyncConfig {
    /// Number of messages to load initially per room.
    #[serde(default = "default_timeline_limit")]
    pub timeline_limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MediaConfig {
    /// Automatically display inline images in the timeline.
    #[serde(default = "bool_true")]
    pub auto_load_images: bool,
    /// Play videos inline in the timeline; when false, clicking a video opens
    /// it in the system's external player instead.
    #[serde(default = "bool_true")]
    pub inline_video: bool,
    /// Maximum rendered width (px) for inline images.
    #[serde(default = "default_max_image_width")]
    pub max_image_width: u32,
    /// Maximum rendered height (px) for inline images.
    #[serde(default = "default_max_image_height")]
    pub max_image_height: u32,
    /// Maximum rendered size (px) for sticker images.
    #[serde(default = "default_sticker_max_size")]
    pub sticker_max_size: u32,
    /// On-disk media cache size limit in megabytes.
    #[serde(default = "default_cache_size_mb")]
    pub cache_size_mb: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum GifProvider {
    Giphy,
    Klipy,
}

/// Deserialize a GIF provider, falling back to the default for any value this
/// build no longer knows.
///
/// Tenor was dropped when the service was sunset, but configs written by older
/// versions still carry `provider = "tenor"`. A plain enum deserialize would
/// fail on that, and `load_app_config_from` treats a parse failure as
/// "use defaults" — silently resetting the user's theme and every other setting
/// alongside the dead provider. Normalising here keeps the blast radius to the
/// one field that actually went away.
fn de_gif_provider<'de, D>(deserializer: D) -> Result<GifProvider, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = String::deserialize(deserializer)?;
    Ok(match raw.as_str() {
        "giphy" => GifProvider::Giphy,
        "klipy" => GifProvider::Klipy,
        other => {
            tracing::warn!("Unknown gif provider '{other}' in config.toml; falling back to default");
            default_gif_provider()
        }
    })
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum GifRating {
    #[serde(rename = "g")]
    G,
    #[serde(rename = "pg")]
    Pg,
    #[serde(rename = "pg-13")]
    Pg13,
    #[serde(rename = "r")]
    R,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GifConfig {
    #[serde(default = "default_gif_provider", deserialize_with = "de_gif_provider")]
    pub provider: GifProvider,
    /// User-supplied API key for the selected GIF provider.
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_gif_rating")]
    pub rating: GifRating,
    #[serde(default = "bool_true")]
    pub cache_results: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EmojiConfig {
    /// Enable `:shortcode` autocomplete in the compose box.
    #[serde(default = "bool_true")]
    pub shortcode_autocomplete: bool,
    /// Minimum characters typed before autocomplete activates.
    #[serde(default = "default_autocomplete_min_chars")]
    pub autocomplete_min_chars: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HomeConfig {
    /// Number of DM floaters shown on the Home canvas.
    #[serde(default = "default_home_dm_limit")]
    pub dm_limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CacheConfig {
    /// In-memory cap (MB) for decoded message images/stickers. Bounds the
    /// blob-URL cache that makes revisited images paint instantly; LRU eviction
    /// frees the oldest blobs past this limit.
    #[serde(default = "default_image_memory_mb")]
    pub image_memory_mb: u64,
    /// Number of rooms whose timeline tail is kept in memory for instant
    /// re-open (LRU). Events per room are separately bounded.
    #[serde(default = "default_timeline_rooms")]
    pub timeline_rooms: u32,
}

/// Desktop auto-update release channel. Serialized lowercase ("stable"/"beta")
/// so it reads naturally in config.toml and matches the feed path segment.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UpdateChannel {
    Stable,
    Beta,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UpdaterConfig {
    /// Which release channel the in-app updater follows.
    #[serde(default = "default_channel")]
    pub channel: UpdateChannel,
    /// Check for an update automatically a few seconds after sync starts.
    #[serde(default = "bool_true")]
    pub auto_check: bool,
}

// ─── Root config ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AppConfig {
    #[serde(default)]
    pub general: GeneralConfig,
    #[serde(default)]
    pub sync: SyncConfig,
    #[serde(default)]
    pub media: MediaConfig,
    #[serde(default)]
    pub gif: GifConfig,
    #[serde(default)]
    pub emoji: EmojiConfig,
    #[serde(default)]
    pub home: HomeConfig,
    #[serde(default)]
    pub cache: CacheConfig,
    #[serde(default)]
    pub updater: UpdaterConfig,
}

// ─── Default impls ────────────────────────────────────────────────────────────

fn default_theme_name() -> String { "phosphor".to_string() }
fn default_icon_radius() -> String { "50%".to_string() }
fn bool_true() -> bool { true }
fn default_send_key_behavior() -> SendKeyBehavior { SendKeyBehavior::Auto }
fn default_timeline_limit() -> u32 { 50 }
fn default_max_image_width() -> u32 { 600 }
fn default_max_image_height() -> u32 { 400 }
fn default_sticker_max_size() -> u32 { 256 }
fn default_cache_size_mb() -> u64 { 500 }
fn default_gif_provider() -> GifProvider { GifProvider::Klipy }
fn default_gif_rating() -> GifRating { GifRating::Pg }
fn default_autocomplete_min_chars() -> u32 { 2 }
fn default_home_dm_limit() -> u32 { 12 }
fn default_image_memory_mb() -> u64 { 150 }
fn default_timeline_rooms() -> u32 { 30 }
fn default_channel() -> UpdateChannel { UpdateChannel::Stable }

impl Default for GeneralConfig {
    fn default() -> Self {
        Self { theme: default_theme_name(), notifications: true, confirm_redact: true, icon_radius: default_icon_radius(), vim_mode: true, send_read_receipts: true, show_read_receipts: true, prompt_session_verification: true, send_key_behavior: SendKeyBehavior::Auto }
    }
}

impl Default for SyncConfig {
    fn default() -> Self {
        Self { timeline_limit: default_timeline_limit() }
    }
}

impl Default for MediaConfig {
    fn default() -> Self {
        Self {
            auto_load_images: true,
            inline_video: true,
            max_image_width: default_max_image_width(),
            max_image_height: default_max_image_height(),
            sticker_max_size: default_sticker_max_size(),
            cache_size_mb: default_cache_size_mb(),
        }
    }
}

impl Default for GifConfig {
    fn default() -> Self {
        Self { provider: GifProvider::Klipy, api_key: String::new(), rating: GifRating::Pg, cache_results: true }
    }
}

impl Default for EmojiConfig {
    fn default() -> Self {
        Self { shortcode_autocomplete: true, autocomplete_min_chars: default_autocomplete_min_chars() }
    }
}

impl Default for HomeConfig {
    fn default() -> Self {
        Self { dm_limit: default_home_dm_limit() }
    }
}

impl Default for CacheConfig {
    fn default() -> Self {
        Self { image_memory_mb: default_image_memory_mb(), timeline_rooms: default_timeline_rooms() }
    }
}

impl Default for UpdaterConfig {
    fn default() -> Self {
        Self { channel: UpdateChannel::Stable, auto_check: true }
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            general: GeneralConfig::default(),
            sync: SyncConfig::default(),
            media: MediaConfig::default(),
            gif: GifConfig::default(),
            emoji: EmojiConfig::default(),
            home: HomeConfig::default(),
            cache: CacheConfig::default(),
            updater: UpdaterConfig::default(),
        }
    }
}

// ─── I/O ─────────────────────────────────────────────────────────────────────

/// Return the canonical path to `~/.config/quark/config.toml`.
///
/// Desktop only — Android's filesystem layout has no `~/.config/`, so the
/// caller should pass an explicit directory via `config_path_in()`.
pub fn config_path() -> Option<std::path::PathBuf> {
    directories::ProjectDirs::from("", "", "quark")
        .map(|d| d.config_dir().join("config.toml"))
}

/// Return `<dir>/config.toml`. Use this on Android where the config dir comes
/// from Tauri's `app.path().app_config_dir()` rather than XDG.
pub fn config_path_in(dir: &std::path::Path) -> std::path::PathBuf {
    dir.join("config.toml")
}

/// Load config from `path`; return defaults if the file is absent or unparseable.
pub fn load_app_config_from(path: &std::path::Path) -> AppConfig {
    if !path.exists() { return AppConfig::default() }
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("Failed to read config.toml: {e}");
            return AppConfig::default();
        }
    };
    match toml::from_str::<AppConfig>(&content) {
        Ok(cfg) => cfg,
        Err(e) => {
            tracing::warn!("Failed to parse config.toml: {e}");
            AppConfig::default()
        }
    }
}

/// Serialize config and write it to `path`.
pub fn save_app_config_to(path: &std::path::Path, config: &AppConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config dir: {e}"))?;
    }

    let content = toml::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {e}"))?;

    std::fs::write(path, content)
        .map_err(|e| format!("Failed to write config.toml: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod updater_config_tests {
    use super::*;

    #[test]
    fn updater_defaults_are_stable_and_auto() {
        let c = UpdaterConfig::default();
        assert_eq!(c.channel, UpdateChannel::Stable);
        assert!(c.auto_check);
    }

    #[test]
    fn app_config_includes_updater_default() {
        let c = AppConfig::default();
        assert_eq!(c.updater.channel, UpdateChannel::Stable);
        assert!(c.updater.auto_check);
    }

    #[test]
    fn missing_updater_section_falls_back_to_default() {
        let cfg: AppConfig = toml::from_str("[general]\ntheme = \"phosphor\"\n").unwrap();
        assert_eq!(cfg.updater.channel, UpdateChannel::Stable);
        assert!(cfg.updater.auto_check);
    }

    #[test]
    fn channel_round_trips_lowercase() {
        let c = UpdaterConfig { channel: UpdateChannel::Beta, auto_check: false };
        let toml = toml::to_string(&c).unwrap();
        assert!(toml.contains("channel = \"beta\""), "got: {toml}");
        let back: UpdaterConfig = toml::from_str(&toml).unwrap();
        assert_eq!(back, c);
    }
}

#[cfg(test)]
mod send_key_behavior_tests {
    use super::*;

    #[test]
    fn general_default_send_key_behavior_is_auto() {
        assert_eq!(GeneralConfig::default().send_key_behavior, SendKeyBehavior::Auto);
    }

    #[test]
    fn missing_field_falls_back_to_auto() {
        // A config written before this field existed must still load.
        let cfg: AppConfig = toml::from_str("[general]\ntheme = \"phosphor\"\n").unwrap();
        assert_eq!(cfg.general.send_key_behavior, SendKeyBehavior::Auto);
    }

    #[test]
    fn round_trips_lowercase() {
        let toml = toml::Value::try_from(SendKeyBehavior::Newline).unwrap();
        assert_eq!(toml.as_str(), Some("newline"));
        let back: SendKeyBehavior = toml.try_into().unwrap();
        assert_eq!(back, SendKeyBehavior::Newline);
    }
}

#[cfg(test)]
mod gif_provider_tests {
    use super::*;

    #[test]
    fn default_provider_is_klipy() {
        assert_eq!(GifConfig::default().provider, GifProvider::Klipy);
    }

    #[test]
    fn retired_tenor_provider_falls_back_without_losing_the_config() {
        // Configs written before Tenor was removed must still load in full —
        // a hard parse failure would reset every unrelated setting too.
        let cfg: AppConfig = toml::from_str(
            "[general]\ntheme = \"phosphor\"\n\n[gif]\nprovider = \"tenor\"\napi_key = \"KEY\"\n",
        )
        .unwrap();
        assert_eq!(cfg.gif.provider, GifProvider::Klipy);
        assert_eq!(cfg.gif.api_key, "KEY");
        assert_eq!(cfg.general.theme, "phosphor");
    }

    #[test]
    fn known_providers_still_parse() {
        let cfg: AppConfig = toml::from_str("[gif]\nprovider = \"giphy\"\n").unwrap();
        assert_eq!(cfg.gif.provider, GifProvider::Giphy);
    }

    #[test]
    fn round_trips_lowercase() {
        let toml = toml::Value::try_from(GifProvider::Klipy).unwrap();
        assert_eq!(toml.as_str(), Some("klipy"));
    }
}

#[cfg(test)]
mod sync_config_tests {
    use super::*;

    #[test]
    fn retired_sliding_sync_key_is_ignored_without_losing_the_config() {
        // `[sync] sliding_sync` was written by every build up to 0.18 but read
        // by nothing (issue #75). Configs still carrying it must load in full —
        // a hard parse failure would reset every unrelated setting too, since
        // `load_app_config_from` falls back to defaults on any parse error.
        let cfg: AppConfig = toml::from_str(
            "[general]\ntheme = \"gruvbox\"\n\n[sync]\nsliding_sync = false\ntimeline_limit = 200\n",
        )
        .unwrap();
        assert_eq!(cfg.sync.timeline_limit, 200);
        assert_eq!(cfg.general.theme, "gruvbox");
    }

    #[test]
    fn saved_config_no_longer_writes_sliding_sync() {
        let toml = toml::to_string_pretty(&AppConfig::default()).unwrap();
        assert!(!toml.contains("sliding_sync"), "got: {toml}");
    }

    #[test]
    fn missing_sync_section_falls_back_to_default() {
        let cfg: AppConfig = toml::from_str("[general]\ntheme = \"phosphor\"\n").unwrap();
        assert_eq!(cfg.sync.timeline_limit, default_timeline_limit());
    }
}
