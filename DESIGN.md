# Quark — A CLI-Styled Matrix Client

The authoritative spec and reference for Quark: architecture, UI layout, Matrix
feature support, the vim keybinding config syntax (`quarkrc`), theming (TOML
structure), and config files. Read it before implementing a new feature.

Work — bugs, features, and release QA — is tracked in
[GitHub issues](https://github.com/mcplummet/quark/issues), not in this file.

## Overview

Quark is a keyboard-driven, CLI-aesthetic Matrix client that renders in a GUI window (not a raw terminal) to support inline images, custom emoji, and stickers. It uses vim-style navigation throughout and offers deep theme customization.

---

## Architecture

### Stack: Tauri v2 + matrix-sdk (Rust) + Web Frontend

```
┌─────────────────────────────────────┐
│        Web Frontend (TypeScript)    │
│   Monospace / terminal-styled UI    │
│   Renders HTML, images, emoji       │
├─────────────────────────────────────┤
│          Tauri v2 IPC Bridge        │
├─────────────────────────────────────┤
│         Rust Backend (Core)         │
│   matrix-sdk  ·  Vodozemac E2EE     │
│   Sliding Sync  ·  Media cache      │
└─────────────────────────────────────┘
```

**Why Tauri over Electron?** ~10x smaller binary, ~3-5x less RAM. The Rust backend uses `matrix-sdk` directly — the same SDK powering Element X — giving us best-in-class E2EE, Sliding Sync, and protocol coverage without FFI wrappers.

**Why not a real TUI?** Inline custom emoji (`<img data-mx-emoticon>`) and stickers require rendering images inline with text flow. Terminal image protocols (Sixel/Kitty) can't do this reliably across terminals. The CLI aesthetic is achieved purely through CSS (monospace fonts, dark background, prompt-style input).

### Backend (Rust)

The backend handles all Matrix protocol interaction and exposes commands to the frontend via Tauri's IPC.

**Crates:**
- `matrix-sdk` — client, sync, room operations, E2EE (Vodozemac), Sliding Sync
- `matrix-sdk-crypto` — cross-signing, key backup, device verification
- `tauri` — windowing, IPC, system tray, file dialogs
- `serde` / `serde_json` — serialization
- `tokio` — async runtime
- `directories` — XDG-compliant config/data paths

**Responsibilities:**
- Login (OIDC via MAS + legacy password fallback)
- Sliding Sync room list management & subscriptions
- Sending/receiving messages, reactions, edits, redactions
- E2EE: device verification (SAS emoji, QR), key backup, cross-signing
- Media download/upload with authenticated media (MSC3916)
- Custom emoji/sticker pack resolution (MSC2545)
- Theme file loading and validation
- Local encrypted database — matrix-sdk SQLite store opened with a keyring-held passphrase; store key + session in the OS keyring (`secrets.rs`)

### Frontend (TypeScript)

A single-page app styled as a terminal interface. No framework required initially — vanilla TS + a lightweight reactive layer (Preact or Solid) if needed.

**Responsibilities:**
- Rendering the message timeline (text, images, replies, threads, reactions, custom emoji, stickers)
- Vim-mode input handling and command bar
- Emoji/sticker picker (keyboard-navigable)
- Theme application from user config
- Room list, member list, space hierarchy display

---

## UI Design

### Layout

```
┌────┬───────────┬──────────────────────────────┐
│    │           │ #general · 42 members         │
│ S  │  Rooms    ├──────────────────────────────┤
│ P  │           │                               │
│ A  │  #general │ <alice> hey check this out    │
│ C  │  #dev     │ <alice> :custom_emoji:  ← img │
│ E  │  #random  │ <bob> ┊ replying to alice     │
│ S  │  #off-top │ <bob> ┊ nice!                 │
│    │           │ <carol> [sticker: partyblob]  │
│ 🌐 │  ──────── │ ─── reactions: 🎉 3  :cool: 2 │
│ 🎮 │  DMs      │                               │
│ 🏠 │  @friend  │ :> I love :parti|             │
│    │           │ ┌────────────────┐            │
│    │           │ │ 🎉 :partyblob: │ ← preview  │
│    │           │ │ 🥳 :partytime: │            │
│    │           │ └────────────────┘            │
└────┴───────────┴──────────────────────────────┘
```

All panels, borders, and text use monospace rendering. Colors, borders, and glyph styles are controlled by themes.

### Spaces (Cinny-Style)

The room list has a two-column layout inspired by Cinny:

**Left strip — Space selector:**
- Narrow vertical strip showing space icons (avatar images or first-letter fallback)
- A "Home" icon at the top for rooms not in any space, and a "DMs" icon
- Spaces display their avatar/icon; this is the only place icons appear in the room list
- `j/k` (or rebound keys) to navigate spaces, `Enter` to select
- Selecting a space filters the room list to show only that space's children
- Each space remembers its own last-active chat: switching to a space loads that
  chat into the timeline (or its first room on first visit), so the timeline
  never lingers on a room from the space you just left. Memory is session-only.

**Right column — Room list (text only, no icons):**
- Rooms listed by name in a **fixed, deterministic order** (not sorted by activity):
  - Order follows the `m.space.child` state event `order` field if set
  - Fallback: alphabetical by room name
  - User can pin rooms to top via `:pin` command
- No room avatars or icons — text only, matching the CLI aesthetic
- Unread indicators via color (theme-configurable) and optional badge count
- Nested spaces shown as indented sections with collapsible headers
- Categories/sections within a space rendered as visual dividers (using `m.space.child` ordering)

This mirrors Cinny's approach: spaces have visual identity through icons, but the channel list itself is clean text in a stable order, so rooms don't jump around based on activity.

### Vim-Style Navigation

**Modes:**
- **Normal** — navigate rooms, scroll messages, select items
- **Insert** — compose messages in the input bar
- **Command** — `:` prefix for client commands
- **Visual** — select text/messages for quoting or copying

**Key bindings (defaults, all rebindable via quarkrc — see below):**

| Context       | Key           | Action                        |
|---------------|---------------|-------------------------------|
| Global        | `i`           | Enter insert mode             |
| Global        | `Esc`         | Return to normal mode         |
| Global        | `:`           | Open command bar              |
| Room list     | `j/k`         | Move down/up                  |
| Room list     | `Enter`       | Open room                     |
| Room list     | `/`           | Search/filter rooms           |
| Room list     | `gs`          | Go to spaces view             |
| Timeline      | `j/k`         | Scroll down/up                |
| Timeline      | `g/G`         | Jump to top/bottom            |
| Timeline      | `r`           | Reply to selected message     |
| Timeline      | `e`           | React to selected message     |
| Timeline      | `t`           | Open/enter thread             |
| Timeline      | `dd`          | Redact own message            |
| Timeline      | `E` / `c`     | Edit own message              |
| Insert        | `Ctrl-e`      | Open emoji/sticker picker     |
| Insert        | `Ctrl-g`      | Open GIF search               |
| Insert        | `Tab`         | Autocomplete :shortcode:      |
| Picker        | `j/k/h/l`     | Navigate grid                 |
| Picker        | `Enter`       | Select emoji/sticker/GIF      |
| Picker        | `/`           | Search within picker          |
| Picker        | `Tab`         | Switch emoji ↔ sticker ↔ GIF  |

**Compose box ↔ timeline:** with a draft in the compose box, `Esc` drops into
Normal-mode editing of the draft (vim motions/operators on the text). The
compose box then behaves like the message just below the timeline — pressing the
up key (`k`) on the draft's first line moves focus up into the timeline, and the
down key (`j`) past the last message drops back into the draft (caret at the
top). `i` resumes editing. An empty compose box is left untouched by `j` at the
bottom of the timeline; press `i` to start composing.

### Keybinding Configuration (quarkrc)

Keybindings are configured via `~/.config/quark/quarkrc`, using a vimrc-inspired syntax. This file is sourced on startup and on `:source` command.

```vim
" ~/.config/quark/quarkrc

" Remap navigation to ijkl (scandalous but valid)
nmap i     mode-insert
nmap j     nav-left
nmap k     nav-down
nmap l     nav-up        " yes, really
nmap ;     nav-right

" Context-scoped mappings
tmap k     scroll-down          " timeline: scroll down
tmap l     scroll-up            " timeline: scroll up
rmap k     room-next            " room list: next room
rmap l     room-prev            " room list: prev room
pmap k     picker-down          " picker: move down
pmap l     picker-up            " picker: move up
pmap j     picker-left          " picker: move left
pmap ;     picker-right         " picker: move right

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

" Set options (like :set in vim)
set scrolloff=5               " keep 5 messages visible above/below cursor
set shortcode_preview=true    " show emoji preview while typing :shortcode:
set gif_provider=tenor        " tenor | giphy
set gif_rating=pg             " g | pg | pg-13 | r
set home_dm_limit=12          " chats shown on the Home canvas
```

**Map command syntax:**
- `nmap` — normal mode mapping
- `imap` — insert mode mapping
- `tmap` — timeline-scoped mapping (normal mode, timeline focused)
- `rmap` — room list-scoped mapping (normal mode, room list focused)
- `pmap` — picker-scoped mapping (emoji/sticker/GIF picker)
- `cmap` — command mode mapping
- `vmap` — visual mode mapping
- `nunmap`, `iunmap`, etc. — remove a mapping
- `noremap` variants (`nnoremap`, etc.) — non-recursive mappings

Scoped maps (`tmap`, `rmap`, `pmap`) take precedence over global `nmap` when that panel is focused. This allows the same key to do different things depending on context.

**quarkrc also supports:**
- `source <path>` — include another rc file
- `colorscheme <name>` — shorthand for `:theme`
- `set <option>=<value>` — set config options inline
- `" comments` — lines starting with `"` are ignored
- `autocmd` — hooks for events (e.g., `autocmd RoomEnter * set scrolloff=3`)

### Commands

```
:join #room:server.org       Join a room
:leave                       Leave current room
:topic <text>                Set room topic
:invite @user:server.org     Invite user
:verify                      Start device verification
:upload <path>               Upload file/image
:theme <name>                Switch theme
:keys                        Show/edit keybindings
:stickers                    Browse sticker packs
:emoji                       Manage emoji packs
:gif <query>                 Search and send a GIF
:search [query]              Search messages in the current room
:source <path>               Reload quarkrc or source a file
:roomsettings                Open room settings (name/topic/access/permissions)
:spacesettings               Open space settings (name/topic/children)
:debug                       Open debug viewer for current room state events
:debug $eventId              Open debug viewer for a specific event
:version                     Show the current app version
```

### Settings Dialog

Opened via `:settings` or the settings UI affordance. The dialog has eight tabs, rendered in this order:

| Tab | Contents |
|-----|----------|
| **General** | Theme selector, notification toggles, send-key behaviour, read-receipt toggles, confirm-redact toggle |
| **Account** | Devices & Verification — see below |
| **Media** | Image auto-load, max dimensions, cache-size limit |
| **GIF** | Provider (Tenor / Giphy / Klipy), API key, content rating |
| **Emoji** | Shortcode autocomplete toggle, minimum-character threshold |
| **Notifications** | Quiet-hours window, per-room mute list |
| **Themes** | Theme picker and hot-reload path |
| **About** | App version, Quark on GitHub link, Updates section (desktop only — see below) |

The tab strip never scrolls horizontally; long option text is constrained within each tab's panel.

#### Account tab — Devices & Verification

- **Session list** — all devices registered on the account, each showing: display name, last-seen timestamp + IP address, and a trust badge (verified / unverified / unknown).
- **Rename device** — edit the display name of your current device or any other session.
- **Remove session** — delete another device; requires password re-authentication (UIAA).
- **Verify another user** — enter a `@user:server` Matrix ID to initiate SAS emoji verification with that user's device.
- **Reset cross-signing** — regenerates cross-signing keys; requires password re-authentication (UIAA).
- **Key backup status** — read-only line showing whether backup is enabled and whether a backup exists on the server (`Backup: enabled/disabled · on server: yes/no`). Enabling or restoring key backup from the settings UI is not yet supported.
- **Prompt to verify on startup** — toggle (moved here from General).
- **Log out** — ends the current session and returns to the login screen.

#### About tab

Shows the running app version, a "Quark on GitHub" link (opens in the system browser), and the **Updates** section. The Updates section (release channel dropdown + auto-check toggle) is shown on **desktop only**; it is hidden on mobile, where in-app updates are not supported.

---

## Matrix Feature Support

### Core Protocol
- [x] Login: OIDC (MAS) + legacy password + SSO
- [x] Sliding Sync (MSC4186) — native, no proxy
- [x] E2EE: Megolm via Vodozemac, cross-signing, key backup (SSSS)
- [x] Device verification: SAS emoji, QR code
- [x] Room creation, join, leave, invite, kick, ban
- [x] Room directory & federated room search
- [x] In-room message search — header search box (`:search`) with four tiers: loaded window (instant) · local cache (matrix-sdk event cache, offline) · back-to-date · entire history. Server tiers stream results one page at a time (bounded memory) and are cancelable.
- [x] Spaces: hierarchy display, space-scoped room lists, restricted joins
- [x] Threads (m.thread relation)
- [x] Rich replies (m.in_reply_to)
- [x] Reactions (m.annotation) — Unicode + custom emoji
- [x] Message editing & redaction
- [x] Read receipts (public m.read + private m.read.private) — displayed Element-style as shifting, overlapping avatars at the bottom-right of each other user's last-read message (seeded on room open via `get_room_receipts`, updated live). Settings toggles: "send my read receipts" (private-only when off) and "show others' read receipts".
- [x] Typing indicators
- [x] Presence (when homeserver enables it)
- [x] Authenticated media (MSC3916)
- [x] Room summary previews (MSC3266)

### Custom Emoji & Stickers (MSC2545 — im.ponies)

Full compatibility with Cinny, FluffyChat, Nheko, and SchildiChat.

**Pack sources:**
- `im.ponies.room_emotes` — room state events (per-room packs)
- `im.ponies.user_emotes` — account data (personal packs)
- Packs distinguish emoji (`usage: ["emoticon"]`) from stickers (`usage: ["sticker"]`)

**Sending custom emoji in messages:**
- User types `:shortcode:` → autocomplete resolves from available packs
- Sent as `formatted_body` HTML: `<img data-mx-emoticon height="32" src="mxc://..." alt=":shortcode:" title=":shortcode:" />`
- Plain `body` contains `:shortcode:` as fallback
- Format field: `org.matrix.custom.html`

**Sending stickers:**
- Sticker picker (keyboard-navigable grid) sourced from packs with `usage: ["sticker"]`
- Sent as `m.sticker` event with `url` (mxc://), `body`, and `info` (mimetype, dimensions, thumbnail)
- Rendered in timeline at larger size than emoji, standalone (not inline with text)

**Custom emoji in reactions:**
- Reaction key is `:shortcode:`
- Client resolves the mxc:// URL from loaded packs for display
- Falls back to text `:shortcode:` if pack not available

**Custom emoji in replies:**
- Reply preview renders custom emoji images inline
- `<mx-reply>` fallback contains `:shortcode:` text

**Pack management UI:**
- View available packs (room + personal)
- Create/edit personal packs (set state on account data)
- Create/edit room packs (if user has state event permissions)
- Import packs from other rooms

### GIF Search

Discord-style integrated GIF search, accessible from insert mode or command bar.

**Providers (configurable in quarkrc):**
- Tenor (default) — `set gif_provider=tenor`
- Giphy — `set gif_provider=giphy`
- Klipy — `set gif_provider=klipy`
- Content rating filter: `set gif_rating=pg` (g / pg / pg-13 / r)

**UX flow:**
1. User presses `Ctrl-g` (insert mode) or runs `:gif <query>`
2. A search overlay appears with a text input and a grid of GIF thumbnails
3. Thumbnails are animated previews (low-res for performance)
4. Navigate grid with `j/k/h/l`, search with `/`, send with `Enter`
5. `Tab` to load more results, `Esc` to dismiss
6. Selected GIF is uploaded to the homeserver as media and sent as an `m.image` event with `info.mimetype: "image/gif"` — this avoids linking to external URLs that may break or track users

**Backend:**
- Rust backend handles API calls to Tenor/Giphy/Klipy (API keys stored in config)
- Downloads selected GIF, uploads to homeserver via media API
- Caches recent search results and thumbnails locally

### Emoji Shortcode Preview

When the user types `:` followed by characters in insert mode, an inline autocomplete popup appears:

```
:> I think this is :aweso|
  ┌──────────────────────────┐
  │ 😎  :awesome:            │  ← Unicode emoji
  │ [img] :awesome_face:     │  ← Custom emoji (shows image)
  │ 🌟  :awesome_star:       │
  └──────────────────────────┘
```

- Each row shows the emoji **image or glyph** alongside the `:shortcode:`
- Custom emoji display their actual `mxc://` image thumbnail (small, inline)
- Unicode emoji display the native glyph
- List updates as user types, fuzzy-matched against all available packs
- `Tab` / arrow keys to select, `Enter` to insert, `Esc` to dismiss
- Triggered after `shortcode_min_chars` characters (default: 2, configurable via `set shortcode_min_chars=2` in quarkrc)
- Sources: Unicode emoji database + `im.ponies.user_emotes` + `im.ponies.room_emotes` from current room

### Media Handling
- Authenticated media download via `/_matrix/client/v1/media/download/`
- Inline image previews in timeline (configurable max dimensions)
- Inline video playback — `m.video` plays inline and seekable: a loopback HTTP server (Range requests) on Linux/WebKitGTK, the asset protocol on macOS/Windows/iOS; graceful fallback to the external player on decode failure
- Sticker rendering (larger than emoji, centered)
- Image uploads with thumbnail generation
- Blurhash placeholders during loading
- Media cache on disk with configurable size limit

### Not in Scope (v1)
- VoIP / MatrixRTC (group calls) — fundamentally incompatible with CLI aesthetic
- Widgets — no iframe support in terminal-styled UI
- Mobile targets — Tauri v2 supports them, but defer to future

---

## Theming

Themes are TOML files stored in `~/.config/quark/themes/`. The active theme is set in `~/.config/quark/config.toml`.

### Theme File Structure

```toml
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
message_spacing = 4           # px between messages

[borders]
style = "single"              # single | double | rounded | ascii | none
room_list_width = "25%"

[emoji]
size = 32                     # px, inline custom emoji height
sticker_max_size = 256        # px, max sticker dimension
reaction_size = 20            # px, emoji in reaction bar

[prompt]
symbol = ":>"                 # input prompt glyph
normal_indicator = "NOR"      # mode indicator in normal mode
insert_indicator = "INS"
command_indicator = "CMD"
visual_indicator = "VIS"
```

### Built-in Themes
- **Phosphor** — green-on-black CRT terminal
- **Amber** — amber phosphor CRT
- **Dracula** — based on Dracula color scheme
- **Nord** — based on Nord palette
- **Solarized Dark / Light**
- **Catppuccin Mocha / Latte**
- **Gruvbox Dark**
- **High Contrast** — accessibility-focused

### Theme Hot-Reloading
Themes reload on file save (watched via `notify` crate / filesystem events passed through Tauri). No restart required.

---

## Configuration

`~/.config/quark/config.toml`:

```toml
[general]
theme = "phosphor"
notifications = true
confirm_redact = true
send_key_behavior = "auto"    # auto | enter | newline — what the Enter key does
                              #   auto:    send on desktop, newline on mobile
                              #   enter:   always send (Shift+Enter inserts a newline)
                              #   newline: always newline (send via button / Ctrl·Cmd+Enter)
                              # A dedicated send button appears on mobile, or whenever
                              # Enter won't send. Also: `:set send_key_behavior=…` and
                              # Settings → General → Input.

[sync]
sliding_sync = true           # use Sliding Sync (MSC4186)
timeline_limit = 50           # initial messages to load per room

[media]
auto_load_images = true
max_image_width = 600
max_image_height = 400
sticker_max_size = 256
cache_size_mb = 500

[gif]
provider = "tenor"            # tenor | giphy
api_key = ""                  # user provides their own API key
rating = "pg"                 # g | pg | pg-13 | r
cache_results = true

[emoji]
shortcode_autocomplete = true
autocomplete_min_chars = 2    # chars before autocomplete triggers

[home]
dm_limit = 12                 # chats shown on the Home canvas

[cache]
image_memory_mb = 150         # in-memory cap for decoded message images
timeline_rooms = 30           # rooms kept in memory for instant re-open

[updater]
channel = "stable"            # stable | beta — which release channel to follow
auto_check = true             # check for an update shortly after sync starts

# Keybindings are configured in ~/.config/quark/quarkrc (see Keybinding Configuration)
# NOT in this file — quarkrc uses vimrc-style syntax for full flexibility
```

---

## Auto-update

Desktop builds update themselves in-app over two release channels:

- **stable** — final tags only (`vX.Y.Z`).
- **beta** — early releases (`vX.Y.Z-beta.N`) *and* every stable release.

A release feeds the channels by tag shape: a final tag (`v1.2.3`) publishes to **both** stable and beta; a pre-release (`v1.2.3-beta.4`) publishes to **beta only**. Each channel is a static manifest served from the project site:

```
https://quark.tel/updates/stable/latest.json
https://quark.tel/updates/beta/latest.json
```

The manifest follows Tauri's static-update schema (`version`, `pub_date`, and a `platforms` map of `{ signature, url }` keyed by target triple). Update payloads are signed with a minisign key; the public key is embedded in the app, so a tampered or unsigned bundle is rejected.

### UX — notify and confirm

Quark never installs silently. When `auto_check` is on, it checks the configured channel a few seconds after sync starts; `:update` runs the same check on demand. If an update is available, a non-modal banner offers **Install & restart** (downloads, installs, and relaunches) or **Later** (dismisses — the same version won't re-nag until you run `:update` again). A failed download leaves the offer in place so it can be retried.

### Configuration

The `[updater]` section (above) holds the prefs; both are also editable live:

- `:set update_channel=stable|beta`
- `:set auto_update=true|false`
- Settings → About → **Updates** (channel dropdown + auto-check toggle; desktop only — hidden on mobile).

### Platform scope

In-app update covers the **AppImage** (Linux x86_64), the **`.app`** (macOS Apple-Silicon / `aarch64` only), and the **NSIS `-setup.exe`** (Windows x86_64). `.deb`/`.rpm`/Flatpak/Android builds update through their own package channels, not this updater. macOS auto-update is best-effort until Apple notarization is configured (Gatekeeper may still warn on a freshly downloaded build).

---

## Project Structure

```
quark/
├── src-tauri/                # Rust backend
│   ├── src/
│   │   ├── main.rs           # Tauri entry point
│   │   ├── matrix/           # Matrix client logic
│   │   │   ├── client.rs     # Login, sync, session management
│   │   │   ├── rooms.rs      # Room operations
│   │   │   ├── timeline.rs   # Message timeline handling
│   │   │   ├── threads.rs    # Thread support
│   │   │   ├── reactions.rs  # Reactions (Unicode + custom emoji)
│   │   │   ├── emoji.rs      # MSC2545 pack resolution
│   │   │   ├── stickers.rs   # Sticker pack handling & sending
│   │   │   ├── media.rs      # Authenticated media, cache
│   │   │   ├── crypto.rs     # E2EE, verification, key backup
│   │   │   └── spaces.rs     # Space hierarchy
│   │   ├── gif/              # GIF search integration
│   │   │   ├── mod.rs
│   │   │   ├── tenor.rs      # Tenor API client
│   │   │   ├── giphy.rs      # Giphy API client
│   │   │   └── klipy.rs      # Klipy API client
│   │   ├── config/           # Config & theme loading
│   │   │   ├── mod.rs
│   │   │   ├── theme.rs      # Theme parsing, validation
│   │   │   └── quarkrc.rs    # vimrc-style keybinding parser
│   │   └── commands.rs       # Tauri IPC command handlers
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                      # Web frontend
│   ├── index.html
│   ├── main.ts               # Entry point, Tauri IPC bindings
│   ├── ui/
│   │   ├── App.ts            # Root layout (room list + timeline + input)
│   │   ├── ModalManager.ts   # Open-overlay registry (replaces isVisible switchyards)
│   │   ├── DialogBase.ts     # Shared dialog chrome: overlay, header, Esc, form rows
│   │   ├── PickerBase.ts     # Shared picker overlay + keymap-driven SelectionList
│   │   ├── RoomList.ts       # Room list panel
│   │   ├── Timeline.ts       # Message rendering
│   │   ├── MessageRow.ts     # Single message (text, images, emoji)
│   │   ├── ReplyPreview.ts   # Inline reply rendering
│   │   ├── ThreadView.ts     # Thread timeline
│   │   ├── Reactions.ts      # Reaction bar
│   │   ├── Input.ts          # Compose bar with mode indicator
│   │   ├── EmojiPicker.ts    # Keyboard-navigable emoji/sticker picker
│   │   ├── StickerPicker.ts  # Sticker grid browser
│   │   ├── GifPicker.ts      # GIF search overlay
│   │   ├── ShortcodePreview.ts # Inline emoji preview popup
│   │   ├── MemberList.ts     # Room member sidebar
│   │   └── Verification.ts   # SAS/QR verification UI
│   ├── vim/
│   │   ├── mode.ts           # Mode state machine
│   │   ├── keybindings.ts    # Keymap resolution
│   │   └── commands.ts       # : command parser
│   ├── theme/
│   │   ├── loader.ts         # Apply theme from backend
│   │   └── vars.css          # CSS custom properties
│   └── style/
│       └── base.css          # Monospace terminal base styles
├── themes/                   # Built-in theme files
│   ├── phosphor.toml
│   ├── amber.toml
│   ├── dracula.toml
│   └── ...
└── README.md
```
