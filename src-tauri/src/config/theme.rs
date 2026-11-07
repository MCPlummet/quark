use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

/// Root theme structure parsed from a TOML theme file.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Theme {
    pub meta: ThemeMeta,
    pub colors: ThemeColors,
    pub typography: ThemeTypography,
    pub borders: ThemeBorders,
    pub emoji: ThemeEmoji,
    pub prompt: ThemePrompt,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThemeMeta {
    pub name: String,
    pub author: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThemeColors {
    pub background: String,
    pub foreground: String,
    pub cursor: String,
    pub selection_bg: String,
    pub selection_fg: String,
    pub border: String,
    pub accent: ThemeAccentColors,
    pub messages: ThemeMessageColors,
    pub roomlist: ThemeRoomlistColors,
    pub reactions: ThemeReactionColors,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThemeAccentColors {
    pub primary: String,
    pub secondary: String,
    pub error: String,
    pub warning: String,
    pub success: String,
    pub link: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThemeMessageColors {
    pub own: String,
    pub other: String,
    pub system: String,
    pub timestamp: String,
    pub mention_bg: String,
    pub mention_fg: String,
    pub reply_border: String,
    pub thread_indicator: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThemeRoomlistColors {
    pub active_bg: String,
    pub active_fg: String,
    pub unread: String,
    pub mention_badge: String,
    pub muted: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThemeReactionColors {
    pub background: String,
    pub border: String,
    pub own_bg: String,
    pub count: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThemeTypography {
    pub font_family: String,
    pub font_size: u32,
    pub line_height: f32,
    pub message_spacing: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThemeBorders {
    pub style: BorderStyle,
    pub room_list_width: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum BorderStyle {
    Single,
    Double,
    Rounded,
    Ascii,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThemeEmoji {
    pub size: u32,
    pub sticker_max_size: u32,
    pub reaction_size: u32,
}

/// Labels for the vim mode badge left of the compose box.
///
/// Themes once carried a `symbol` here too, an input prompt glyph the UI no
/// longer draws. It is gone from the struct; serde ignores unknown keys, so
/// theme files that still set it keep loading.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThemePrompt {
    pub normal_indicator: String,
    pub insert_indicator: String,
    pub command_indicator: String,
    pub visual_indicator: String,
}

/// Validation errors for a theme.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThemeValidationError {
    pub field: String,
    pub message: String,
}

/// Parse a theme from a TOML string.
pub fn parse_theme(toml_content: &str) -> Result<Theme, String> {
    let theme: Theme = toml::from_str(toml_content)
        .map_err(|e| format!("Failed to parse theme TOML: {e}"))?;
    Ok(theme)
}

/// Load and parse a theme from a file path.
pub fn load_theme_file(path: &Path) -> Result<Theme, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read theme file '{}': {e}", path.display()))?;
    parse_theme(&content)
}

/// Validate that a color string is a valid hex color (#rrggbb or #rgb).
fn is_valid_hex_color(color: &str) -> bool {
    if !color.starts_with('#') {
        return false;
    }
    let hex = &color[1..];
    matches!(hex.len(), 3 | 6 | 8) && hex.chars().all(|c| c.is_ascii_hexdigit())
}

/// Validate all color fields in a theme. Returns a list of errors.
pub fn validate_theme(theme: &Theme) -> Vec<ThemeValidationError> {
    let mut errors = Vec::new();

    macro_rules! check_color {
        ($field:expr, $value:expr) => {
            if !is_valid_hex_color($value) {
                errors.push(ThemeValidationError {
                    field: $field.to_string(),
                    message: format!("'{}' is not a valid hex color", $value),
                });
            }
        };
    }

    check_color!("colors.background", &theme.colors.background);
    check_color!("colors.foreground", &theme.colors.foreground);
    check_color!("colors.cursor", &theme.colors.cursor);
    check_color!("colors.selection_bg", &theme.colors.selection_bg);
    check_color!("colors.selection_fg", &theme.colors.selection_fg);
    check_color!("colors.border", &theme.colors.border);

    check_color!("colors.accent.primary", &theme.colors.accent.primary);
    check_color!("colors.accent.secondary", &theme.colors.accent.secondary);
    check_color!("colors.accent.error", &theme.colors.accent.error);
    check_color!("colors.accent.warning", &theme.colors.accent.warning);
    check_color!("colors.accent.success", &theme.colors.accent.success);
    check_color!("colors.accent.link", &theme.colors.accent.link);

    check_color!("colors.messages.own", &theme.colors.messages.own);
    check_color!("colors.messages.other", &theme.colors.messages.other);
    check_color!("colors.messages.system", &theme.colors.messages.system);
    check_color!("colors.messages.timestamp", &theme.colors.messages.timestamp);
    check_color!("colors.messages.mention_bg", &theme.colors.messages.mention_bg);
    check_color!("colors.messages.mention_fg", &theme.colors.messages.mention_fg);
    check_color!("colors.messages.reply_border", &theme.colors.messages.reply_border);
    check_color!(
        "colors.messages.thread_indicator",
        &theme.colors.messages.thread_indicator
    );

    check_color!("colors.roomlist.active_bg", &theme.colors.roomlist.active_bg);
    check_color!("colors.roomlist.active_fg", &theme.colors.roomlist.active_fg);
    check_color!("colors.roomlist.unread", &theme.colors.roomlist.unread);
    check_color!(
        "colors.roomlist.mention_badge",
        &theme.colors.roomlist.mention_badge
    );
    check_color!("colors.roomlist.muted", &theme.colors.roomlist.muted);

    check_color!("colors.reactions.background", &theme.colors.reactions.background);
    check_color!("colors.reactions.border", &theme.colors.reactions.border);
    check_color!("colors.reactions.own_bg", &theme.colors.reactions.own_bg);
    check_color!("colors.reactions.count", &theme.colors.reactions.count);

    // Validate font size
    if theme.typography.font_size < 6 || theme.typography.font_size > 72 {
        errors.push(ThemeValidationError {
            field: "typography.font_size".to_string(),
            message: format!(
                "font_size {} is out of range (6–72)",
                theme.typography.font_size
            ),
        });
    }

    // Validate emoji sizes
    if theme.emoji.size < 8 || theme.emoji.size > 256 {
        errors.push(ThemeValidationError {
            field: "emoji.size".to_string(),
            message: format!("emoji.size {} is out of range (8–256)", theme.emoji.size),
        });
    }

    errors
}

/// Return the default Phosphor theme.
pub fn default_theme() -> Theme {
    Theme {
        meta: ThemeMeta {
            name: "Phosphor".to_string(),
            author: Some("Quark".to_string()),
            version: Some("1.0".to_string()),
        },
        colors: ThemeColors {
            background: "#0a0a0a".to_string(),
            foreground: "#b0b0b0".to_string(),
            cursor: "#00ff41".to_string(),
            selection_bg: "#1a3a1a".to_string(),
            selection_fg: "#00ff41".to_string(),
            border: "#333333".to_string(),
            accent: ThemeAccentColors {
                primary: "#00ff41".to_string(),
                secondary: "#00aaff".to_string(),
                error: "#ff3333".to_string(),
                warning: "#ffaa00".to_string(),
                success: "#00ff41".to_string(),
                link: "#00aaff".to_string(),
            },
            messages: ThemeMessageColors {
                own: "#00ff41".to_string(),
                other: "#b0b0b0".to_string(),
                system: "#555555".to_string(),
                timestamp: "#444444".to_string(),
                mention_bg: "#1a1a00".to_string(),
                mention_fg: "#ffaa00".to_string(),
                reply_border: "#00aaff".to_string(),
                thread_indicator: "#00aaff".to_string(),
            },
            roomlist: ThemeRoomlistColors {
                active_bg: "#1a1a1a".to_string(),
                active_fg: "#00ff41".to_string(),
                unread: "#ffffff".to_string(),
                mention_badge: "#ff3333".to_string(),
                muted: "#444444".to_string(),
            },
            reactions: ThemeReactionColors {
                background: "#0a0a0a".to_string(),
                border: "#333333".to_string(),
                own_bg: "#1a3a1a".to_string(),
                count: "#888888".to_string(),
            },
        },
        typography: ThemeTypography {
            font_family: "JetBrains Mono, Fira Code, monospace".to_string(),
            font_size: 14,
            line_height: 1.5,
            message_spacing: 4,
        },
        borders: ThemeBorders {
            style: BorderStyle::Rounded,
            room_list_width: "25%".to_string(),
        },
        emoji: ThemeEmoji {
            size: 32,
            sticker_max_size: 256,
            reaction_size: 20,
        },
        prompt: ThemePrompt {
            normal_indicator: "NOR".to_string(),
            insert_indicator: "INS".to_string(),
            command_indicator: "CMD".to_string(),
            visual_indicator: "VIS".to_string(),
        },
    }
}

// ── Custom theme files ──────────────────────────────────────────────────────
//
// Custom themes are the `*.toml` files in `<config_dir>/themes/`. On desktop
// users put them there by hand; on every platform Settings → Themes → Import
// writes them there. Mobile has no user-visible config folder, so import is
// the only way in there — but the folder itself works the same.
//
// A custom theme is named by its file name relative to that folder
// (`nord-tweaked.toml`), which is what `config.toml` stores. Not the absolute
// path: iOS moves the app container on update, so a stored absolute path
// would stop resolving.

/// Largest theme file Import will write. A full canonical theme is ~1.2 KB.
pub const MAX_THEME_FILE_BYTES: usize = 64 * 1024;

/// The folder custom themes live in.
pub fn themes_dir(config_dir: &Path) -> PathBuf {
    config_dir.join("themes")
}

/// The file `load_theme` reads for `name_or_path`.
///
/// A bare file name is a theme in the themes folder: `nord-tweaked.toml`, or
/// `nord-tweaked` with the extension implied. That is what Settings stores.
/// Anything with a directory part is a path, used as given — an absolute one
/// is what Settings stored before themes were named by file, and a relative
/// one (`themes/foo.toml`, `../x.toml`) resolves against the working
/// directory, as every theme path did before the themes folder was looked in.
/// Only a bare name is rooted in the folder, so `..` can't climb out of it.
pub fn resolve_theme_path(config_dir: &Path, name_or_path: &str) -> PathBuf {
    let given = Path::new(name_or_path);
    if !is_bare_file_name(given) {
        return given.to_path_buf();
    }
    let mut file = themes_dir(config_dir).join(given).into_os_string();
    if given.extension().and_then(|e| e.to_str()) != Some("toml") {
        file.push(".toml");
    }
    PathBuf::from(file)
}

/// `path` is a single file name: no root, no directory, not `.` or `..`.
fn is_bare_file_name(path: &Path) -> bool {
    let mut parts = path.components();
    matches!((parts.next(), parts.next()), (Some(Component::Normal(_)), None))
}

/// Device names Windows reserves in every folder, with any extension: a file
/// called `nul.toml` there is the null device, so writing it saves nothing.
fn is_windows_device_name(stem: &str) -> bool {
    match stem.as_bytes() {
        b"con" | b"prn" | b"aux" | b"nul" => true,
        [b'c', b'o', b'm', d] | [b'l', b'p', b't', d] => d.is_ascii_digit(),
        _ => false,
    }
}

/// Whether `stem` is safe to name a file in the themes folder: what the
/// frontend's `themeSlug` produces — lowercase ASCII letters and digits, with
/// single hyphens between them, at most 64 characters, and not a Windows
/// device name (`con`, `nul`, `com1` …). Rules out separators, `..`, dotfiles
/// and anything a filesystem might treat specially. Checked on every platform,
/// so a theme folder copied to Windows still works there.
pub fn is_valid_theme_stem(stem: &str) -> bool {
    !stem.is_empty()
        && stem.len() <= 64
        && !stem.starts_with('-')
        && !stem.ends_with('-')
        && !stem.contains("--")
        && stem.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !is_windows_device_name(stem)
}

/// A custom theme as listed in Settings → Themes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CustomThemeEntry {
    /// Display name from `[meta]`, or the file stem when it has none.
    pub name: String,
    /// File name in the themes folder — the theme's id, stored in
    /// `config.toml` and accepted by `load_theme` and `:theme`.
    pub id: String,
    /// Absolute path to the file. Matches what older configs stored as the
    /// theme, so Settings can still mark those as current.
    pub path: String,
}

/// Lenient TOML shape used only for extracting a display name from a theme
/// file without requiring every field to be present.
#[derive(Deserialize)]
struct PartialThemeMeta {
    name: Option<String>,
}
#[derive(Deserialize)]
struct PartialTheme {
    meta: Option<PartialThemeMeta>,
}

/// The display name of a theme file: its `meta.name`, or the file stem when
/// the file doesn't parse or has none, so even incomplete themes list.
fn theme_display_name(path: &Path) -> String {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|content| toml::from_str::<PartialTheme>(&content).ok())
        .and_then(|t| t.meta)
        .and_then(|m| m.name)
        .unwrap_or_else(|| {
            path.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .to_string()
        })
}

fn entry_for(path: &Path) -> Option<CustomThemeEntry> {
    let id = path.file_name()?.to_str()?.to_string();
    Some(CustomThemeEntry {
        name: theme_display_name(path),
        id,
        path: path.to_string_lossy().into_owned(),
    })
}

/// Every `*.toml` file in the themes folder, sorted by display name. Each is
/// listed whether or not it is a complete, valid theme; that is checked when
/// it is applied.
pub fn list_custom_themes_in(config_dir: &Path) -> Result<Vec<CustomThemeEntry>, String> {
    let dir = themes_dir(config_dir);
    if !dir.exists() {
        return Ok(vec![]);
    }
    let read = std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read themes directory: {e}"))?;
    let mut entries: Vec<CustomThemeEntry> = read
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|e| e.to_str()) == Some("toml"))
        .filter_map(|path| entry_for(&path))
        .collect();
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

/// What [`save_custom_theme`] did.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum SaveThemeOutcome {
    /// Written; this is the new (or replaced) theme.
    Saved { theme: CustomThemeEntry },
    /// A theme already has that file name and `overwrite` was not set. Nothing
    /// was written; `theme` is the one that would be replaced.
    Exists { theme: CustomThemeEntry },
}

/// Write `content` to `<themes folder>/<stem>.toml`.
///
/// The frontend has already decoded, completed and serialized the theme; this
/// checks only what the filesystem depends on: a safe stem, a sane size, and
/// TOML that will parse when the theme is applied. The write goes through a
/// temporary file so a crash never leaves a half-written theme behind.
pub fn save_custom_theme(
    config_dir: &Path,
    stem: &str,
    content: &str,
    overwrite: bool,
) -> Result<SaveThemeOutcome, String> {
    if !is_valid_theme_stem(stem) {
        return Err(format!("Invalid theme file name '{stem}'"));
    }
    if content.len() > MAX_THEME_FILE_BYTES {
        return Err(format!(
            "Theme is too large ({} bytes, limit {MAX_THEME_FILE_BYTES})",
            content.len()
        ));
    }
    toml::from_str::<toml::Table>(content)
        .map_err(|e| format!("Failed to parse theme TOML: {e}"))?;

    let dir = themes_dir(config_dir);
    let file = dir.join(format!("{stem}.toml"));
    if file.exists() && !overwrite {
        let theme = entry_for(&file).ok_or("Unreadable theme file name")?;
        return Ok(SaveThemeOutcome::Exists { theme });
    }

    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create themes directory: {e}"))?;
    let tmp = dir.join(format!("{stem}.toml.tmp"));
    std::fs::write(&tmp, content).map_err(|e| format!("Failed to write theme: {e}"))?;
    std::fs::rename(&tmp, &file).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Failed to save theme: {e}")
    })?;
    let theme = entry_for(&file).ok_or("Unreadable theme file name")?;
    Ok(SaveThemeOutcome::Saved { theme })
}

#[cfg(test)]
mod tests {
    use super::*;

    const PHOSPHOR_TOML: &str = r##"
[meta]
name = "Phosphor"
author = "user"
version = "1.0"

[colors]
background = "#0a0a0a"
foreground = "#b0b0b0"
cursor = "#00ff41"
selection_bg = "#1a3a1a"
selection_fg = "#00ff41"
border = "#333333"

[colors.accent]
primary = "#00ff41"
secondary = "#00aaff"
error = "#ff3333"
warning = "#ffaa00"
success = "#00ff41"
link = "#00aaff"

[colors.messages]
own = "#00ff41"
other = "#b0b0b0"
system = "#555555"
timestamp = "#444444"
mention_bg = "#1a1a00"
mention_fg = "#ffaa00"
reply_border = "#555555"
thread_indicator = "#00aaff"

[colors.roomlist]
active_bg = "#1a1a1a"
active_fg = "#00ff41"
unread = "#ffffff"
mention_badge = "#ff3333"
muted = "#444444"

[colors.reactions]
background = "#1a1a1a"
border = "#333333"
own_bg = "#1a3a1a"
count = "#888888"

[typography]
font_family = "JetBrains Mono, Fira Code, monospace"
font_size = 14
line_height = 1.5
message_spacing = 4

[borders]
style = "single"
room_list_width = "25%"

[emoji]
size = 32
sticker_max_size = 256
reaction_size = 20

[prompt]
normal_indicator = "NOR"
insert_indicator = "INS"
command_indicator = "CMD"
visual_indicator = "VIS"
"##;

    #[test]
    fn test_parse_phosphor_theme() {
        let theme = parse_theme(PHOSPHOR_TOML).expect("Should parse valid theme");
        assert_eq!(theme.meta.name, "Phosphor");
        assert_eq!(theme.colors.background, "#0a0a0a");
        assert_eq!(theme.colors.cursor, "#00ff41");
        assert_eq!(theme.colors.accent.primary, "#00ff41");
        assert_eq!(theme.colors.messages.own, "#00ff41");
        assert_eq!(theme.colors.roomlist.unread, "#ffffff");
        assert_eq!(theme.colors.reactions.count, "#888888");
        assert_eq!(theme.typography.font_size, 14);
        assert!((theme.typography.line_height - 1.5).abs() < f32::EPSILON);
        assert_eq!(theme.borders.style, BorderStyle::Single);
        assert_eq!(theme.emoji.size, 32);
        assert_eq!(theme.prompt.normal_indicator, "NOR");
    }

    #[test]
    fn test_theme_validation_passes_for_valid_theme() {
        let theme = parse_theme(PHOSPHOR_TOML).unwrap();
        let errors = validate_theme(&theme);
        assert!(errors.is_empty(), "Valid theme should have no errors: {:?}", errors);
    }

    #[test]
    fn test_theme_validation_fails_for_bad_color() {
        let mut theme = parse_theme(PHOSPHOR_TOML).unwrap();
        theme.colors.background = "not-a-color".to_string();
        let errors = validate_theme(&theme);
        assert!(
            errors.iter().any(|e| e.field == "colors.background"),
            "Should report bad color error"
        );
    }

    #[test]
    fn test_default_theme_is_valid() {
        let theme = default_theme();
        let errors = validate_theme(&theme);
        assert!(errors.is_empty(), "Default theme should be valid: {:?}", errors);
    }

    #[test]
    fn test_hex_color_validation() {
        assert!(is_valid_hex_color("#ff3333"));
        assert!(is_valid_hex_color("#fff"));
        assert!(is_valid_hex_color("#00ff4180")); // with alpha
        assert!(!is_valid_hex_color("ff3333")); // missing #
        assert!(!is_valid_hex_color("#gg1234")); // invalid hex
        assert!(!is_valid_hex_color("#12345")); // wrong length
    }

    #[test]
    fn test_parse_invalid_toml_returns_error() {
        let result = parse_theme("this is not valid toml [[[[");
        assert!(result.is_err());
    }

    #[test]
    fn test_border_style_deserialization() {
        let toml = PHOSPHOR_TOML.replace(r#"style = "single""#, r#"style = "double""#);
        let theme = parse_theme(&toml).unwrap();
        assert_eq!(theme.borders.style, BorderStyle::Double);
    }

    // --- All BorderStyle variants deserialize ---

    #[test]
    fn test_border_style_rounded() {
        let toml = PHOSPHOR_TOML.replace(r#"style = "single""#, r#"style = "rounded""#);
        let theme = parse_theme(&toml).unwrap();
        assert_eq!(theme.borders.style, BorderStyle::Rounded);
    }

    #[test]
    fn test_border_style_ascii() {
        let toml = PHOSPHOR_TOML.replace(r#"style = "single""#, r#"style = "ascii""#);
        let theme = parse_theme(&toml).unwrap();
        assert_eq!(theme.borders.style, BorderStyle::Ascii);
    }

    #[test]
    fn test_border_style_none() {
        let toml = PHOSPHOR_TOML.replace(r#"style = "single""#, r#"style = "none""#);
        let theme = parse_theme(&toml).unwrap();
        assert_eq!(theme.borders.style, BorderStyle::None);
    }

    // --- Invalid hex colors ---

    #[test]
    fn test_hex_color_missing_hash() {
        assert!(!is_valid_hex_color("ff3333"));
        assert!(!is_valid_hex_color("00ff41"));
    }

    #[test]
    fn test_hex_color_wrong_length() {
        assert!(!is_valid_hex_color("#12345")); // 5 hex digits
        assert!(!is_valid_hex_color("#1234567")); // 7 hex digits
        assert!(!is_valid_hex_color("#")); // empty hex part
    }

    #[test]
    fn test_hex_color_invalid_characters() {
        assert!(!is_valid_hex_color("#gg1234"));
        assert!(!is_valid_hex_color("#xyz000"));
        assert!(!is_valid_hex_color("#00ff4g"));
    }

    #[test]
    fn test_hex_color_short_form_valid() {
        assert!(is_valid_hex_color("#abc"));
        assert!(is_valid_hex_color("#000"));
        assert!(is_valid_hex_color("#fff"));
    }

    #[test]
    fn test_hex_color_with_alpha_valid() {
        assert!(is_valid_hex_color("#00ff4180"));
        assert!(is_valid_hex_color("#00000000"));
        assert!(is_valid_hex_color("#ffffffff"));
    }

    // --- Validation catches out-of-range font_size ---

    #[test]
    fn test_font_size_too_small_triggers_error() {
        let mut theme = default_theme();
        theme.typography.font_size = 4; // below min of 6
        let errors = validate_theme(&theme);
        assert!(
            errors.iter().any(|e| e.field == "typography.font_size"),
            "Should flag font_size < 6"
        );
    }

    #[test]
    fn test_font_size_too_large_triggers_error() {
        let mut theme = default_theme();
        theme.typography.font_size = 100; // above max of 72
        let errors = validate_theme(&theme);
        assert!(
            errors.iter().any(|e| e.field == "typography.font_size"),
            "Should flag font_size > 72"
        );
    }

    #[test]
    fn test_font_size_boundary_values_are_valid() {
        let mut theme = default_theme();
        theme.typography.font_size = 6;
        assert!(validate_theme(&theme).is_empty());
        theme.typography.font_size = 72;
        assert!(validate_theme(&theme).is_empty());
    }

    // --- Validation catches out-of-range emoji size ---

    #[test]
    fn test_emoji_size_too_small_triggers_error() {
        let mut theme = default_theme();
        theme.emoji.size = 4; // below min of 8
        let errors = validate_theme(&theme);
        assert!(
            errors.iter().any(|e| e.field == "emoji.size"),
            "Should flag emoji.size < 8"
        );
    }

    #[test]
    fn test_emoji_size_too_large_triggers_error() {
        let mut theme = default_theme();
        theme.emoji.size = 512; // above max of 256
        let errors = validate_theme(&theme);
        assert!(
            errors.iter().any(|e| e.field == "emoji.size"),
            "Should flag emoji.size > 256"
        );
    }

    #[test]
    fn test_emoji_size_boundary_values_are_valid() {
        let mut theme = default_theme();
        theme.emoji.size = 8;
        assert!(validate_theme(&theme).is_empty());
        theme.emoji.size = 256;
        assert!(validate_theme(&theme).is_empty());
    }

    // --- Missing required sections fail to parse ---

    #[test]
    fn test_missing_meta_section_fails() {
        let toml = r##"
[colors]
background = "#0a0a0a"
foreground = "#b0b0b0"
"##;
        assert!(parse_theme(toml).is_err());
    }

    #[test]
    fn test_missing_colors_section_fails() {
        let toml = r#"
[meta]
name = "Test"
"#;
        assert!(parse_theme(toml).is_err());
    }

    #[test]
    fn test_empty_toml_fails() {
        assert!(parse_theme("").is_err());
    }

    // --- Default values ---

    #[test]
    fn test_default_theme_name_is_phosphor() {
        let theme = default_theme();
        assert_eq!(theme.meta.name, "Phosphor");
    }

    #[test]
    fn test_default_theme_has_author() {
        let theme = default_theme();
        assert!(theme.meta.author.is_some());
    }

    #[test]
    fn test_default_theme_font_size_in_range() {
        let theme = default_theme();
        assert!(theme.typography.font_size >= 6);
        assert!(theme.typography.font_size <= 72);
    }

    #[test]
    fn test_default_theme_emoji_size_in_range() {
        let theme = default_theme();
        assert!(theme.emoji.size >= 8);
        assert!(theme.emoji.size <= 256);
    }

    #[test]
    fn test_default_theme_border_style_is_rounded() {
        let theme = default_theme();
        assert_eq!(theme.borders.style, BorderStyle::Rounded);
    }

    #[test]
    fn test_retired_prompt_symbol_still_parses() {
        // Themes written before `prompt.symbol` was dropped must keep loading.
        let old = PHOSPHOR_TOML.replace("[prompt]\n", "[prompt]\nsymbol = \":>\"\n");
        assert!(old.contains("symbol"));
        let theme = parse_theme(&old).expect("a retired key must not break parsing");
        assert_eq!(theme.prompt.normal_indicator, "NOR");
    }

    #[test]
    fn test_default_theme_prompt_has_all_indicators() {
        let theme = default_theme();
        assert!(!theme.prompt.normal_indicator.is_empty());
        assert!(!theme.prompt.insert_indicator.is_empty());
        assert!(!theme.prompt.command_indicator.is_empty());
        assert!(!theme.prompt.visual_indicator.is_empty());
    }

    // --- validate_theme reports correct field names ---

    #[test]
    fn test_validation_reports_correct_field_for_bad_accent_primary() {
        let mut theme = default_theme();
        theme.colors.accent.primary = "notacolor".to_string();
        let errors = validate_theme(&theme);
        assert!(errors.iter().any(|e| e.field == "colors.accent.primary"));
    }

    #[test]
    fn test_validation_reports_correct_field_for_bad_roomlist_unread() {
        let mut theme = default_theme();
        theme.colors.roomlist.unread = "bad".to_string();
        let errors = validate_theme(&theme);
        assert!(errors.iter().any(|e| e.field == "colors.roomlist.unread"));
    }

    #[test]
    fn test_validation_error_message_contains_invalid_value() {
        let mut theme = default_theme();
        theme.colors.background = "notacolor".to_string();
        let errors = validate_theme(&theme);
        let bg_error = errors.iter().find(|e| e.field == "colors.background").unwrap();
        assert!(bg_error.message.contains("notacolor"));
    }

    // ── Custom theme files ──────────────────────────────────────────────

    #[test]
    fn resolve_theme_path_keeps_absolute_paths() {
        let cfg = Path::new("/cfg");
        let abs = std::env::temp_dir().join("elsewhere.toml");
        assert_eq!(resolve_theme_path(cfg, abs.to_str().unwrap()), abs);
    }

    #[test]
    fn resolve_theme_path_reads_names_from_the_themes_folder() {
        let cfg = Path::new("cfg");
        let expected = cfg.join("themes").join("nord-tweaked.toml");
        assert_eq!(resolve_theme_path(cfg, "nord-tweaked.toml"), expected);
        assert_eq!(resolve_theme_path(cfg, "nord-tweaked"), expected);
        // A dot in the stem is not an extension to keep.
        assert_eq!(
            resolve_theme_path(cfg, "v1.2"),
            cfg.join("themes").join("v1.2.toml")
        );
    }

    #[test]
    fn resolve_theme_path_leaves_paths_with_a_directory_alone() {
        let cfg = Path::new("cfg");
        // Relative paths keep meaning what they did before the themes folder
        // was looked in: relative to the working directory, used as given.
        assert_eq!(resolve_theme_path(cfg, "themes/foo.toml"), Path::new("themes/foo.toml"));
        assert_eq!(resolve_theme_path(cfg, "./nord"), Path::new("./nord"));
        // `..` never climbs out of the themes folder into the config folder.
        assert_eq!(resolve_theme_path(cfg, "../config"), Path::new("../config"));
        assert_eq!(resolve_theme_path(cfg, ".."), Path::new(".."));
    }

    #[test]
    fn theme_stems_are_slugs() {
        for ok in ["nord", "catppuccin-mocha", "theme2", "a", "aux-2", "console", "com10", "nul-theme"] {
            assert!(is_valid_theme_stem(ok), "{ok}");
        }
        let long = "a".repeat(65);
        for bad in [
            "", "..", "../x", "a/b", "a\\b", ".hidden", "-a", "a-", "a--b", "Nord", "nörd",
            "a b", "a.toml", long.as_str(), "con", "nul", "aux", "prn", "com1", "lpt9", "com0",
        ] {
            assert!(!is_valid_theme_stem(bad), "{bad:?}");
        }
    }

    const IMPORTED: &str = "[meta]\nname = \"Imported\"\n\n[colors]\nbackground = \"#000000\"\n";

    #[test]
    fn save_custom_theme_writes_into_the_themes_folder() {
        let cfg = tempfile::tempdir().unwrap();
        let outcome = save_custom_theme(cfg.path(), "imported", IMPORTED, false).unwrap();
        let file = cfg.path().join("themes").join("imported.toml");
        let SaveThemeOutcome::Saved { theme } = outcome else { panic!("{outcome:?}") };
        assert_eq!(theme.name, "Imported");
        assert_eq!(theme.id, "imported.toml");
        assert_eq!(Path::new(&theme.path), file);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), IMPORTED);
        assert!(!cfg.path().join("themes").join("imported.toml.tmp").exists());
        assert_eq!(list_custom_themes_in(cfg.path()).unwrap(), vec![theme]);
    }

    #[test]
    fn save_custom_theme_asks_before_replacing() {
        let cfg = tempfile::tempdir().unwrap();
        save_custom_theme(cfg.path(), "imported", IMPORTED, false).unwrap();
        let newer = IMPORTED.replace("#000000", "#111111");

        let outcome = save_custom_theme(cfg.path(), "imported", &newer, false).unwrap();
        let SaveThemeOutcome::Exists { theme } = outcome else { panic!("{outcome:?}") };
        assert_eq!(theme.name, "Imported");
        let file = cfg.path().join("themes").join("imported.toml");
        assert_eq!(std::fs::read_to_string(&file).unwrap(), IMPORTED);

        let outcome = save_custom_theme(cfg.path(), "imported", &newer, true).unwrap();
        assert!(matches!(outcome, SaveThemeOutcome::Saved { .. }));
        assert_eq!(std::fs::read_to_string(&file).unwrap(), newer);
    }

    #[test]
    fn save_custom_theme_refuses_unsafe_names_and_bad_content() {
        let cfg = tempfile::tempdir().unwrap();
        assert!(save_custom_theme(cfg.path(), "../escape", IMPORTED, false).is_err());
        assert!(save_custom_theme(cfg.path(), "broken", "[meta\nname =", false).is_err());
        let huge = format!("{IMPORTED}# {}\n", "x".repeat(MAX_THEME_FILE_BYTES));
        assert!(save_custom_theme(cfg.path(), "huge", &huge, false).is_err());
        assert!(!cfg.path().join("themes").exists());
    }

    #[test]
    fn listed_themes_fall_back_to_the_file_stem_for_a_name() {
        let cfg = tempfile::tempdir().unwrap();
        let dir = cfg.path().join("themes");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("bare.toml"), "[colors]\n").unwrap();
        std::fs::write(dir.join("notes.txt"), "not a theme").unwrap();
        std::fs::write(dir.join("half.toml.tmp"), IMPORTED).unwrap();
        let listed = list_custom_themes_in(cfg.path()).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!((listed[0].name.as_str(), listed[0].id.as_str()), ("bare", "bare.toml"));
    }
}
