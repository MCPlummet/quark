//! User colors (#45): the `[user_colors]` section of `config.toml` — which of
//! the three treatments are on, and this device's local per-user overrides —
//! plus the one validator every color passes through before it can reach CSS.

use std::collections::BTreeMap;

use matrix_sdk::ruma::UserId;
use serde::{Deserialize, Deserializer, Serialize};

/// A color as Quark stores and draws it: lowercase `#rrggbb`.
///
/// Accepts `#rgb` or `#rrggbb` in either case and nothing else — no names, no
/// alpha, no surrounding whitespace. Colors arrive from other people's public
/// profiles, so anything that fails this is "no color", never a style.
pub fn normalize_color(raw: &str) -> Option<String> {
    let hex = raw.strip_prefix('#')?;
    if !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let hex = hex.to_ascii_lowercase();
    match hex.len() {
        6 => Some(format!("#{hex}")),
        3 => Some(hex.chars().fold(String::from("#"), |mut out, c| {
            out.push(c);
            out.push(c);
            out
        })),
        _ => None,
    }
}

/// `[user_colors]` in `config.toml`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UserColorsConfig {
    /// Color the sender's name in the message box header.
    #[serde(default = "bool_true")]
    pub name: bool,
    /// Outline the sender's avatar in their color.
    #[serde(default)]
    pub avatar: bool,
    /// Draw the message box border in the sender's color.
    #[serde(default)]
    pub border: bool,
    /// This device's own colors for other users, `"@user:server" = "#rrggbb"`.
    /// Entries that aren't a user ID and a valid color are dropped on load.
    #[serde(default, deserialize_with = "valid_overrides")]
    pub overrides: BTreeMap<String, String>,
}

impl Default for UserColorsConfig {
    fn default() -> Self {
        Self { name: true, avatar: false, border: false, overrides: BTreeMap::new() }
    }
}

fn bool_true() -> bool {
    true
}

/// Is `user_id` a Matrix user ID an override can be keyed by?
pub fn is_user_id(user_id: &str) -> bool {
    UserId::parse(user_id).is_ok()
}

fn valid_overrides<'de, D: Deserializer<'de>>(d: D) -> Result<BTreeMap<String, String>, D::Error> {
    let raw = BTreeMap::<String, String>::deserialize(d)?;
    Ok(raw
        .into_iter()
        .filter(|(user, _)| is_user_id(user))
        .filter_map(|(user, color)| normalize_color(&color).map(|c| (user, c)))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::app_config::AppConfig;

    #[test]
    fn normalizes_short_and_long_hex() {
        assert_eq!(normalize_color("#ABC").as_deref(), Some("#aabbcc"));
        assert_eq!(normalize_color("#00FF41").as_deref(), Some("#00ff41"));
    }

    #[test]
    fn rejects_everything_else() {
        for bad in [
            "red", "#12345", "#1234567", "#ff0000; background:url(x)", " #fff", "#fff ", "", "#ggg",
            "#ff00ff00", "fff", "#",
        ] {
            assert_eq!(normalize_color(bad), None, "{bad}");
        }
    }

    #[test]
    fn missing_section_uses_defaults() {
        let cfg: AppConfig = toml::from_str("").expect("parse");
        assert_eq!(
            cfg.user_colors,
            UserColorsConfig { name: true, avatar: false, border: false, overrides: BTreeMap::new() }
        );
    }

    #[test]
    fn overrides_round_trip_through_toml() {
        let mut cfg = AppConfig::default();
        cfg.user_colors.overrides.insert("@alice:example.org".into(), "#ff4466".into());
        let text = toml::to_string_pretty(&cfg).expect("serialize");
        let back: AppConfig = toml::from_str(&text).expect("parse");
        assert_eq!(back.user_colors, cfg.user_colors);
    }

    #[test]
    fn invalid_overrides_are_dropped_on_load() {
        let text = r##"
[user_colors.overrides]
"@ok:x.org" = "#ABC"
"not-a-user" = "#ffffff"
"@bad:x.org" = "url(x)"
"##;
        let cfg: AppConfig = toml::from_str(text).expect("parse");
        let expected: BTreeMap<String, String> =
            [("@ok:x.org".to_string(), "#aabbcc".to_string())].into_iter().collect();
        assert_eq!(cfg.user_colors.overrides, expected);
    }
}
