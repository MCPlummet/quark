use crate::matrix::timeline::{convert_raw_message_like, TimelineEvent};
use matrix_sdk::{
    room::MessagesOptions,
    ruma::{
        api::{client::relations::get_relating_events_with_rel_type, Direction},
        events::{
            relation::RelationType,
            room::message::{MessageType, Relation, RoomMessageEventContent},
            AnySyncMessageLikeEvent, AnySyncTimelineEvent, SyncMessageLikeEvent,
        },
        serde::Raw,
        EventId, RoomId, UInt,
    },
    Client, Room,
};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

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

/// Replies asked for per `/relations` page.
const THREAD_PAGE_SIZE: u32 = 100;
/// Pages read before giving up on the rest of a thread: 5,000 replies, far past
/// anything the panel is meant to hold.
const MAX_THREAD_PAGES: usize = 50;

/// Get the full timeline of a thread (root + replies), oldest first.
///
/// The replies are the root's `m.thread` relations, read page by page to the
/// end. This used to be the last 100 events of the *room* filtered down to the
/// thread, so any reply further back than that — a busy room, a long thread, an
/// old one — was silently missing, and the panel counted only what was left.
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

    // The root is not one of its own relations. A root that cannot be read
    // (redacted, before our history) still leaves a thread to show; the
    // frontend draws the root it already has.
    let root = match room.event(&root_id, None).await {
        Ok(ev) => Some(ev.raw().clone()),
        Err(e) => {
            warn!(thread_root = %root_id, "Could not fetch thread root: {e}");
            None
        }
    };

    let mut replies = Vec::new();
    let mut from = None;
    for _ in 0..MAX_THREAD_PAGES {
        let mut request = get_relating_events_with_rel_type::v1::Request::new(
            room_id.clone(),
            root_id.clone(),
            RelationType::Thread,
        );
        request.dir = Direction::Backward;
        request.from = from.take();
        request.limit = Some(UInt::from(THREAD_PAGE_SIZE));
        let page = client
            .send(request, None)
            .await
            .map_err(|e| format!("Failed to fetch thread: {e}"))?;
        for event in page.chunk {
            replies.push(decrypted(&room, event.cast()).await);
        }
        match page.next_batch {
            Some(token) => from = Some(token),
            None => break,
        }
    }

    Ok(assemble_thread(root, replies, thread_root_event_id))
}

/// The event as its sender wrote it, when we hold the key; otherwise the
/// encrypted event, which converts to an "unable to decrypt" row.
async fn decrypted(room: &Room, event: Raw<AnySyncTimelineEvent>) -> Raw<AnySyncTimelineEvent> {
    if let Ok(AnySyncTimelineEvent::MessageLike(AnySyncMessageLikeEvent::RoomEncrypted(
        SyncMessageLikeEvent::Original(_),
    ))) = event.deserialize()
    {
        if let Ok(ev) = room.decrypt_event(event.cast_ref()).await {
            return ev.raw().clone();
        }
    }
    event
}

/// The thread as the panel shows it: the root (when it could be read), then its
/// replies oldest first. `replies` arrive newest first, as `/relations` pages
/// backward, and keep the server's order rather than being sorted by
/// timestamp. Events that are not messages (a poll, say) are left out;
/// stickers and undecryptable replies are not — a sticker matched nothing here
/// once and vanished from the panel (#78).
fn assemble_thread(
    root: Option<Raw<AnySyncTimelineEvent>>,
    replies: Vec<Raw<AnySyncTimelineEvent>>,
    thread_root_event_id: &str,
) -> Vec<TimelineEvent> {
    let root = root
        .as_ref()
        .and_then(convert_raw_message_like)
        .map(|te| anchor_to_thread(te, true, thread_root_event_id));
    root.into_iter()
        .chain(
            replies
                .iter()
                .rev()
                .filter_map(convert_raw_message_like)
                .map(|te| anchor_to_thread(te, false, thread_root_event_id)),
        )
        .collect()
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
fn anchor_to_thread(
    mut te: TimelineEvent,
    is_root: bool,
    thread_root_event_id: &str,
) -> TimelineEvent {
    if is_root {
        te.thread_root = None;
    } else if te.thread_root.is_none() {
        te.thread_root = Some(thread_root_event_id.to_string());
    }
    te
}

/// Send a message into a thread.
///
/// `in_reply_to` quotes one of the thread's own messages: the event then
/// carries it as a real reply (`is_falling_back: false`) inside the `m.thread`
/// relation. Without it the message is a plain thread message, whose
/// `m.in_reply_to` is only the fallback pointer for thread-unaware clients.
/// This used to accept no reply target at all, so a reply typed inside a thread
/// lost its quote (#131).
pub async fn send_thread_reply(
    client: &Client,
    room_id: &str,
    thread_root_event_id: &str,
    body: &str,
    formatted_body: Option<&str>,
    in_reply_to: Option<&str>,
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

    // Shared with every other sender rather than built here — the media senders
    // needed the same decision for #78, and a second copy of it is how they
    // would drift.
    let mut thread_content = content;
    thread_content.relates_to =
        crate::matrix::relations::build_relation(Some(root_id.as_str()), in_reply_to)?;

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
    use matrix_sdk::ruma::events::room::message::OriginalSyncRoomMessageEvent;

    /// What `assemble_thread` does to one room message: convert, then anchor.
    fn convert_thread_event(
        ev: OriginalSyncRoomMessageEvent,
        is_root: bool,
        thread_root_event_id: &str,
    ) -> TimelineEvent {
        anchor_to_thread(
            crate::matrix::timeline::convert_sync_room_message(ev),
            is_root,
            thread_root_event_id,
        )
    }

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

    // A sticker sent into a thread is an `m.sticker`, not an `m.room.message`,
    // so matching only the latter left it invisible in the panel — on the live
    // echo *and* on every reload afterwards (#78).
    #[test]
    fn a_sticker_in_a_thread_is_one_of_its_replies() {
        let root = "$root:example.com";
        let sticker = raw(serde_json::json!({
            "type": "m.sticker",
            "event_id": "$sticker:example.com",
            "sender": "@alice:example.com",
            "origin_server_ts": 1_700_000_000_000i64,
            "content": {
                "body": "party",
                "url": "mxc://example.com/sticker",
                "info": { "mimetype": "image/png", "w": 128, "h": 128 },
                "m.relates_to": { "rel_type": "m.thread", "event_id": root },
            },
        }));
        let events = assemble_thread(None, vec![sticker], root);
        assert_eq!(events.len(), 1);
        let te = &events[0];
        assert_eq!(te.msg_type, "m.sticker");
        assert_eq!(te.thread_root.as_deref(), Some(root));
        assert_eq!(te.media_url.as_deref(), Some("mxc://example.com/sticker"));
    }

    fn raw(json: serde_json::Value) -> Raw<AnySyncTimelineEvent> {
        Raw::from_json(serde_json::value::to_raw_value(&json).expect("raw json"))
    }

    fn text(id: &str, body: &str, ts: i64, thread: Option<&str>) -> Raw<AnySyncTimelineEvent> {
        let mut content = serde_json::json!({ "msgtype": "m.text", "body": body });
        if let Some(root) = thread {
            content["m.relates_to"] = serde_json::json!({ "rel_type": "m.thread", "event_id": root });
        }
        raw(serde_json::json!({
            "type": "m.room.message",
            "event_id": id,
            "sender": "@alice:example.com",
            "origin_server_ts": ts,
            "content": content,
        }))
    }

    // `/relations` pages backward, newest first; the panel reads oldest first,
    // with the root ahead of its replies.
    #[test]
    fn a_thread_reads_root_first_then_its_replies_oldest_first() {
        let root = "$root:example.com";
        let newest_first = vec![
            text("$c:example.com", "third", 3, Some(root)),
            text("$b:example.com", "second", 2, Some(root)),
            text("$a:example.com", "first", 1, Some(root)),
        ];
        let events = assemble_thread(Some(text(root, "the root", 0, None)), newest_first, root);
        let bodies: Vec<&str> = events.iter().map(|e| e.body.as_str()).collect();
        assert_eq!(bodies, ["the root", "first", "second", "third"]);
        assert_eq!(events[0].thread_root, None);
        assert!(events[1..].iter().all(|e| e.thread_root.as_deref() == Some(root)));
    }

    // Server order, not timestamps: what other clients show, and what a
    // clock-skewed federated reply would otherwise be sorted out of.
    #[test]
    fn replies_keep_the_servers_order() {
        let root = "$root:example.com";
        let newest_first = vec![
            text("$b:example.com", "second", 1, Some(root)),
            text("$a:example.com", "first", 9, Some(root)),
        ];
        let events = assemble_thread(None, newest_first, root);
        let bodies: Vec<&str> = events.iter().map(|e| e.body.as_str()).collect();
        assert_eq!(bodies, ["first", "second"]);
    }

    // A reply that cannot be decrypted is still a reply — shown as such, not
    // dropped; other event types relating to the thread are not messages.
    #[test]
    fn an_undecryptable_reply_stays_and_other_events_are_skipped() {
        let root = "$root:example.com";
        let newest_first = vec![
            raw(serde_json::json!({
                "type": "m.room.encrypted",
                "event_id": "$utd:example.com",
                "sender": "@bob:example.com",
                "origin_server_ts": 2,
                "content": {
                    "algorithm": "m.megolm.v1.aes-sha2",
                    "ciphertext": "AwgA",
                    "sender_key": "key",
                    "device_id": "DEVICE",
                    "session_id": "session",
                    "m.relates_to": { "rel_type": "m.thread", "event_id": root },
                },
            })),
            raw(serde_json::json!({
                "type": "org.example.poll",
                "event_id": "$poll:example.com",
                "sender": "@bob:example.com",
                "origin_server_ts": 1,
                "content": { "m.relates_to": { "rel_type": "m.thread", "event_id": root } },
            })),
        ];
        let events = assemble_thread(None, newest_first, root);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_id, "$utd:example.com");
        assert_eq!(events[0].msg_type, "m.room.encrypted");
        assert_eq!(events[0].thread_root.as_deref(), Some(root));
    }
}
