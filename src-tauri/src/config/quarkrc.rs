use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A parsed keybinding directive.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Mapping {
    /// The map command type: nmap, tmap, rmap, pmap, imap, cmap, vmap,
    /// nnoremap, tnoremap, rnoremap, etc.
    pub map_type: MapType,
    /// Whether this is a noremap (non-recursive) variant.
    pub noremap: bool,
    /// The key sequence (e.g., "gg", "<leader>e", "Ctrl-g").
    pub key: String,
    /// The action/command string (e.g., "jump-top", "mode-insert").
    pub action: String,
}

/// Scope of a mapping.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum MapType {
    /// Normal mode (global)
    Normal,
    /// Insert mode
    Insert,
    /// Timeline panel (normal mode, timeline focused)
    Timeline,
    /// Room list panel (normal mode, room list focused)
    RoomList,
    /// Picker (emoji/sticker/GIF picker)
    Picker,
    /// Command mode
    Command,
    /// Visual mode
    Visual,
}

/// An unmap directive.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Unmap {
    pub map_type: MapType,
    pub key: String,
}

/// A set directive (e.g., `set scrolloff=5`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SetOption {
    pub name: String,
    pub value: OptionValue,
}

/// Value types for `set` options.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum OptionValue {
    Bool(bool),
    Integer(i64),
    Str(String),
}

/// A `let` directive (e.g., `let mapleader = " "`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LetBinding {
    pub name: String,
    pub value: String,
}

/// A `source` directive.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SourceDirective {
    pub path: String,
}

/// A `colorscheme` directive.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ColorschemeDiretive {
    pub name: String,
}

/// A parsed line/directive from a quarkrc file.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RcDirective {
    Map(Mapping),
    Unmap(Unmap),
    Set(SetOption),
    Let(LetBinding),
    Source(SourceDirective),
    Colorscheme(ColorschemeDiretive),
    Comment(String),
}

/// Result of parsing a quarkrc file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedRc {
    pub directives: Vec<RcDirective>,
    pub errors: Vec<ParseError>,
}

/// A non-fatal parse error on a specific line.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParseError {
    pub line_number: usize,
    pub line: String,
    pub message: String,
}

/// Parse a quarkrc file from its string content.
pub fn parse_quarkrc(content: &str) -> ParsedRc {
    let mut directives = Vec::new();
    let mut errors = Vec::new();

    for (line_idx, line) in content.lines().enumerate() {
        let line_number = line_idx + 1;
        let trimmed = line.trim();

        // Empty lines
        if trimmed.is_empty() {
            continue;
        }

        // Comments: lines starting with "
        if trimmed.starts_with('"') {
            directives.push(RcDirective::Comment(trimmed[1..].trim().to_string()));
            continue;
        }

        match parse_line(trimmed) {
            Ok(Some(directive)) => directives.push(directive),
            Ok(None) => {} // Intentionally ignored
            Err(message) => errors.push(ParseError {
                line_number,
                line: line.to_string(),
                message,
            }),
        }
    }

    ParsedRc {
        directives,
        errors,
    }
}

/// Parse a single non-comment, non-empty line.
fn parse_line(line: &str) -> Result<Option<RcDirective>, String> {
    let line = line.trim();
    if line.is_empty() {
        return Ok(None);
    }

    let mut parts = line.splitn(2, char::is_whitespace);
    let cmd = parts.next().unwrap_or("");
    // For `let` directives, preserve the full rest (don't strip inline comments from values).
    // For other directives, strip inline comments.
    let rest_raw = parts.next().unwrap_or("").trim();
    let rest = if cmd == "let" {
        rest_raw
    } else {
        strip_inline_comment(rest_raw).trim()
    };

    match cmd {
        // Map commands
        cmd if is_map_cmd(cmd) => {
            let (map_type, noremap) = parse_map_cmd(cmd)?;
            let (key, action) = parse_key_action(rest)?;
            Ok(Some(RcDirective::Map(Mapping {
                map_type,
                noremap,
                key,
                action,
            })))
        }

        // Unmap commands
        cmd if is_unmap_cmd(cmd) => {
            let map_type = parse_unmap_cmd(cmd)?;
            let key = rest.to_string();
            if key.is_empty() {
                return Err(format!("'{}' requires a key argument", cmd));
            }
            Ok(Some(RcDirective::Unmap(Unmap { map_type, key })))
        }

        "set" => {
            let option = parse_set(rest)?;
            Ok(Some(RcDirective::Set(option)))
        }

        "let" => {
            let binding = parse_let(rest)?;
            Ok(Some(RcDirective::Let(binding)))
        }

        "source" => {
            if rest.is_empty() {
                return Err("'source' requires a file path".to_string());
            }
            Ok(Some(RcDirective::Source(SourceDirective {
                path: rest.to_string(),
            })))
        }

        "colorscheme" => {
            if rest.is_empty() {
                return Err("'colorscheme' requires a name".to_string());
            }
            Ok(Some(RcDirective::Colorscheme(ColorschemeDiretive {
                name: rest.to_string(),
            })))
        }

        // autocmd: recognized but not deeply parsed in phase 1
        "autocmd" => Ok(None),

        _ => Err(format!("Unknown directive: '{}'", cmd)),
    }
}

/// Strip an inline comment from a vimrc-style line.
/// Comments start with `"` that is preceded by whitespace but NOT directly after `=`.
/// This allows `let mapleader = " "` to work correctly.
fn strip_inline_comment(line: &str) -> &str {
    if let Some(idx) = find_inline_comment(line) {
        line[..idx].trim_end()
    } else {
        line
    }
}

fn find_inline_comment(line: &str) -> Option<usize> {
    let bytes = line.as_bytes();
    let mut i = 1;
    let mut in_double_quote = false;
    let mut in_single_quote = false;

    while i < bytes.len() {
        let b = bytes[i];

        if in_double_quote {
            if b == b'"' {
                in_double_quote = false;
            }
            i += 1;
            continue;
        }
        if in_single_quote {
            if b == b'\'' {
                in_single_quote = false;
            }
            i += 1;
            continue;
        }

        if b == b'"' {
            // Check if preceded by whitespace — if so, it's a comment start
            if bytes[i - 1].is_ascii_whitespace() {
                return Some(i - 1);
            } else {
                // It's the start of a quoted string
                in_double_quote = true;
            }
        } else if b == b'\'' {
            in_single_quote = true;
        }

        i += 1;
    }
    None
}

/// Check if a command string is a map command.
fn is_map_cmd(cmd: &str) -> bool {
    matches!(
        cmd,
        "nmap" | "imap" | "tmap" | "rmap" | "pmap" | "cmap" | "vmap"
            | "nnoremap" | "inoremap" | "tnoremap" | "rnoremap" | "pnoremap"
            | "cnoremap" | "vnoremap"
    )
}

/// Check if a command string is an unmap command.
fn is_unmap_cmd(cmd: &str) -> bool {
    matches!(
        cmd,
        "nunmap" | "iunmap" | "tunmap" | "runmap" | "punmap" | "cunmap" | "vunmap"
    )
}

/// Parse a map command name into (MapType, noremap).
fn parse_map_cmd(cmd: &str) -> Result<(MapType, bool), String> {
    let noremap = cmd.contains("noremap");
    let prefix = cmd.trim_end_matches("noremap").trim_end_matches("map");

    let map_type = match prefix {
        "n" => MapType::Normal,
        "i" => MapType::Insert,
        "t" => MapType::Timeline,
        "r" => MapType::RoomList,
        "p" => MapType::Picker,
        "c" => MapType::Command,
        "v" => MapType::Visual,
        other => return Err(format!("Unknown map prefix: '{}'", other)),
    };

    Ok((map_type, noremap))
}

/// Parse an unmap command name into MapType.
fn parse_unmap_cmd(cmd: &str) -> Result<MapType, String> {
    let prefix = cmd.trim_end_matches("unmap");
    match prefix {
        "n" => Ok(MapType::Normal),
        "i" => Ok(MapType::Insert),
        "t" => Ok(MapType::Timeline),
        "r" => Ok(MapType::RoomList),
        "p" => Ok(MapType::Picker),
        "c" => Ok(MapType::Command),
        "v" => Ok(MapType::Visual),
        other => Err(format!("Unknown unmap prefix: '{}'", other)),
    }
}

/// Parse "key action" from the rest of a map line.
fn parse_key_action(rest: &str) -> Result<(String, String), String> {
    let mut parts = rest.splitn(2, char::is_whitespace);
    let key = parts
        .next()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Map directive requires a key".to_string())?;
    let action = parts
        .next()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Map directive requires an action".to_string())?;

    Ok((key.to_string(), action.to_string()))
}

/// Parse a `set name=value` or `set name` (boolean toggle) line.
fn parse_set(rest: &str) -> Result<SetOption, String> {
    if rest.is_empty() {
        return Err("'set' requires an option name".to_string());
    }

    if let Some(eq_pos) = rest.find('=') {
        let name = rest[..eq_pos].trim().to_string();
        let raw_value = rest[eq_pos + 1..].trim();

        let value = parse_option_value(raw_value);
        Ok(SetOption { name, value })
    } else {
        // Boolean set (no value = true)
        let name = rest.trim().to_string();
        Ok(SetOption {
            name,
            value: OptionValue::Bool(true),
        })
    }
}

/// Parse a string into an OptionValue.
fn parse_option_value(s: &str) -> OptionValue {
    if s == "true" {
        return OptionValue::Bool(true);
    }
    if s == "false" {
        return OptionValue::Bool(false);
    }
    if let Ok(n) = s.parse::<i64>() {
        return OptionValue::Integer(n);
    }
    OptionValue::Str(s.to_string())
}

/// Parse a `let name = value` line.
fn parse_let(rest: &str) -> Result<LetBinding, String> {
    if let Some(eq_pos) = rest.find('=') {
        let name = rest[..eq_pos].trim().to_string();
        let raw_value = rest[eq_pos + 1..].trim();

        // Strip surrounding quotes if present
        let value = strip_quotes(raw_value).to_string();

        Ok(LetBinding { name, value })
    } else {
        Err(format!("'let' requires assignment: let name = value (got: '{}')", rest))
    }
}

/// Strip surrounding single or double quotes from a string.
fn strip_quotes(s: &str) -> &str {
    if (s.starts_with('"') && s.ends_with('"'))
        || (s.starts_with('\'') && s.ends_with('\''))
    {
        &s[1..s.len() - 1]
    } else {
        s
    }
}

/// Build a flat keymap from parsed directives.
/// Returns a map from (MapType, key) -> action.
pub fn build_keymap(
    directives: &[RcDirective],
) -> HashMap<(MapType, String), String> {
    let mut map: HashMap<(MapType, String), String> = HashMap::new();

    for directive in directives {
        match directive {
            RcDirective::Map(m) => {
                map.insert((m.map_type.clone(), m.key.clone()), m.action.clone());
            }
            RcDirective::Unmap(u) => {
                map.remove(&(u.map_type.clone(), u.key.clone()));
            }
            _ => {}
        }
    }

    map
}

/// Get all `set` options as a flat string->OptionValue map.
pub fn collect_options(directives: &[RcDirective]) -> HashMap<String, OptionValue> {
    let mut opts = HashMap::new();
    for directive in directives {
        if let RcDirective::Set(opt) = directive {
            opts.insert(opt.name.clone(), opt.value.clone());
        }
    }
    opts
}

/// Get all `let` bindings as a flat map.
pub fn collect_let_bindings(directives: &[RcDirective]) -> HashMap<String, String> {
    let mut bindings = HashMap::new();
    for directive in directives {
        if let RcDirective::Let(binding) = directive {
            bindings.insert(binding.name.clone(), binding.value.clone());
        }
    }
    bindings
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_RC: &str = r#"
" ~/.config/quark/quarkrc

" Remap navigation to ijkl
nmap i     mode-insert
nmap j     nav-left
nmap k     nav-down
nmap l     nav-up        " yes, really
nmap ;     nav-right

" Context-scoped mappings
tmap k     scroll-down
tmap l     scroll-up
rmap k     room-next
rmap l     room-prev
pmap k     picker-down
pmap l     picker-up
pmap j     picker-left
pmap ;     picker-right

" Multi-key sequences
nmap gg    jump-top
nmap G     jump-bottom
nmap dd    redact

" Leader key (default: space)
let mapleader = " "
nmap <leader>e  emoji-picker
nmap <leader>g  gif-search
nmap <leader>s  sticker-picker
nmap <leader>t  thread-open
nmap <leader>v  verify-device

" Unmap a default binding
nunmap gs

" Set options
set scrolloff=5
set shortcode_preview=true
set gif_provider=klipy
set gif_rating=pg
"#;

    #[test]
    fn test_parse_comments() {
        let rc = parse_quarkrc(r#"" This is a comment"#);
        assert_eq!(rc.errors.len(), 0);
        assert!(matches!(
            &rc.directives[0],
            RcDirective::Comment(c) if c == "This is a comment"
        ));
    }

    #[test]
    fn test_parse_nmap() {
        let rc = parse_quarkrc("nmap j nav-left");
        assert_eq!(rc.errors.len(), 0);
        let dir = &rc.directives[0];
        assert!(matches!(
            dir,
            RcDirective::Map(m) if m.map_type == MapType::Normal && m.key == "j" && m.action == "nav-left"
        ));
    }

    #[test]
    fn test_parse_tmap() {
        let rc = parse_quarkrc("tmap k scroll-down");
        assert_eq!(rc.errors.len(), 0);
        assert!(matches!(
            &rc.directives[0],
            RcDirective::Map(m) if m.map_type == MapType::Timeline
        ));
    }

    #[test]
    fn test_parse_rmap() {
        let rc = parse_quarkrc("rmap k room-next");
        assert_eq!(rc.errors.len(), 0);
        assert!(matches!(
            &rc.directives[0],
            RcDirective::Map(m) if m.map_type == MapType::RoomList
        ));
    }

    #[test]
    fn test_parse_pmap() {
        let rc = parse_quarkrc("pmap j picker-left");
        assert_eq!(rc.errors.len(), 0);
        assert!(matches!(
            &rc.directives[0],
            RcDirective::Map(m) if m.map_type == MapType::Picker
        ));
    }

    #[test]
    fn test_parse_noremap() {
        let rc = parse_quarkrc("nnoremap j nav-left");
        assert_eq!(rc.errors.len(), 0);
        assert!(matches!(
            &rc.directives[0],
            RcDirective::Map(m) if m.noremap && m.map_type == MapType::Normal
        ));
    }

    #[test]
    fn test_parse_nunmap() {
        let rc = parse_quarkrc("nunmap gs");
        assert_eq!(rc.errors.len(), 0);
        assert!(matches!(
            &rc.directives[0],
            RcDirective::Unmap(u) if u.map_type == MapType::Normal && u.key == "gs"
        ));
    }

    #[test]
    fn test_parse_set_integer() {
        let rc = parse_quarkrc("set scrolloff=5");
        assert_eq!(rc.errors.len(), 0);
        assert!(matches!(
            &rc.directives[0],
            RcDirective::Set(s) if s.name == "scrolloff" && s.value == OptionValue::Integer(5)
        ));
    }

    #[test]
    fn test_parse_set_bool() {
        let rc = parse_quarkrc("set shortcode_preview=true");
        assert_eq!(rc.errors.len(), 0);
        assert!(matches!(
            &rc.directives[0],
            RcDirective::Set(s) if s.name == "shortcode_preview" && s.value == OptionValue::Bool(true)
        ));
    }

    #[test]
    fn test_parse_set_string() {
        let rc = parse_quarkrc("set gif_provider=klipy");
        assert_eq!(rc.errors.len(), 0);
        if let RcDirective::Set(s) = &rc.directives[0] {
            assert_eq!(s.name, "gif_provider");
            assert_eq!(s.value, OptionValue::Str("klipy".to_string()));
        } else {
            panic!("Expected Set directive");
        }
    }

    #[test]
    fn test_parse_let() {
        let rc = parse_quarkrc(r#"let mapleader = " ""#);
        assert_eq!(rc.errors.len(), 0);
        assert!(matches!(
            &rc.directives[0],
            RcDirective::Let(b) if b.name == "mapleader" && b.value == " "
        ));
    }

    #[test]
    fn test_parse_source() {
        let rc = parse_quarkrc("source ~/.config/quark/extra.rc");
        assert_eq!(rc.errors.len(), 0);
        assert!(matches!(
            &rc.directives[0],
            RcDirective::Source(s) if s.path == "~/.config/quark/extra.rc"
        ));
    }

    #[test]
    fn test_parse_colorscheme() {
        let rc = parse_quarkrc("colorscheme phosphor");
        assert_eq!(rc.errors.len(), 0);
        assert!(matches!(
            &rc.directives[0],
            RcDirective::Colorscheme(c) if c.name == "phosphor"
        ));
    }

    #[test]
    fn test_inline_comment_stripping() {
        let rc = parse_quarkrc(r#"nmap l     nav-up        " yes, really"#);
        assert_eq!(rc.errors.len(), 0);
        assert!(matches!(
            &rc.directives[0],
            RcDirective::Map(m) if m.key == "l" && m.action == "nav-up"
        ));
    }

    #[test]
    fn test_parse_full_sample_rc() {
        let rc = parse_quarkrc(SAMPLE_RC);
        assert!(rc.errors.is_empty(), "Parse errors: {:?}", rc.errors);

        // Count map directives
        let maps: Vec<_> = rc
            .directives
            .iter()
            .filter(|d| matches!(d, RcDirective::Map(_)))
            .collect();
        assert!(maps.len() >= 10, "Expected at least 10 map directives, got {}", maps.len());

        // Check for the leader map
        let leader_emoji = maps.iter().any(|d| {
            matches!(d, RcDirective::Map(m) if m.key == "<leader>e" && m.action == "emoji-picker")
        });
        assert!(leader_emoji, "Should have <leader>e -> emoji-picker mapping");
    }

    #[test]
    fn test_build_keymap() {
        let rc = parse_quarkrc("nmap j nav-left\nnmap k nav-down\nnunmap k");
        let keymap = build_keymap(&rc.directives);
        assert_eq!(keymap.get(&(MapType::Normal, "j".to_string())), Some(&"nav-left".to_string()));
        // k should be unmapped
        assert!(!keymap.contains_key(&(MapType::Normal, "k".to_string())));
    }

    #[test]
    fn test_collect_options() {
        let rc = parse_quarkrc("set scrolloff=5\nset shortcode_preview=true");
        let opts = collect_options(&rc.directives);
        assert_eq!(opts.get("scrolloff"), Some(&OptionValue::Integer(5)));
        assert_eq!(opts.get("shortcode_preview"), Some(&OptionValue::Bool(true)));
    }

    #[test]
    fn test_unknown_directive_is_error() {
        let rc = parse_quarkrc("notacommand foo bar");
        assert_eq!(rc.errors.len(), 1);
        assert!(rc.errors[0].message.contains("Unknown directive"));
    }

    #[test]
    fn test_empty_file() {
        let rc = parse_quarkrc("");
        assert!(rc.directives.is_empty());
        assert!(rc.errors.is_empty());
    }

    #[test]
    fn test_map_without_action_is_error() {
        let rc = parse_quarkrc("nmap j");
        assert_eq!(rc.errors.len(), 1);
    }

    // --- Edge cases: blank / whitespace lines ---

    #[test]
    fn test_blank_lines_are_skipped() {
        let rc = parse_quarkrc("\n\n\nnmap j nav-left\n\n");
        assert_eq!(rc.errors.len(), 0);
        assert_eq!(rc.directives.len(), 1);
    }

    #[test]
    fn test_only_whitespace_lines_produce_no_directives() {
        let rc = parse_quarkrc("   \n\t\n  \n");
        assert!(rc.directives.is_empty());
        assert!(rc.errors.is_empty());
    }

    #[test]
    fn test_multiple_spaces_between_key_and_action() {
        let rc = parse_quarkrc("nmap gg    jump-top");
        assert_eq!(rc.errors.len(), 0);
        assert!(matches!(
            &rc.directives[0],
            RcDirective::Map(m) if m.key == "gg" && m.action == "jump-top"
        ));
    }

    // --- Inline comments with quoted values ---

    #[test]
    fn test_inline_comment_stripped_from_set() {
        let rc = parse_quarkrc(r#"set scrolloff=5 " scroll buffer"#);
        assert_eq!(rc.errors.len(), 0);
        assert!(matches!(
            &rc.directives[0],
            RcDirective::Set(s) if s.name == "scrolloff" && s.value == OptionValue::Integer(5)
        ));
    }

    #[test]
    fn test_let_with_space_value_preserves_quotes() {
        // let directive keeps the raw rest to support quoted spaces
        let rc = parse_quarkrc(r#"let mapleader = " ""#);
        assert_eq!(rc.errors.len(), 0);
        assert!(matches!(
            &rc.directives[0],
            RcDirective::Let(b) if b.value == " "
        ));
    }

    #[test]
    fn test_let_with_single_quoted_value() {
        let rc = parse_quarkrc("let myvar = 'hello'");
        assert_eq!(rc.errors.len(), 0);
        assert!(matches!(
            &rc.directives[0],
            RcDirective::Let(b) if b.value == "hello"
        ));
    }

    // --- autocmd: recognized but produces no directive ---

    #[test]
    fn test_autocmd_is_silently_ignored() {
        let rc = parse_quarkrc("autocmd BufEnter * nmap j nav-left");
        assert_eq!(rc.errors.len(), 0);
        assert!(rc.directives.is_empty());
    }

    #[test]
    fn test_autocmd_bare_is_silently_ignored() {
        let rc = parse_quarkrc("autocmd");
        assert_eq!(rc.errors.len(), 0);
        assert!(rc.directives.is_empty());
    }

    // --- noremap variants for all map types ---

    #[test]
    fn test_inoremap() {
        let rc = parse_quarkrc("inoremap <Esc> mode-normal");
        assert_eq!(rc.errors.len(), 0);
        assert!(matches!(
            &rc.directives[0],
            RcDirective::Map(m) if m.map_type == MapType::Insert && m.noremap && m.key == "<Esc>"
        ));
    }

    #[test]
    fn test_tnoremap() {
        let rc = parse_quarkrc("tnoremap k scroll-down");
        assert_eq!(rc.errors.len(), 0);
        assert!(matches!(
            &rc.directives[0],
            RcDirective::Map(m) if m.map_type == MapType::Timeline && m.noremap
        ));
    }

    #[test]
    fn test_rnoremap() {
        let rc = parse_quarkrc("rnoremap k room-next");
        assert_eq!(rc.errors.len(), 0);
        assert!(matches!(
            &rc.directives[0],
            RcDirective::Map(m) if m.map_type == MapType::RoomList && m.noremap
        ));
    }

    #[test]
    fn test_pnoremap() {
        let rc = parse_quarkrc("pnoremap j picker-left");
        assert_eq!(rc.errors.len(), 0);
        assert!(matches!(
            &rc.directives[0],
            RcDirective::Map(m) if m.map_type == MapType::Picker && m.noremap
        ));
    }

    #[test]
    fn test_cnoremap() {
        let rc = parse_quarkrc("cnoremap <Tab> complete");
        assert_eq!(rc.errors.len(), 0);
        assert!(matches!(
            &rc.directives[0],
            RcDirective::Map(m) if m.map_type == MapType::Command && m.noremap
        ));
    }

    #[test]
    fn test_vnoremap() {
        let rc = parse_quarkrc("vnoremap d yank-delete");
        assert_eq!(rc.errors.len(), 0);
        assert!(matches!(
            &rc.directives[0],
            RcDirective::Map(m) if m.map_type == MapType::Visual && m.noremap
        ));
    }

    // --- regular (non-noremap) map variants ---

    #[test]
    fn test_imap() {
        let rc = parse_quarkrc("imap jk mode-normal");
        assert_eq!(rc.errors.len(), 0);
        assert!(matches!(
            &rc.directives[0],
            RcDirective::Map(m) if m.map_type == MapType::Insert && !m.noremap
        ));
    }

    #[test]
    fn test_cmap() {
        let rc = parse_quarkrc("cmap <Up> history-prev");
        assert_eq!(rc.errors.len(), 0);
        assert!(matches!(
            &rc.directives[0],
            RcDirective::Map(m) if m.map_type == MapType::Command && !m.noremap
        ));
    }

    #[test]
    fn test_vmap() {
        let rc = parse_quarkrc("vmap y yank");
        assert_eq!(rc.errors.len(), 0);
        assert!(matches!(
            &rc.directives[0],
            RcDirective::Map(m) if m.map_type == MapType::Visual && !m.noremap
        ));
    }

    // --- Error handling for malformed lines ---

    #[test]
    fn test_set_without_name_is_error() {
        let rc = parse_quarkrc("set");
        assert_eq!(rc.errors.len(), 1);
        assert!(rc.errors[0].message.contains("'set' requires"));
    }

    #[test]
    fn test_source_without_path_is_error() {
        let rc = parse_quarkrc("source");
        assert_eq!(rc.errors.len(), 1);
        assert!(rc.errors[0].message.contains("'source' requires"));
    }

    #[test]
    fn test_colorscheme_without_name_is_error() {
        let rc = parse_quarkrc("colorscheme");
        assert_eq!(rc.errors.len(), 1);
        assert!(rc.errors[0].message.contains("'colorscheme' requires"));
    }

    #[test]
    fn test_unmap_without_key_is_error() {
        let rc = parse_quarkrc("nunmap");
        assert_eq!(rc.errors.len(), 1);
    }

    #[test]
    fn test_let_without_equals_is_error() {
        let rc = parse_quarkrc("let myvar");
        assert_eq!(rc.errors.len(), 1);
        assert!(rc.errors[0].message.contains("'let' requires"));
    }

    #[test]
    fn test_error_includes_line_number() {
        let rc = parse_quarkrc("nmap j nav-left\nnotacommand foo\nset x=1");
        assert_eq!(rc.errors.len(), 1);
        assert_eq!(rc.errors[0].line_number, 2);
    }

    #[test]
    fn test_error_includes_original_line() {
        let rc = parse_quarkrc("notacommand foo bar");
        assert_eq!(rc.errors.len(), 1);
        assert_eq!(rc.errors[0].line.trim(), "notacommand foo bar");
    }

    #[test]
    fn test_multiple_errors_are_all_collected() {
        let rc = parse_quarkrc("bad1 x\nbad2 y\nbad3 z");
        assert_eq!(rc.errors.len(), 3);
    }

    // --- set boolean toggle (no =) ---

    #[test]
    fn test_set_bare_name_is_bool_true() {
        let rc = parse_quarkrc("set myoption");
        assert_eq!(rc.errors.len(), 0);
        assert!(matches!(
            &rc.directives[0],
            RcDirective::Set(s) if s.name == "myoption" && s.value == OptionValue::Bool(true)
        ));
    }

    #[test]
    fn test_set_false_value() {
        let rc = parse_quarkrc("set myoption=false");
        assert_eq!(rc.errors.len(), 0);
        assert!(matches!(
            &rc.directives[0],
            RcDirective::Set(s) if s.value == OptionValue::Bool(false)
        ));
    }

    #[test]
    fn test_set_negative_integer() {
        let rc = parse_quarkrc("set offset=-3");
        assert_eq!(rc.errors.len(), 0);
        assert!(matches!(
            &rc.directives[0],
            RcDirective::Set(s) if s.value == OptionValue::Integer(-3)
        ));
    }

    // --- collect_let_bindings ---

    #[test]
    fn test_collect_let_bindings() {
        let rc = parse_quarkrc("let mapleader = \" \"\nlet x = hello");
        let bindings = collect_let_bindings(&rc.directives);
        assert_eq!(bindings.get("mapleader"), Some(&" ".to_string()));
        assert_eq!(bindings.get("x"), Some(&"hello".to_string()));
    }

    // --- unmap all types ---

    #[test]
    fn test_iunmap() {
        let rc = parse_quarkrc("iunmap jk");
        assert_eq!(rc.errors.len(), 0);
        assert!(matches!(
            &rc.directives[0],
            RcDirective::Unmap(u) if u.map_type == MapType::Insert && u.key == "jk"
        ));
    }

    #[test]
    fn test_tunmap() {
        let rc = parse_quarkrc("tunmap k");
        assert_eq!(rc.errors.len(), 0);
        assert!(matches!(
            &rc.directives[0],
            RcDirective::Unmap(u) if u.map_type == MapType::Timeline
        ));
    }
}
