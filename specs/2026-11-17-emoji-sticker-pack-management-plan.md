# Emoji & Sticker Pack Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manage MSC2545 emoji/sticker packs from Quark — personal pack and favorites in Settings → Emoji, room packs in the Room dialog, space packs in Space settings — and make space packs apply to the space's rooms.

**Architecture:** A new backend module `matrix/packs.rs` owns pack writes: one Tauri command per kind of edit, each re-reading the pack from the server, patching the raw JSON with a pure function, and writing it back under a per-pack lock, with a short-lived overlay so reads see a write before sync echoes it. `matrix/emoji.rs` loading gains joined ancestor spaces and a precedence order. On the frontend, one `PackEditor` component is mounted by a shared Emoji tab (Room dialog + Space settings, both hosted by a `RoomTabsDialog` base extracted from `RoomDialog`) and by Settings → Emoji. Pickers and the outgoing formatter switch to a per-room shortcode map with first-wins dedupe.

**Tech Stack:** Rust (matrix-sdk 0.9, ruma-client-api 0.20, serde_json, tokio), TypeScript vanilla DOM, Vitest + jsdom.

**Spec:** `specs/2026-11-17-emoji-sticker-pack-management-design.md`

## Global Constraints

- Branch `feat/emoji-pack-management`; commit per task; minor version bump once at merge prep (`version-bump` skill).
- Write only standard MSC2545 shapes: personal pack = top-level `{ images, pack }` in `im.ponies.user_emotes`; room/space pack = `im.ponies.room_emotes` state, state key = pack id; favorites = `im.ponies.emote_rooms` `{ rooms: { "<room>": { "<state key>": {} } } }`.
- Every write: fresh read from the server (not the store) → pure patch on `serde_json::Value` → write; serialised per pack location; unknown fields round-trip untouched.
- Shortcodes Quark creates or accepts on rename match `^[A-Za-z0-9_+-]+$` — the same set the outgoing formatter recognises (`SHORTCODE_RE` in `src/app/actions/context.ts`).
- Precedence (first wins): current room's packs → nearer joined ancestor space → farther → personal → favorites.
- New Tauri command checklist (CLAUDE.md): handler in `commands.rs`, registered in `lib.rs`, wrapper in `src/ipc/`, mock in `src/ipc/mock.ts`, types in `src/ipc/types.ts`.
- `cargo test` runs under `RUSTFLAGS=-Dwarnings`: no new rustc warnings.
- Settings-family dialogs: `Tab` cycles tabs; fields save themselves (`commit_field.ts`); within-tab keyboard movement is out of scope (#156).
- Pack images upload unencrypted (`client.media().upload`), regardless of room encryption.

## Review Focus

1. A pack edited in Quark while another client changed a *different* image in the same pack: the other change survives. Test in Task 2 (`patch preserves unknown and untouched keys`) plus the fresh-read rule.
2. Two quick edits to one pack (rename, then usage) before sync echoes: the second keeps the first. Test in Task 2 (`overlay serves the last write until the store catches up`).
3. A room member without power for `im.ponies.room_emotes` sees no edit controls (but can favorite). Test in Task 7.
4. A space pack's shortcode does not turn into an image in a room outside that space. Test in Task 5.
5. Uploading a file whose name is all invalid characters, or collides with an existing shortcode, yields a valid unique shortcode. Test in Task 1.

---

### Task 1: Pure pack patching (Rust)

**Files:**
- Create: `src-tauri/src/matrix/packs.rs` (pure section + `#[cfg(test)] mod tests`)
- Modify: `src-tauri/src/matrix/mod.rs` (add `pub mod packs;`)

**Interfaces — Produces** (all `pub`, pure, operating on the pack *content* JSON — `{ images, pack }`; a missing/non-object input is treated as `{}`):
```rust
pub fn is_valid_shortcode(s: &str) -> bool;                       // ^[A-Za-z0-9_+-]+$
pub fn shortcode_from_filename(filename: &str, taken: &HashSet<String>) -> String;
pub struct NewImage { pub url: String, pub body: Option<String>, pub info: Value /* {w,h,mimetype,size}, may be Null */, pub filename: String }
pub fn add_images(pack: &Value, images: &[NewImage]) -> (Value, Vec<String> /* shortcodes assigned, in order */);
pub fn rename_image(pack: &Value, from: &str, to: &str) -> Result<Value, String>;
pub fn set_image_usage(pack: &Value, shortcode: &str, usage: Option<&[String]>) -> Result<Value, String>; // None removes the key
pub fn set_image_body(pack: &Value, shortcode: &str, body: Option<&str>) -> Result<Value, String>;      // None/"" removes
pub fn remove_image(pack: &Value, shortcode: &str) -> Result<Value, String>;
pub struct MetaPatch { pub display_name: Option<String>, pub avatar_url: Option<String>, pub usage: Option<Vec<String>> } // Some("")/Some(vec![]) removes the key
pub fn set_meta(pack: &Value, patch: &MetaPatch) -> Value;
pub fn set_favorite(emote_rooms: &Value, room_id: &str, state_key: &str, favorite: bool) -> Value;
pub fn is_favorite(emote_rooms: &Value, room_id: &str, state_key: &str) -> bool;
pub fn state_key_for_name(name: &str, taken: &HashSet<String>) -> String; // slug [a-z0-9_-], non-empty, unique
```
`shortcode_from_filename`: stem (drop last extension), lowercase, every char outside `[a-z0-9_+-]` → `_`, collapse runs of `_`, trim `_`; empty → `"emoji"`; if taken, append `_2`, `_3`, … until free. Usage values are only `"emoticon"` / `"sticker"`; others are rejected by `set_image_usage` with `Err`.

- [ ] **Step 1: Write the failing tests** in `packs.rs` `mod tests`:
  - `shortcode_from_filename("Party Blob.PNG", ∅) == "party_blob"`; `("!!!.gif", ∅) == "emoji"`; `("wave.png", {"wave"}) == "wave_2"`; `("wave.png", {"wave","wave_2"}) == "wave_3"`; `("a.b.webp", ∅) == "a_b"`.
  - `is_valid_shortcode`: `"blob_cat"`, `"+1"`, `"a-b"` true; `""`, `"a b"`, `":x:"`, `"é"` false.
  - `add_images_assigns_unique_shortcodes_and_keeps_existing`: pack with `images.wave` and an unknown top-level key `"x.custom": 1`; add two files both named `wave.png` → shortcodes `["wave_2","wave_3"]`, `images.wave` unchanged, `"x.custom"` still `1`, each new entry has `url` and (when given) `body`/`info`, no `usage` key.
  - `rename_moves_entry_with_all_fields` (incl. an unknown per-image field `"x.extra"`); `rename_rejects_existing_target`; `rename_rejects_invalid_target`; `rename_missing_source_errs`.
  - `set_image_usage_sets_and_clears`; `set_image_usage_rejects_unknown_value`.
  - `set_image_body_sets_and_clears_on_empty`.
  - `remove_image_removes_only_that_entry`.
  - `set_meta_patches_only_given_fields` (pack has `attribution` → survives; `display_name: Some("")` removes it).
  - `set_favorite_adds_and_removes` (removing the last key of a room removes the room entry; other rooms untouched; non-object input → `{"rooms":{...}}`); `is_favorite` matches.
  - `state_key_for_name("Blob Pack!", ∅) == "blob_pack"`; collision → `"blob_pack_2"`; `("", ∅) == "pack"`.
- [ ] **Step 2: Run** `cd src-tauri && cargo test matrix::packs` → FAIL (unresolved items).
- [ ] **Step 3: Implement** the functions above in `packs.rs`.
- [ ] **Step 4: Run** `cd src-tauri && RUSTFLAGS=-Dwarnings cargo test matrix::packs` → PASS (dead-code warnings are expected only if items are unused; they are `pub`, so none).
- [ ] **Step 5: Commit** `feat(packs): pure MSC2545 pack patching (#12)`.

### Task 2: Pack I/O and write commands (Rust)

**Files:**
- Modify: `src-tauri/src/matrix/packs.rs` (I/O section), `src-tauri/src/commands.rs` (new `// ─── Pack Management Commands` block), `src-tauri/src/lib.rs` (register)

**Interfaces — Consumes:** Task 1. **Produces** (serde: fields snake_case; enums tagged):
```rust
#[derive(Deserialize, Clone)] #[serde(tag = "kind", rename_all = "snake_case")]
pub enum PackLocation { User, Room { room_id: String, state_key: String } }

#[derive(Serialize)] pub struct EditableImage { shortcode: String, url: String, body: Option<String>, usage: Option<Vec<String>> /* explicit only */ }
#[derive(Serialize)] pub struct EditablePack {
  room_id: Option<String>, state_key: Option<String>,
  display_name: Option<String>, avatar_url: Option<String>,
  usage: Option<Vec<String>>, images: Vec<EditableImage> /* sorted by shortcode */,
  favorited: bool,
  read_only: bool, // personal pack stored in the non-standard { packs: {...} } form
}
#[derive(Serialize)] pub struct RoomPacks { can_edit: bool, packs: Vec<EditablePack> /* "" first, then by state key */ }
#[derive(Serialize)] pub struct FavoritePack { room_id: String, state_key: String, room_name: Option<String>, joined: bool, display_name: Option<String>, avatar_url: Option<String>, image_count: usize }
#[derive(Serialize)] pub struct AddImagesResult { pack: EditablePack, added: Vec<String> }
#[derive(Deserialize)] pub struct NewImageArg { url: String, body: Option<String>, info: Option<Value>, filename: String }
#[derive(Deserialize, Default)] pub struct MetaPatchArg { display_name: Option<String>, avatar_url: Option<String>, usage: Option<Vec<String>> }
```
Tauri commands (args camelCase at the top level, as everywhere else):
| command | args | returns |
|---|---|---|
| `get_user_pack` | — | `EditablePack` |
| `get_room_packs` | `roomId` | `RoomPacks` |
| `get_favorite_packs` | — | `Vec<FavoritePack>` |
| `upload_pack_media` | `dataBase64, mimetype` | `String` (mxc) |
| `add_pack_images` | `location, images: Vec<NewImageArg>` | `AddImagesResult` |
| `rename_pack_image` | `location, from, to` | `EditablePack` |
| `set_pack_image_usage` | `location, shortcode, usage: Option<Vec<String>>` | `EditablePack` |
| `set_pack_image_body` | `location, shortcode, body: Option<String>` | `EditablePack` |
| `remove_pack_image` | `location, shortcode` | `EditablePack` |
| `set_pack_meta` | `location, patch: MetaPatchArg` | `EditablePack` |
| `create_room_pack` | `roomId, displayName` | `EditablePack` |
| `delete_room_pack` | `roomId, stateKey` | `()` |
| `set_pack_favorite` | `roomId, stateKey, favorite` | `()` |

Rules:
- Fresh read — user: `client.account().fetch_account_data("im.ponies.user_emotes")`; room: `client.send(get_state_events_for_key::v3::Request::new(room, "im.ponies.room_emotes".into(), key), None)`, a `M_NOT_FOUND` → `{}`; favorites: `fetch_account_data("im.ponies.emote_rooms")`.
- Writes — user/favorites: `set_account_data_raw`; room: `room.send_state_event_raw("im.ponies.room_emotes", key, value)`.
- Lock: one `tokio::sync::Mutex<()>` per location key (`"user"`, `"room\u{0}{id}\u{0}{key}"`, `"favorites"`), held across read-patch-write.
- Overlay (mirrors `spaces.rs` pending orders): after a room-pack write, remember `(location key → written Value, Instant)` for 120 s; any *store* read of that pack (`get_room_packs`, and Task 3's `get_emoji_packs`) uses the overlay value instead while the store differs. Pure helper: `fn effective_room_pack(stored: Option<Value>, pending: Option<(&Value, Instant)>, now: Instant) -> Option<Value>`.
- Personal pack in `{ packs: {...} }` form: `get_user_pack` returns the standard top-level part with `read_only: true` when only the legacy form has images; writes always patch the top level and keep `packs` untouched.
- `delete_room_pack` writes `{}` then removes the favorite. `create_room_pack` picks the state key with `state_key_for_name` against the room's existing pack state keys and writes `{ "pack": { "display_name": name }, "images": {} }`.
- `can_edit`: `room.can_user_send_state(own_user, "im.ponies.room_emotes".into())`.
- `upload_pack_media`: `client.media().upload(&mime, bytes, None)`; errors through `media::map_upload_sdk_error`.

- [ ] **Step 1: Failing tests** (pure, in `packs.rs` tests): `effective_room_pack_prefers_fresh_pending_write`, `effective_room_pack_drops_pending_once_store_matches`, `effective_room_pack_ignores_expired_pending`; `editable_pack_from_value` (`to_editable(&Value, room_id, state_key, favorited)`): explicit usage only, images sorted, legacy `packs` form → `read_only: true`; `location_key` distinct for user/room/favorites; serde: `{"kind":"room","room_id":"!a:x","state_key":""}` → `PackLocation::Room`, `{"kind":"user"}` → `User`.
- [ ] **Step 2: Run** `cargo test matrix::packs` → FAIL.
- [ ] **Step 3: Implement** I/O fns in `packs.rs`, thin `#[tauri::command]` wrappers in `commands.rs` (`get_client(&state)?` then delegate), register all 13 in `lib.rs`.
- [ ] **Step 4: Run** `cd src-tauri && RUSTFLAGS=-Dwarnings cargo test` → PASS; `cargo build` clean.
- [ ] **Step 5: Commit** `feat(packs): pack write commands with fresh reads and per-pack locks (#12)`.

### Task 3: Space packs + precedence in loading (Rust)

**Files:** Modify `src-tauri/src/matrix/emoji.rs`, `src-tauri/src/matrix/spaces.rs` (make `read_child_events` `pub(crate)` or add `pub(crate) async fn child_room_ids(space) -> Vec<String>`).

**Interfaces — Produces:**
```rust
// EmojiPack gains (serde):
pub state_key: Option<String>, pub favorited: bool, pub scope: String /* "room" | "space" | "user" | "favorite" */
/// Joined ancestor spaces of `room`, nearest first; each listed once; cycles safe.
pub fn ancestors_nearest_first(parents: &HashMap<String, Vec<String>>, room: &str) -> Vec<String>;
```
`get_emoji_packs(client, room_id)` returns, in order: the room's packs (all state keys, `""` first then sorted; `scope:"room"`), then each ancestor space's packs (`scope:"space"`), then the personal pack(s) (`scope:"user"`), then favorites not already listed (`scope:"favorite"`). Every room/space pack carries `favorited` from `im.ponies.emote_rooms`. Room-state packs pass through Task 2's overlay. `parents` is built from every joined space's `m.space.child` (non-empty `via`).

- [ ] **Step 1: Failing tests:** `ancestors_direct_parent_first`, `ancestors_include_grandparents_after_parents`, `ancestors_survive_a_cycle`, `ancestors_of_unparented_room_is_empty`; `pack_order_room_then_spaces_then_user_then_favorites` (a pure `fn order_packs(room: Vec<EmojiPack>, spaces: Vec<EmojiPack>, user: Vec<EmojiPack>, favorites: Vec<EmojiPack>) -> Vec<EmojiPack>` that also drops favorites whose `(room_id, state_key)` already appears and marks the kept one `favorited`).
- [ ] **Step 2:** `cargo test matrix::emoji` → FAIL.
- [ ] **Step 3:** Implement; update the existing emoji/sticker tests' `make_pack` helpers for the new fields.
- [ ] **Step 4:** `RUSTFLAGS=-Dwarnings cargo test` → PASS.
- [ ] **Step 5: Commit** `feat(packs): space packs apply to their rooms, in precedence order (#12)`.

### Task 4: Frontend IPC, types and stateful mocks

**Files:** Create `src/ipc/packs.ts`; modify `src/ipc/types.ts`, `src/ipc/index.ts`, `src/ipc/mock.ts`; test `src/ipc/packs.test.ts`.

**Interfaces — Produces** (TS mirrors of Task 2; `EmojiPack` gains `state_key: string | null; favorited: boolean; scope: "room" | "space" | "user" | "favorite"`):
```ts
export type PackUsage = "emoticon" | "sticker";
export type PackLocation = { kind: "user" } | { kind: "room"; room_id: string; state_key: string };
export interface EditableImage { shortcode: string; url: string; body: string | null; usage: PackUsage[] | null }
export interface EditablePack { room_id: string | null; state_key: string | null; display_name: string | null; avatar_url: string | null; usage: PackUsage[] | null; images: EditableImage[]; favorited: boolean; read_only: boolean }
export interface RoomPacks { can_edit: boolean; packs: EditablePack[] }
export interface FavoritePack { room_id: string; state_key: string; room_name: string | null; joined: boolean; display_name: string | null; avatar_url: string | null; image_count: number }
export interface NewPackImage { url: string; body: string | null; info: { w?: number; h?: number; mimetype: string; size: number } | null; filename: string }
export interface MetaPatch { display_name?: string; avatar_url?: string; usage?: PackUsage[] }
export function getUserPack(): Promise<EditablePack>;
export function getRoomPacks(roomId: string): Promise<RoomPacks>;
export function getFavoritePacks(): Promise<FavoritePack[]>;
export function uploadPackMedia(dataBase64: string, mimetype: string): Promise<string>;
export function addPackImages(location: PackLocation, images: NewPackImage[]): Promise<{ pack: EditablePack; added: string[] }>;
export function renamePackImage(location: PackLocation, from: string, to: string): Promise<EditablePack>;
export function setPackImageUsage(location: PackLocation, shortcode: string, usage: PackUsage[] | null): Promise<EditablePack>;
export function setPackImageBody(location: PackLocation, shortcode: string, body: string | null): Promise<EditablePack>;
export function removePackImage(location: PackLocation, shortcode: string): Promise<EditablePack>;
export function setPackMeta(location: PackLocation, patch: MetaPatch): Promise<EditablePack>;
export function createRoomPack(roomId: string, displayName: string): Promise<EditablePack>;
export function deleteRoomPack(roomId: string, stateKey: string): Promise<void>;
export function setPackFavorite(roomId: string, stateKey: string, favorite: boolean): Promise<void>;
```
Mocks: an in-memory store (personal pack + one pack in the first mock room + one in the first mock space, favorites set) that the write mocks mutate and `get_emoji_packs` reads, so `pnpm dev` shows edits in the pickers. Mock `upload_pack_media` returns a `data:` URL of the bytes. Mock `rename` rejects an existing target with the backend's message.

- [ ] **Step 1: Failing tests** (`packs.test.ts`, against the mock): `rename then getUserPack shows the new shortcode`; `addPackImages assigns unique shortcodes`; `setPackFavorite then getFavoritePacks lists it`; `get_emoji_packs reflects a mock edit`; `getRoomPacks on a room with no packs → { can_edit: true, packs: [] }`.
- [ ] **Step 2:** `pnpm test src/ipc/packs.test.ts` → FAIL.
- [ ] **Step 3:** Implement wrappers (`invoke("<command>", { …camelCase })`), types, exports, mocks; update existing `EmojiPack` literals in mocks/tests for the new fields.
- [ ] **Step 4:** `pnpm test` → PASS; `pnpm build` → OK.
- [ ] **Step 5: Commit** `feat(packs): IPC wrappers, types and stateful mocks (#12)`.

### Task 5: Per-room shortcode map, first-wins dedupe, cache invalidation

**Files:** Modify `src/app/actions/context.ts`, `src/app/actions/custom_emoji.ts`, `src/app/keyboard.ts` (autocomplete refresh), callers of `prepareOutgoingBody` (`messages.ts` ×2, `threads.ts`, `media.ts`); tests `context.test.ts`, `custom_emoji.test.ts`.

**Interfaces — Produces:**
```ts
// context.ts — replaces the app-wide `_shortcodeToMxc`
export const _shortcodeToMxcByRoom: Map<string, Map<string, string>>; // "" = no room
export function customEmojiMxc(roomId: string | null, shortcode: string): string | undefined;
export function replaceUnicodeEmojiShortcodes(text: string, roomId: string | null): string;
export function _buildFormattedBodyWithEmoji(body: string, roomId: string | null): string | undefined;
export function prepareOutgoingBody(raw: string, roomId: string | null): { body: string; formattedBody: string | undefined };
// custom_emoji.ts
export function invalidateCustomEmoji(): void;   // drop cached packs + per-room maps, bump version
export function customEmojiVersion(): number;
```
`toCustomPacks(raw, roomKey)` keeps the first pack's entry for a shortcode and drops later duplicates (packs arrive in precedence order), and **replaces** `_shortcodeToMxcByRoom.get(roomKey)` with the result. Keyboard autocomplete reloads when `(roomId, customEmojiVersion())` changes. Stickers are not deduped (sent by exact URL; ledger as a ruling).

- [ ] **Step 1: Failing tests:** `context.test.ts` — existing cases rewritten to seed `_shortcodeToMxcByRoom.set("!r", new Map([...]))` and pass `"!r"`; new `a shortcode loaded for one room does not resolve in another` (`_buildFormattedBodyWithEmoji(":party:", "!other")` → `undefined`). `custom_emoji.test.ts` — `the first pack wins a shared shortcode` (two packs with `:blob:` → one entry, the first's url; map → first url); `a reload replaces the room's map` (shortcode gone after reload); `invalidateCustomEmoji drops cached packs and bumps the version`.
- [ ] **Step 2:** run those files → FAIL.
- [ ] **Step 3:** Implement; thread `roomId` through the four callers.
- [ ] **Step 4:** `pnpm test` → PASS; `pnpm build` → OK.
- [ ] **Step 5: Commit** `fix(emoji): shortcodes resolve per room; first pack wins a shared shortcode (#12)`.

### Task 6: `PackEditor` component

**Files:** Create `src/ui/packs/PackEditor.ts`, `src/ui/packs/image_file.ts`, `src/ui/packs/PackEditor.test.ts`; modify `src/style/base.css` (`.pack-editor*`).

**Interfaces — Consumes:** Task 4 IPC, `commitTextRow` / `commitSelectRow` / `statusLine` (`settings/commit_field.ts`), `askConfirm` (`ConfirmDialog.ts`), `sectionedGridMove` (`grid_nav.ts`), `resolveEmojiThumbnail` (`app/actions/context.ts`), `invalidateCustomEmoji` (Task 5). **Produces:**
```ts
export interface PackEditorOpts {
  location: PackLocation;
  pack: EditablePack;
  canEdit: boolean;
  /** Room/space packs only: show the "use in every room" toggle. */
  favoritable: boolean;
  /** Called after a successful write with the pack as written (or null once deleted). */
  onChange?(pack: EditablePack | null): void;
}
export class PackEditor { constructor(opts: PackEditorOpts); getElement(): HTMLElement; }
// image_file.ts
export interface ReadImage { dataBase64: string; mimetype: string; size: number; w?: number; h?: number }
export function readImageFile(file: File): Promise<ReadImage>; // rejects non-image/*
```
Layout per the spec sketch: header (name commit field, icon button, default-use select `emoji+sticker | emoji | sticker` ↔ `null | ["emoticon"] | ["sticker"]`, favorite checkbox when `favoritable`, `[delete pack]` for room packs when `canEdit`); grid of `button.pack-editor__cell` (thumbnail + `:shortcode:`), `[+ add images]` (hidden `<input type=file accept="image/*" multiple>`); detail of the selected image (shortcode commit field, use select `pack default | emoji | sticker | emoji+sticker`, description commit field, `[delete]`). Upload flow: for each file `readImageFile` → `uploadPackMedia` (status line "uploading 2/5…", per-file failure listed) → one `addPackImages`. Grid keys when a cell is focused: arrows/`hjkl` (`sectionedGridMove` with one section), `Enter` selects, `x`/`Delete` → `askConfirm({ danger: true })` → `removePackImage`. Icon: the header shows the pack's `avatar_url` thumbnail (or the first image's); the selected image's detail has `[use as pack icon]` → `setPackMeta({ avatar_url: image.url })`, and the header's `[upload icon]` → file → `uploadPackMedia` → `setPackMeta({ avatar_url })`. Every successful write → re-render from the returned pack, `invalidateCustomEmoji()`, `onChange`. `canEdit: false` or `pack.read_only` → no inputs, no add/delete (favorite toggle still shown when `favoritable`).

- [ ] **Step 1: Failing tests** (`PackEditor.test.ts`, IPC wrappers mocked with `vi.mock("../../ipc/index.js")`): renders a cell per image with `:shortcode:`; clicking a cell shows its detail with the shortcode; committing a new shortcode calls `renamePackImage(location, "old", "new")` and re-renders with the returned pack; a rename error shows on the field's status line and leaves the grid unchanged; `x` on a focused cell confirms then calls `removePackImage`; cancelled confirm calls nothing; read-only renders no `input`/`select` except the favorite checkbox; favorite checkbox calls `setPackFavorite(room, key, true)`; add-images with two files calls `uploadPackMedia` twice and `addPackImages` once with both; a failed upload is reported and the rest still added; every write calls `invalidateCustomEmoji`. `image_file.test.ts`: rejects `text/plain`; returns base64 + size + mimetype for a PNG `File`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Implement + CSS (cells sized like picker cells; detail panel under the grid; wraps at phone width).
- [ ] **Step 4:** `pnpm test` → PASS.
- [ ] **Step 5: Commit** `feat(packs): pack editor component (#12)`.

### Task 7: Emoji tab for rooms and spaces; Space settings onto the tab registry

**Files:**
- Create: `src/ui/room/RoomTabsDialog.ts` (host extracted from `RoomDialog`), `src/ui/packs/packs_tab.ts`, `src/ui/space/registry.ts`, `src/ui/space/tabs/general.ts`, `src/ui/space/tabs/children.ts`, tests `src/ui/packs/packs_tab.test.ts`, `src/ui/SpaceSettingsDialog.test.ts`
- Modify: `src/ui/RoomDialog.ts` (extends `RoomTabsDialog`), `src/ui/SpaceSettingsDialog.ts` (extends `RoomTabsDialog`), `src/ui/room/registry.ts` (add `packsTab` after Settings)

**Interfaces — Produces:**
```ts
export interface RoomTabsDialogOpts { title: string; ariaLabel: string; closeLabel: string; backLabel: string; tabs: RoomTab[] }
export abstract class RoomTabsDialog extends DialogBase {
  protected constructor(opts: RoomTabsDialogOpts);
  /** Open on `roomId` (null → "No room selected."), landing on `tabId` if visible. */
  protected open(roomId: string | null, tabId?: string): void;
}
// RoomDialog.show(tabId?) → open(currentRoomId, tabId)   (unchanged public API)
// SpaceSettingsDialog.show(spaceId?) → open(spaceId ?? currentSpaceId)  (unchanged public API)
export const SPACE_TABS: RoomTab[]; // [spaceGeneralTab, spaceChildrenTab, packsTab]
export const packsTab: RoomTab;     // id "emoji", label "Emoji"
```
`packsTab.build`: `getRoomPacks(roomId)` → a `PackEditor` per pack (`location {kind:"room", room_id, state_key}`, `canEdit`, `favoritable: true`), `[new pack]` (when `can_edit`) → name prompt (commit text row) → `createRoomPack` → `ctx.refresh()`; empty + no permission → "This room has no packs." General/Children tab bodies move verbatim from `SpaceSettingsDialog` into `space/tabs/*.ts` as `RoomTab`s (space id = `ctx.roomId`).

- [ ] **Step 1: Failing tests:** `packs_tab.test.ts` — editable room shows `[new pack]` and one editor per pack; `can_edit: false` shows editors read-only and no `[new pack]`; empty + no permission shows the empty line; `[new pack]` → `createRoomPack(room, name)` then refresh. `SpaceSettingsDialog.test.ts` — `show("!space")` renders tabs General, Children, Emoji; `Tab` cycles to Children; Emoji tab calls `getRoomPacks("!space")`. Existing `RoomDialog.test.ts` stays green, plus `the room dialog lists an Emoji tab after Settings`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Implement (extract host; port space tabs; register).
- [ ] **Step 4:** `pnpm test` → PASS; `pnpm build` → OK.
- [ ] **Step 5: Commit** `feat(packs): Emoji tab in the room dialog and space settings (#12)`.

### Task 8: Settings → Emoji: your pack and favorites

**Files:** Modify `src/ui/settings/tabs/emoji.ts`; create `src/ui/packs/favorites.ts`; tests `src/ui/settings/tabs/emoji.test.ts`.

**Interfaces — Produces:** `export function favoritesSection(onChange?: () => void): Promise<HTMLElement>` — rows of icon, name, where it lives (`room_name ?? room_id`, "not joined" when `!joined`), image count, `[remove]` → `setPackFavorite(room, key, false)` → row removed + `invalidateCustomEmoji()`.

Tab order: existing autocomplete section (unchanged), then **Your pack** (`PackEditor` on `{kind:"user"}`, `canEdit: !pack.read_only`, `favoritable: false`) with the one-line note "One personal pack per account. For more, keep packs in a private room and add them to favorites.", then **Favorite packs** (`favoritesSection`), empty state "No favorite packs. Open a room's Emoji tab to add one.".

- [ ] **Step 1: Failing tests:** tab renders the three sections in order; Your pack editor shows the user pack's images; favorites list shows a not-joined entry with "not joined"; `[remove]` calls `setPackFavorite(room, key, false)` and removes the row; empty favorites shows the empty line.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `pnpm test` → PASS.
- [ ] **Step 5: Commit** `feat(packs): personal pack and favorites in Settings → Emoji (#12)`.

### Task 9: Docs, full verification, live check

**Files:** `DESIGN.md`.

- [ ] DESIGN.md: rewrite "Pack management UI" under Custom Emoji & Stickers (what shipped; storage table; fresh-read/lock/overlay; precedence; first-wins in pickers; per-room shortcode map; shortcode charset); Settings dialog table row for **Emoji**; Room Dialog paragraph lists **Emoji**; space settings tabs (General, Children, Emoji) on the shared host.
- [ ] `cd src-tauri && RUSTFLAGS=-Dwarnings cargo test` → PASS; `cargo clippy` → no new warnings in `packs.rs`/`emoji.rs` (advisory); `pnpm test` → PASS; `pnpm build` → OK.
- [ ] Live check in WebKitGTK against the mock frontend (Vite + MiniBrowser/WebDriver harness from #117): Settings → Emoji shows Your pack; rename an image; add an image; the emoji picker shows the change; a room's Emoji tab favorite toggle → Settings → Emoji lists it.
- [ ] Commit `docs: emoji & sticker pack management (#12)`.
