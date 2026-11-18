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

use serde_json::{Map, Value};
use std::collections::HashSet;

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

/// Add or remove one room pack in `im.ponies.emote_rooms` content. A room left
/// with no packs is removed from the map.
pub fn set_favorite(emote_rooms: &Value, room_id: &str, state_key: &str, favorite: bool) -> Value {
    let mut content = as_object(emote_rooms);
    let rooms = content.entry("rooms").or_insert_with(|| Value::Object(Map::new()));
    if !rooms.is_object() {
        *rooms = Value::Object(Map::new());
    }
    let rooms = rooms.as_object_mut().expect("just made an object");
    if favorite {
        let keys = rooms.entry(room_id).or_insert_with(|| Value::Object(Map::new()));
        if !keys.is_object() {
            *keys = Value::Object(Map::new());
        }
        keys.as_object_mut()
            .expect("just made an object")
            .entry(state_key)
            .or_insert_with(|| Value::Object(Map::new()));
    } else if let Some(keys) = rooms.get_mut(room_id).and_then(Value::as_object_mut) {
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
        .and_then(Value::as_object)
        .is_some_and(|keys| keys.contains_key(state_key))
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

    #[test]
    fn set_favorite_on_missing_content() {
        let out = set_favorite(&Value::Null, "!r:x", "", true);
        assert_eq!(out, json!({ "rooms": { "!r:x": { "": {} } } }));
    }

    // ── state keys ──────────────────────────────────────────────────────────

    #[test]
    fn state_key_for_name_slugs_and_dedupes() {
        assert_eq!(state_key_for_name("Blob Pack!", &set(&[])), "blob_pack");
        assert_eq!(state_key_for_name("Blob Pack!", &set(&["blob_pack"])), "blob_pack_2");
        assert_eq!(state_key_for_name("", &set(&[])), "pack");
    }
}
