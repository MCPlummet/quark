use crate::matrix::packs::{self, FAVORITES_EVENT, USER_PACK_EVENT};
use matrix_sdk::{ruma::RoomId, Client, RoomState};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet, VecDeque};
use tracing::warn;

/// A single emoji entry within a pack.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmojiEntry {
    /// The shortcode (key in the pack images map).
    pub shortcode: String,
    /// The mxc:// URL of the emoji image.
    pub url: String,
    /// Body/description of the emoji.
    pub body: Option<String>,
    /// Usage: ["emoticon"], ["sticker"], or ["emoticon", "sticker"]
    pub usage: Vec<String>,
}

/// An emoji pack (from im.ponies.room_emotes or im.ponies.user_emotes).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmojiPack {
    pub pack_id: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    /// Source: "room" or "user"
    pub source: String,
    /// The room_id if source == "room"
    pub room_id: Option<String>,
    pub emojis: Vec<EmojiEntry>,
    /// The pack's state key, for a room or space pack.
    #[serde(default)]
    pub state_key: Option<String>,
    /// Listed in the user's im.ponies.emote_rooms (usable in every room).
    #[serde(default)]
    pub favorited: bool,
    /// Why this pack is offered here: "room" (the room's own), "space" (a
    /// joined space containing the room), "user" (personal) or "favorite".
    #[serde(default)]
    pub scope: String,
}

/// Parse raw state event content for im.ponies.room_emotes or im.ponies.user_emotes.
fn parse_ponies_pack(
    pack_id: &str,
    source: &str,
    room_id: Option<&str>,
    value: &Value,
) -> Option<EmojiPack> {
    let pack_meta = value.get("pack");
    let display_name = pack_meta
        .and_then(|m| m.get("display_name"))
        .and_then(|v| v.as_str())
        .map(String::from);
    let avatar_url = pack_meta
        .and_then(|m| m.get("avatar_url"))
        .and_then(|v| v.as_str())
        .map(String::from);
    // If the pack has no explicit `usage` field, default to both emoticon and
    // sticker so that packs that omit usage (common in real-world deployments)
    // are not incorrectly excluded from either picker.
    let pack_usage: Vec<String> = pack_meta
        .and_then(|m| m.get("usage"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|u| u.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_else(|| vec!["emoticon".to_string(), "sticker".to_string()]);

    let images = value.get("images")?.as_object()?;

    let mut emojis = Vec::new();

    for (shortcode, img_data) in images {
        let url = img_data
            .get("url")
            .and_then(|v| v.as_str())
            .map(String::from)?;

        let body = img_data
            .get("body")
            .and_then(|v| v.as_str())
            .map(String::from);

        let usage: Vec<String> = img_data
            .get("usage")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|u| u.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_else(|| pack_usage.clone());

        emojis.push(EmojiEntry {
            shortcode: shortcode.clone(),
            url,
            body,
            usage,
        });
    }

    Some(EmojiPack {
        pack_id: pack_id.to_string(),
        display_name,
        avatar_url,
        source: source.to_string(),
        room_id: room_id.map(String::from),
        emojis,
        state_key: None,
        favorited: false,
        scope: source.to_string(),
    })
}

/// The joined spaces above `room`, nearest first (parents, then theirs, …),
/// each once. `parents` maps a room to the joined spaces listing it as a child.
pub fn ancestors_nearest_first(parents: &HashMap<String, Vec<String>>, room: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen: HashSet<&str> = HashSet::from([room]);
    let mut queue: VecDeque<&str> = VecDeque::from([room]);
    while let Some(current) = queue.pop_front() {
        for parent in parents.get(current).into_iter().flatten() {
            if seen.insert(parent.as_str()) {
                out.push(parent.clone());
                queue.push_back(parent.as_str());
            }
        }
    }
    out
}

/// Packs in the order a shortcode is resolved (first wins): the room's own,
/// then its spaces nearest first, then the personal pack, then favorites. A
/// favorite already listed as the room's or a space's pack is dropped and that
/// listing marked favorited.
pub fn order_packs(
    room: Vec<EmojiPack>,
    spaces: Vec<EmojiPack>,
    user: Vec<EmojiPack>,
    favorites: Vec<EmojiPack>,
) -> Vec<EmojiPack> {
    let mut out: Vec<EmojiPack> = room.into_iter().chain(spaces).collect();
    let place = |p: &EmojiPack| (p.room_id.clone(), p.state_key.clone());
    let listed: HashMap<(Option<String>, Option<String>), usize> =
        out.iter().enumerate().map(|(i, p)| (place(p), i)).collect();
    let mut kept_favorites = Vec::new();
    for fav in favorites {
        match listed.get(&place(&fav)) {
            Some(&i) => out[i].favorited = true,
            None => kept_favorites.push(fav),
        }
    }
    out.extend(user);
    out.extend(kept_favorites);
    out
}

/// A room or space's packs as `EmojiPack`s, from the store (with recent writes).
async fn packs_of_room(room: &matrix_sdk::Room, scope: &str, favorites: &Value) -> Vec<EmojiPack> {
    let rid = room.room_id().as_str();
    let mut out = Vec::new();
    for (state_key, content) in packs::room_packs_from_store(room).await {
        let pack_id = if state_key.is_empty() { format!("room_{rid}") } else { format!("room_{rid}_{state_key}") };
        if let Some(mut pack) = parse_ponies_pack(&pack_id, "room", Some(rid), &content) {
            pack.favorited = packs::is_favorite(favorites, rid, &state_key);
            pack.state_key = Some(state_key);
            pack.scope = scope.to_string();
            out.push(pack);
        }
    }
    out
}

/// Joined spaces' children: child room → the joined spaces listing it.
async fn joined_space_parents(client: &Client) -> HashMap<String, Vec<String>> {
    let mut parents: HashMap<String, Vec<String>> = HashMap::new();
    for space in client.joined_rooms().into_iter().filter(|r| r.is_space()) {
        for child in crate::matrix::spaces::child_room_ids(&space).await {
            parents.entry(child).or_default().push(space.room_id().to_string());
        }
    }
    for list in parents.values_mut() {
        list.sort();
    }
    parents
}

async fn account_data(client: &Client, event_type: &str) -> Option<Value> {
    match client
        .account()
        .fetch_account_data(matrix_sdk::ruma::events::GlobalAccountDataEventType::from(event_type))
        .await
    {
        Ok(raw) => raw.and_then(|r| r.deserialize_as::<Value>().ok()),
        Err(e) => {
            warn!("Failed to fetch {event_type}: {e}");
            None
        }
    }
}

/// Load all emoji packs usable in `room_id` (or anywhere, for `None`), in the
/// order a shortcode is resolved: see `order_packs`.
///
/// - the room's own `im.ponies.room_emotes` packs (every state key);
/// - the packs of every joined space containing the room, nearest first (#12);
/// - the personal pack, `im.ponies.user_emotes`;
/// - favorites, `im.ponies.emote_rooms`, not already listed above.
pub async fn get_emoji_packs(
    client: &Client,
    room_id: Option<&str>,
) -> Result<Vec<EmojiPack>, String> {
    let favorites = account_data(client, FAVORITES_EVENT).await.unwrap_or(Value::Null);

    let mut room_packs = Vec::new();
    let mut space_packs = Vec::new();
    if let Some(rid) = room_id {
        let parsed = RoomId::parse(rid).map_err(|e| format!("Invalid room ID: {e}"))?;
        if let Some(room) = client.get_room(&parsed) {
            room_packs = packs_of_room(&room, "room", &favorites).await;
        }
        let parents = joined_space_parents(client).await;
        for space_id in ancestors_nearest_first(&parents, rid) {
            let space = RoomId::parse(space_id.as_str()).ok().and_then(|id| client.get_room(&id));
            if let Some(space) = space {
                space_packs.extend(packs_of_room(&space, "space", &favorites).await);
            }
        }
    }

    // The personal pack. Some content carries a `packs` map (a non-standard
    // multi-pack form); each is offered, as before.
    let mut user_packs = Vec::new();
    if let Some(value) = account_data(client, USER_PACK_EVENT).await {
        if let Some(pack) = parse_ponies_pack("user_default", "user", None, &value) {
            user_packs.push(pack);
        }
        if let Some(map) = value.get("packs").and_then(|p| p.as_object()) {
            for (pack_id, pack_data) in map {
                if let Some(pack) = parse_ponies_pack(pack_id, "user", None, pack_data) {
                    user_packs.push(pack);
                }
            }
        }
    }

    // Favorites: { "rooms": { "!room:server": { "": {}, "pack-key": {} } } }.
    let mut favorite_packs = Vec::new();
    if let Some(rooms) = favorites.get("rooms").and_then(|r| r.as_object()) {
        for (fav_rid, keys) in rooms {
            let Some(room) = RoomId::parse(fav_rid.as_str())
                .ok()
                .and_then(|id| client.get_room(&id))
                .filter(|r| r.state() == RoomState::Joined)
            else {
                continue;
            };
            let wanted: Vec<String> = keys
                .as_object()
                .map(|o| o.keys().cloned().collect())
                .unwrap_or_else(|| vec![String::new()]);
            for mut pack in packs_of_room(&room, "favorite", &favorites).await {
                if pack.state_key.as_deref().is_some_and(|k| wanted.iter().any(|w| w == k)) {
                    pack.favorited = true;
                    favorite_packs.push(pack);
                }
            }
        }
    }

    Ok(order_packs(room_packs, space_packs, user_packs, favorite_packs))
}

/// Resolve a shortcode to its mxc:// URL from the given packs.
pub fn resolve_shortcode(packs: &[EmojiPack], shortcode: &str) -> Option<String> {
    for pack in packs {
        for emoji in &pack.emojis {
            if emoji.shortcode == shortcode {
                return Some(emoji.url.clone());
            }
        }
    }
    None
}

/// Filter emojis from a pack to only those usable as emoticons.
pub fn emoticons(pack: &EmojiPack) -> Vec<&EmojiEntry> {
    pack.emojis
        .iter()
        .filter(|e| e.usage.iter().any(|u| u == "emoticon"))
        .collect()
}

/// Filter emojis from a pack to only those usable as stickers.
pub fn stickers(pack: &EmojiPack) -> Vec<&EmojiEntry> {
    pack.emojis
        .iter()
        .filter(|e| e.usage.iter().any(|u| u == "sticker"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json;

    fn make_entry(shortcode: &str, url: &str, usage: Vec<&str>) -> EmojiEntry {
        EmojiEntry {
            shortcode: shortcode.to_string(),
            url: url.to_string(),
            body: None,
            usage: usage.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn make_pack(pack_id: &str, source: &str, emojis: Vec<EmojiEntry>) -> EmojiPack {
        EmojiPack {
            pack_id: pack_id.to_string(),
            display_name: Some("Test Pack".to_string()),
            avatar_url: None,
            source: source.to_string(),
            room_id: None,
            emojis,
            state_key: None,
            favorited: false,
            scope: source.to_string(),
        }
    }

    // --- Serialization roundtrip ---

    #[test]
    fn test_emoji_entry_serialization_roundtrip() {
        let entry = EmojiEntry {
            shortcode: "wave".to_string(),
            url: "mxc://example.com/wave".to_string(),
            body: Some("Waving hand".to_string()),
            usage: vec!["emoticon".to_string()],
        };
        let json = serde_json::to_string(&entry).expect("serialize");
        let back: EmojiEntry = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.shortcode, "wave");
        assert_eq!(back.url, "mxc://example.com/wave");
        assert_eq!(back.body.as_deref(), Some("Waving hand"));
        assert_eq!(back.usage, vec!["emoticon"]);
    }

    #[test]
    fn test_emoji_entry_no_body_serializes_null() {
        let entry = make_entry("tada", "mxc://example.com/tada", vec!["sticker"]);
        let json = serde_json::to_string(&entry).expect("serialize");
        assert!(json.contains("\"body\":null"));
    }

    #[test]
    fn test_emoji_pack_serialization_roundtrip() {
        let pack = EmojiPack {
            pack_id: "pack_001".to_string(),
            display_name: Some("Blob Pack".to_string()),
            avatar_url: Some("mxc://example.com/avatar".to_string()),
            source: "room".to_string(),
            room_id: Some("!abc:example.com".to_string()),
            emojis: vec![make_entry("blobhug", "mxc://example.com/blobhug", vec!["emoticon"])],
            state_key: None,
            favorited: false,
            scope: "room".to_string(),
        };
        let json = serde_json::to_string(&pack).expect("serialize");
        let back: EmojiPack = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.pack_id, "pack_001");
        assert_eq!(back.display_name.as_deref(), Some("Blob Pack"));
        assert_eq!(back.source, "room");
        assert_eq!(back.emojis.len(), 1);
        assert_eq!(back.emojis[0].shortcode, "blobhug");
    }

    #[test]
    fn test_emoji_pack_optional_fields_can_be_none() {
        let pack = EmojiPack {
            pack_id: "minimal".to_string(),
            display_name: None,
            avatar_url: None,
            source: "user".to_string(),
            room_id: None,
            emojis: vec![],
            state_key: None,
            favorited: false,
            scope: "user".to_string(),
        };
        let json = serde_json::to_string(&pack).expect("serialize");
        let back: EmojiPack = serde_json::from_str(&json).expect("deserialize");
        assert!(back.display_name.is_none());
        assert!(back.avatar_url.is_none());
        assert!(back.room_id.is_none());
        assert!(back.emojis.is_empty());
    }

    // --- Space ancestors and precedence (#12) ---

    fn parents(edges: &[(&str, &[&str])]) -> HashMap<String, Vec<String>> {
        edges
            .iter()
            .map(|(child, ps)| (child.to_string(), ps.iter().map(|p| p.to_string()).collect()))
            .collect()
    }

    #[test]
    fn ancestors_direct_parent_first() {
        assert_eq!(ancestors_nearest_first(&parents(&[("!r", &["!s"])]), "!r"), vec!["!s"]);
    }

    #[test]
    fn ancestors_include_grandparents_after_parents() {
        let p = parents(&[("!r", &["!s1", "!s2"]), ("!s1", &["!g"])]);
        assert_eq!(ancestors_nearest_first(&p, "!r"), vec!["!s1", "!s2", "!g"]);
    }

    #[test]
    fn ancestors_survive_a_cycle() {
        let p = parents(&[("!r", &["!s1"]), ("!s1", &["!s2"]), ("!s2", &["!s1", "!r"])]);
        assert_eq!(ancestors_nearest_first(&p, "!r"), vec!["!s1", "!s2"]);
    }

    #[test]
    fn ancestors_of_unparented_room_is_empty() {
        assert!(ancestors_nearest_first(&parents(&[]), "!r").is_empty());
    }

    fn scoped(pack_id: &str, scope: &str, room_id: Option<&str>, state_key: Option<&str>) -> EmojiPack {
        let mut p = make_pack(pack_id, if scope == "user" { "user" } else { "room" }, vec![]);
        p.scope = scope.to_string();
        p.room_id = room_id.map(String::from);
        p.state_key = state_key.map(String::from);
        p
    }

    #[test]
    fn pack_order_room_then_spaces_then_user_then_favorites() {
        let room = vec![scoped("r", "room", Some("!r"), Some(""))];
        let spaces = vec![scoped("s", "space", Some("!s"), Some("blobs"))];
        let user = vec![scoped("u", "user", None, None)];
        let favorites = vec![
            scoped("dup", "favorite", Some("!s"), Some("blobs")),
            scoped("f", "favorite", Some("!f"), Some("")),
        ];
        let ordered = order_packs(room, spaces, user, favorites);
        let ids: Vec<&str> = ordered.iter().map(|p| p.pack_id.as_str()).collect();
        assert_eq!(ids, vec!["r", "s", "u", "f"]);
        assert!(ordered[1].favorited, "the space pack the favorite duplicated is marked favorited");
        assert!(!ordered[0].favorited);
    }

    // --- Usage type filtering ---

    #[test]
    fn test_emoticons_filter() {
        let pack = make_pack("p", "room", vec![
            make_entry("wave", "mxc://a/wave", vec!["emoticon"]),
            make_entry("blob", "mxc://a/blob", vec!["sticker"]),
            make_entry("both", "mxc://a/both", vec!["emoticon", "sticker"]),
        ]);
        let result = emoticons(&pack);
        let shortcodes: Vec<&str> = result.iter().map(|e| e.shortcode.as_str()).collect();
        assert!(shortcodes.contains(&"wave"));
        assert!(shortcodes.contains(&"both"));
        assert!(!shortcodes.contains(&"blob"));
    }

    #[test]
    fn test_stickers_filter() {
        let pack = make_pack("p", "room", vec![
            make_entry("wave", "mxc://a/wave", vec!["emoticon"]),
            make_entry("blob", "mxc://a/blob", vec!["sticker"]),
            make_entry("both", "mxc://a/both", vec!["emoticon", "sticker"]),
        ]);
        let result = stickers(&pack);
        let shortcodes: Vec<&str> = result.iter().map(|e| e.shortcode.as_str()).collect();
        assert!(shortcodes.contains(&"blob"));
        assert!(shortcodes.contains(&"both"));
        assert!(!shortcodes.contains(&"wave"));
    }

    #[test]
    fn test_emoticon_only_pack_has_no_stickers() {
        let pack = make_pack("p", "user", vec![
            make_entry("a", "mxc://x/a", vec!["emoticon"]),
            make_entry("b", "mxc://x/b", vec!["emoticon"]),
        ]);
        assert!(stickers(&pack).is_empty());
        assert_eq!(emoticons(&pack).len(), 2);
    }

    #[test]
    fn test_sticker_only_pack_has_no_emoticons() {
        let pack = make_pack("p", "user", vec![
            make_entry("s1", "mxc://x/s1", vec!["sticker"]),
        ]);
        assert!(emoticons(&pack).is_empty());
        assert_eq!(stickers(&pack).len(), 1);
    }

    // --- resolve_shortcode ---

    #[test]
    fn test_resolve_shortcode_found() {
        let pack = make_pack("p", "room", vec![
            make_entry("wave", "mxc://example.com/wave", vec!["emoticon"]),
            make_entry("tada", "mxc://example.com/tada", vec!["sticker"]),
        ]);
        assert_eq!(
            resolve_shortcode(&[pack], "wave"),
            Some("mxc://example.com/wave".to_string())
        );
    }

    #[test]
    fn test_resolve_shortcode_not_found() {
        let pack = make_pack("p", "room", vec![
            make_entry("wave", "mxc://example.com/wave", vec!["emoticon"]),
        ]);
        assert_eq!(resolve_shortcode(&[pack], "nonexistent"), None);
    }

    #[test]
    fn test_resolve_shortcode_first_match_wins() {
        let pack1 = make_pack("p1", "room", vec![
            make_entry("wave", "mxc://example.com/wave1", vec!["emoticon"]),
        ]);
        let pack2 = make_pack("p2", "user", vec![
            make_entry("wave", "mxc://example.com/wave2", vec!["emoticon"]),
        ]);
        // First pack's URL should be returned
        assert_eq!(
            resolve_shortcode(&[pack1, pack2], "wave"),
            Some("mxc://example.com/wave1".to_string())
        );
    }

    #[test]
    fn test_resolve_shortcode_empty_packs() {
        assert_eq!(resolve_shortcode(&[], "wave"), None);
    }

    #[test]
    fn test_resolve_shortcode_searches_multiple_packs() {
        let pack1 = make_pack("p1", "room", vec![
            make_entry("smile", "mxc://example.com/smile", vec!["emoticon"]),
        ]);
        let pack2 = make_pack("p2", "user", vec![
            make_entry("cry", "mxc://example.com/cry", vec!["emoticon"]),
        ]);
        assert_eq!(
            resolve_shortcode(&[pack1, pack2], "cry"),
            Some("mxc://example.com/cry".to_string())
        );
    }

    // Review fix: the space walk against a homeserver's synced state.
    mod io {
        use super::*;
        use crate::matrix::test_support::{joined_rooms, own_join, space_child, space_create, state_event, TestHomeserver, ME};
        use serde_json::json;

        #[tokio::test]
        async fn a_space_pack_is_offered_in_the_space_rooms_only() {
            let hs = TestHomeserver::new().await;
            let space = "!emoji-space:example.org";
            let inside = "!emoji-inside:example.org";
            let outside = "!emoji-outside:example.org";
            let pack = state_event(
                "im.ponies.room_emotes",
                "",
                ME,
                json!({ "pack": { "display_name": "Work" }, "images": { "workblob": { "url": "mxc://x/w" } } }),
            );
            hs.sync(joined_rooms(&[
                (space, vec![own_join(), space_create(), space_child(inside), pack]),
                (inside, vec![own_join()]),
                (outside, vec![own_join()]),
            ]))
            .await;

            let in_room = get_emoji_packs(&hs.client, Some(inside)).await.expect("inside");
            let space_pack = in_room.iter().find(|p| p.room_id.as_deref() == Some(space)).expect("space pack offered");
            assert_eq!(space_pack.scope, "space");
            assert_eq!(space_pack.emojis[0].shortcode, "workblob");

            let elsewhere = get_emoji_packs(&hs.client, Some(outside)).await.expect("outside");
            assert!(elsewhere.iter().all(|p| p.room_id.as_deref() != Some(space)));
        }
    }
}
