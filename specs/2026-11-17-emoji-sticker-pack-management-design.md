# Emoji & sticker pack management — design

Issue: #12 · Branch: `feat/emoji-pack-management` · Status: draft for approval

## Intent

Quark can read MSC2545 (`im.ponies.*`) custom emoji and sticker packs but not
change them, so anyone who wants a new emoji has to leave for another client
(Cinny, FluffyChat) to manage it. This adds management UI so a user can, without
leaving Quark:

- upload, view and manage emoji/stickers in their **personal pack** and in
  **room and space packs**;
- change an image's shortcode, delete it, and choose whether it is usable as an
  emoji, a sticker, or both;
- set a pack's name and icon;
- **favorite** a room or space pack so it shows in the pickers in every room,
  not only where it lives.

The issue says "servers"; that meant **spaces** (Discord vocabulary). A pack set
on a space is that space's pack.

## Goals

1. Global management in **Settings → Emoji**: the personal pack and the list of
   favorited packs.
2. Per-room management in a new **Emoji** tab of the Room dialog.
3. Per-space management in a new **Emoji** tab of Space settings.
4. **Space packs apply to the space's rooms**: a room's pickers and `:shortcode`
   autocomplete include the packs of every joined space that contains the
   room, directly or through subspaces. (Today only the current room's packs,
   the personal pack and favorites load.)
5. Edits never clobber concurrent edits made elsewhere, and never drop fields
   Quark does not understand.
6. Full compatibility with other MSC2545 clients: Quark writes only the
   standard shapes.

## Non-goals

- More than one personal pack. MSC2545 gives the account exactly one
  (`im.ponies.user_emotes`). A user who wants several keeps them in a private
  room and favorites them; the UI says so in one line.
- Copying images from one pack into another ("import"). Favoriting is how a pack
  from elsewhere becomes usable everywhere.
- Reordering images within a pack. `images` is a JSON object; order is not
  something clients agree on.
- Resizing, cropping or converting images. Uploaded files go up as they are.
- Sticker-picker widgets / integration managers.

## Anti-goals (a failure even if it "works")

- An edit overwriting a change another client, or another room admin, made
  while Quark's dialog was open.
- Dropping fields Quark doesn't model (`info`, `attribution`, other clients'
  extensions) when it writes a pack back.
- Offering an edit control the homeserver will refuse (e.g. editing a room pack
  without the power level for `im.ponies.room_emotes`). Same principle the Room
  dialog's moderation controls already follow.
- Writing a non-standard shape another client can't read.

## Constraints and facts

**Storage (MSC2545):**

| What | Where | Shape |
|---|---|---|
| Personal pack | account data `im.ponies.user_emotes` | one pack: `{ images, pack }` |
| Room / space pack | state `im.ponies.room_emotes`, state key = pack id (`""` is the default pack) | `{ images, pack }` |
| Favorites | account data `im.ponies.emote_rooms` | `{ rooms: { "<room id>": { "<state key>": {} } } }` |

A pack: `pack: { display_name?, avatar_url?, usage?, attribution? }`,
`images: { "<shortcode>": { url, body?, info?: { w, h, mimetype, size }, usage? } }`.
Image `usage` absent → inherits the pack's; pack `usage` absent → both
`emoticon` and `sticker`. `emoji.rs::parse_ponies_pack` already implements this
resolution.

**Existing code:**

- `src-tauri/src/matrix/emoji.rs` loads packs (personal, favorites, current room)
  and is read-only. `stickers.rs` filters the same packs to sticker usage.
- `src/app/actions/custom_emoji.ts` caches packs per room for the emoji picker
  and autocomplete; the sticker tab reads `getStickerPacks`. Both must drop
  their cached packs after any successful write so the pickers show the change.
- `emoji.rs` also accepts a non-standard `{ packs: { … } }` map inside
  `im.ponies.user_emotes`. Quark never writes that shape (see Decisions).
- Room state read through `Room::get_state_event(s)` comes from the **local
  store**, which only updates when the write echoes back through sync. It is
  therefore not a safe base for a read-modify-write.
- Settings-family dialogs: `Tab` cycles tabs (it does not move focus within a
  tab); fields save themselves through `settings/commit_field.ts`; tabs are
  modules registered in `settings/registry.ts` / `room/registry.ts`.
  `SpaceSettingsDialog` still hardcodes its two tabs in a `switch`.
- `grid_nav.ts` has the sectioned-grid movement the emoji picker uses.
- Uploading: `upload_media` takes a file **path** (desktop-only shape). Attachments
  already cross IPC as base64 (`AttachmentSend.dataBase64`); `set_avatar` uploads
  base64 image bytes.

**Media:** pack images are uploaded **unencrypted** even when managed from an
encrypted room — other clients fetch them by plain `mxc://` URL, and state
events are not encrypted anyway.

## Approaches considered

**A. Each edit is its own backend operation — chosen.** One Tauri command per
kind of edit. Each re-reads the pack **from the server** immediately before
writing, applies just that change to the raw JSON, writes it, and returns the
pack as written. Fields save themselves in the UI, matching the Room dialog's
Settings tab.
*Trade-off:* ~7 new commands (each with an `ipc/index.ts` wrapper and a
`mock.ts` mock). *Why chosen:* it is the only option that meets anti-goals 1
and 2; the project already hit the whole-copy overwrite bug once (the Settings
draft undoing a mute taken while it was open, see `NotificationConfig::with_preferences`).

**B. Frontend edits a whole copy and writes it back.** Two commands (read pack,
write pack). Rejected: a pack left open overwrites anything changed elsewhere in
the meantime, and preserving unknown fields falls to TypeScript.

**C. Draft + `[save]` per pack.** Rejected: same overwrite window as B, and the
project moved away from per-section save buttons (`commit_field.ts` header).

## Design

### Backend (`src-tauri/src/matrix/emoji.rs`, plus a `packs` submodule if it grows)

**Pack location** — every write command names its target with one enum,
serialised as a tagged object across IPC:

```
PackLocation = { kind: "user" }
             | { kind: "room", room_id, state_key }   // a space is a room
```

**Operations** (names indicative; final names are the builder's):

| Command | Change |
|---|---|
| `add_pack_images(location, images[])` | upload each `{ data_base64, mimetype, w, h, filename }`, then insert each under a unique shortcode; returns the pack plus the shortcode each image got |
| `rename_pack_image(location, from, to)` | move the entry to the new key; error if `to` exists or is invalid |
| `set_pack_image_usage(location, shortcode, usage \| null)` | set per-image `usage`; `null` removes it (inherit the pack's) |
| `set_pack_image_body(location, shortcode, body)` | description / alt text |
| `remove_pack_image(location, shortcode)` | delete the entry |
| `set_pack_meta(location, { display_name?, avatar_url?, usage? })` | patch `pack` only |
| `create_room_pack(room_id, display_name)` | new state key slugged from the name, unique in the room |
| `delete_room_pack(room_id, state_key)` | write `{}` (state can't be removed) and drop it from favorites |
| `set_pack_favorite(room_id, state_key, bool)` | patch `im.ponies.emote_rooms` |
| `get_pack_permissions(room_id)` | can the account send `im.ponies.room_emotes`? (power levels: `events["im.ponies.room_emotes"]`, else `state_default`) |

Rules every write follows:

- **Fresh read**: room state via `GET /rooms/{id}/state/im.ponies.room_emotes/{key}`
  (an HTTP request, not the store); account data via `fetch_account_data`, which
  already hits the server. 404 → empty pack.
- **Serialised per location**: a per-location async mutex, so two edits to the
  same pack in quick succession can't both read the pre-edit state.
- **Raw JSON patching** on `serde_json::Value`: only the touched key changes;
  everything else round-trips untouched.
- **Shortcodes**: no `:` and no whitespace; empty is invalid. On upload the
  shortcode comes from the filename stem, lower-cased, invalid characters → `_`,
  de-duplicated with `_2`, `_3`, ….
- **Pure core**: each patch is a pure function `(Value, args) -> Result<Value>`,
  unit-tested without a client; the command is the thin fetch-lock-patch-write
  wrapper.

**Loading changes** (`get_emoji_packs(room_id)`):

- Add packs from every **joined ancestor space** of the room, nearest first. The
  child → parent map comes from joined spaces' `m.space.child` state. Cycles are
  guarded.
- Each `EmojiPack` gains: `state_key` (room packs), `favorited: bool`, and
  `scope: "user" | "room" | "space" | "favorite"` so the UI and pickers can label
  where a pack comes from. A pack reachable two ways (e.g. the current space's
  pack is also favorited) is listed once, under its closest scope.
- **Shortcode precedence** when two packs share one: room → nearer space →
  farther space → personal → favorites (closest scope wins). This keeps today's
  behaviour (room beats personal) and extends it.
- New `get_room_packs(room_id)` for the management tabs: that room's own packs
  only (all state keys, including ones with no images yet), with `favorited`.

### Frontend

**One `PackEditor` component** (`src/ui/packs/PackEditor.ts`), mounted by all
three tabs, given a `PackLocation`, the pack, and whether it may edit:

```
── Blobs ─────────────────────────── [★ use in every room]
name  [Blobs________]   icon [▣]   default use [emoji+sticker ▾]

 ▣ blobhug   ▣ blobwave   ▣ blobcat   ▣ partyblob   [+ add images]
 ▣ blobsad   ▣ blobyes …

 selected: ▣ :blobwave:
   shortcode [blobwave____]  use [pack default ▾]  description [______]
   [delete]
```

- Pack fields and the selected image's fields are `commit_field` fields (save on
  Enter/blur/change, status line underneath, Esc reverts an edited field).
- Grid: thumbnails through `resolveEmojiThumbnail`; arrows / `h j k l` move
  (via `grid_nav`), `Enter` or click selects, `x` / `Delete` deletes after a
  `ConfirmDialog`. `Tab` keeps cycling dialog tabs.
- `[+ add images]`: a multi-select `<input type="file" accept="image/*">` (works
  on desktop and the Android/iOS webviews, as attachments do). The frontend reads
  each file's bytes, size, mimetype and pixel dimensions (`createImageBitmap`)
  and sends them in one `add_pack_images` call; a status line shows progress and
  per-file failures. New images inherit the pack's default use.
- Icon: pick one of the pack's images, or upload one.
- Without edit permission: the same grid read-only, plus the favorite toggle
  (favoriting needs no room power).
- After any successful write: render from the returned pack, and invalidate the
  custom-emoji and sticker caches.

**Settings → Emoji** (existing tab; autocomplete settings stay at the top):

- *Your pack* — `PackEditor` on `{ kind: "user" }`, with the one-line note about
  using a private room for more packs.
- *Favorite packs* — each favorited pack: icon, name, where it lives (room/space
  name), image count, `[remove]`. An entry for a room the account has left shows
  as "not joined" and can still be removed.

**Room dialog → Emoji tab** and **Space settings → Emoji tab** — one shared tab
module: the room's packs, each a `PackEditor`; `[new pack]` when permitted.

**Space settings onto the tab registry.** `SpaceSettingsDialog`'s hardcoded
`switch` gains a third case otherwise. Move General and Children into tab
modules under `src/ui/space/tabs/` with a `SPACE_TABS` registry using the
existing `RoomTab` contract (a space is a room), so the Emoji tab is one
registry entry shared with the Room dialog. `SettingsDialog`, `RoomDialog` and
`SpaceSettingsDialog` then share near-identical host code (tab rail, `Tab`
cycling, mobile list/detail); extracting a common tabbed-dialog base is
encouraged if it falls out naturally, but is not required.

### Docs

DESIGN.md: rewrite the "Pack management UI" bullets under Custom Emoji &
Stickers to describe what shipped; add the space-pack loading and precedence
rules; add the Emoji tab to the Room dialog and Space settings descriptions and
update the Settings → Emoji row.

## Decisions (mine — flag any you disagree with)

1. Space packs include **all** joined ancestor spaces, not only the immediate
   parent.
2. Shortcode precedence: room → nearer space → farther space → personal →
   favorites.
3. Usage is settable both per pack (default) and per image (override).
4. Deleting a room/space pack writes `{}` and unfavorites it; the personal pack
   can't be deleted, only emptied.
5. Uploads are not resized or converted.
6. The non-standard `{ packs: {…} }` form of `im.ponies.user_emotes` is still
   read, shown read-only, and left untouched; edits go to the standard
   top-level `{ images, pack }`.
7. Grid keys: arrows/`hjkl`, `Enter`, `x`/`Delete`; `Tab` stays tab-cycling.

## Left to the builder

Command names and module split; exact IPC payload shapes; the editor's CSS
within the existing `settings-dialog__*` look; whether to extract the shared
tabbed-dialog base; test layout (Rust unit tests for the pure patches and the
ancestor walk; Vitest for `PackEditor`, the tabs and cache invalidation; mocks
in `src/ipc/mock.ts` so `pnpm dev` exercises the UI).

## Versioning

New user-visible feature → minor bump, once, when the branch is prepped for
merge (`version-bump` skill).
