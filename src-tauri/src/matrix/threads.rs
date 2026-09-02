use crate::matrix::timeline::TimelineEvent;
use matrix_sdk::{
    room::MessagesOptions,
    ruma::{
        events::{
            room::message::{
                MessageType, OriginalSyncRoomMessageEvent, Relation, RoomMessageEventContent,
            },
            AnySyncMessageLikeEvent, AnySyncTimelineEvent, SyncMessageLikeEvent,
        },
        EventId, RoomId, UInt,
    },
    Client,
};
use serde::{Deserialize, Serialize};
use tracing::info;

/// A thread root message with reply count.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadRoot {
    pub event_id: String,
    pub sender: String,
    pub body: String,
    pub timestamp: u64,
    pub reply_count: u64,
    pub latest_reply_timestamp: Option<u64>,
}

/// Get all thread roots in a room (messages that have thread replies).
pub async fn get_thread_roots(
    client: &Client,
    room_id: &str,
) -> Result<Vec<ThreadRoot>, String> {
    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;

    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {} not found", room_id))?;

    let mut opts = MessagesOptions::backward();
    opts.limit = UInt::from(100u32);

    let messages = room
        .messages(opts)
        .await
        .map_err(|e| format!("Failed to fetch messages: {e}"))?;

    // Collect all thread replies and group by root event ID
    use std::collections::HashMap;
    let mut thread_map: HashMap<String, (u64, u64)> = HashMap::new(); // root_id -> (count, latest_ts)

    for timeline_event in &messages.chunk {
        if let Ok(deserialized) = timeline_event.raw().deserialize() {
            if let AnySyncTimelineEvent::MessageLike(AnySyncMessageLikeEvent::RoomMessage(
                SyncMessageLikeEvent::Original(ev),
            )) = deserialized
            {
                if let Some(Relation::Thread(thread)) = &ev.content.relates_to {
                    let root_id = thread.event_id.to_string();
                    let ts: u64 = ev.origin_server_ts.get().into();
                    let entry = thread_map.entry(root_id).or_insert((0, 0));
                    entry.0 += 1;
                    if ts > entry.1 {
                        entry.1 = ts;
                    }
                }
            }
        }
    }

    // Now build ThreadRoot by finding the root events
    let mut roots = Vec::new();

    for timeline_event in &messages.chunk {
        if let Ok(deserialized) = timeline_event.raw().deserialize() {
            if let AnySyncTimelineEvent::MessageLike(AnySyncMessageLikeEvent::RoomMessage(
                SyncMessageLikeEvent::Original(ev),
            )) = deserialized
            {
                let event_id_str = ev.event_id.to_string();
                if let Some((reply_count, latest_ts)) = thread_map.get(&event_id_str) {
                    let body = match &ev.content.msgtype {
                        MessageType::Text(t) => t.body.clone(),
                        _ => "[non-text message]".to_string(),
                    };
                    roots.push(ThreadRoot {
                        event_id: event_id_str,
                        sender: ev.sender.to_string(),
                        body,
                        timestamp: ev.origin_server_ts.get().into(),
                        reply_count: *reply_count,
                        latest_reply_timestamp: Some(*latest_ts),
                    });
                }
            }
        }
    }

    // Sort by timestamp descending (newest thread activity first)
    roots.sort_by(|a, b| {
        b.latest_reply_timestamp
            .cmp(&a.latest_reply_timestamp)
    });

    Ok(roots)
}

/// Get the full timeline of a thread (root + replies).
pub async fn get_thread_timeline(
    client: &Client,
    room_id: &str,
    thread_root_event_id: &str,
) -> Result<Vec<TimelineEvent>, String> {
    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let root_id = EventId::parse(thread_root_event_id)
        .map_err(|e| format!("Invalid event ID: {e}"))?;

    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {} not found", room_id))?;

    let mut opts = MessagesOptions::backward();
    opts.limit = UInt::from(100u32);

    let messages = room
        .messages(opts)
        .await
        .map_err(|e| format!("Failed to fetch thread timeline: {e}"))?;

    let mut thread_events = Vec::new();

    for timeline_event in messages.chunk {
        if let Ok(deserialized) = timeline_event.raw().deserialize() {
            if let AnySyncTimelineEvent::MessageLike(AnySyncMessageLikeEvent::RoomMessage(
                SyncMessageLikeEvent::Original(ev),
            )) = deserialized
            {
                let event_id_str = ev.event_id.to_string();
                let is_root = event_id_str == thread_root_event_id;

                let is_thread_reply = matches!(
                    &ev.content.relates_to,
                    Some(Relation::Thread(t)) if t.event_id == root_id
                );

                if is_root || is_thread_reply {
                    thread_events.push(convert_thread_event(ev, is_root, thread_root_event_id));
                }
            }
        }
    }

    // Sort by timestamp ascending
    thread_events.sort_by_key(|e| e.timestamp);

    Ok(thread_events)
}

/// Convert one thread event into a `TimelineEvent`.
///
/// Delegates to the main-timeline converter rather than hand-rolling a second
/// one. The duplicate this replaced hardcoded `msg_type: "m.text"`, dropped
/// every media field and the MSC2530 caption, and ignored edit/reply relations,
/// so media in a thread rendered as a bare filename line — see #42, split out
/// of #41 which fixed the same loss on the main-timeline live tail.
///
/// The only thread-specific part is `thread_root`: the shared converter derives
/// it from the event's own `m.thread` relation, which the *root* event does not
/// carry, so the root is forced to `None` and a reply missing the relation (it
/// was matched some other way) is backfilled with the requested root.
fn convert_thread_event(
    ev: OriginalSyncRoomMessageEvent,
    is_root: bool,
    thread_root_event_id: &str,
) -> TimelineEvent {
    let mut te = crate::matrix::timeline::convert_sync_room_message(ev);
    if is_root {
        te.thread_root = None;
    } else if te.thread_root.is_none() {
        te.thread_root = Some(thread_root_event_id.to_string());
    }
    te
}

/// Send a reply in a thread.
pub async fn send_thread_reply(
    client: &Client,
    room_id: &str,
    thread_root_event_id: &str,
    body: &str,
    formatted_body: Option<&str>,
) -> Result<String, String> {
    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let root_id = EventId::parse(thread_root_event_id)
        .map_err(|e| format!("Invalid event ID: {e}"))?;

    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {} not found", room_id))?;

    let content = if let Some(formatted) = formatted_body {
        RoomMessageEventContent::text_html(body, formatted)
    } else {
        RoomMessageEventContent::text_plain(body)
    };

    use matrix_sdk::ruma::events::relation::Thread as ThreadRelation;
    // Add thread relation to the content
    let mut thread_content = content;
    thread_content.relates_to = Some(Relation::Thread(ThreadRelation::plain(
        root_id.clone(),
        root_id.clone(),
    )));

    let response = room
        .send(thread_content)
        .await
        .map_err(|e| format!("Failed to send thread reply: {e}"))?;

    let event_id = response.event_id.to_string();
    info!(event_id = %event_id, thread_root = %thread_root_event_id, "Thread reply sent");
    Ok(event_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn image_reply(root: &str, with_relation: bool) -> OriginalSyncRoomMessageEvent {
        let mut content = serde_json::json!({
            "msgtype": "m.image",
            "body": "look at this cat",
            "filename": "pasted-image-123.png",
            "url": "mxc://example.com/abc123",
            "info": { "mimetype": "image/png", "w": 800, "h": 600 }
        });
        if with_relation {
            content["m.relates_to"] =
                serde_json::json!({ "rel_type": "m.thread", "event_id": root });
        }
        serde_json::from_value(serde_json::json!({
            "type": "m.room.message",
            "event_id": "$reply:example.com",
            "sender": "@alice:example.com",
            "origin_server_ts": 1_700_000_000_000i64,
            "content": content,
        }))
        .expect("deserialize thread reply")
    }

    // #42: the thread path used to hardcode `m.text` and drop every media field
    // plus the MSC2530 caption, so a captioned image posted in a thread reached
    // the frontend as a bare body string.
    #[test]
    fn thread_reply_keeps_media_and_caption() {
        let root = "$root:example.com";
        let te = convert_thread_event(image_reply(root, true), false, root);
        assert_eq!(te.msg_type, "m.image");
        assert_eq!(te.caption.as_deref(), Some("look at this cat"));
        assert_eq!(te.media_url.as_deref(), Some("mxc://example.com/abc123"));
        assert_eq!(te.media_mimetype.as_deref(), Some("image/png"));
        assert_eq!(te.media_width, Some(800));
        assert_eq!(te.media_height, Some(600));
        assert_eq!(te.thread_root.as_deref(), Some(root));
    }

    #[test]
    fn thread_root_is_not_marked_as_its_own_reply() {
        let root = "$root:example.com";
        // Even if the event somehow carried a thread relation, the root of the
        // thread being fetched must come back with `thread_root: None` so the
        // frontend renders it as the root rather than a reply to itself.
        let te = convert_thread_event(image_reply(root, true), true, root);
        assert_eq!(te.thread_root, None);
        assert_eq!(te.msg_type, "m.image");
    }

    #[test]
    fn reply_without_a_relation_is_backfilled_with_the_requested_root() {
        let root = "$root:example.com";
        let te = convert_thread_event(image_reply(root, false), false, root);
        assert_eq!(te.thread_root.as_deref(), Some(root));
    }
}
