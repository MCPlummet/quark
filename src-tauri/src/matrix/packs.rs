// MSC2545 pack management (#12).
//
// Quark used to read packs and nothing more; this module is the write side.
// Every edit is a small operation: read the pack fresh from the server, patch
// the one thing that changed on the raw JSON, write it back. Patching raw JSON
// (rather than round-tripping through a struct) is what keeps fields Quark does
// not model — `info`, `attribution`, other clients' extensions — intact, and
// the fresh read is what keeps an edit from overwriting a change another client
// or another room admin made while Quark's dialog was open.
//
// The patches themselves are pure functions over the pack content
// (`{ images, pack }`), so they are tested without a client.

use matrix_sdk::{
    ruma::{
        api::client::{error::ErrorKind, state::get_state_events_for_key},
        events::{AnyGlobalAccountDataEventContent, GlobalAccountDataEventType, StateEventType},
        serde::Raw,
        RoomId,
    },
    Client, RoomState,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

/// Room state event holding a room's (or space's) packs, one per state key.
pub const ROOM_PACK_EVENT: &str = "im.ponies.room_emotes";
/// Account data holding the user's own pack.
pub const USER_PACK_EVENT: &str = "im.ponies.user_emotes";
/// Account data listing the room packs the user has made usable everywhere.
pub const FAVORITES_EVENT: &str = "im.ponies.emote_rooms";

// ─── Pure patching ───────────────────────────────────────────────────────────

/// Usage values MSC2545 defines.
const USAGES: [&str; 2] = ["emoticon", "sticker"];

/// Whether `s` is a shortcode Quark can type and send: the same characters the
/// outgoing formatter recognises in `:shortcode:` (`SHORTCODE_RE` in
/// `src/app/actions/context.ts`). Packs from other clients may hold others;
/// they are shown, but Quark never creates one.
pub fn is_valid_shortcode(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '+' | '-'))
}

/// Lower-case `name`, map every character outside `[a-z0-9_-]` (and `+` when
/// `keep_plus`) to `_`, collapse runs of `_` and trim them.
fn slug(name: &str, keep_plus: bool) -> String {
    let mut out = String::new();
    for c in name.to_lowercase().chars() {
        let ok = c.is_ascii_alphanumeric() || c == '_' || c == '-' || (keep_plus && c == '+');
        let c = if ok { c } else { '_' };
        if c == '_' && out.ends_with('_') {
            continue;
        }
        out.push(c);
    }
    out.trim_matches('_').to_string()
}

/// `base`, or `base_2`, `base_3`, … — the first not in `taken`.
fn unique(base: String, taken: &HashSet<String>) -> String {
    if !taken.contains(&base) {
        return base;
    }
    (2..)
        .map(|n| format!("{base}_{n}"))
        .find(|candidate| !taken.contains(candidate))
        .expect("an unbounded range always yields a free name")
}

/// A shortcode for an uploaded file: its name without the extension, slugged,
/// and made unique against `taken`.
pub fn shortcode_from_filename(filename: &str, taken: &HashSet<String>) -> String {
    let stem = match filename.rsplit_once('.') {
        Some((stem, _)) if !stem.is_empty() => stem,
        _ => filename,
    };
    let base = slug(stem, true);
    unique(if base.is_empty() { "emoji".into() } else { base }, taken)
}

/// A state key for a new room pack named `name`, unique against `taken`.
pub fn state_key_for_name(name: &str, taken: &HashSet<String>) -> String {
    let base = slug(name, false);
    unique(if base.is_empty() { "pack".into() } else { base }, taken)
}

/// One image to add to a pack, already uploaded.
pub struct NewImage {
    pub url: String,
    pub body: Option<String>,
    /// `{ w, h, mimetype, size }`, or `Null` when unknown.
    pub info: Value,
    pub filename: String,
}

/// The pack content as an object (a missing or malformed pack is empty).
fn as_object(pack: &Value) -> Map<String, Value> {
    pack.as_object().cloned().unwrap_or_default()
}

/// The `images` map of `pack`, creating it if absent.
fn images_mut(pack: &mut Map<String, Value>) -> &mut Map<String, Value> {
    let entry = pack.entry("images").or_insert_with(|| Value::Object(Map::new()));
    if !entry.is_object() {
        *entry = Value::Object(Map::new());
    }
    entry.as_object_mut().expect("just made an object")
}

/// The entry for `shortcode`, or an error naming it.
fn image_mut<'a>(images: &'a mut Map<String, Value>, shortcode: &str) -> Result<&'a mut Map<String, Value>, String> {
    images
        .get_mut(shortcode)
        .and_then(Value::as_object_mut)
        .ok_or_else(|| format!(":{shortcode}: is not in this pack"))
}

/// Add `images`, each under a shortcode derived from its filename and unique in
/// the pack. Returns the new pack and the shortcode each image got, in order.
pub fn add_images(pack: &Value, new: &[NewImage]) -> (Value, Vec<String>) {
    let mut pack = as_object(pack);
    let images = images_mut(&mut pack);
    let mut taken: HashSet<String> = images.keys().cloned().collect();
    let mut added = Vec::with_capacity(new.len());
    for image in new {
        let shortcode = shortcode_from_filename(&image.filename, &taken);
        let mut entry = Map::new();
        entry.insert("url".into(), Value::String(image.url.clone()));
        if let Some(body) = image.body.as_deref().filter(|b| !b.is_empty()) {
            entry.insert("body".into(), Value::String(body.to_string()));
        }
        if !image.info.is_null() {
            entry.insert("info".into(), image.info.clone());
        }
        images.insert(shortcode.clone(), Value::Object(entry));
        taken.insert(shortcode.clone());
        added.push(shortcode);
    }
    (Value::Object(pack), added)
}

/// Move the image at `from` to `to`, keeping every field it has.
pub fn rename_image(pack: &Value, from: &str, to: &str) -> Result<Value, String> {
    if !is_valid_shortcode(to) {
        return Err(format!(
            "\"{to}\" can't be a shortcode: use letters, digits, _, + and - only"
        ));
    }
    let mut pack = as_object(pack);
    let images = images_mut(&mut pack);
    if from == to {
        image_mut(images, from)?;
        return Ok(Value::Object(pack));
    }
    if images.contains_key(to) {
        return Err(format!(":{to}: is already in this pack"));
    }
    let entry = images
        .remove(from)
        .ok_or_else(|| format!(":{from}: is not in this pack"))?;
    images.insert(to.to_string(), entry);
    Ok(Value::Object(pack))
}

/// Set an image's own `usage`, or remove it (`None`) so it inherits the pack's.
pub fn set_image_usage(pack: &Value, shortcode: &str, usage: Option<&[String]>) -> Result<Value, String> {
    if let Some(bad) = usage.into_iter().flatten().find(|u| !USAGES.contains(&u.as_str())) {
        return Err(format!("Unknown usage \"{bad}\""));
    }
    let mut pack = as_object(pack);
    let entry = image_mut(images_mut(&mut pack), shortcode)?;
    match usage {
        Some(u) => {
            entry.insert("usage".into(), Value::from(u.to_vec()));
        }
        None => {
            entry.remove("usage");
        }
    }
    Ok(Value::Object(pack))
}

/// Set an image's description, or remove it when `None` or empty.
pub fn set_image_body(pack: &Value, shortcode: &str, body: Option<&str>) -> Result<Value, String> {
    let mut pack = as_object(pack);
    let entry = image_mut(images_mut(&mut pack), shortcode)?;
    match body.filter(|b| !b.is_empty()) {
        Some(b) => {
            entry.insert("body".into(), Value::String(b.to_string()));
        }
        None => {
            entry.remove("body");
        }
    }
    Ok(Value::Object(pack))
}

/// Remove one image.
pub fn remove_image(pack: &Value, shortcode: &str) -> Result<Value, String> {
    let mut pack = as_object(pack);
    images_mut(&mut pack)
        .remove(shortcode)
        .ok_or_else(|| format!(":{shortcode}: is not in this pack"))?;
    Ok(Value::Object(pack))
}

/// Changes to a pack's own metadata. A field left `None` is not touched; an
/// empty string or list removes the key.
pub struct MetaPatch {
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub usage: Option<Vec<String>>,
}

/// Apply `patch` to the pack's `pack` object, leaving its other keys alone.
pub fn set_meta(pack: &Value, patch: &MetaPatch) -> Value {
    let mut pack = as_object(pack);
    let meta = pack.entry("pack").or_insert_with(|| Value::Object(Map::new()));
    if !meta.is_object() {
        *meta = Value::Object(Map::new());
    }
    let meta = meta.as_object_mut().expect("just made an object");
    let mut apply = |key: &str, value: Option<Value>, empty: bool| match value {
        Some(_) if empty => {
            meta.remove(key);
        }
        Some(v) => {
            meta.insert(key.into(), v);
        }
        None => {}
    };
    apply("display_name", patch.display_name.clone().map(Value::String), patch.display_name.as_deref() == Some(""));
    apply("avatar_url", patch.avatar_url.clone().map(Value::String), patch.avatar_url.as_deref() == Some(""));
    apply("usage", patch.usage.clone().map(Value::from), patch.usage.as_ref().is_some_and(Vec::is_empty));
    Value::Object(pack)
}

/// The state keys a room's entry in `im.ponies.emote_rooms` favorites.
///
/// MSC2545 makes the entry an object keyed by state key. An entry that isn't
/// one (`true`, `null` — another client's doing) has always been read as the
/// room's default pack, `""`. Listing, `is_favorite` and `set_favorite` all go
/// through here, so such a favorite is shown, recognised and removable alike:
/// it used to be listed but not recognised, so [remove] wrote nothing and the
/// row came back.
pub fn favorite_state_keys(entry: &Value) -> Vec<String> {
    match entry.as_object() {
        Some(keys) => keys.keys().cloned().collect(),
        None => vec![String::new()],
    }
}

/// Add or remove one room pack in `im.ponies.emote_rooms` content. A room left
/// with no packs is removed from the map. Content that already says so is
/// returned unchanged.
pub fn set_favorite(emote_rooms: &Value, room_id: &str, state_key: &str, favorite: bool) -> Value {
    if is_favorite(emote_rooms, room_id, state_key) == favorite {
        return emote_rooms.clone();
    }
    let mut content = as_object(emote_rooms);
    let rooms = content.entry("rooms").or_insert_with(|| Value::Object(Map::new()));
    if !rooms.is_object() {
        *rooms = Value::Object(Map::new());
    }
    let rooms = rooms.as_object_mut().expect("just made an object");
    // An entry that isn't an object stands for the packs `favorite_state_keys`
    // reads in it; spell those out before changing them.
    let keys = rooms.entry(room_id).or_insert_with(|| Value::Object(Map::new()));
    if !keys.is_object() {
        *keys = Value::Object(
            favorite_state_keys(keys).into_iter().map(|k| (k, Value::Object(Map::new()))).collect(),
        );
    }
    let keys = keys.as_object_mut().expect("just made an object");
    if favorite {
        keys.entry(state_key).or_insert_with(|| Value::Object(Map::new()));
    } else {
        keys.remove(state_key);
        if keys.is_empty() {
            rooms.remove(room_id);
        }
    }
    Value::Object(content)
}

/// Whether `im.ponies.emote_rooms` content lists this room pack.
pub fn is_favorite(emote_rooms: &Value, room_id: &str, state_key: &str) -> bool {
    emote_rooms
        .get("rooms")
        .and_then(|r| r.get(room_id))
        .is_some_and(|entry| favorite_state_keys(entry).iter().any(|k| k == state_key))
}

/// A deleted room pack: state can't be removed, so deleting writes `{}`.
pub fn is_deleted_pack(content: &Value) -> bool {
    content.as_object().is_some_and(Map::is_empty)
}

/// The content of a new pack named `name`, to write where `current` is — only
/// if nothing is there (missing, or a deleted pack's `{}`). Any other content
/// is someone's pack, with or without an `images` key, and is not overwritten.
pub fn new_pack(current: &Value, name: &str) -> Result<Value, String> {
    if !(current.is_null() || is_deleted_pack(current)) {
        return Err("A pack with that name already exists here".into());
    }
    let mut pack = Map::new();
    let name = name.trim();
    if !name.is_empty() {
        pack.insert("display_name".into(), Value::String(name.to_owned()));
    }
    Ok(serde_json::json!({ "pack": pack, "images": {} }))
}

// ─── Locations and the editable view ─────────────────────────────────────────

/// Where a pack lives. A space is a room, so space packs are `Room` too.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PackLocation {
    User,
    Room { room_id: String, state_key: String },
}

/// The lock key of the favorites list (alongside `location_key`'s).
pub const FAVORITES_KEY: &str = "favorites";

/// A key naming one pack, for its write lock and the recent-write overlay.
pub fn location_key(location: &PackLocation) -> String {
    match location {
        PackLocation::User => "user".into(),
        // NUL can't appear in a room ID or survive in a state key Quark writes,
        // so the pair can't collide with another.
        PackLocation::Room { room_id, state_key } => format!("room\u{0}{room_id}\u{0}{state_key}"),
    }
}

/// One image as the management UI shows it.
#[derive(Debug, Clone, Serialize)]
pub struct EditableImage {
    pub shortcode: String,
    pub url: String,
    pub body: Option<String>,
    /// The image's own usage; `None` inherits the pack's.
    pub usage: Option<Vec<String>>,
}

/// A pack as the management UI shows it.
#[derive(Debug, Clone, Serialize)]
pub struct EditablePack {
    pub room_id: Option<String>,
    pub state_key: Option<String>,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    /// The pack's own usage; `None` means both.
    pub usage: Option<Vec<String>>,
    /// Sorted by shortcode.
    pub images: Vec<EditableImage>,
    pub favorited: bool,
    /// Not editable here. Set by the frontend for the legacy images it shows
    /// apart; the backend's packs are always editable (power permitting).
    pub read_only: bool,
    /// The personal pack only: images in the non-standard `{ packs: {…} }` form
    /// of `im.ponies.user_emotes`, which Quark shows read-only and never writes
    /// (edits go to the standard top-level `{ images, pack }` — spec decision 6).
    pub legacy_images: Vec<EditableImage>,
}

fn string_list(v: Option<&Value>) -> Option<Vec<String>> {
    v.and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|u| u.as_str().map(String::from)).collect())
}

fn images_of(images: Option<&Value>) -> Vec<EditableImage> {
    let mut out: Vec<EditableImage> = images
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(shortcode, entry)| {
            Some(EditableImage {
                shortcode: shortcode.clone(),
                url: entry.get("url")?.as_str()?.to_string(),
                body: entry.get("body").and_then(Value::as_str).map(String::from),
                usage: string_list(entry.get("usage")),
            })
        })
        .collect();
    out.sort_by(|a, b| a.shortcode.cmp(&b.shortcode));
    out
}

/// The editable view of pack content.
pub fn to_editable(content: &Value, room_id: Option<&str>, state_key: Option<&str>, favorited: bool) -> EditablePack {
    let meta = content.get("pack");
    let images = images_of(content.get("images"));
    let mut legacy_images = Vec::new();
    if room_id.is_none() {
        // The legacy multi-pack form of im.ponies.user_emotes: shown apart,
        // read-only, never written; the standard pack stays editable.
        if let Some(packs) = content.get("packs").and_then(Value::as_object) {
            let mut seen = HashSet::new();
            for legacy in packs.values() {
                for image in images_of(legacy.get("images")) {
                    if seen.insert(image.shortcode.clone()) {
                        legacy_images.push(image);
                    }
                }
            }
            legacy_images.sort_by(|a, b| a.shortcode.cmp(&b.shortcode));
        }
    }
    EditablePack {
        room_id: room_id.map(String::from),
        state_key: state_key.map(String::from),
        display_name: meta.and_then(|m| m.get("display_name")).and_then(Value::as_str).map(String::from),
        avatar_url: meta.and_then(|m| m.get("avatar_url")).and_then(Value::as_str).map(String::from),
        usage: string_list(meta.and_then(|m| m.get("usage"))),
        images,
        favorited,
        read_only: false,
        legacy_images,
    }
}

// ─── Recent-write overlay ────────────────────────────────────────────────────
//
// A room pack written here reaches the local store only when the write echoes
// back through sync. Until then a store read would hand the UI (and the
// pickers) the pack as it was — so a second edit right after the first would
// show the first undone. Same remedy as `spaces.rs`'s pending orders: remember
// what was written, prefer it while the store differs, forget it once the store
// agrees or it ages out.

pub const OVERLAY_TTL: Duration = Duration::from_secs(120);

#[derive(Default)]
pub struct Overlay {
    pending: HashMap<(String, String), (Value, Instant)>,
}

impl Overlay {
    pub fn note(&mut self, room_id: &str, state_key: &str, content: Value, at: Instant) {
        self.pending.insert((room_id.to_owned(), state_key.to_owned()), (content, at));
    }

    /// The pack to believe: a recent write the store hasn't caught up with, else the store's.
    pub fn effective(&mut self, room_id: &str, state_key: &str, stored: Option<Value>, now: Instant) -> Option<Value> {
        let key = (room_id.to_owned(), state_key.to_owned());
        match self.pending.get(&key) {
            Some((written, at)) if now.duration_since(*at) < OVERLAY_TTL && stored.as_ref() != Some(written) => {
                Some(written.clone())
            }
            Some(_) => {
                self.pending.remove(&key);
                stored
            }
            None => stored,
        }
    }

    /// Recent writes to `room_id`'s packs that have not expired, by state key.
    pub fn pending_for_room(&mut self, room_id: &str, now: Instant) -> Vec<(String, Value)> {
        self.pending.retain(|_, (_, at)| now.duration_since(*at) < OVERLAY_TTL);
        let mut out: Vec<(String, Value)> = self
            .pending
            .iter()
            .filter(|((room, _), _)| room == room_id)
            .map(|((_, key), (content, _))| (key.clone(), content.clone()))
            .collect();
        out.sort_by(|a, b| a.0.cmp(&b.0));
        out
    }
}

static OVERLAY: LazyLock<std::sync::Mutex<Overlay>> = LazyLock::new(Default::default);

/// A room's packs as the store holds them, with recent writes laid over, by
/// state key; deleted (empty) packs are left out. Shared with the pickers'
/// loader so an edit shows there before sync echoes it.
pub async fn room_packs_from_store(room: &matrix_sdk::Room) -> Vec<(String, Value)> {
    let mut by_key: HashMap<String, Value> = HashMap::new();
    if let Ok(raw_events) = room.get_state_events(StateEventType::from(ROOM_PACK_EVENT)).await {
        for raw in raw_events {
            let value: Option<Value> = match raw {
                matrix_sdk::deserialized_responses::RawAnySyncOrStrippedState::Sync(r) => r.deserialize_as().ok(),
                matrix_sdk::deserialized_responses::RawAnySyncOrStrippedState::Stripped(r) => r.deserialize_as().ok(),
            };
            let Some(value) = value else { continue };
            let state_key = value.get("state_key").and_then(Value::as_str).unwrap_or("").to_string();
            let content = value.get("content").cloned().unwrap_or(Value::Object(Map::new()));
            by_key.insert(state_key, content);
        }
    }
    let now = Instant::now();
    let room_id = room.room_id().as_str();
    if let Ok(mut overlay) = OVERLAY.lock() {
        let keys: Vec<String> = by_key.keys().cloned().collect();
        for key in keys {
            let stored = by_key.remove(&key);
            if let Some(v) = overlay.effective(room_id, &key, stored, now) {
                by_key.insert(key, v);
            }
        }
        for (key, content) in overlay.pending_for_room(room_id, now) {
            by_key.entry(key).or_insert(content);
        }
    }
    let mut out: Vec<(String, Value)> = by_key.into_iter().filter(|(_, c)| !is_deleted_pack(c)).collect();
    // The default pack ("") first, then by state key.
    out.sort_by(|a, b| (!a.0.is_empty(), &a.0).cmp(&(!b.0.is_empty(), &b.0)));
    out
}

// ─── Server reads and writes ─────────────────────────────────────────────────

static LOCKS: LazyLock<std::sync::Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> =
    LazyLock::new(Default::default);

/// The write lock for one pack (or the favorites list): two edits to it in
/// quick succession must not both read the state before either.
fn lock_for(key: &str) -> Arc<tokio::sync::Mutex<()>> {
    let mut locks = LOCKS.lock().unwrap_or_else(|p| p.into_inner());
    locks.entry(key.to_owned()).or_default().clone()
}

fn parse_room_id(room_id: &str) -> Result<matrix_sdk::ruma::OwnedRoomId, String> {
    RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))
}

fn joined_room(client: &Client, room_id: &str) -> Result<matrix_sdk::Room, String> {
    let room = client
        .get_room(&parse_room_id(room_id)?)
        .ok_or("You are not in this room")?;
    if room.state() != RoomState::Joined {
        return Err("You are not in this room".into());
    }
    Ok(room)
}

async fn read_account_data(client: &Client, event_type: &str) -> Result<Value, String> {
    let raw = client
        .account()
        .fetch_account_data(GlobalAccountDataEventType::from(event_type))
        .await
        .map_err(|e| format!("Couldn't read {event_type}: {e}"))?;
    Ok(raw
        .and_then(|r| r.deserialize_as::<Value>().ok())
        .unwrap_or_else(|| Value::Object(Map::new())))
}

/// Account data as the store holds it from sync — no request; `Null` if absent.
async fn stored_account_data(client: &Client, event_type: &str) -> Value {
    client
        .account()
        .account_data_raw(GlobalAccountDataEventType::from(event_type))
        .await
        .ok()
        .flatten()
        .and_then(|raw| raw.deserialize_as::<Value>().ok())
        .unwrap_or(Value::Null)
}

async fn write_account_data(client: &Client, event_type: &str, content: &Value) -> Result<(), String> {
    let raw: Raw<AnyGlobalAccountDataEventContent> = Raw::new(content)
        .map_err(|e| format!("Couldn't encode {event_type}: {e}"))?
        .cast();
    client
        .account()
        .set_account_data_raw(GlobalAccountDataEventType::from(event_type), raw)
        .await
        .map_err(|e| format!("Couldn't save {event_type}: {e}"))?;
    Ok(())
}

/// A room pack read from the server, not the store: the base for an edit.
async fn read_room_pack_fresh(client: &Client, room_id: &str, state_key: &str) -> Result<Value, String> {
    let request = get_state_events_for_key::v3::Request::new(
        parse_room_id(room_id)?,
        StateEventType::from(ROOM_PACK_EVENT),
        state_key.to_owned(),
    );
    match client.send(request, None).await {
        Ok(response) => response
            .content
            .deserialize_as::<Value>()
            .map_err(|e| format!("Couldn't read the pack: {e}")),
        Err(e) if e.client_api_error_kind() == Some(&ErrorKind::NotFound) => Ok(Value::Object(Map::new())),
        Err(e) => Err(format!("Couldn't read the pack: {e}")),
    }
}

async fn write_room_pack(client: &Client, room_id: &str, state_key: &str, content: &Value) -> Result<(), String> {
    let room = joined_room(client, room_id)?;
    room.send_state_event_raw(ROOM_PACK_EVENT, state_key, content.clone())
        .await
        .map_err(|e| format!("Couldn't save the pack: {e}"))?;
    if let Ok(mut overlay) = OVERLAY.lock() {
        overlay.note(room_id, state_key, content.clone(), Instant::now());
    }
    Ok(())
}

async fn read_pack(client: &Client, location: &PackLocation) -> Result<Value, String> {
    match location {
        PackLocation::User => read_account_data(client, USER_PACK_EVENT).await,
        PackLocation::Room { room_id, state_key } => read_room_pack_fresh(client, room_id, state_key).await,
    }
}

async fn write_pack(client: &Client, location: &PackLocation, content: &Value) -> Result<(), String> {
    match location {
        PackLocation::User => write_account_data(client, USER_PACK_EVENT, content).await,
        PackLocation::Room { room_id, state_key } => write_room_pack(client, room_id, state_key, content).await,
    }
}

/// Read the pack fresh, apply `patch`, write the result, and return the pack
/// as written — all under the pack's lock.
///
/// The returned view is built before the lock is released. It used to be
/// built after, around a request for the favorites list: an edit could then
/// wait on that request while the next edit to the pack read, wrote and
/// returned, so the first edit's older pack reached the editor last and was
/// drawn over the second's (a rename undone on screen, and the edits after it
/// refused as ":x: is not in this pack").
async fn edit_pack(
    client: &Client,
    location: &PackLocation,
    patch: impl FnOnce(&Value) -> Result<Value, String>,
) -> Result<EditablePack, String> {
    let lock = lock_for(&location_key(location));
    let _turn = lock.lock().await;
    let current = read_pack(client, location).await?;
    let next = patch(&current)?;
    if next != current {
        write_pack(client, location, &next).await?;
    }
    Ok(editable_at(client, location, &next).await)
}

/// The editable view of `content` at `location`, with its favorite flag.
///
/// The flag comes from the favorites list as the store has it: an edit never
/// changes it, so it is not worth a request, and the editor showing the pack
/// already knows it (a favorite toggled moments ago reaches the store only when
/// sync echoes it, and the editor keeps its own flag over this one).
async fn editable_at(client: &Client, location: &PackLocation, content: &Value) -> EditablePack {
    match location {
        PackLocation::User => to_editable(content, None, None, false),
        PackLocation::Room { room_id, state_key } => {
            let favorites = stored_account_data(client, FAVORITES_EVENT).await;
            to_editable(content, Some(room_id), Some(state_key), is_favorite(&favorites, room_id, state_key))
        }
    }
}

// ─── Operations (the Tauri commands' bodies) ─────────────────────────────────

/// A room's packs for its management tab.
#[derive(Debug, Serialize)]
pub struct RoomPacks {
    pub can_edit: bool,
    pub packs: Vec<EditablePack>,
}

/// One favorited room pack, for Settings → Emoji.
#[derive(Debug, Serialize)]
pub struct FavoritePack {
    pub room_id: String,
    pub state_key: String,
    pub room_name: Option<String>,
    pub joined: bool,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub image_count: usize,
}

/// One already-uploaded image to add.
#[derive(Debug, Deserialize)]
pub struct NewImageArg {
    pub url: String,
    pub body: Option<String>,
    pub info: Option<Value>,
    pub filename: String,
}

/// Pack metadata changes; see `MetaPatch`.
#[derive(Debug, Default, Deserialize)]
pub struct MetaPatchArg {
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub usage: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
pub struct AddImagesResult {
    pub pack: EditablePack,
    /// The shortcode each image got, in the order given.
    pub added: Vec<String>,
}

pub async fn get_user_pack(client: &Client) -> Result<EditablePack, String> {
    let content = read_account_data(client, USER_PACK_EVENT).await?;
    Ok(to_editable(&content, None, None, false))
}

pub async fn get_room_packs(client: &Client, room_id: &str) -> Result<RoomPacks, String> {
    let room = joined_room(client, room_id)?;
    let can_edit = match client.user_id() {
        Some(me) => room
            .can_user_send_state(me, StateEventType::from(ROOM_PACK_EVENT))
            .await
            .unwrap_or(false),
        None => false,
    };
    let favorites = read_account_data(client, FAVORITES_EVENT).await.unwrap_or(Value::Null);
    let packs = room_packs_from_store(&room)
        .await
        .into_iter()
        .map(|(key, content)| {
            let favorited = is_favorite(&favorites, room_id, &key);
            to_editable(&content, Some(room_id), Some(&key), favorited)
        })
        .collect();
    Ok(RoomPacks { can_edit, packs })
}

pub async fn get_favorite_packs(client: &Client) -> Result<Vec<FavoritePack>, String> {
    let favorites = read_account_data(client, FAVORITES_EVENT).await?;
    let mut out = Vec::new();
    let Some(rooms) = favorites.get("rooms").and_then(Value::as_object) else { return Ok(out) };
    for (room_id, keys) in rooms {
        // A room since left is still in the store, with the state it had: its
        // packs keep working as favorites (emoji.rs reads them from there), so
        // they are listed by name here too, marked not joined.
        let room = RoomId::parse(room_id.as_str()).ok().and_then(|id| client.get_room(&id));
        let joined = room.as_ref().is_some_and(|r| r.state() == RoomState::Joined);
        let stored: Vec<(String, Value)> = match &room {
            Some(room) => room_packs_from_store(room).await,
            None => Vec::new(),
        };
        let room_name = room.as_ref().and_then(|r| r.name().or_else(|| r.canonical_alias().map(|a| a.to_string())));
        for state_key in favorite_state_keys(keys) {
            let content = stored.iter().find(|(k, _)| *k == state_key).map(|(_, c)| c);
            let view = content.map(|c| to_editable(c, Some(room_id), Some(&state_key), true));
            out.push(FavoritePack {
                room_id: room_id.clone(),
                state_key: state_key.clone(),
                room_name: room_name.clone(),
                joined,
                display_name: view.as_ref().and_then(|v| v.display_name.clone()),
                avatar_url: view.as_ref().and_then(|v| v.avatar_url.clone()),
                image_count: view.as_ref().map_or(0, |v| v.images.len()),
            });
        }
    }
    Ok(out)
}

/// Upload an image for a pack. Unencrypted even from an encrypted room: other
/// clients fetch pack images by plain `mxc://` URL.
pub async fn upload_pack_media(client: &Client, data_base64: &str, mimetype: &str) -> Result<String, String> {
    let bytes = crate::matrix::media::from_base64(data_base64)?;
    let mime: mime::Mime = mimetype
        .parse()
        .map_err(|e| format!("Invalid mime type {mimetype:?}: {e}"))?;
    if mime.type_() != mime::IMAGE {
        return Err(format!("{mimetype} is not an image"));
    }
    let size = bytes.len();
    let response = client
        .media()
        .upload(&mime, bytes, None)
        .await
        .map_err(|e| crate::matrix::media::map_upload_http_error("Failed to upload the image", &e, size))?;
    Ok(response.content_uri.to_string())
}

pub async fn add_pack_images(
    client: &Client,
    location: &PackLocation,
    images: Vec<NewImageArg>,
) -> Result<AddImagesResult, String> {
    let new: Vec<NewImage> = images
        .into_iter()
        .map(|i| NewImage { url: i.url, body: i.body, info: i.info.unwrap_or(Value::Null), filename: i.filename })
        .collect();
    let mut added = Vec::new();
    let pack = edit_pack(client, location, |pack| {
        let (next, codes) = add_images(pack, &new);
        added = codes;
        Ok(next)
    })
    .await?;
    Ok(AddImagesResult { pack, added })
}

pub async fn rename_pack_image(client: &Client, location: &PackLocation, from: &str, to: &str) -> Result<EditablePack, String> {
    edit_pack(client, location, |p| rename_image(p, from, to)).await
}

pub async fn set_pack_image_usage(
    client: &Client,
    location: &PackLocation,
    shortcode: &str,
    usage: Option<Vec<String>>,
) -> Result<EditablePack, String> {
    edit_pack(client, location, |p| set_image_usage(p, shortcode, usage.as_deref())).await
}

pub async fn set_pack_image_body(
    client: &Client,
    location: &PackLocation,
    shortcode: &str,
    body: Option<String>,
) -> Result<EditablePack, String> {
    edit_pack(client, location, |p| set_image_body(p, shortcode, body.as_deref())).await
}

pub async fn remove_pack_image(client: &Client, location: &PackLocation, shortcode: &str) -> Result<EditablePack, String> {
    edit_pack(client, location, |p| remove_image(p, shortcode)).await
}

pub async fn set_pack_meta(client: &Client, location: &PackLocation, patch: MetaPatchArg) -> Result<EditablePack, String> {
    if let Some(bad) = patch.usage.iter().flatten().find(|u| !USAGES.contains(&u.as_str())) {
        return Err(format!("Unknown usage \"{bad}\""));
    }
    let patch = MetaPatch { display_name: patch.display_name, avatar_url: patch.avatar_url, usage: patch.usage };
    edit_pack(client, location, |p| Ok(set_meta(p, &patch))).await
}

pub async fn create_room_pack(client: &Client, room_id: &str, display_name: &str) -> Result<EditablePack, String> {
    let room = joined_room(client, room_id)?;
    let taken: HashSet<String> = room_packs_from_store(&room).await.into_iter().map(|(k, _)| k).collect();
    let state_key = state_key_for_name(display_name, &taken);
    let location = PackLocation::Room { room_id: room_id.to_owned(), state_key };
    edit_pack(client, &location, |current| new_pack(current, display_name)).await
}

pub async fn set_pack_favorite(client: &Client, room_id: &str, state_key: &str, favorite: bool) -> Result<(), String> {
    let lock = lock_for(FAVORITES_KEY);
    let _turn = lock.lock().await;
    let current = read_account_data(client, FAVORITES_EVENT).await?;
    let next = set_favorite(&current, room_id, state_key, favorite);
    if next != current {
        write_account_data(client, FAVORITES_EVENT, &next).await?;
    }
    Ok(())
}

pub async fn delete_room_pack(client: &Client, room_id: &str, state_key: &str) -> Result<(), String> {
    let location = PackLocation::Room { room_id: room_id.to_owned(), state_key: state_key.to_owned() };
    edit_pack(client, &location, |_| Ok(Value::Object(Map::new()))).await?;
    set_pack_favorite(client, room_id, state_key, false).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashSet;

    fn set(items: &[&str]) -> HashSet<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    fn img(url: &str, filename: &str) -> NewImage {
        NewImage { url: url.into(), body: None, info: Value::Null, filename: filename.into() }
    }

    // ── shortcodes ──────────────────────────────────────────────────────────

    #[test]
    fn shortcode_from_filename_slugs_the_stem() {
        assert_eq!(shortcode_from_filename("Party Blob.PNG", &set(&[])), "party_blob");
        assert_eq!(shortcode_from_filename("a.b.webp", &set(&[])), "a_b");
    }

    #[test]
    fn shortcode_from_filename_falls_back_when_nothing_is_left() {
        assert_eq!(shortcode_from_filename("!!!.gif", &set(&[])), "emoji");
    }

    #[test]
    fn shortcode_from_filename_avoids_taken_names() {
        assert_eq!(shortcode_from_filename("wave.png", &set(&["wave"])), "wave_2");
        assert_eq!(shortcode_from_filename("wave.png", &set(&["wave", "wave_2"])), "wave_3");
    }

    #[test]
    fn valid_shortcodes_are_what_the_formatter_recognises() {
        for ok in ["blob_cat", "+1", "a-b", "X9"] {
            assert!(is_valid_shortcode(ok), "{ok}");
        }
        for bad in ["", "a b", ":x:", "é", "a.b"] {
            assert!(!is_valid_shortcode(bad), "{bad}");
        }
    }

    // ── images ──────────────────────────────────────────────────────────────

    #[test]
    fn add_images_assigns_unique_shortcodes_and_keeps_existing() {
        let pack = json!({
            "images": { "wave": { "url": "mxc://a/wave" } },
            "x.custom": 1
        });
        let mut second = img("mxc://a/w3", "wave.png");
        second.body = Some("Wave".into());
        second.info = json!({ "w": 32, "h": 32, "mimetype": "image/png", "size": 10 });
        let (out, added) = add_images(&pack, &[img("mxc://a/w2", "wave.png"), second]);
        assert_eq!(added, vec!["wave_2", "wave_3"]);
        assert_eq!(out["images"]["wave"], json!({ "url": "mxc://a/wave" }));
        assert_eq!(out["x.custom"], json!(1));
        assert_eq!(out["images"]["wave_2"], json!({ "url": "mxc://a/w2" }));
        assert_eq!(
            out["images"]["wave_3"],
            json!({ "url": "mxc://a/w3", "body": "Wave", "info": { "w": 32, "h": 32, "mimetype": "image/png", "size": 10 } })
        );
    }

    #[test]
    fn add_images_to_an_empty_pack() {
        let (out, added) = add_images(&Value::Null, &[img("mxc://a/x", "x.png")]);
        assert_eq!(added, vec!["x"]);
        assert_eq!(out["images"]["x"]["url"], json!("mxc://a/x"));
    }

    #[test]
    fn rename_moves_entry_with_all_fields() {
        let pack = json!({ "images": { "old": { "url": "mxc://a/o", "x.extra": true }, "keep": { "url": "mxc://a/k" } } });
        let out = rename_image(&pack, "old", "new").unwrap();
        assert!(out["images"].get("old").is_none());
        assert_eq!(out["images"]["new"], json!({ "url": "mxc://a/o", "x.extra": true }));
        assert_eq!(out["images"]["keep"], json!({ "url": "mxc://a/k" }));
    }

    #[test]
    fn rename_rejects_existing_target() {
        let pack = json!({ "images": { "a": { "url": "mxc://a/a" }, "b": { "url": "mxc://a/b" } } });
        assert!(rename_image(&pack, "a", "b").is_err());
    }

    #[test]
    fn rename_rejects_invalid_target() {
        let pack = json!({ "images": { "a": { "url": "mxc://a/a" } } });
        assert!(rename_image(&pack, "a", "has space").is_err());
    }

    #[test]
    fn rename_missing_source_errs() {
        assert!(rename_image(&json!({ "images": {} }), "nope", "yes").is_err());
    }

    #[test]
    fn set_image_usage_sets_and_clears() {
        let pack = json!({ "images": { "a": { "url": "mxc://a/a" } } });
        let usage = vec!["sticker".to_string()];
        let set_ = set_image_usage(&pack, "a", Some(&usage)).unwrap();
        assert_eq!(set_["images"]["a"]["usage"], json!(["sticker"]));
        let cleared = set_image_usage(&set_, "a", None).unwrap();
        assert!(cleared["images"]["a"].get("usage").is_none());
    }

    #[test]
    fn set_image_usage_rejects_unknown_value() {
        let pack = json!({ "images": { "a": { "url": "mxc://a/a" } } });
        assert!(set_image_usage(&pack, "a", Some(&["banner".to_string()])).is_err());
    }

    #[test]
    fn set_image_body_sets_and_clears_on_empty() {
        let pack = json!({ "images": { "a": { "url": "mxc://a/a" } } });
        let with = set_image_body(&pack, "a", Some("A thing")).unwrap();
        assert_eq!(with["images"]["a"]["body"], json!("A thing"));
        let without = set_image_body(&with, "a", Some("")).unwrap();
        assert!(without["images"]["a"].get("body").is_none());
        let without2 = set_image_body(&with, "a", None).unwrap();
        assert!(without2["images"]["a"].get("body").is_none());
    }

    #[test]
    fn remove_image_removes_only_that_entry() {
        let pack = json!({ "images": { "a": { "url": "mxc://a/a" }, "b": { "url": "mxc://a/b" } }, "pack": { "display_name": "P" } });
        let out = remove_image(&pack, "a").unwrap();
        assert!(out["images"].get("a").is_none());
        assert_eq!(out["images"]["b"], json!({ "url": "mxc://a/b" }));
        assert_eq!(out["pack"], json!({ "display_name": "P" }));
        assert!(remove_image(&out, "a").is_err());
    }

    // ── pack metadata ───────────────────────────────────────────────────────

    #[test]
    fn set_meta_patches_only_given_fields() {
        let pack = json!({ "pack": { "display_name": "Old", "attribution": "someone" }, "images": {} });
        let out = set_meta(&pack, &MetaPatch { display_name: None, avatar_url: Some("mxc://a/i".into()), usage: Some(vec!["emoticon".into()]) });
        assert_eq!(out["pack"], json!({ "display_name": "Old", "attribution": "someone", "avatar_url": "mxc://a/i", "usage": ["emoticon"] }));
        let cleared = set_meta(&out, &MetaPatch { display_name: Some(String::new()), avatar_url: None, usage: Some(vec![]) });
        assert_eq!(cleared["pack"], json!({ "attribution": "someone", "avatar_url": "mxc://a/i" }));
    }

    // ── favorites ───────────────────────────────────────────────────────────

    #[test]
    fn set_favorite_adds_and_removes() {
        let rooms = json!({ "rooms": { "!other:x": { "": {} } }, "x.custom": 1 });
        let added = set_favorite(&rooms, "!r:x", "blobs", true);
        assert!(is_favorite(&added, "!r:x", "blobs"));
        assert!(is_favorite(&added, "!other:x", ""));
        assert_eq!(added["x.custom"], json!(1));
        let removed = set_favorite(&added, "!r:x", "blobs", false);
        assert!(!is_favorite(&removed, "!r:x", "blobs"));
        assert!(removed["rooms"].get("!r:x").is_none(), "an emptied room entry goes");
        assert!(is_favorite(&removed, "!other:x", ""));
    }

    // Review fix: an entry that isn't an object was listed as the default
    // pack but not recognised as a favorite, so removing it wrote nothing.
    #[test]
    fn a_favorite_entry_that_is_not_an_object_is_the_default_pack_throughout() {
        for entry in [json!(true), Value::Null, json!(1)] {
            let content = json!({ "rooms": { "!r:x": entry.clone(), "!other:x": { "": {} } } });
            assert_eq!(favorite_state_keys(&entry), vec![String::new()]);
            assert!(is_favorite(&content, "!r:x", ""), "{entry}");
            assert!(!is_favorite(&content, "!r:x", "blobs"), "{entry}");

            let removed = set_favorite(&content, "!r:x", "", false);
            assert!(!is_favorite(&removed, "!r:x", ""), "{entry}");
            assert!(removed["rooms"].get("!r:x").is_none(), "{entry}");
            assert!(is_favorite(&removed, "!other:x", ""), "{entry}");

            let added = set_favorite(&content, "!r:x", "blobs", true);
            assert!(is_favorite(&added, "!r:x", "blobs"), "{entry}");
            assert!(is_favorite(&added, "!r:x", ""), "the default pack stays a favorite: {entry}");
        }
    }

    #[test]
    fn set_favorite_leaves_content_that_already_says_so_alone() {
        let content = json!({ "rooms": { "!r:x": true }, "x.other": 1 });
        assert_eq!(set_favorite(&content, "!r:x", "blobs", false), content);
        assert_eq!(set_favorite(&content, "!r:x", "", true), content);
    }

    #[test]
    fn set_favorite_on_missing_content() {
        let out = set_favorite(&Value::Null, "!r:x", "", true);
        assert_eq!(out, json!({ "rooms": { "!r:x": { "": {} } } }));
    }

    // ── locations ───────────────────────────────────────────────────────────

    #[test]
    fn location_from_json() {
        let room: PackLocation =
            serde_json::from_value(json!({ "kind": "room", "room_id": "!a:x", "state_key": "" })).unwrap();
        assert!(matches!(room, PackLocation::Room { ref room_id, ref state_key } if room_id == "!a:x" && state_key.is_empty()));
        let user: PackLocation = serde_json::from_value(json!({ "kind": "user" })).unwrap();
        assert!(matches!(user, PackLocation::User));
    }

    #[test]
    fn location_keys_are_distinct() {
        let user = location_key(&PackLocation::User);
        let a = location_key(&PackLocation::Room { room_id: "!a:x".into(), state_key: "".into() });
        let a2 = location_key(&PackLocation::Room { room_id: "!a:x".into(), state_key: "b".into() });
        assert_ne!(user, a);
        assert_ne!(a, a2);
        assert_ne!(user, FAVORITES_KEY);
        assert_ne!(a, FAVORITES_KEY);
    }

    // ── recent-write overlay ────────────────────────────────────────────────

    #[test]
    fn overlay_prefers_a_fresh_write_over_the_store() {
        let mut o = Overlay::default();
        let now = Instant::now();
        o.note("!r", "k", json!({ "v": 2 }), now);
        assert_eq!(o.effective("!r", "k", Some(json!({ "v": 1 })), now), Some(json!({ "v": 2 })));
        assert_eq!(o.pending_for_room("!r", now), vec![("k".to_string(), json!({ "v": 2 }))]);
    }

    #[test]
    fn overlay_forgets_a_write_once_the_store_has_it() {
        let mut o = Overlay::default();
        let now = Instant::now();
        o.note("!r", "k", json!({ "v": 2 }), now);
        assert_eq!(o.effective("!r", "k", Some(json!({ "v": 2 })), now), Some(json!({ "v": 2 })));
        // Forgotten: a later (older) store value is believed again.
        assert_eq!(o.effective("!r", "k", Some(json!({ "v": 1 })), now), Some(json!({ "v": 1 })));
        assert!(o.pending_for_room("!r", now).is_empty());
    }

    #[test]
    fn overlay_ignores_an_expired_write() {
        let mut o = Overlay::default();
        let then = Instant::now();
        o.note("!r", "k", json!({ "v": 2 }), then);
        let later = then + OVERLAY_TTL + std::time::Duration::from_secs(1);
        assert_eq!(o.effective("!r", "k", Some(json!({ "v": 1 })), later), Some(json!({ "v": 1 })));
        assert!(o.pending_for_room("!r", later).is_empty());
    }

    // ── editable view ───────────────────────────────────────────────────────

    #[test]
    fn editable_pack_lists_explicit_usage_only_and_sorts_images() {
        let content = json!({
            "pack": { "display_name": "Blobs", "usage": ["sticker"] },
            "images": {
                "b": { "url": "mxc://a/b", "usage": ["emoticon"] },
                "a": { "url": "mxc://a/a", "body": "A" }
            }
        });
        let p = to_editable(&content, Some("!r:x"), Some("k"), true);
        assert_eq!(p.display_name.as_deref(), Some("Blobs"));
        assert_eq!(p.usage, Some(vec!["sticker".to_string()]));
        assert_eq!(p.images.iter().map(|i| i.shortcode.as_str()).collect::<Vec<_>>(), vec!["a", "b"]);
        assert_eq!(p.images[0].usage, None);
        assert_eq!(p.images[0].body.as_deref(), Some("A"));
        assert_eq!(p.images[1].usage, Some(vec!["emoticon".to_string()]));
        assert!(p.favorited);
        assert!(!p.read_only);
        assert_eq!(p.room_id.as_deref(), Some("!r:x"));
        assert_eq!(p.state_key.as_deref(), Some("k"));
    }

    // Review fix (spec decision 6): the legacy `{ packs: {…} }` form is shown,
    // read-only, beside the standard pack — which stays editable. It used to be
    // folded into the pack and lock the whole thing.
    #[test]
    fn editable_user_pack_keeps_legacy_images_apart_and_stays_editable() {
        let content = json!({ "packs": { "p": { "images": { "x": { "url": "mxc://a/x" } } } } });
        let p = to_editable(&content, None, None, false);
        assert!(!p.read_only);
        assert!(p.images.is_empty());
        assert_eq!(p.legacy_images.len(), 1);
        assert_eq!(p.legacy_images[0].shortcode, "x");
    }

    #[test]
    fn new_pack_refuses_to_overwrite_one_without_images() {
        assert!(new_pack(&json!({ "pack": { "display_name": "Theirs" } }), "Mine").is_err());
        assert!(new_pack(&json!({ "images": { "a": { "url": "mxc://a/a" } } }), "Mine").is_err());
    }

    #[test]
    fn new_pack_over_nothing_or_a_deleted_pack() {
        assert_eq!(new_pack(&json!({}), "Blobs").unwrap(), json!({ "pack": { "display_name": "Blobs" }, "images": {} }));
        assert_eq!(new_pack(&Value::Null, " ").unwrap(), json!({ "pack": {}, "images": {} }));
    }

    #[test]
    fn editable_pack_skips_images_without_a_url() {
        let content = json!({ "images": { "ok": { "url": "mxc://a/ok" }, "bad": { "body": "no url" } } });
        let p = to_editable(&content, None, None, false);
        assert_eq!(p.images.len(), 1);
    }

    #[test]
    fn a_deleted_pack_is_empty_content() {
        assert!(is_deleted_pack(&json!({})));
        assert!(!is_deleted_pack(&json!({ "images": {} })));
        assert!(!is_deleted_pack(&json!({ "pack": { "display_name": "New" } })));
    }

    // ── state keys ──────────────────────────────────────────────────────────

    #[test]
    fn state_key_for_name_slugs_and_dedupes() {
        assert_eq!(state_key_for_name("Blob Pack!", &set(&[])), "blob_pack");
        assert_eq!(state_key_for_name("Blob Pack!", &set(&["blob_pack"])), "blob_pack_2");
        assert_eq!(state_key_for_name("", &set(&[])), "pack");
    }

    // ── Against a homeserver (review fix): the I/O the pure tests can't see ──
    //
    // OVERLAY and LOCKS are process-wide, so every test has its own room IDs.

    mod io {
        use super::*;
        use crate::matrix::test_support::{joined_rooms, own_join, state_event, TestHomeserver, ME};
        use wiremock::matchers::method;
        use wiremock::{Mock, ResponseTemplate};

        const NOT_FOUND: &str = r#"{"errcode":"M_NOT_FOUND","error":"Not found"}"#;

        /// The state-event URL path of `room`'s pack at `key`, as matched by suffix
        /// (the room ID's `!` may arrive percent-encoded).
        fn pack_path(room_local: &str, key: &str) -> impl Fn(&wiremock::Request) -> bool + Send + Sync + 'static {
            let room_local = room_local.to_string();
            let tail = format!("/state/{ROOM_PACK_EVENT}/{key}");
            move |req: &wiremock::Request| {
                let p = req.url.path();
                p.contains(&room_local) && p.ends_with(&tail)
            }
        }

        async fn mount_state(hs: &TestHomeserver, verb: &str, room_local: &str, key: &str, status: u16, body: Value) {
            Mock::given(method(verb))
                .and(pack_path(room_local, key))
                .respond_with(ResponseTemplate::new(status).set_body_json(body))
                .mount(&hs.server)
                .await;
        }

        async fn mount_no_account_data(hs: &TestHomeserver) {
            Mock::given(method("GET"))
                .and(|req: &wiremock::Request| req.url.path().contains("/account_data/"))
                .respond_with(ResponseTemplate::new(404).set_body_raw(NOT_FOUND, "application/json"))
                .mount(&hs.server)
                .await;
        }

        /// The JSON body of the one PUT to `room`'s pack at `key`.
        async fn put_body(hs: &TestHomeserver, room_local: &str, key: &str) -> Value {
            let matches = pack_path(room_local, key);
            let puts: Vec<Value> = hs
                .server
                .received_requests()
                .await
                .unwrap_or_default()
                .iter()
                .filter(|r| r.method.as_str() == "PUT" && matches(r))
                .map(|r| serde_json::from_slice(&r.body).expect("JSON body"))
                .collect();
            assert_eq!(puts.len(), 1, "one PUT to the pack");
            puts.into_iter().next().unwrap()
        }

        fn room(local: &str) -> String {
            format!("!{local}:example.org")
        }

        fn pack_state(key: &str, content: Value) -> Value {
            state_event(ROOM_PACK_EVENT, key, ME, content)
        }

        #[tokio::test]
        async fn an_edit_keeps_another_clients_change_to_a_different_image() {
            let hs = TestHomeserver::new().await;
            let rid = room("pk-other-client");
            let stored = json!({ "images": { "a": { "url": "mxc://x/a" }, "b": { "url": "mxc://x/b" } } });
            hs.sync(joined_rooms(&[(&rid, vec![own_join(), pack_state("", stored)])])).await;
            // Since the sync, another client changed b.
            let server_now = json!({ "images": { "a": { "url": "mxc://x/a" }, "b": { "url": "mxc://x/b2" } } });
            mount_state(&hs, "GET", "pk-other-client", "", 200, server_now).await;
            mount_state(&hs, "PUT", "pk-other-client", "", 200, json!({ "event_id": "$w" })).await;
            mount_no_account_data(&hs).await;

            let loc = PackLocation::Room { room_id: rid.clone(), state_key: String::new() };
            rename_pack_image(&hs.client, &loc, "a", "c").await.expect("rename");

            let body = put_body(&hs, "pk-other-client", "").await;
            assert_eq!(body["images"]["c"], json!({ "url": "mxc://x/a" }));
            assert_eq!(body["images"]["b"], json!({ "url": "mxc://x/b2" }), "the other client's change survives");
            assert!(body["images"].get("a").is_none());
        }

        #[tokio::test]
        async fn adding_to_a_pack_the_server_does_not_have_writes_only_the_new_images() {
            let hs = TestHomeserver::new().await;
            let rid = room("pk-missing");
            hs.sync(joined_rooms(&[(&rid, vec![own_join()])])).await;
            Mock::given(method("GET"))
                .and(pack_path("pk-missing", "fresh"))
                .respond_with(ResponseTemplate::new(404).set_body_raw(NOT_FOUND, "application/json"))
                .mount(&hs.server)
                .await;
            mount_state(&hs, "PUT", "pk-missing", "fresh", 200, json!({ "event_id": "$w" })).await;
            mount_no_account_data(&hs).await;

            let loc = PackLocation::Room { room_id: rid.clone(), state_key: "fresh".into() };
            let res = add_pack_images(
                &hs.client,
                &loc,
                vec![NewImageArg { url: "mxc://x/n".into(), body: None, info: None, filename: "New One.png".into() }],
            )
            .await
            .expect("add");
            assert_eq!(res.added, vec!["new_one"]);
            assert_eq!(put_body(&hs, "pk-missing", "fresh").await, json!({ "images": { "new_one": { "url": "mxc://x/n" } } }));
        }

        #[tokio::test]
        async fn a_write_shows_before_sync_echoes_it() {
            let hs = TestHomeserver::new().await;
            let rid = room("pk-overlay");
            let stored = json!({ "images": { "a": { "url": "mxc://x/a" } } });
            hs.sync(joined_rooms(&[(&rid, vec![own_join(), pack_state("", stored.clone())])])).await;
            mount_state(&hs, "GET", "pk-overlay", "", 200, stored).await;
            mount_state(&hs, "PUT", "pk-overlay", "", 200, json!({ "event_id": "$w" })).await;
            mount_no_account_data(&hs).await;

            let loc = PackLocation::Room { room_id: rid.clone(), state_key: String::new() };
            rename_pack_image(&hs.client, &loc, "a", "renamed").await.expect("rename");

            // The store still holds `a`; the listing shows what was written.
            let packs = get_room_packs(&hs.client, &rid).await.expect("room packs");
            let codes: Vec<&str> = packs.packs[0].images.iter().map(|i| i.shortcode.as_str()).collect();
            assert_eq!(codes, vec!["renamed"]);
        }

        // Review fix: each edit asked the server for the favorites list after
        // releasing the pack's lock, so a slow answer let the next edit to the
        // pack finish first and this edit's older pack reached the editor
        // last. The view is now built under the lock, from the store.
        #[tokio::test]
        async fn an_edit_takes_the_favorite_flag_from_the_store_without_a_request() {
            let hs = TestHomeserver::new().await;
            let rid = room("pk-edit-fav");
            let stored = json!({ "images": { "a": { "url": "mxc://x/a" } } });
            let mut body = joined_rooms(&[(&rid, vec![own_join(), pack_state("", stored.clone())])]);
            body["account_data"] =
                json!({ "events": [{ "type": FAVORITES_EVENT, "content": { "rooms": { &rid: { "": {} } } } }] });
            hs.sync(body).await;
            mount_state(&hs, "GET", "pk-edit-fav", "", 200, stored).await;
            mount_state(&hs, "PUT", "pk-edit-fav", "", 200, json!({ "event_id": "$w" })).await;
            mount_no_account_data(&hs).await;

            let loc = PackLocation::Room { room_id: rid.clone(), state_key: String::new() };
            let pack = rename_pack_image(&hs.client, &loc, "a", "b").await.expect("rename");
            assert!(pack.favorited);
            assert_eq!(pack.images[0].shortcode, "b");
            assert_eq!(hs.requests_to(&format!("/account_data/{FAVORITES_EVENT}")).await, 0);
        }

        /// Answer `GET` of the favorites account data with `content`.
        async fn mount_favorites(hs: &TestHomeserver, content: Value) {
            Mock::given(method("GET"))
                .and(|req: &wiremock::Request| req.url.path().ends_with(&format!("/account_data/{FAVORITES_EVENT}")))
                .respond_with(ResponseTemplate::new(200).set_body_json(content))
                .mount(&hs.server)
                .await;
        }

        // Review fix: a favorite from a room since left still works (emoji.rs
        // reads its pack from the stored state), so Settings lists it by name,
        // marked not joined, rather than as a nameless "pack".
        #[tokio::test]
        async fn a_favorite_from_a_room_since_left_is_listed_by_name() {
            let hs = TestHomeserver::new().await;
            let rid = room("pk-fav-left");
            let pack = pack_state("", json!({ "pack": { "display_name": "Old" }, "images": { "o": { "url": "mxc://x/o" } } }));
            hs.sync(joined_rooms(&[(&rid, vec![own_join(), pack])])).await;
            let leave = state_event("m.room.member", ME, ME, json!({ "membership": "leave" }));
            hs.sync(json!({
                "next_batch": "pk-fav-left-batch",
                "rooms": { "leave": { &rid: { "state": { "events": [] }, "timeline": { "events": [leave] } } } }
            }))
            .await;
            mount_favorites(&hs, json!({ "rooms": { &rid: { "": {} } } })).await;

            let favs = get_favorite_packs(&hs.client).await.expect("favorites");
            assert_eq!(favs.len(), 1);
            assert!(!favs[0].joined);
            assert_eq!(favs[0].display_name.as_deref(), Some("Old"));
            assert_eq!(favs[0].image_count, 1);
        }

        fn power_levels(my_level: i64) -> Value {
            state_event(
                "m.room.power_levels",
                "",
                ME,
                json!({
                    "users": { ME: my_level },
                    "users_default": 0,
                    "events": { ROOM_PACK_EVENT: 50 },
                    "state_default": 50,
                    "events_default": 0
                }),
            )
        }

        #[tokio::test]
        async fn without_power_for_packs_the_room_is_read_only() {
            let hs = TestHomeserver::new().await;
            let low = room("pk-low-power");
            let high = room("pk-high-power");
            hs.sync(joined_rooms(&[
                (&low, vec![own_join(), power_levels(0)]),
                (&high, vec![own_join(), power_levels(50)]),
            ]))
            .await;
            mount_no_account_data(&hs).await;
            assert!(!get_room_packs(&hs.client, &low).await.expect("low").can_edit);
            assert!(get_room_packs(&hs.client, &high).await.expect("high").can_edit);
        }
    }
}
