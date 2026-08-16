//! Tauri event emission for Matrix sync updates.
//!
//! This module defines serializable event payload structs and the function
//! that registers matrix-sdk event handlers to push sync events to the frontend
//! via Tauri's event system.

use matrix_sdk::{
    event_handler::Ctx,
    ruma::events::{
        key::verification::request::ToDeviceKeyVerificationRequestEventContent,
        presence::PresenceEvent,
        reaction::ReactionEventContent,
        receipt::{ReceiptEventContent, ReceiptThread, ReceiptType},
        room::{
            encrypted::RoomEncryptedEventContent,
            message::{OriginalSyncRoomMessageEvent, SyncRoomMessageEvent},
            redaction::OriginalSyncRoomRedactionEvent,
        },
        sticker::StickerEventContent,
        typing::SyncTypingEvent,
        OriginalSyncMessageLikeEvent, SyncEphemeralRoomEvent, SyncMessageLikeEvent,
        ToDeviceEvent,
    },
    Client, Room,
};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};
use tauri::{Emitter, Manager};
use tracing::{debug, error, warn};

/// Wall-clock time (ms since UNIX epoch) when the app finished initializing.
///
/// Used to suppress OS notifications for messages whose `origin_server_ts`
/// predates this moment — those events arrive via the catch-up sync at
/// startup and have already been "seen" in the user's sense (they were sent
/// while the app was closed). Without this guard, every unread message
/// fires a notification on launch.
pub static STARTUP_TIME_MS: OnceLock<u64> = OnceLock::new();

/// Record the moment startup completed. Called once from `lib.rs::run()`.
pub fn init_startup_time() {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let _ = STARTUP_TIME_MS.set(now);
}

/// Event IDs already surfaced as an OS notification, newest at the back.
/// Bounded to the most recent [`MAX_NOTIFIED_IDS`] entries.
static NOTIFIED_EVENT_IDS: Mutex<VecDeque<String>> = Mutex::new(VecDeque::new());

/// Upper bound on remembered notification event IDs. A few hundred covers any
/// realistic burst of re-deliveries while keeping the scan and memory trivial.
const MAX_NOTIFIED_IDS: usize = 256;

/// Record that `event_id` is about to be notified, returning `true` if it is
/// new (notify) or `false` if it was already notified (skip).
///
/// The matrix-sdk sync loop can hand the same message event to our handler more
/// than once — e.g. when `client.sync()` retries after a transient error and
/// re-delivers events from before the sync token advanced. Without this guard
/// each re-delivery raises another OS notification, so one message can produce
/// a burst of duplicates. Deduping by event ID collapses them to one.
pub(crate) fn claim_notification(event_id: &str) -> bool {
    let mut ids = match NOTIFIED_EVENT_IDS.lock() {
        Ok(ids) => ids,
        // On a poisoned lock, fail open: better one possible duplicate than a
        // silently dropped notification.
        Err(_) => return true,
    };
    if ids.iter().any(|id| id == event_id) {
        return false;
    }
    ids.push_back(event_id.to_string());
    if ids.len() > MAX_NOTIFIED_IDS {
        ids.pop_front();
    }
    true
}

use crate::{
    matrix::{rooms::RoomInfo, timeline::TimelineEvent},
    notifications::NotificationConfig,
};

// ─── Event Name Constants ─────────────────────────────────────────────────────

pub const EVENT_NEW_MESSAGE: &str = "quark://sync/message";
pub const EVENT_ROOM_UPDATE: &str = "quark://sync/rooms";
pub const EVENT_TYPING: &str = "quark://sync/typing";
pub const EVENT_READ_RECEIPT: &str = "quark://sync/read_receipt";
pub const EVENT_PRESENCE: &str = "quark://sync/presence";
pub const EVENT_VERIFICATION_REQUEST: &str = "quark://sync/verification_request";
pub const EVENT_UNREAD_COUNT: &str = "quark://sync/unread_count";
pub const EVENT_CONNECTED: &str = "quark://sync/connected";
pub const EVENT_REACTION: &str = "quark://sync/reaction";
pub const EVENT_REDACTION: &str = "quark://sync/redaction";
/// Emitted when new room (megolm) keys are received — e.g. after the session is
/// verified or key backup is restored — so the frontend can retry decryption of
/// rooms it's showing.
pub const EVENT_ROOM_KEYS: &str = "quark://sync/room_keys";

/// Emitted for each message that matches an in-progress server-side search.
pub const EVENT_SEARCH_HIT: &str = "quark://search/hit";
/// Emitted periodically during a server-side search to report scan progress.
pub const EVENT_SEARCH_PROGRESS: &str = "quark://search/progress";

// ─── Event Payload Structs ────────────────────────────────────────────────────

/// Emitted when a new message arrives in a room.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncNewMessage {
    pub room_id: String,
    pub event: TimelineEvent,
}

/// Emitted when the room list changes (join/leave/name change/etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncRoomUpdate {
    pub rooms: Vec<RoomInfo>,
}

/// Emitted when typing indicators change in a room.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncTypingUpdate {
    pub room_id: String,
    pub user_ids: Vec<String>,
}

/// Emitted when a read receipt is received.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncReadReceipt {
    pub room_id: String,
    pub event_id: String,
    pub user_id: String,
    /// When the receipt was sent (ms since epoch), if the server provided it.
    /// Used by the frontend to place the avatar on the nearest rendered message
    /// and to show "read at" times in the hover list.
    pub ts: Option<u64>,
}

/// Emitted when a user's presence changes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncPresenceUpdate {
    pub user_id: String,
    pub presence: String,
    pub status_msg: Option<String>,
}

/// Emitted when a verification request is received.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncVerificationRequest {
    pub user_id: String,
    pub device_id: String,
    pub flow_id: String,
}

/// Emitted when unread counts change for a room.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncRoomUnreadCount {
    pub room_id: String,
    pub unread_count: u64,
    pub highlight_count: u64,
}

/// Emitted when a message is redacted in a room.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncRedactionUpdate {
    pub room_id: String,
    pub redacted_event_id: String,
}

/// Emitted when new room keys arrive, listing the affected rooms so the
/// frontend can re-decrypt/refresh any it is displaying.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomKeysReceived {
    pub room_ids: Vec<String>,
}

/// Emitted for each message matching an in-progress server-side search.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    pub room_id: String,
    pub event: TimelineEvent,
}

/// Emitted periodically during a server-side search to report progress.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchProgress {
    pub scanned: u64,
    /// Oldest message timestamp (epoch ms) scanned so far, as a running minimum.
    /// Drives the "back to «date»" readout and the date-scope progress bar.
    /// `None` until at least one event with a timestamp has been scanned.
    pub oldest_ts: Option<u64>,
}

/// Emitted when a reaction is added to an event in a room.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncReactionUpdate {
    pub room_id: String,
    pub target_event_id: String,
    pub sender: String,
    pub key: String,
    pub reaction_event_id: String,
}

// ─── Handler Registration ─────────────────────────────────────────────────────

/// Run a freshly-converted timeline event through the notification pipeline:
/// gate cheaply (own message / focused window / catch-up replay / config),
/// render via `notify::evaluate`, dedup via `claim_notification`, deliver.
///
/// Shared by the message and sticker handlers, so every notifying event type
/// goes through one path (and a future push transport reuses it unchanged).
async fn maybe_notify(
    app: &tauri::AppHandle,
    room: &Room,
    sender_id: &matrix_sdk::ruma::UserId,
    timeline_event: &crate::matrix::timeline::TimelineEvent,
    push_actions: &[matrix_sdk::ruma::push::Action],
) {
    let room_id = room.room_id().to_string();

    let is_own = room.own_user_id() == sender_id;
    let window_focused = app
        .get_webview_window("main")
        .and_then(|w: tauri::WebviewWindow| w.is_focused().ok())
        .unwrap_or(false);
    // Skip messages whose server timestamp predates app startup — those come
    // from the initial catch-up sync.
    let pre_startup = STARTUP_TIME_MS
        .get()
        .map(|&start_ms| timeline_event.timestamp < start_ms)
        .unwrap_or(false);

    let Some(config) = app
        .try_state::<Mutex<NotificationConfig>>()
        .and_then(|s| s.lock().ok().map(|c| c.clone()))
    else {
        return;
    };

    // The display-name lookup is a store read — only pay for it when the
    // cheap gates have already passed.
    let sender_label = if !is_own && !window_focused && !pre_startup {
        room.get_member_no_sync(sender_id)
            .await
            .ok()
            .flatten()
            .and_then(|m| m.display_name().map(str::to_string))
            .unwrap_or_else(|| timeline_event.sender.clone())
    } else {
        timeline_event.sender.clone()
    };

    let input = crate::notify::NotificationInput {
        room_id: room_id.clone(),
        room_name: room.name().unwrap_or_else(|| room_id.clone()),
        event_id: timeline_event.event_id.clone(),
        sender: sender_label,
        body: timeline_event.body.clone(),
        is_edit: timeline_event.is_edit,
        is_own,
        window_focused,
        pre_startup,
        push: crate::notify::PushEval::from_actions(push_actions),
    };

    // `claim_notification` stays the dedup gate: an event ID is only
    // remembered when we genuinely notify, and a re-delivered event (sync
    // retry replay) is suppressed here.
    if let Some(spec) = crate::notify::evaluate(&input, &config) {
        if claim_notification(&spec.event_id) {
            crate::notify::deliver(app, &spec);
        }
    }
}

/// Register matrix-sdk event handlers that push sync events to the frontend.
///
/// This must be called after the client has logged in and before sync starts,
/// so the handlers are in place when the first sync response arrives.
pub fn setup_sync_event_handlers(client: &Client, app_handle: &tauri::AppHandle) {
    // Store the AppHandle as event handler context so closures can access it.
    client.add_event_handler_context(app_handle.clone());

    // ── New messages ──────────────────────────────────────────────────────────
    client.add_event_handler(
        |ev: SyncRoomMessageEvent,
         room: Room,
         Ctx(app): Ctx<tauri::AppHandle>,
         push_actions: Vec<matrix_sdk::ruma::push::Action>| async move {
            // Only handle original (non-redacted) messages.
            if let SyncRoomMessageEvent::Original(original_ev) = ev {
                let room_id = room.room_id().to_string();
                let sender_id = original_ev.sender.clone();
                if let Some(timeline_event) = convert_room_message_event(original_ev) {
                    let now_ms = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);
                    debug!(
                        "sync message received in {} ({}ms delivery latency)",
                        room_id,
                        now_ms.saturating_sub(timeline_event.timestamp)
                    );

                    // Record the room's recency so get_rooms can sort without
                    // probing the homeserver per room.
                    if let Some(recency) = app.try_state::<crate::matrix::rooms::RecencyState>() {
                        recency.bump(&room_id, timeline_event.timestamp);
                    }
                    // Feed the Home view's latest-message bubble (edits keep
                    // the original bubble; recency above still moves the room).
                    if !timeline_event.is_edit {
                        if let Some(cache) = app.try_state::<crate::matrix::rooms::LastEventCache>() {
                            cache.record(&room_id, crate::matrix::rooms::LastEventInfo {
                                sender: timeline_event.sender.clone(),
                                body: crate::matrix::rooms::snippet(
                                    &timeline_event.body,
                                    crate::matrix::rooms::HOME_SNIPPET_MAX,
                                ),
                                is_utd: timeline_event.msg_type == "m.room.encrypted",
                                msg_type: timeline_event.msg_type.clone(),
                                ts: timeline_event.timestamp,
                            });
                        }
                    }

                    // ── OS notification via the notify pipeline ──
                    maybe_notify(&app, &room, &sender_id, &timeline_event, &push_actions)
                        .await;

                    // Feed the live message into the search index so it's
                    // searchable immediately, with no re-scan, and so a
                    // fully-indexed room stays current. Skip undecryptable events.
                    if timeline_event.msg_type != "m.room.encrypted" {
                        if let Some(idx) = app
                            .try_state::<crate::search_index::SearchIndexState>()
                            .and_then(|s| s.get())
                        {
                            let m = crate::search_index::IndexedMessage {
                                event_id: timeline_event.event_id.clone(),
                                sender: timeline_event.sender.clone(),
                                timestamp: timeline_event.timestamp,
                                body: timeline_event.body.clone(),
                                formatted_body: timeline_event.formatted_body.clone(),
                                msg_type: timeline_event.msg_type.clone(),
                            };
                            if let Err(e) = idx.upsert(&room_id, &[m]) {
                                tracing::warn!("search index upsert (sync) failed: {e}");
                            }
                        }
                    }

                    let payload = SyncNewMessage {
                        room_id: room_id.clone(),
                        event: timeline_event,
                    };
                    if let Err(e) = app.emit(EVENT_NEW_MESSAGE, &payload) {
                        error!("Failed to emit {}: {}", EVENT_NEW_MESSAGE, e);
                    } else {
                        debug!("emitted {} for {}", EVENT_NEW_MESSAGE, room_id);
                    }

                    // Also emit updated unread counts for the room.
                    let unread = room.unread_notification_counts();
                    let unread_payload = SyncRoomUnreadCount {
                        room_id,
                        unread_count: unread.highlight_count,
                        highlight_count: unread.notification_count,
                    };
                    if let Err(e) = app.emit(EVENT_UNREAD_COUNT, &unread_payload) {
                        error!("Failed to emit {}: {}", EVENT_UNREAD_COUNT, e);
                    }
                }
            }
        },
    );

    // ── Sticker events ────────────────────────────────────────────────────────
    client.add_event_handler(
        |ev: SyncMessageLikeEvent<StickerEventContent>,
         room: Room,
         Ctx(app): Ctx<tauri::AppHandle>,
         push_actions: Vec<matrix_sdk::ruma::push::Action>| async move {
            if let SyncMessageLikeEvent::Original(original_ev) = ev {
                let room_id = room.room_id().to_string();
                let sender_id = original_ev.sender.clone();
                let timeline_event =
                    crate::matrix::timeline::convert_sync_sticker_event(original_ev);
                if let Some(recency) = app.try_state::<crate::matrix::rooms::RecencyState>() {
                    recency.bump(&room_id, timeline_event.timestamp);
                }
                if let Some(cache) = app.try_state::<crate::matrix::rooms::LastEventCache>() {
                    cache.record(&room_id, crate::matrix::rooms::LastEventInfo {
                        sender: timeline_event.sender.clone(),
                        body: crate::matrix::rooms::snippet(
                            &timeline_event.body,
                            crate::matrix::rooms::HOME_SNIPPET_MAX,
                        ),
                        is_utd: false,
                        msg_type: timeline_event.msg_type.clone(),
                        ts: timeline_event.timestamp,
                    });
                }
                // Same pipeline as messages — whether a sticker actually fires
                // depends on the push rules, as in other clients.
                maybe_notify(&app, &room, &sender_id, &timeline_event, &push_actions).await;
                let payload = SyncNewMessage {
                    room_id,
                    event: timeline_event,
                };
                if let Err(e) = app.emit(EVENT_NEW_MESSAGE, &payload) {
                    error!("Failed to emit {}: {}", EVENT_NEW_MESSAGE, e);
                }
            }
        },
    );

    // ── Still-encrypted events (decryption failed at sync time) ──────────────
    // The SDK dispatches successfully decrypted events as their decrypted type
    // (the message handler above), so this fires only for events that stay
    // undecryptable. A message we can't read yet is still a message: bump
    // recency and feed the Home bubble (rendered as an encrypted placeholder)
    // so active E2EE rooms sort correctly while keys are missing.
    client.add_event_handler(
        |ev: SyncMessageLikeEvent<RoomEncryptedEventContent>,
         room: Room,
         Ctx(app): Ctx<tauri::AppHandle>| async move {
            if let SyncMessageLikeEvent::Original(original_ev) = ev {
                let room_id = room.room_id().to_string();
                let ts: u64 = original_ev.origin_server_ts.get().into();
                if let Some(recency) = app.try_state::<crate::matrix::rooms::RecencyState>() {
                    recency.bump(&room_id, ts);
                }
                if let Some(cache) = app.try_state::<crate::matrix::rooms::LastEventCache>() {
                    cache.record(&room_id, crate::matrix::rooms::LastEventInfo {
                        sender: original_ev.sender.to_string(),
                        body: String::new(),
                        is_utd: true,
                        msg_type: "m.room.encrypted".to_string(),
                        ts,
                    });
                }
            }
        },
    );

    // ── Typing indicators ─────────────────────────────────────────────────────
    client.add_event_handler(
        |ev: SyncTypingEvent, room: Room, Ctx(app): Ctx<tauri::AppHandle>| async move {
            let room_id = room.room_id().to_string();
            let user_ids: Vec<String> =
                ev.content.user_ids.iter().map(|u| u.to_string()).collect();
            let payload = SyncTypingUpdate { room_id, user_ids };
            if let Err(e) = app.emit(EVENT_TYPING, &payload) {
                error!("Failed to emit {}: {}", EVENT_TYPING, e);
            }
        },
    );

    // ── Read receipts ─────────────────────────────────────────────────────────
    client.add_event_handler(
        |ev: SyncEphemeralRoomEvent<ReceiptEventContent>,
         room: Room,
         Ctx(app): Ctx<tauri::AppHandle>| async move {
            let room_id = room.room_id().to_string();
            let own_id = room.own_user_id().to_owned();

            // Walk the receipt map: event_id -> receipt_type -> user_id -> Receipt
            for (event_id, receipts_by_type) in ev.content.iter() {
                for (receipt_type, user_receipts) in receipts_by_type.iter() {
                    // Any read receipt from the own user — public or private,
                    // from any device — means the room was seen: dismiss its
                    // OS notifications (Signal-style read-state hygiene).
                    if matches!(*receipt_type, ReceiptType::Read | ReceiptType::ReadPrivate)
                        && user_receipts.iter().any(|(user_id, _)| *user_id == own_id)
                    {
                        crate::notify::cancel_room(&app, &room_id);
                    }
                    // Only surface public read receipts. `m.read.private` is the
                    // own user's private marker (and is never sent for others), and
                    // the fully-read marker isn't a read position — skip both so we
                    // don't render the own user's own avatar.
                    if *receipt_type != ReceiptType::Read {
                        continue;
                    }
                    for (user_id, receipt) in user_receipts.iter() {
                        // Never render the own user's receipt (Element-style).
                        if *user_id == own_id {
                            continue;
                        }
                        // Skip receipts confined to a sub-thread — they point at
                        // thread replies that aren't in the main timeline. Main and
                        // Unthreaded both belong on the main timeline.
                        if matches!(receipt.thread, ReceiptThread::Thread(_)) {
                            continue;
                        }
                        let payload = SyncReadReceipt {
                            room_id: room_id.clone(),
                            event_id: event_id.to_string(),
                            user_id: user_id.to_string(),
                            ts: receipt.ts.map(|t| u64::from(t.get())),
                        };
                        if let Err(e) = app.emit(EVENT_READ_RECEIPT, &payload) {
                            error!("Failed to emit {}: {}", EVENT_READ_RECEIPT, e);
                        }
                    }
                }
            }
        },
    );

    // ── Presence ──────────────────────────────────────────────────────────────
    client.add_event_handler(
        |ev: PresenceEvent, Ctx(app): Ctx<tauri::AppHandle>| async move {
            let payload = SyncPresenceUpdate {
                user_id: ev.sender.to_string(),
                presence: ev.content.presence.to_string(),
                status_msg: ev.content.status_msg.clone(),
            };
            if let Err(e) = app.emit(EVENT_PRESENCE, &payload) {
                error!("Failed to emit {}: {}", EVENT_PRESENCE, e);
            }
        },
    );

    // ── Verification requests (to-device) ─────────────────────────────────────
    //
    // Verification requests arrive as to-device events.  matrix-sdk wraps the
    // content in a generic `ToDeviceEvent<C>` container.
    client.add_event_handler(
        |ev: ToDeviceEvent<ToDeviceKeyVerificationRequestEventContent>,
         Ctx(app): Ctx<tauri::AppHandle>| async move {
            let payload = SyncVerificationRequest {
                user_id: ev.sender.to_string(),
                device_id: ev.content.from_device.to_string(),
                flow_id: ev.content.transaction_id.to_string(),
            };
            if let Err(e) = app.emit(EVENT_VERIFICATION_REQUEST, &payload) {
                error!("Failed to emit {}: {}", EVENT_VERIFICATION_REQUEST, e);
            }
        },
    );

    // ── Redactions ────────────────────────────────────────────────────────────
    client.add_event_handler(
        |ev: OriginalSyncRoomRedactionEvent,
         room: Room,
         Ctx(app): Ctx<tauri::AppHandle>| async move {
            // The redacted event ID is in `ev.redacts` (older spec) or
            // `ev.content.redacts` (newer spec / MSC2174). Try both.
            let redacted_id = ev.redacts
                .as_deref()
                .or(ev.content.redacts.as_deref())
                .map(|id| id.to_string());

            if let Some(redacted_event_id) = redacted_id {
                let payload = SyncRedactionUpdate {
                    room_id: room.room_id().to_string(),
                    redacted_event_id,
                };
                if let Err(e) = app.emit(EVENT_REDACTION, &payload) {
                    error!("Failed to emit {}: {}", EVENT_REDACTION, e);
                }
            }
        },
    );

    // ── Reactions ─────────────────────────────────────────────────────────────
    client.add_event_handler(
        |ev: OriginalSyncMessageLikeEvent<ReactionEventContent>,
         room: Room,
         Ctx(app): Ctx<tauri::AppHandle>| async move {
            let payload = SyncReactionUpdate {
                room_id: room.room_id().to_string(),
                target_event_id: ev.content.relates_to.event_id.to_string(),
                sender: ev.sender.to_string(),
                key: ev.content.relates_to.key.clone(),
                reaction_event_id: ev.event_id.to_string(),
            };
            if let Err(e) = app.emit(EVENT_REACTION, &payload) {
                error!("Failed to emit {}: {}", EVENT_REACTION, e);
            }
        },
    );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

pub(crate) fn convert_room_message_event(ev: OriginalSyncRoomMessageEvent) -> Option<TimelineEvent> {
    use matrix_sdk::ruma::events::room::{
        message::{MessageType, Relation},
        MediaSource,
    };

    let event_id = ev.event_id.to_string();
    let sender = ev.sender.to_string();
    let timestamp: u64 = ev.origin_server_ts.get().into();
    let content = &ev.content;

    let enc_info = |source: &MediaSource| -> Option<String> {
        if let MediaSource::Encrypted(file) = source {
            serde_json::to_string(file.as_ref()).ok()
        } else {
            None
        }
    };

    // For replacement (edit) events use m.new_content so we get the actual updated
    // body instead of the "* fallback" body stored in the top-level msgtype.
    let effective_msgtype = if let Some(Relation::Replacement(r)) = &content.relates_to {
        &r.new_content.msgtype
    } else {
        &content.msgtype
    };

    let (body, formatted_body, msg_type, media_url, media_mimetype, media_width, media_height, media_encryption_info) =
        match effective_msgtype {
            MessageType::Text(text) => (
                text.body.clone(),
                text.formatted.as_ref().map(|f| crate::matrix::html::sanitize(&f.body)),
                "m.text".to_string(),
                None,
                None,
                None,
                None,
                None,
            ),
            MessageType::Image(image) => {
                let url = match &image.source {
                    MediaSource::Plain(uri) => Some(uri.to_string()),
                    MediaSource::Encrypted(file) => Some(file.url.to_string()),
                };
                let enc = enc_info(&image.source);
                let (w, h, mime) = if let Some(info) = &image.info {
                    (
                        info.width.map(|v| v.into()),
                        info.height.map(|v| v.into()),
                        info.mimetype.clone(),
                    )
                } else {
                    (None, None, None)
                };
                (image.body.clone(), None, "m.image".to_string(), url, mime, w, h, enc)
            }
            MessageType::Video(video) => {
                let url = match &video.source {
                    MediaSource::Plain(uri) => Some(uri.to_string()),
                    MediaSource::Encrypted(file) => Some(file.url.to_string()),
                };
                let enc = enc_info(&video.source);
                let (w, h, mime) = if let Some(info) = &video.info {
                    (
                        info.width.map(|v| v.into()),
                        info.height.map(|v| v.into()),
                        info.mimetype.clone(),
                    )
                } else {
                    (None, None, None)
                };
                (video.body.clone(), None, "m.video".to_string(), url, mime, w, h, enc)
            }
            MessageType::Audio(audio) => {
                let url = match &audio.source {
                    MediaSource::Plain(uri) => Some(uri.to_string()),
                    MediaSource::Encrypted(file) => Some(file.url.to_string()),
                };
                let enc = enc_info(&audio.source);
                (audio.body.clone(), None, "m.audio".to_string(), url, None, None, None, enc)
            }
            MessageType::File(file) => {
                let url = match &file.source {
                    MediaSource::Plain(uri) => Some(uri.to_string()),
                    MediaSource::Encrypted(f) => Some(f.url.to_string()),
                };
                let enc = enc_info(&file.source);
                (file.body.clone(), None, "m.file".to_string(), url, None, None, None, enc)
            }
            MessageType::Emote(emote) => (
                emote.body.clone(),
                emote.formatted.as_ref().map(|f| crate::matrix::html::sanitize(&f.body)),
                "m.emote".to_string(),
                None,
                None,
                None,
                None,
                None,
            ),
            MessageType::Notice(notice) => (
                notice.body.clone(),
                notice.formatted.as_ref().map(|f| crate::matrix::html::sanitize(&f.body)),
                "m.notice".to_string(),
                None,
                None,
                None,
                None,
                None,
            ),
            _ => (
                "[unsupported message type]".to_string(),
                None,
                "m.unknown".to_string(),
                None,
                None,
                None,
                None,
                None,
            ),
        };

    let (is_edit, relates_to_event_id, in_reply_to, thread_root) = {
        let mut is_edit = false;
        let mut relates_to = None;
        let mut reply_to = None;
        let mut t_root = None;

        if let Some(relation) = &content.relates_to {
            match relation {
                Relation::Replacement(r) => {
                    is_edit = true;
                    relates_to = Some(r.event_id.to_string());
                }
                Relation::Reply { in_reply_to: r } => {
                    reply_to = Some(r.event_id.to_string());
                }
                Relation::Thread(thread) => {
                    t_root = Some(thread.event_id.to_string());
                    if let Some(r) = &thread.in_reply_to {
                        reply_to = Some(r.event_id.to_string());
                    }
                }
                _ => {}
            }
        }
        (is_edit, relates_to, reply_to, t_root)
    };

    // Media captions (MSC2530): only present when a distinct filename is set, so
    // a bare-filename body is not surfaced as a caption.
    let caption = match effective_msgtype {
        MessageType::Image(image) => image.caption().map(|c| c.to_owned()),
        _ => None,
    };

    Some(TimelineEvent {
        event_id,
        sender,
        body,
        formatted_body,
        timestamp,
        msg_type,
        is_edit,
        relates_to_event_id,
        in_reply_to,
        thread_root,
        media_url,
        media_mimetype,
        media_width,
        media_height,
        caption,
        media_encryption_info,
        media_thumbnail_url: None,
        media_thumbnail_encryption_info: None,
        reactions: vec![],
    })
}

// ─── Async room-list helper ───────────────────────────────────────────────────

/// Collect current joined rooms into `RoomInfo` structs and emit a room update.
pub async fn emit_room_update(client: &Client, app_handle: &tauri::AppHandle) {
    let recency = app_handle.state::<crate::matrix::rooms::RecencyState>();
    match crate::matrix::rooms::get_rooms(client, &recency).await {
        Ok(rooms) => {
            let payload = SyncRoomUpdate { rooms };
            if let Err(e) = app_handle.emit(EVENT_ROOM_UPDATE, &payload) {
                error!("Failed to emit {}: {}", EVENT_ROOM_UPDATE, e);
            }
        }
        Err(e) => {
            warn!("emit_room_update: failed to fetch rooms: {}", e);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json;

    // ── SyncNewMessage ────────────────────────────────────────────────────────

    fn make_timeline_event() -> TimelineEvent {
        TimelineEvent {
            event_id: "$ev:example.com".to_string(),
            sender: "@alice:example.com".to_string(),
            body: "Hello".to_string(),
            formatted_body: None,
            timestamp: 1_700_000_000_000,
            msg_type: "m.text".to_string(),
            is_edit: false,
            relates_to_event_id: None,
            in_reply_to: None,
            thread_root: None,
            media_url: None,
            media_mimetype: None,
            media_width: None,
            media_height: None,
            caption: None,
            media_encryption_info: None,
            media_thumbnail_url: None,
            media_thumbnail_encryption_info: None,
            reactions: vec![],
        }
    }

    #[test]
    fn test_sync_new_message_roundtrip() {
        let payload = SyncNewMessage {
            room_id: "!room:example.com".to_string(),
            event: make_timeline_event(),
        };
        let json = serde_json::to_string(&payload).expect("serialize");
        let back: SyncNewMessage = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.room_id, "!room:example.com");
        assert_eq!(back.event.sender, "@alice:example.com");
    }

    // ── SyncRoomUpdate ────────────────────────────────────────────────────────

    #[test]
    fn test_sync_room_update_empty() {
        let payload = SyncRoomUpdate { rooms: vec![] };
        let json = serde_json::to_string(&payload).expect("serialize");
        let back: SyncRoomUpdate = serde_json::from_str(&json).expect("deserialize");
        assert!(back.rooms.is_empty());
    }

    // ── SyncTypingUpdate ──────────────────────────────────────────────────────

    #[test]
    fn test_sync_typing_update_roundtrip() {
        let payload = SyncTypingUpdate {
            room_id: "!room:example.com".to_string(),
            user_ids: vec!["@alice:example.com".to_string(), "@bob:example.com".to_string()],
        };
        let json = serde_json::to_string(&payload).expect("serialize");
        let back: SyncTypingUpdate = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.room_id, "!room:example.com");
        assert_eq!(back.user_ids.len(), 2);
        assert_eq!(back.user_ids[0], "@alice:example.com");
    }

    #[test]
    fn test_sync_typing_update_empty_users() {
        let payload = SyncTypingUpdate {
            room_id: "!room:example.com".to_string(),
            user_ids: vec![],
        };
        let json = serde_json::to_string(&payload).expect("serialize");
        let back: SyncTypingUpdate = serde_json::from_str(&json).expect("deserialize");
        assert!(back.user_ids.is_empty());
    }

    // ── SyncReadReceipt ───────────────────────────────────────────────────────

    #[test]
    fn test_sync_read_receipt_roundtrip() {
        let payload = SyncReadReceipt {
            room_id: "!room:example.com".to_string(),
            event_id: "$event:example.com".to_string(),
            user_id: "@alice:example.com".to_string(),
            ts: Some(1_700_000_000_000),
        };
        let json = serde_json::to_string(&payload).expect("serialize");
        let back: SyncReadReceipt = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.room_id, "!room:example.com");
        assert_eq!(back.event_id, "$event:example.com");
        assert_eq!(back.user_id, "@alice:example.com");
        assert_eq!(back.ts, Some(1_700_000_000_000));
    }

    // ── SyncPresenceUpdate ────────────────────────────────────────────────────

    #[test]
    fn test_sync_presence_update_roundtrip() {
        let payload = SyncPresenceUpdate {
            user_id: "@alice:example.com".to_string(),
            presence: "online".to_string(),
            status_msg: Some("Working from home".to_string()),
        };
        let json = serde_json::to_string(&payload).expect("serialize");
        let back: SyncPresenceUpdate = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.user_id, "@alice:example.com");
        assert_eq!(back.presence, "online");
        assert_eq!(back.status_msg.as_deref(), Some("Working from home"));
    }

    #[test]
    fn test_sync_presence_update_no_status_msg() {
        let payload = SyncPresenceUpdate {
            user_id: "@bob:example.com".to_string(),
            presence: "offline".to_string(),
            status_msg: None,
        };
        let json = serde_json::to_string(&payload).expect("serialize");
        let back: SyncPresenceUpdate = serde_json::from_str(&json).expect("deserialize");
        assert!(back.status_msg.is_none());
    }

    // ── SyncVerificationRequest ───────────────────────────────────────────────

    #[test]
    fn test_sync_verification_request_roundtrip() {
        let payload = SyncVerificationRequest {
            user_id: "@alice:example.com".to_string(),
            device_id: "DEVICE123".to_string(),
            flow_id: "abc123flow".to_string(),
        };
        let json = serde_json::to_string(&payload).expect("serialize");
        let back: SyncVerificationRequest = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.user_id, "@alice:example.com");
        assert_eq!(back.device_id, "DEVICE123");
        assert_eq!(back.flow_id, "abc123flow");
    }

    // ── SyncRoomUnreadCount ───────────────────────────────────────────────────

    #[test]
    fn test_sync_room_unread_count_roundtrip() {
        let payload = SyncRoomUnreadCount {
            room_id: "!room:example.com".to_string(),
            unread_count: 5,
            highlight_count: 2,
        };
        let json = serde_json::to_string(&payload).expect("serialize");
        let back: SyncRoomUnreadCount = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.room_id, "!room:example.com");
        assert_eq!(back.unread_count, 5);
        assert_eq!(back.highlight_count, 2);
    }

    #[test]
    fn test_sync_room_unread_count_zero() {
        let payload = SyncRoomUnreadCount {
            room_id: "!room:example.com".to_string(),
            unread_count: 0,
            highlight_count: 0,
        };
        let json = serde_json::to_string(&payload).expect("serialize");
        let back: SyncRoomUnreadCount = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.unread_count, 0);
        assert_eq!(back.highlight_count, 0);
    }

    // ── Event name constants ──────────────────────────────────────────────────

    #[test]
    fn test_event_name_constants() {
        assert_eq!(EVENT_NEW_MESSAGE, "quark://sync/message");
        assert_eq!(EVENT_ROOM_UPDATE, "quark://sync/rooms");
        assert_eq!(EVENT_TYPING, "quark://sync/typing");
        assert_eq!(EVENT_READ_RECEIPT, "quark://sync/read_receipt");
        assert_eq!(EVENT_PRESENCE, "quark://sync/presence");
        assert_eq!(EVENT_VERIFICATION_REQUEST, "quark://sync/verification_request");
        assert_eq!(EVENT_UNREAD_COUNT, "quark://sync/unread_count");
        assert_eq!(EVENT_CONNECTED, "quark://sync/connected");
    }

    // ── Notification dedup ────────────────────────────────────────────────────

    #[test]
    fn test_claim_notification_dedupes_repeated_event() {
        // Use unique IDs so this test is independent of the process-global set.
        let id = "$claim-dedupe-test:example.com";
        assert!(claim_notification(id), "first delivery should notify");
        assert!(!claim_notification(id), "re-delivery should be suppressed");
        assert!(!claim_notification(id), "still suppressed on a third delivery");
    }

    #[test]
    fn test_claim_notification_evicts_oldest_past_cap() {
        let first = "$evict-test-first:example.com";
        assert!(claim_notification(first));
        // Fill past the cap so `first` is evicted from the back-bounded deque.
        for i in 0..MAX_NOTIFIED_IDS {
            assert!(claim_notification(&format!("$evict-test-{i}:example.com")));
        }
        // Evicted → treated as new again (notifies). Acceptable: the cap only
        // bounds memory; a duplicate this far back in history is implausible.
        assert!(claim_notification(first), "evicted ID should be claimable again");
    }
}
