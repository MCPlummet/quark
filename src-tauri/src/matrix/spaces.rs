use matrix_sdk::{
    ruma::{
        events::StateEventType,
        RoomId,
    },
    Client,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Semaphore;
use tracing::{info, warn};

use super::space_order::{between, compare_children, order_updates, sanitize_order, ChildKey};

/// A child room/space in a space hierarchy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpaceChild {
    pub room_id: String,
    pub name: Option<String>,
    pub topic: Option<String>,
    pub avatar_url: Option<String>,
    pub is_space: bool,
    pub member_count: Option<u64>,
    /// The `order` field from the m.space.child event.
    pub order: Option<String>,
    pub canonical_alias: Option<String>,
}

/// Resolve the direct children of a space room.
pub async fn get_space_hierarchy(
    client: &Client,
    space_room_id: &str,
    max_depth: Option<u8>,
) -> Result<Vec<SpaceChild>, String> {
    let room_id =
        RoomId::parse(space_room_id).map_err(|e| format!("Invalid room ID: {e}"))?;

    use matrix_sdk::ruma::api::client::space::get_hierarchy::v1::Request as HierarchyRequest;

    let mut request = HierarchyRequest::new(room_id.clone());
    request.max_depth = max_depth.map(|d| d.into());
    request.limit = Some(matrix_sdk::ruma::UInt::from(100u32));
    request.suggested_only = false;

    let response = client
        .send(request, None)
        .await
        .map_err(|e| format!("Failed to get space hierarchy: {e}"))?;

    let children: Vec<SpaceChild> = response
        .rooms
        .iter()
        .skip(1) // First room is the space itself
        .map(|room_summary| {
            let is_space = room_summary
                .room_type
                .as_ref()
                .map(|t| t == &matrix_sdk::ruma::room::RoomType::Space)
                .unwrap_or(false);

            SpaceChild {
                room_id: room_summary.room_id.to_string(),
                name: room_summary.name.clone().map(String::from),
                topic: room_summary.topic.clone(),
                avatar_url: room_summary.avatar_url.as_ref().map(|u| u.to_string()),
                is_space,
                member_count: Some(room_summary.num_joined_members.into()),
                order: None,
                canonical_alias: room_summary.canonical_alias.as_ref().map(|a| a.to_string()),
            }
        })
        .collect();

    // Enrich with order fields from the parent room's m.space.child state events
    let enriched = enrich_with_order(client, &room_id, children).await;

    Ok(enriched)
}

/// Read m.space.child state events from the parent to get ordering info.
async fn enrich_with_order(
    client: &Client,
    parent_id: &RoomId,
    children: Vec<SpaceChild>,
) -> Vec<SpaceChild> {
    let room = match client.get_room(parent_id) {
        Some(r) => r,
        None => return children,
    };

    let event_type = StateEventType::from("m.space.child");
    let semaphore = Arc::new(Semaphore::new(8));
    let mut tasks = tokio::task::JoinSet::new();

    for mut child in children {
        let room = room.clone();
        let event_type = event_type.clone();
        let permit = semaphore.clone().acquire_owned().await.unwrap();

        tasks.spawn(async move {
            let _permit = permit;
            let child_room_id_str = child.room_id.clone();

            match room.get_state_event(event_type, child_room_id_str.as_str()).await {
                Ok(Some(raw)) => {
                    use serde_json::Value;
                    let raw_json: Option<Value> = match raw {
                        matrix_sdk::deserialized_responses::RawAnySyncOrStrippedState::Sync(r) => {
                            r.deserialize_as::<Value>().ok()
                        }
                        matrix_sdk::deserialized_responses::RawAnySyncOrStrippedState::Stripped(r) => {
                            r.deserialize_as::<Value>().ok()
                        }
                    };
                    if let Some(value) = raw_json {
                        let content = value.get("content").unwrap_or(&value);
                        if let Some(order) = content
                            .get("order")
                            .and_then(|v| v.as_str())
                            .map(String::from)
                        {
                            child.order = Some(order);
                        }
                    }
                }
                Ok(None) => {}
                Err(e) => {
                    warn!("Failed to get m.space.child for {}: {}", child.room_id, e);
                }
            }
            child
        });
    }

    let mut enriched = Vec::new();
    while let Some(res) = tasks.join_next().await {
        if let Ok(child) = res {
            enriched.push(child);
        }
    }

    // Same listing order as the local path and the reorder computation.
    enriched.sort_by(compare_space_children);

    enriched
}

fn child_key(child: &SpaceChild) -> ChildKey {
    ChildKey {
        room_id: child.room_id.clone(),
        order: sanitize_order(child.order.as_deref()),
        name: child.name.clone().unwrap_or_default(),
    }
}

fn compare_space_children(a: &SpaceChild, b: &SpaceChild) -> std::cmp::Ordering {
    compare_children(&child_key(a), &child_key(b))
}

/// One `m.space.child` event of a joined space, as read from the local store.
struct ChildEvent {
    room_id: String,
    /// The event content, kept whole so a reorder rewrites `order` and
    /// nothing else (`via`, `suggested`, anything a newer spec adds).
    content: serde_json::Map<String, serde_json::Value>,
}

/// The live `m.space.child` events of a joined space.
///
/// A child event whose `via` is missing or empty is how a child is *removed*
/// (state events cannot be deleted), so those are skipped.
async fn read_child_events(space: &matrix_sdk::Room) -> Result<Vec<ChildEvent>, String> {
    let raw_events = space
        .get_state_events(StateEventType::from("m.space.child"))
        .await
        .map_err(|e| format!("Failed to read space children: {e}"))?;

    let mut out = Vec::new();
    for raw in raw_events {
        let value: Option<serde_json::Value> = match raw {
            matrix_sdk::deserialized_responses::RawAnySyncOrStrippedState::Sync(r) => {
                r.deserialize_as::<serde_json::Value>().ok()
            }
            matrix_sdk::deserialized_responses::RawAnySyncOrStrippedState::Stripped(r) => {
                r.deserialize_as::<serde_json::Value>().ok()
            }
        };
        let Some(value) = value else { continue };
        let Some(room_id) = value.get("state_key").and_then(|v| v.as_str()) else { continue };
        let Some(content) = value.get("content").and_then(|v| v.as_object()) else { continue };
        let has_via = content
            .get("via")
            .and_then(|v| v.as_array())
            .is_some_and(|via| !via.is_empty());
        if !has_via || RoomId::parse(room_id).is_err() {
            continue;
        }
        out.push(ChildEvent { room_id: room_id.to_owned(), content: content.clone() });
    }
    Ok(out)
}

/// Order strings this process has written but sync has not yet echoed back,
/// by space and then child.
///
/// A reorder is several `m.space.child` writes, and the local store only learns
/// of them when sync returns them. Until then a read of the space would list
/// the old order — a refresh landing in that window put a just-moved room back
/// where it came from for a second — and a second move made in quick
/// succession would be computed from orders already overwritten. Reads layer
/// these on top of the store; each entry goes once the store agrees, or after
/// [`PENDING_ORDER_TTL`] if the echo never comes.
type PendingBySpace = HashMap<String, HashMap<String, (String, std::time::Instant)>>;
static PENDING_ORDERS: std::sync::LazyLock<std::sync::Mutex<PendingBySpace>> =
    std::sync::LazyLock::new(Default::default);

const PENDING_ORDER_TTL: std::time::Duration = std::time::Duration::from_secs(120);

/// Reorders of one process run one at a time, so each is computed from the
/// writes of the one before it.
static REORDER_TURN: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn note_pending_order(space_id: &str, child_id: &str, order: &str) {
    if let Ok(mut pending) = PENDING_ORDERS.lock() {
        pending
            .entry(space_id.to_owned())
            .or_default()
            .insert(child_id.to_owned(), (order.to_owned(), std::time::Instant::now()));
    }
}

fn forget_pending_order(space_id: &str, child_id: &str) {
    if let Ok(mut pending) = PENDING_ORDERS.lock() {
        if let Some(children) = pending.get_mut(space_id) {
            children.remove(child_id);
            if children.is_empty() {
                pending.remove(space_id);
            }
        }
    }
}

/// The order to list `child_id` by: a pending write if there is one the store
/// has not caught up with, else what the store holds.
fn effective_order(space_id: &str, child_id: &str, stored: Option<String>) -> Option<String> {
    let Ok(mut pending) = PENDING_ORDERS.lock() else { return stored };
    let Some(children) = pending.get_mut(space_id) else { return stored };
    let result = match children.get(child_id) {
        Some((order, at)) if at.elapsed() < PENDING_ORDER_TTL && stored.as_deref() != Some(order) => {
            Some(order.clone())
        }
        Some(_) => {
            children.remove(child_id);
            stored
        }
        None => stored,
    };
    if children.is_empty() {
        pending.remove(space_id);
    }
    result
}

/// The joined space room for `space_room_id`, or `None` when this account is
/// not in it (an unjoined subspace, say), whose state we do not hold.
fn joined_space(client: &Client, space_room_id: &RoomId) -> Option<matrix_sdk::Room> {
    client
        .get_room(space_room_id)
        .filter(|room| room.state() == matrix_sdk::RoomState::Joined)
}

/// `/hierarchy` answers for spaces this account has not joined, by space ID.
///
/// The room list re-reads a space's children on every room-list change, and a
/// space can have subspaces this account never joined; without this, each of
/// those was a (possibly federated) server request per refresh — the shape of
/// load this app has put on a homeserver before. Their children change rarely
/// and are only used to draw sections, so a few minutes stale is fine.
type HierarchyCache = HashMap<String, (std::time::Instant, Vec<SpaceChild>)>;
static HIERARCHY_CACHE: std::sync::LazyLock<std::sync::Mutex<HierarchyCache>> =
    std::sync::LazyLock::new(Default::default);

const HIERARCHY_TTL: std::time::Duration = std::time::Duration::from_secs(300);

async fn hierarchy_cached(client: &Client, space_room_id: &str) -> Result<Vec<SpaceChild>, String> {
    if let Ok(cache) = HIERARCHY_CACHE.lock() {
        if let Some((at, children)) = cache.get(space_room_id) {
            if at.elapsed() < HIERARCHY_TTL {
                return Ok(children.clone());
            }
        }
    }
    let children = get_space_hierarchy(client, space_room_id, Some(1)).await?;
    if let Ok(mut cache) = HIERARCHY_CACHE.lock() {
        cache.insert(space_room_id.to_owned(), (std::time::Instant::now(), children.clone()));
    }
    Ok(children)
}

/// The direct children of a space, in listing order.
///
/// Read from the local store whenever this account has joined the space — no
/// HTTP, and current with sync, which matters because the room list re-reads
/// every space's children on every room-list change. `/hierarchy` used to
/// serve this; it is a server round-trip per space per refresh, and it lagged
/// a reorder or a new child until the server's own view caught up. It is kept
/// as the fallback for a space this account has not joined.
///
/// Children are described from the local room when this account knows it;
/// one it has never seen has only its ID, and is never shown in the room list
/// anyway (that lists joined rooms).
pub async fn get_space_children(
    client: &Client,
    space_room_id: &str,
) -> Result<Vec<SpaceChild>, String> {
    let space_id = RoomId::parse(space_room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let Some(space) = joined_space(client, &space_id) else {
        return hierarchy_cached(client, space_room_id).await;
    };

    let mut children = Vec::new();
    for event in read_child_events(&space).await? {
        let stored = event
            .content
            .get("order")
            .and_then(|v| v.as_str())
            .map(str::to_owned);
        let order = effective_order(space_room_id, &event.room_id, stored);
        let known = RoomId::parse(&event.room_id).ok().and_then(|id| client.get_room(&id));
        let child = match known {
            Some(room) => SpaceChild {
                room_id: event.room_id,
                name: room.compute_display_name().await.ok().map(|n| n.to_string()),
                topic: room.topic(),
                avatar_url: room.avatar_url().map(|u| u.to_string()),
                is_space: room.is_space(),
                member_count: Some(room.joined_members_count()),
                order,
                canonical_alias: room.canonical_alias().map(|a| a.to_string()),
            },
            None => SpaceChild {
                room_id: event.room_id,
                name: None,
                topic: None,
                avatar_url: None,
                is_space: false,
                member_count: None,
                order,
                canonical_alias: None,
            },
        };
        children.push(child);
    }
    children.sort_by(compare_space_children);
    Ok(children)
}

/// Reorder a joined space's children so the rooms in `visible_order` list in
/// that sequence. Returns how many `m.space.child` events were written.
///
/// `visible_order` is what the user sees: the joined rooms of one section of
/// the room list. Children it does not mention — rooms this account has not
/// joined, subspaces — keep their slots, and the listed rooms are permuted
/// among the remaining slots. The writes are the fewest [`order_updates`] can
/// find (one, for a single move in a space that has been ordered before), and
/// each rewrites only `order`.
pub async fn reorder_space_children(
    client: &Client,
    space_room_id: &str,
    visible_order: &[String],
) -> Result<usize, String> {
    let space_id = RoomId::parse(space_room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let space = joined_space(client, &space_id).ok_or("You are not in this space")?;
    let _turn = REORDER_TURN.lock().await;

    let children = get_space_children(client, space_room_id).await?;
    let keys: Vec<ChildKey> = children.iter().map(child_key).collect();

    let visible: std::collections::HashSet<&str> = visible_order.iter().map(String::as_str).collect();
    if visible.len() != visible_order.len() {
        return Err("A room is listed twice".into());
    }
    if let Some(stray) = visible_order.iter().find(|id| !keys.iter().any(|k| &k.room_id == *id)) {
        return Err(format!("{stray} is not a child of this space"));
    }
    let mut moved = visible_order.iter();
    let target: Vec<String> = keys
        .iter()
        .map(|k| {
            if visible.contains(k.room_id.as_str()) {
                moved.next().cloned().unwrap_or_else(|| k.room_id.clone())
            } else {
                k.room_id.clone()
            }
        })
        .collect();

    let updates = order_updates(&keys, &target)?;
    if updates.is_empty() {
        return Ok(0);
    }

    let events = read_child_events(&space).await?;
    for (room_id, order) in &updates {
        let mut content = events
            .iter()
            .find(|e| &e.room_id == room_id)
            .map(|e| e.content.clone())
            .ok_or_else(|| format!("{room_id} is no longer a child of this space"))?;
        content.insert("order".into(), serde_json::Value::String(order.clone()));
        // Noted before the write rather than after it, so a refresh that lands
        // while the request is in flight already lists the new order.
        note_pending_order(space_room_id, room_id, order);
        if let Err(e) = space
            .send_state_event_raw("m.space.child", room_id, serde_json::Value::Object(content))
            .await
        {
            forget_pending_order(space_room_id, room_id);
            return Err(format!("Failed to reorder the space: {e}"));
        }
    }
    info!(space = %space_room_id, writes = updates.len(), "Reordered space children");
    Ok(updates.len())
}

/// Make `child_id` a child of `space_id`: the `m.space.child` event in the
/// space, which is what lists it there. `via` names the servers a client can
/// join the child through; the child's own server is always one.
pub async fn add_space_child(client: &Client, space_id: &str, child_id: &str) -> Result<(), String> {
    let space_room_id = RoomId::parse(space_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let child_room_id = RoomId::parse(child_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let space = joined_space(client, &space_room_id).ok_or("You are not in this space")?;
    let via = space_via(client, &child_room_id);

    // Append after every child that has an order, so the new room lands at the
    // end of the ordered run instead of jumping to wherever its name sorts.
    // Through the pending overlay, so a reorder sync hasn't echoed yet counts.
    let last_order = read_child_events(&space)
        .await?
        .iter()
        .filter_map(|e| {
            let stored = e.content.get("order").and_then(|v| v.as_str()).map(str::to_owned);
            sanitize_order(effective_order(space_id, &e.room_id, stored).as_deref())
        })
        .max();
    let mut content = serde_json::json!({ "via": via });
    if let Some(last) = last_order {
        if let Some(order) = between(Some(&last), None) {
            content["order"] = serde_json::Value::String(order);
        }
    }
    space
        .send_state_event_raw("m.space.child", child_id, content)
        .await
        .map_err(|e| format!("Failed to add the room to the space: {e}"))?;
    Ok(())
}

/// Servers to route through for a room: its own, then ours.
pub fn space_via(client: &Client, room_id: &RoomId) -> Vec<String> {
    let mut via = Vec::new();
    if let Some(server) = room_id.server_name() {
        via.push(server.to_string());
    }
    if let Some(own) = client.user_id().map(|u| u.server_name().to_string()) {
        if !via.contains(&own) {
            via.push(own);
        }
    }
    via
}

/// List all space rooms the user has joined.
pub async fn get_user_spaces(client: &Client) -> Result<Vec<SpaceChild>, String> {
    use matrix_sdk::ruma::room::RoomType;

    let rooms = client.joined_rooms();
    let spaces: Vec<SpaceChild> = rooms
        .iter()
        .filter(|room| {
            room.room_type()
                .map(|t| t == RoomType::Space)
                .unwrap_or(false)
        })
        .map(|room| SpaceChild {
            room_id: room.room_id().to_string(),
            name: room.name(),
            topic: room.topic(),
            avatar_url: room.avatar_url().map(|u| u.to_string()),
            is_space: true,
            member_count: Some(room.joined_members_count()),
            order: None,
            canonical_alias: room.canonical_alias().map(|a| a.to_string()),
        })
        .collect();

    Ok(spaces)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pending_order_wins_until_the_store_catches_up() {
        let space = "!pending-test-space:x";
        note_pending_order(space, "!a:x", "m");
        // Sync has not echoed the write yet: the pending order is listed.
        assert_eq!(effective_order(space, "!a:x", Some("c".into())).as_deref(), Some("m"));
        // Now it has: the store's value is used and the entry is dropped.
        assert_eq!(effective_order(space, "!a:x", Some("m".into())).as_deref(), Some("m"));
        assert_eq!(effective_order(space, "!a:x", Some("z".into())).as_deref(), Some("z"));
    }

    #[test]
    fn a_failed_write_is_forgotten() {
        let space = "!forget-test-space:x";
        note_pending_order(space, "!a:x", "m");
        forget_pending_order(space, "!a:x");
        assert_eq!(effective_order(space, "!a:x", Some("c".into())).as_deref(), Some("c"));
    }

    #[test]
    fn children_without_pending_writes_read_the_store() {
        assert_eq!(effective_order("!other-space:x", "!b:x", None), None);
        assert_eq!(effective_order("!other-space:x", "!b:x", Some("q".into())).as_deref(), Some("q"));
    }
}
