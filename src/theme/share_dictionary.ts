// The preset dictionary for version-1 theme share strings. FROZEN — never edit.
//
// A version-1 share string is the theme TOML compressed with raw DEFLATE
// against this text (see encodeThemeShare in ./share.ts). Every theme shares
// its keys, layout and most values with this one, so a link shrinks from
// ~1,470 characters to ~250. The decoder needs the identical bytes to read a
// link: change one and every version-1 link anyone has ever shared breaks.
//
// It is Phosphor in canonical TOML as of the format's introduction, and it
// stays that way even if Phosphor, the schema, or themeToToml change — a new
// field just compresses a little less well. If the gap ever grows big enough
// to matter, add a version 2 with its own dictionary beside this one; decoders
// keep reading version 1.
//
// share.test.ts pins it with a link made by an independent encoder (zlib).

export const SHARE_DICTIONARY_V1 = `[meta]
name = "Phosphor"
author = "quark"
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
reply_border = "#00aaff"
thread_indicator = "#00aaff"

[colors.roomlist]
active_bg = "#1a1a1a"
active_fg = "#00ff41"
unread = "#ffffff"
mention_badge = "#ff3333"
muted = "#444444"

[colors.reactions]
background = "#0a0a0a"
border = "#333333"
own_bg = "#1a3a1a"
count = "#888888"

[typography]
font_family = "JetBrains Mono, Fira Code, monospace"
font_size = 14
line_height = 1.5
message_spacing = 4

[borders]
style = "rounded"
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
`;
