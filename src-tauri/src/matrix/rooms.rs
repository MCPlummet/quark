use matrix_sdk::{
    room::RoomMemberRole,
    ruma::{
        api::client::room::create_room::v3::Request as CreateRoomRequest,
        events::receipt::ReceiptThread,
        RoomId,
    },
    Client, RoomMemberships,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::Semaphore;
use tracing::info;

/// Serializable room info for IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomInfo {
    pub room_id: String,
    pub name: Option<String>,
    pub topic: Option<String>,
    pub avatar_url: Option<String>,
    pub unread_count: u64,
    pub notification_count: u64,
    pub is_direct: bool,
    pub is_encrypted: bool,
    pub member_count: u64,
    /// Timestamp (ms since Unix epoch) of the most recent event in the room.
    /// Used to sort DMs by recency. May be None if the room has no local events.
    pub last_activity_ts: Option<u64>,
}

/// Live record of each room's most-recent message timestamp (ms since epoch),
/// fed by the sync event handlers in `events.rs`. `get_rooms` reads from here
/// instead of probing `/messages` per room — `Room::messages()` is always a
/// network round-trip in matrix-sdk 0.9, so the old per-room probe made every
/// room-list refresh cost N HTTP calls.
///
/// Persisted as JSON (timestamps only — message content never touches disk,
/// for the same at-rest reasons the search index is SQLCipher-encrypted).
#[derive(Default)]
pub struct RecencyState {
    map: Mutex<HashMap<String, u64>>,
    path: Mutex<Option<PathBuf>>,
    dirty: AtomicBool,
}

/// On-disk format version. v1 was a bare room→timestamp map whose probed
/// values counted *any* event type — member/profile churn inflated dormant
/// rooms, and `bump` being monotonic means those values could never come back
/// down. v2 discards v1 data once so the message-only probe repopulates it.
const RECENCY_FORMAT_VERSION: u32 = 2;

#[derive(Serialize, Deserialize)]
struct PersistedRecency {
    v: u32,
    rooms: HashMap<String, u64>,
}

impl RecencyState {
    /// Attach the persistence path and merge any previously saved timestamps
    /// (keeping the newer value per room if sync already bumped one).
    pub fn init(&self, path: PathBuf) {
        if let Ok(data) = std::fs::read_to_string(&path) {
            match serde_json::from_str::<PersistedRecency>(&data) {
                Ok(saved) if saved.v == RECENCY_FORMAT_VERSION => {
                    if let Ok(mut map) = self.map.lock() {
                        for (room_id, ts) in saved.rooms {
                            let entry = map.entry(room_id).or_insert(0);
                            if ts > *entry {
                                *entry = ts;
                            }
                        }
                    }
                }
                // v1 (bare map, no version field) or unknown: discard, and
                // mark dirty so the next flush rewrites the file in the
                // current format even if no message arrives first.
                _ => self.dirty.store(true, Ordering::Relaxed),
            }
        }
        if let Ok(mut p) = self.path.lock() {
            *p = Some(path);
        }
    }

    /// Record a room's activity timestamp. Monotonic per room — an older
    /// timestamp (out-of-order delivery, sync replay) never moves it back.
    pub fn bump(&self, room_id: &str, ts: u64) {
        if let Ok(mut map) = self.map.lock() {
            let entry = map.entry(room_id.to_string()).or_insert(0);
            if ts > *entry {
                *entry = ts;
                self.dirty.store(true, Ordering::Relaxed);
            }
        }
    }

    pub fn get(&self, room_id: &str) -> Option<u64> {
        self.map
            .lock()
            .ok()
            .and_then(|map| map.get(room_id).copied())
    }

    /// Write the map to disk if it changed since the last flush. Called by the
    /// periodic flusher and the `RunEvent::Exit` hook in `lib.rs`.
    pub fn flush(&self) -> std::io::Result<()> {
        if !self.dirty.swap(false, Ordering::Relaxed) {
            return Ok(());
        }
        let Some(path) = self.path.lock().ok().and_then(|p| p.clone()) else {
            return Ok(());
        };
        let json = {
            let map = self
                .map
                .lock()
                .map_err(|e| std::io::Error::other(e.to_string()))?;
            serde_json::to_string(&PersistedRecency {
                v: RECENCY_FORMAT_VERSION,
                rooms: map.clone(),
            })?
        };
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, json)
    }
}

/// Most-recent message-like event per room, for the Home view's chat bubbles.
/// In-memory only — message text never touches disk unencrypted (the same
/// at-rest rule that keeps the search index SQLCipher-encrypted and
/// `RecencyState` timestamps-only). Fed by the sync handlers in `events.rs`;
/// rooms missing here are backfilled by `get_home_data`'s bounded probe.
#[derive(Default)]
pub struct LastEventCache(Mutex<HashMap<String, LastEventInfo>>);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LastEventInfo {
    pub sender: String,
    /// Single-line plain-text snippet (no HTML crosses this type).
    pub body: String,
    pub msg_type: String,
    pub is_utd: bool,
    pub ts: u64,
}

impl LastEventCache {
    /// Record an event if it's newer than the stored one (sync replays and
    /// out-of-order delivery never regress the bubble).
    pub fn record(&self, room_id: &str, info: LastEventInfo) {
        if let Ok(mut map) = self.0.lock() {
            match map.get(room_id) {
                Some(existing) if existing.ts >= info.ts => {}
                _ => {
                    map.insert(room_id.to_string(), info);
                }
            }
        }
    }

    pub fn get(&self, room_id: &str) -> Option<LastEventInfo> {
        self.0.lock().ok().and_then(|map| map.get(room_id).cloned())
    }
}

/// Collapse whitespace/newlines and truncate to `max_chars` (char-safe),
/// appending an ellipsis when shortened. For one-line message previews.
pub fn snippet(body: &str, max_chars: usize) -> String {
    let one_line = body.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut out: String = one_line.chars().take(max_chars).collect();
    if one_line.chars().count() > max_chars {
        out.push('…');
    }
    out
}

/// One bounded `/messages` probe for a room's most recent message-like event
/// (m.room.message / m.sticker / still-encrypted m.room.encrypted). State
/// events, reactions, and redactions are deliberately not activity: keying
/// recency on "latest event of any type" let member/profile churn (avatar and
/// display-name changes fan out an m.room.member event to every shared room)
/// outrank real conversations. The server-side type filter keeps noise from
/// eating the small page; `convert_raw_message_like` re-checks client-side.
/// Always a network round-trip in matrix-sdk 0.9 — callers cache the result.
async fn probe_last_message(room: &matrix_sdk::Room) -> Option<LastEventInfo> {
    let mut opts = matrix_sdk::room::MessagesOptions::backward();
    opts.limit = matrix_sdk::ruma::UInt::from(8u32);
    opts.filter.types = Some(vec![
        "m.room.message".to_owned(),
        "m.sticker".to_owned(),
        "m.room.encrypted".to_owned(),
    ]);
    room.messages(opts).await.ok().and_then(|page| {
        page.chunk.iter().find_map(|ev| {
            crate::matrix::timeline::convert_raw_message_like(ev.raw())
                .filter(|te| !te.is_edit)
                .map(|te| LastEventInfo {
                    sender: te.sender,
                    body: snippet(&te.body, HOME_SNIPPET_MAX),
                    is_utd: te.msg_type == "m.room.encrypted",
                    msg_type: te.msg_type,
                    ts: te.timestamp,
                })
        })
    })
}

/// Per-DM payload for the Home view: partner identity, presence-ready user
/// id, latest-message preview, and recency.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HomeDmInfo {
    pub room_id: String,
    pub name: Option<String>,
    /// The DM partner's user ID (from m.direct), when known.
    pub dm_user_id: Option<String>,
    /// Partner avatar (preferred) or room avatar, as an mxc:// URL.
    pub avatar_url: Option<String>,
    pub last_activity_ts: Option<u64>,
    pub last_sender: Option<String>,
    pub last_body: Option<String>,
    pub last_msg_type: Option<String>,
    pub last_is_utd: bool,
    pub unread_count: u64,
}

/// Maximum characters in a Home-view bubble snippet.
pub const HOME_SNIPPET_MAX: usize = 120;

/// Collect the `limit` most recently active 1:1 DMs with latest-message
/// previews for the Home view. Previews come from `LastEventCache`; rooms the
/// cache has never seen (cold launch) fall back to one bounded
/// `room.messages()` probe each — at most `limit` requests, only when the
/// Home view opens, unlike the old per-room scan `get_rooms` used to do.
pub async fn get_home_data(
    client: &Client,
    recency: &RecencyState,
    last_events: &LastEventCache,
    limit: usize,
) -> Result<Vec<HomeDmInfo>, String> {
    // 1:1 DMs only — same semantics as the frontend's isOneOnOneDm filter.
    let mut dms: Vec<(matrix_sdk::Room, u64)> = client
        .joined_rooms()
        .into_iter()
        .filter(|room| !room.direct_targets().is_empty() && room.joined_members_count() <= 2)
        .map(|room| {
            let ts = recency.get(room.room_id().as_str()).unwrap_or(0);
            (room, ts)
        })
        .collect();
    dms.sort_by(|a, b| b.1.cmp(&a.1));
    dms.truncate(limit);

    let semaphore = Arc::new(Semaphore::new(4));
    let mut tasks = tokio::task::JoinSet::new();

    for (index, (room, recency_ts)) in dms.into_iter().enumerate() {
        let permit = semaphore.clone().acquire_owned().await.unwrap();
        let cached_last = last_events.get(room.room_id().as_str());
        tasks.spawn(async move {
            let _permit = permit;
            let room_id = room.room_id().to_string();
            let name = room.compute_display_name().await.ok().map(|n| n.to_string());
            let dm_user_id = room
                .direct_targets()
                .into_iter()
                .next()
                .map(|t| t.to_string());

            // Prefer the partner's member avatar (DM rooms rarely set a room
            // avatar); store read, no network.
            let mut avatar_url = None;
            if let Some(uid) = dm_user_id.as_deref() {
                if let Ok(user_id) = <&matrix_sdk::ruma::UserId>::try_from(uid) {
                    if let Ok(Some(member)) = room.get_member_no_sync(user_id).await {
                        avatar_url = member.avatar_url().map(|u| u.to_string());
                    }
                }
            }
            if avatar_url.is_none() {
                avatar_url = room.avatar_url().map(|u| u.to_string());
            }

            // Latest message: live cache first, bounded network probe only
            // for rooms the cache has never seen. The probe result is NOT
            // written back here (no &LastEventCache across the spawn) — the
            // sync stream takes over from the first live message.
            let last = match cached_last {
                Some(info) => Some(info),
                None => probe_last_message(&room).await,
            };

            let unread_count = room.unread_notification_counts().notification_count;
            let last_activity_ts = match (recency_ts, last.as_ref()) {
                (0, Some(info)) => Some(info.ts),
                (0, None) => None,
                (ts, _) => Some(ts),
            };

            (
                index,
                HomeDmInfo {
                    room_id,
                    name,
                    dm_user_id,
                    avatar_url,
                    last_activity_ts,
                    last_sender: last.as_ref().map(|l| l.sender.clone()),
                    last_body: last.as_ref().and_then(|l| {
                        if l.is_utd { None } else { Some(l.body.clone()) }
                    }),
                    last_msg_type: last.as_ref().map(|l| l.msg_type.clone()),
                    last_is_utd: last.as_ref().map(|l| l.is_utd).unwrap_or(false),
                    unread_count,
                },
            )
        });
    }

    let mut indexed = Vec::new();
    while let Some(res) = tasks.join_next().await {
        if let Ok(item) = res {
            indexed.push(item);
        }
    }
    indexed.sort_by_key(|(index, _)| *index);

    let result: Vec<HomeDmInfo> = indexed.into_iter().map(|(_, info)| info).collect();

    // Backfill the caches from probe results so the next open is instant and
    // recency-sorted even before the first live message.
    for info in &result {
        if let (Some(ts), Some(sender)) = (info.last_activity_ts, info.last_sender.as_ref()) {
            recency.bump(&info.room_id, ts);
            last_events.record(
                &info.room_id,
                LastEventInfo {
                    sender: sender.clone(),
                    body: info.last_body.clone().unwrap_or_default(),
                    msg_type: info.last_msg_type.clone().unwrap_or_default(),
                    is_utd: info.last_is_utd,
                    ts,
                },
            );
        }
    }

    Ok(result)
}

/// Get info for all joined rooms.
pub async fn get_rooms(client: &Client, recency: &RecencyState) -> Result<Vec<RoomInfo>, String> {
    let rooms = client.joined_rooms();
    let semaphore = Arc::new(Semaphore::new(8));
    let mut tasks = tokio::task::JoinSet::new();

    for room in rooms {
        let permit = semaphore.clone().acquire_owned().await.unwrap();
        // Timestamp from the live recency store (fed by sync handlers,
        // persisted across runs). Only rooms the store has never seen fall
        // back to a network probe inside the task.
        let known_ts = recency.get(room.room_id().as_str());
        tasks.spawn(async move {
            let _permit = permit;
            let name = room.compute_display_name().await.ok().map(|n| n.to_string());
            let topic = room.topic();
            let avatar_url = room.avatar_url().map(|url| url.to_string());
            let is_direct = room.is_direct().await.unwrap_or(false);
            let is_encrypted = room.is_encrypted().await.unwrap_or(false);
            let member_count = room.joined_members_count();

            let unread = room.unread_notification_counts();
            let notification_count = unread.notification_count;
            let unread_count = unread.highlight_count;

            // Fallback probe: runs at most once per room ever — the result is
            // written back to the recency store below. Message-like events
            // only; a room with no messages has no activity timestamp.
            let last_activity_ts = match known_ts {
                Some(ts) => Some(ts),
                None => probe_last_message(&room).await.map(|info| info.ts),
            };

            RoomInfo {
                room_id: room.room_id().to_string(),
                name,
                topic,
                avatar_url,
                unread_count,
                notification_count,
                is_direct,
                is_encrypted,
                member_count,
                last_activity_ts,
            }
        });
    }

    let mut result = Vec::new();
    while let Some(res) = tasks.join_next().await {
        if let Ok(info) = res {
            result.push(info);
        }
    }

    // Persist probed fallbacks. `bump` is monotonic, so entries that came from
    // the store are no-ops here.
    for info in &result {
        if let Some(ts) = info.last_activity_ts {
            recency.bump(&info.room_id, ts);
        }
    }

    Ok(result)
}

/// Join a room by its ID or alias.
pub async fn join_room(client: &Client, room_id_or_alias: &str) -> Result<String, String> {
    use matrix_sdk::ruma::RoomOrAliasId;

    let id = <&RoomOrAliasId>::try_from(room_id_or_alias)
        .map_err(|e| format!("Invalid room ID or alias: {e}"))?;

    let room = client
        .join_room_by_id_or_alias(id, &[])
        .await
        .map_err(|e| format!("Failed to join room: {e}"))?;

    let room_id = room.room_id().to_string();
    info!(room_id = %room_id, "Joined room");
    Ok(room_id)
}

/// Leave a room by its ID.
pub async fn leave_room(client: &Client, room_id: &str) -> Result<(), String> {
    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;

    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {} not found", room_id))?;

    room.leave()
        .await
        .map_err(|e| format!("Failed to leave room: {e}"))?;

    info!(room_id = %room_id, "Left room");
    Ok(())
}

/// Invite a user to a room.
pub async fn invite_user(client: &Client, room_id: &str, user_id: &str) -> Result<(), String> {
    use matrix_sdk::ruma::UserId;

    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let user_id = UserId::parse(user_id).map_err(|e| format!("Invalid user ID: {e}"))?;

    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {room_id} not found"))?;

    room.invite_user_by_id(&user_id)
        .await
        .map_err(|e| format!("Failed to invite user: {e}"))
}

/// Kick a user from a room with an optional reason.
pub async fn kick_user(client: &Client, room_id: &str, user_id: &str, reason: Option<&str>) -> Result<(), String> {
    use matrix_sdk::ruma::UserId;

    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let user_id = UserId::parse(user_id).map_err(|e| format!("Invalid user ID: {e}"))?;

    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {room_id} not found"))?;

    room.kick_user(&user_id, reason)
        .await
        .map_err(|e| format!("Failed to kick user: {e}"))
}

/// Ban a user from a room with an optional reason.
pub async fn ban_user(client: &Client, room_id: &str, user_id: &str, reason: Option<&str>) -> Result<(), String> {
    use matrix_sdk::ruma::UserId;

    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let user_id = UserId::parse(user_id).map_err(|e| format!("Invalid user ID: {e}"))?;

    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {room_id} not found"))?;

    room.ban_user(&user_id, reason)
        .await
        .map_err(|e| format!("Failed to ban user: {e}"))
}

/// Unban a user from a room.
pub async fn unban_user(client: &Client, room_id: &str, user_id: &str) -> Result<(), String> {
    use matrix_sdk::ruma::UserId;

    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let user_id = UserId::parse(user_id).map_err(|e| format!("Invalid user ID: {e}"))?;

    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {room_id} not found"))?;

    room.unban_user(&user_id, None)
        .await
        .map_err(|e| format!("Failed to unban user: {e}"))
}

/// Serializable room member for IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomMemberInfo {
    pub user_id: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    /// "admin" | "mod" | "member"
    pub power_level: String,
    /// "online" | "unavailable" | "offline" | null
    pub presence: Option<String>,
}

/// Get members of a room.
pub async fn get_room_members(client: &Client, room_id: &str) -> Result<Vec<RoomMemberInfo>, String> {
    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {room_id} not found"))?;

    let members = room
        .members(RoomMemberships::JOIN)
        .await
        .map_err(|e| format!("Failed to fetch members: {e}"))?;

    Ok(members
        .iter()
        .map(|m| {
            let power_level = match m.suggested_role_for_power_level() {
                RoomMemberRole::Administrator => "admin",
                RoomMemberRole::Moderator => "mod",
                RoomMemberRole::User => "member",
            };
            RoomMemberInfo {
                user_id: m.user_id().to_string(),
                display_name: m.display_name().map(str::to_string),
                avatar_url: m.avatar_url().map(|u| u.to_string()),
                power_level: power_level.to_string(),
                presence: None,
            }
        })
        .collect())
}

/// Mark a room as fully read by sending a read receipt for the latest event.
///
/// `send_public` controls whether the visible-to-others `m.read` receipt is sent
/// (the "send my read receipts" privacy setting). The private `m.read.private`
/// receipt is always sent so unread counts clear regardless of the setting.
pub async fn mark_room_read(client: &Client, room_id: &str, send_public: bool) -> Result<(), String> {
    use matrix_sdk::ruma::api::client::receipt::create_receipt::v3::ReceiptType;

    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {room_id} not found"))?;

    // Fetch the latest event ID from the timeline to anchor the receipt
    let opts = matrix_sdk::room::MessagesOptions::backward();
    let messages = room
        .messages(opts)
        .await
        .map_err(|e| format!("Failed to fetch messages for read receipt: {e}"))?;

    if let Some(event) = messages.chunk.first() {
        let event_id = event.kind.event_id().ok_or("Latest event has no ID")?;
        // Send public read receipt (visible to other users) unless the privacy
        // setting opts out.
        if send_public {
            room.send_single_receipt(ReceiptType::Read, ReceiptThread::Unthreaded, event_id.to_owned())
                .await
                .map_err(|e| format!("Failed to send read receipt: {e}"))?;
        }
        // Always send the private read receipt (not shared with other users) so
        // the room's unread count clears even when public receipts are disabled.
        room.send_single_receipt(ReceiptType::ReadPrivate, ReceiptThread::Unthreaded, event_id.to_owned())
            .await
            .map_err(|e| format!("Failed to send private read receipt: {e}"))?;
    }

    Ok(())
}

/// A single user's latest public read position in a room.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadReceiptInfo {
    pub user_id: String,
    pub event_id: String,
    /// When the receipt was sent (ms since epoch), if known. Lets the frontend
    /// place the avatar on the nearest rendered message and show "read at" times.
    pub ts: Option<u64>,
}

/// Load every other joined member's latest public main-timeline read receipt.
///
/// Reads from the local store only — no network round-trip — so it's safe to
/// call on every room open. The per-member receipt lookups run concurrently and
/// the member set is capped so the cost stays bounded in very large rooms.
///
/// Both `Unthreaded` (thread-unaware clients) and `Main` (thread-aware clients
/// like Element, which tag main-timeline reads with `thread_id: "main"`) are
/// queried and the later of the two is returned — querying only `Unthreaded`
/// silently dropped every Element user's receipt.
pub async fn get_room_receipts(client: &Client, room_id: &str) -> Result<Vec<ReadReceiptInfo>, String> {
    use matrix_sdk::ruma::events::receipt::{Receipt, ReceiptType as EventReceiptType};
    use matrix_sdk::ruma::OwnedEventId;

    /// Upper bound on members whose receipt we look up per room. Element renders
    /// far fewer avatars than this; the cap only protects huge rooms from a
    /// pathological number of local store reads.
    const MAX_MEMBERS: usize = 500;

    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {room_id} not found"))?;

    let own_id = room.own_user_id().to_owned();

    // Cheap local-store member enumeration (no network round-trip).
    let mut user_ids = client
        .store()
        .get_user_ids(room.room_id(), RoomMemberships::JOIN)
        .await
        .map_err(|e| format!("Failed to load room members: {e}"))?;
    user_ids.retain(|u| u != &own_id);
    user_ids.truncate(MAX_MEMBERS);

    let receipt_ms = |r: &Receipt| -> Option<u64> { r.ts.map(|t| u64::from(t.get())) };

    let semaphore = Arc::new(Semaphore::new(16));
    let mut tasks = tokio::task::JoinSet::new();

    for uid in user_ids {
        let room = room.clone();
        let permit = semaphore.clone().acquire_owned().await.unwrap();
        tasks.spawn(async move {
            let _permit = permit;
            let unthreaded = room
                .load_user_receipt(EventReceiptType::Read, ReceiptThread::Unthreaded, &uid)
                .await
                .ok()
                .flatten();
            let main = room
                .load_user_receipt(EventReceiptType::Read, ReceiptThread::Main, &uid)
                .await
                .ok()
                .flatten();

            // Pick the later of the two by timestamp; if only one exists use it.
            let best: Option<(OwnedEventId, Option<u64>)> = match (unthreaded, main) {
                (Some((ue, ur)), Some((me, mr))) => {
                    let (ut, mt) = (receipt_ms(&ur), receipt_ms(&mr));
                    if mt > ut { Some((me, mt)) } else { Some((ue, ut)) }
                }
                (Some((ue, ur)), None) => Some((ue, receipt_ms(&ur))),
                (None, Some((me, mr))) => Some((me, receipt_ms(&mr))),
                (None, None) => None,
            };

            best.map(|(event_id, ts)| ReadReceiptInfo {
                user_id: uid.to_string(),
                event_id: event_id.to_string(),
                ts,
            })
        });
    }

    let mut result = Vec::new();
    while let Some(res) = tasks.join_next().await {
        if let Ok(Some(info)) = res {
            result.push(info);
        }
    }

    Ok(result)
}

/// Options for creating a new room.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRoomOptions {
    pub name: Option<String>,
    pub topic: Option<String>,
    pub alias: Option<String>,
    pub is_public: bool,
    pub is_direct: bool,
    pub invite: Vec<String>,
    pub enable_encryption: bool,
}

/// Create a new room.
#[allow(dead_code)]
pub async fn create_room(
    client: &Client,
    options: CreateRoomOptions,
) -> Result<String, String> {
    use matrix_sdk::ruma::{
        api::client::room::create_room::v3::RoomPreset,
        RoomAliasId,
    };

    let mut request = CreateRoomRequest::new();

    if let Some(ref name) = options.name {
        request.name = Some(name.as_str().into());
    }

    if let Some(ref topic) = options.topic {
        request.topic = Some(topic.clone());
    }

    if let Some(ref alias) = options.alias {
        let alias_id = RoomAliasId::parse(alias)
            .map_err(|e| format!("Invalid room alias: {e}"))?;
        request.room_alias_name = Some(alias_id.alias().to_owned());
    }

    request.preset = Some(if options.is_public {
        RoomPreset::PublicChat
    } else if options.is_direct {
        RoomPreset::TrustedPrivateChat
    } else {
        RoomPreset::PrivateChat
    });

    request.is_direct = options.is_direct;

    // Add invites
    let invite_ids: Vec<_> = options
        .invite
        .iter()
        .filter_map(|id| matrix_sdk::ruma::UserId::parse(id).ok())
        .collect();
    request.invite = invite_ids;

    let response = client
        .create_room(request)
        .await
        .map_err(|e| format!("Failed to create room: {e}"))?;

    let room_id = response.room_id().to_string();

    // Enable encryption if requested
    if options.enable_encryption {
        if let Some(room) = client.get_room(response.room_id()) {
            room.enable_encryption()
                .await
                .map_err(|e| format!("Failed to enable encryption: {e}"))?;
        }
    }

    info!(room_id = %room_id, "Created room");
    Ok(room_id)
}

/// A single pinned event's content, resolved from the room timeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PinnedEventInfo {
    pub event_id: String,
    pub sender: String,
    pub body: String,
    pub formatted_body: Option<String>,
    pub timestamp: u64,
    /// True when the pinned event couldn't be decrypted (keys not yet
    /// available). `body` carries the "🔒 unable to decrypt" placeholder so the
    /// row isn't blank; the frontend dims it and re-fetches when keys arrive.
    pub encrypted: bool,
}

/// Fetch the pinned events for a room.
pub async fn get_pinned_events(client: &Client, room_id: &str) -> Result<Vec<PinnedEventInfo>, String> {
    use matrix_sdk::ruma::events::StateEventType;
    use matrix_sdk::ruma::EventId;
    use serde_json::Value;

    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {room_id} not found"))?;

    // Read m.room.pinned_events state event
    let raw_opt = room
        .get_state_event(StateEventType::from("m.room.pinned_events"), "")
        .await
        .map_err(|e| format!("Failed to fetch pinned events state: {e}"))?;

    let raw = match raw_opt {
        Some(r) => r,
        None => return Ok(vec![]),
    };

    let json: Value = {
        use matrix_sdk::deserialized_responses::RawAnySyncOrStrippedState;
        match raw {
            RawAnySyncOrStrippedState::Sync(r) => r.deserialize_as::<Value>().unwrap_or(Value::Null),
            RawAnySyncOrStrippedState::Stripped(r) => r.deserialize_as::<Value>().unwrap_or(Value::Null),
        }
    };

    let pinned_ids: Vec<String> = json
        .get("content")
        .and_then(|c| c.get("pinned"))
        .and_then(|p| p.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
        .unwrap_or_default();

    // Fetch each pinned event directly by ID (one request per event) instead of
    // scanning a large message batch for each pin. Cap at 20 and limit concurrency
    // to 5 simultaneous fetches to avoid flooding the server.
    let semaphore = Arc::new(Semaphore::new(5));
    let mut tasks = tokio::task::JoinSet::new();

    for event_id_str in pinned_ids.into_iter().take(20) {
        let Ok(event_id) = EventId::parse(&event_id_str) else { continue };
        let room = room.clone();
        let permit = semaphore.clone().acquire_owned().await.unwrap();

        tasks.spawn(async move {
            let _permit = permit;
            let Ok(timeline_event) = room.event(&event_id, None).await else {
                return None;
            };
            let Ok(json_val) = timeline_event.raw().deserialize_as::<Value>() else {
                return None;
            };
            let sender = json_val.get("sender").and_then(|s| s.as_str()).unwrap_or("").to_string();
            let ts = json_val.get("origin_server_ts").and_then(|t| t.as_u64()).unwrap_or(0);
            // An undecryptable event stays as m.room.encrypted (no decrypted
            // content/body); flag it and substitute the UTD placeholder so the
            // dialog shows something rather than a blank row.
            let encrypted = json_val.get("type").and_then(|t| t.as_str()) == Some("m.room.encrypted");
            let content = json_val.get("content").unwrap_or(&Value::Null);
            let formatted_body = content
                .get("formatted_body")
                .and_then(|b| b.as_str())
                .map(crate::matrix::html::sanitize);
            let body = if encrypted {
                "\u{1f512} unable to decrypt".to_string()
            } else {
                content.get("body").and_then(|b| b.as_str()).unwrap_or("").to_string()
            };
            Some(PinnedEventInfo {
                event_id: event_id_str,
                sender,
                body,
                formatted_body,
                timestamp: ts,
                encrypted,
            })
        });
    }

    let mut result = Vec::new();
    while let Some(res) = tasks.join_next().await {
        if let Ok(Some(info)) = res {
            result.push(info);
        }
    }
    result.sort_by_key(|e| e.timestamp);

    Ok(result)
}

/// Serializable public room for the room directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicRoomInfo {
    pub room_id: String,
    pub name: Option<String>,
    pub topic: Option<String>,
    pub alias: Option<String>,
    pub avatar_url: Option<String>,
    pub member_count: Option<u64>,
}

/// Search the public room directory.
pub async fn search_room_directory(
    client: &Client,
    filter: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<PublicRoomInfo>, String> {
    use matrix_sdk::ruma::api::client::directory::get_public_rooms_filtered::v3::Request as PubRoomsRequest;
    use matrix_sdk::ruma::directory::Filter;
    use matrix_sdk::ruma::UInt;

    let mut request = PubRoomsRequest::new();

    if let Some(limit_val) = limit {
        request.limit = Some(UInt::from(limit_val));
    }

    if let Some(filter_text) = filter {
        let mut f = Filter::new();
        f.generic_search_term = Some(filter_text);
        request.filter = f;
    }

    let response = client
        .public_rooms_filtered(request)
        .await
        .map_err(|e| format!("Room directory search failed: {e}"))?;

    Ok(response
        .chunk
        .into_iter()
        .map(|room| PublicRoomInfo {
            room_id: room.room_id.to_string(),
            name: room.name,
            topic: room.topic,
            alias: room.canonical_alias.map(|a| a.to_string()),
            avatar_url: room.avatar_url.map(|u| u.to_string()),
            member_count: Some(room.num_joined_members.into()),
        })
        .collect())
}

// ─── Room settings (name / topic / join-rule / history-visibility / power levels) ─

/// Serializable power levels for IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PowerLevels {
    pub ban: i64,
    pub kick: i64,
    pub invite: i64,
    pub redact: i64,
    pub state_default: i64,
    pub events_default: i64,
    pub users_default: i64,
    /// Numeric level required to send each named event type key.
    pub events: std::collections::HashMap<String, i64>,
    /// Per-user overrides: user_id → power level.
    pub users: std::collections::HashMap<String, i64>,
}

/// Get the current power levels for a room, returned as a `PowerLevels` struct.
pub async fn get_power_levels(client: &Client, room_id: &str) -> Result<PowerLevels, String> {
    use matrix_sdk::deserialized_responses::RawAnySyncOrStrippedState;
    use matrix_sdk::ruma::events::StateEventType;
    use serde_json::Value;

    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {room_id} not found"))?;

    let raw_opt = room
        .get_state_event(StateEventType::RoomPowerLevels, "")
        .await
        .map_err(|e| format!("Failed to fetch power levels: {e}"))?;

    let raw = raw_opt.ok_or_else(|| format!("No power levels in {room_id}"))?;
    let val: Value = match raw {
        RawAnySyncOrStrippedState::Sync(r) => {
            r.deserialize_as::<Value>().map_err(|e| format!("Deserialize error: {e}"))?
        }
        RawAnySyncOrStrippedState::Stripped(r) => {
            r.deserialize_as::<Value>().map_err(|e| format!("Deserialize error: {e}"))?
        }
    };

    let content = &val["content"];
    let get_i64 = |field: &str, default: i64| -> i64 {
        content[field].as_i64().unwrap_or(default)
    };

    let events: std::collections::HashMap<String, i64> = content["events"]
        .as_object()
        .map(|m| {
            m.iter()
                .filter_map(|(k, v)| Some((k.clone(), v.as_i64()?)))
                .collect()
        })
        .unwrap_or_default();

    let users: std::collections::HashMap<String, i64> = content["users"]
        .as_object()
        .map(|m| {
            m.iter()
                .filter_map(|(k, v)| Some((k.clone(), v.as_i64()?)))
                .collect()
        })
        .unwrap_or_default();

    Ok(PowerLevels {
        ban: get_i64("ban", 50),
        kick: get_i64("kick", 50),
        invite: get_i64("invite", 50),
        redact: get_i64("redact", 50),
        state_default: get_i64("state_default", 50),
        events_default: get_i64("events_default", 0),
        users_default: get_i64("users_default", 0),
        events,
        users,
    })
}

/// Update the power levels for a room.  Fetches the current event, patches the
/// user-visible fields, and re-sends.
pub async fn set_power_levels(
    client: &Client,
    room_id: &str,
    levels: PowerLevels,
) -> Result<(), String> {
    use matrix_sdk::deserialized_responses::RawAnySyncOrStrippedState;
    use matrix_sdk::ruma::events::room::power_levels::RoomPowerLevelsEventContent;
    use matrix_sdk::ruma::events::StateEventType;
    use serde_json::Value;

    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {room_id} not found"))?;

    // Fetch current content as a JSON Value so we can merge cleanly.
    let raw_opt = room
        .get_state_event(StateEventType::RoomPowerLevels, "")
        .await
        .map_err(|e| format!("Failed to fetch power levels: {e}"))?;
    let raw = raw_opt.ok_or_else(|| format!("No power levels in {room_id}"))?;
    let mut val: Value = match raw {
        RawAnySyncOrStrippedState::Sync(r) => {
            r.deserialize_as::<Value>().map_err(|e| format!("Deserialize error: {e}"))?
        }
        RawAnySyncOrStrippedState::Stripped(r) => {
            r.deserialize_as::<Value>().map_err(|e| format!("Deserialize error: {e}"))?
        }
    };

    // Patch top-level content fields.
    let content = val["content"].as_object_mut().ok_or("No content in power levels")?;
    content.insert("ban".into(), levels.ban.into());
    content.insert("kick".into(), levels.kick.into());
    content.insert("invite".into(), levels.invite.into());
    content.insert("redact".into(), levels.redact.into());
    content.insert("state_default".into(), levels.state_default.into());
    content.insert("events_default".into(), levels.events_default.into());
    content.insert("users_default".into(), levels.users_default.into());

    // Patch events map.
    let events_obj = content
        .entry("events")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or("events is not an object")?;
    for (k, v) in &levels.events {
        events_obj.insert(k.clone(), (*v).into());
    }

    // Patch users map.
    let users_obj = content
        .entry("users")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or("users is not an object")?;
    for (k, v) in &levels.users {
        users_obj.insert(k.clone(), (*v).into());
    }

    // Deserialize the patched content into the typed struct and send.
    let new_content: RoomPowerLevelsEventContent = serde_json::from_value(val["content"].clone())
        .map_err(|e| format!("Failed to build power levels content: {e}"))?;

    room.send_state_event(new_content)
        .await
        .map_err(|e| format!("Failed to set power levels: {e}"))?;

    Ok(())
}

/// Update a room's display name.
pub async fn set_room_name(client: &Client, room_id: &str, name: String) -> Result<(), String> {
    use matrix_sdk::ruma::events::room::name::RoomNameEventContent;

    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {room_id} not found"))?;
    room.send_state_event(RoomNameEventContent::new(name))
        .await
        .map_err(|e| format!("Failed to set room name: {e}"))?;
    Ok(())
}

/// Update a room's topic.
pub async fn set_room_topic(client: &Client, room_id: &str, topic: String) -> Result<(), String> {
    use matrix_sdk::ruma::events::room::topic::RoomTopicEventContent;

    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {room_id} not found"))?;
    room.send_state_event(RoomTopicEventContent::new(topic))
        .await
        .map_err(|e| format!("Failed to set room topic: {e}"))?;
    Ok(())
}

/// Set the join rule for a room: "public" | "invite" | "knock" | "private".
pub async fn set_room_join_rule(client: &Client, room_id: &str, rule: &str) -> Result<(), String> {
    use matrix_sdk::ruma::events::room::join_rules::{JoinRule, RoomJoinRulesEventContent};

    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {room_id} not found"))?;

    let join_rule = match rule {
        "public" => JoinRule::Public,
        "invite" => JoinRule::Invite,
        "knock" => JoinRule::Knock,
        "private" => JoinRule::Private,
        other => return Err(format!("Unknown join rule: {other}")),
    };

    room.send_state_event(RoomJoinRulesEventContent::new(join_rule))
        .await
        .map_err(|e| format!("Failed to set join rule: {e}"))?;
    Ok(())
}

/// Mark a room as a DM (or unmark it).
///
/// This is purely account-data (`m.direct`) — no state event is sent, so it
/// needs no power level and works in rooms we don't moderate. Marking adds the
/// room under every other active member; unmarking strips it from every entry.
pub async fn set_room_direct(
    client: &Client,
    room_id: &str,
    is_direct: bool,
) -> Result<(), String> {
    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {room_id} not found"))?;

    room.set_is_direct(is_direct)
        .await
        .map_err(|e| format!("Failed to set direct flag: {e}"))?;
    Ok(())
}

/// Set the history visibility: "invited" | "joined" | "shared" | "world_readable".
pub async fn set_room_history_visibility(
    client: &Client,
    room_id: &str,
    visibility: &str,
) -> Result<(), String> {
    use matrix_sdk::ruma::events::room::history_visibility::{
        HistoryVisibility, RoomHistoryVisibilityEventContent,
    };

    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {room_id} not found"))?;

    let hv = match visibility {
        "invited" => HistoryVisibility::Invited,
        "joined" => HistoryVisibility::Joined,
        "shared" => HistoryVisibility::Shared,
        "world_readable" => HistoryVisibility::WorldReadable,
        other => return Err(format!("Unknown history visibility: {other}")),
    };

    room.send_state_event(RoomHistoryVisibilityEventContent::new(hv))
        .await
        .map_err(|e| format!("Failed to set history visibility: {e}"))?;
    Ok(())
}

// ─── Debug / raw event viewer ─────────────────────────────────────────────────

/// Serializable state event snapshot for the debug viewer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawStateEvent {
    pub event_type: String,
    pub state_key: String,
    pub sender: String,
    pub content_json: String,
    pub event_id: Option<String>,
    pub origin_server_ts: Option<u64>,
}

/// Fetch the key state events for a room as raw JSON blobs (for the debug viewer).
pub async fn get_room_state_events(
    client: &Client,
    room_id: &str,
) -> Result<Vec<RawStateEvent>, String> {
    use matrix_sdk::deserialized_responses::RawAnySyncOrStrippedState;
    use matrix_sdk::ruma::events::StateEventType;
    use serde_json::Value;

    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {room_id} not found"))?;

    let types = [
        StateEventType::RoomName,
        StateEventType::RoomTopic,
        StateEventType::RoomJoinRules,
        StateEventType::RoomHistoryVisibility,
        StateEventType::RoomPowerLevels,
        StateEventType::RoomCanonicalAlias,
        StateEventType::RoomCreate,
        StateEventType::RoomEncryption,
        StateEventType::RoomAvatar,
        StateEventType::RoomMember,
    ];

    let mut results = Vec::new();

    for event_type in &types {
        let evs = match room.get_state_events(event_type.clone()).await {
            Ok(v) => v,
            Err(_) => continue,
        };

        for ev in evs {
            let val: Value = match &ev {
                RawAnySyncOrStrippedState::Sync(r) => {
                    match r.deserialize_as::<Value>() { Ok(v) => v, Err(_) => continue }
                }
                RawAnySyncOrStrippedState::Stripped(r) => {
                    match r.deserialize_as::<Value>() { Ok(v) => v, Err(_) => continue }
                }
            };

            results.push(RawStateEvent {
                event_type: val["type"].as_str().unwrap_or("").to_string(),
                state_key: val["state_key"].as_str().unwrap_or("").to_string(),
                sender: val["sender"].as_str().unwrap_or("").to_string(),
                content_json: serde_json::to_string_pretty(&val["content"]).unwrap_or_default(),
                event_id: val["event_id"].as_str().map(str::to_string),
                origin_server_ts: val["origin_server_ts"].as_u64(),
            });
        }
    }

    Ok(results)
}

/// Get the full raw JSON for a single timeline event (for the debug viewer).
pub async fn get_raw_event(
    client: &Client,
    room_id: &str,
    event_id: &str,
) -> Result<String, String> {
    use matrix_sdk::ruma::EventId;
    use serde_json::Value;

    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {room_id} not found"))?;
    let event_id = EventId::parse(event_id).map_err(|e| format!("Invalid event ID: {e}"))?;

    let ev = room
        .event(&event_id, None)
        .await
        .map_err(|e| format!("Failed to fetch event: {e}"))?;

    let json_str = ev.raw().json().get().to_string();
    let val: Value =
        serde_json::from_str(&json_str).map_err(|e| format!("Failed to parse event JSON: {e}"))?;
    serde_json::to_string_pretty(&val).map_err(|e| format!("Failed to serialize: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json;

    fn make_room_info(
        room_id: &str,
        name: Option<&str>,
        is_direct: bool,
        is_encrypted: bool,
    ) -> RoomInfo {
        RoomInfo {
            room_id: room_id.to_string(),
            name: name.map(str::to_string),
            topic: None,
            avatar_url: None,
            unread_count: 0,
            notification_count: 0,
            is_direct,
            is_encrypted,
            member_count: 2,
            last_activity_ts: None,
        }
    }

    // --- RecencyState ---

    #[test]
    fn recency_bump_is_monotonic_per_room() {
        let recency = RecencyState::default();
        recency.bump("!a:x", 100);
        recency.bump("!a:x", 50); // older — ignored
        assert_eq!(recency.get("!a:x"), Some(100));
        recency.bump("!a:x", 200);
        assert_eq!(recency.get("!a:x"), Some(200));
        assert_eq!(recency.get("!unknown:x"), None);
    }

    #[test]
    fn recency_flush_and_init_roundtrip() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("last_activity.json");

        let recency = RecencyState::default();
        recency.init(path.clone());
        recency.bump("!a:x", 1_700_000_000_000);
        recency.bump("!b:x", 1_700_000_000_500);
        recency.flush().expect("flush");

        let restored = RecencyState::default();
        restored.init(path);
        assert_eq!(restored.get("!a:x"), Some(1_700_000_000_000));
        assert_eq!(restored.get("!b:x"), Some(1_700_000_000_500));
    }

    #[test]
    fn recency_init_keeps_newer_in_memory_value() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("last_activity.json");
        std::fs::write(&path, r#"{"v":2,"rooms":{"!a:x":100,"!b:x":900}}"#).expect("seed file");

        let recency = RecencyState::default();
        recency.bump("!a:x", 500); // sync beat init — newer value must win
        recency.init(path);
        assert_eq!(recency.get("!a:x"), Some(500));
        assert_eq!(recency.get("!b:x"), Some(900));
    }

    #[test]
    fn recency_init_discards_v1_format() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("last_activity.json");
        // v1: bare map. Its values came from an any-event-type probe, so they
        // may be inflated by member/profile events — and bump() can never
        // lower them. Must be dropped, not migrated.
        std::fs::write(&path, r#"{"!a:x":100,"!b:x":900}"#).expect("seed file");

        let recency = RecencyState::default();
        recency.init(path.clone());
        assert_eq!(recency.get("!a:x"), None);
        assert_eq!(recency.get("!b:x"), None);

        // The discard marks the store dirty so the stale file is rewritten in
        // the current format even before any message arrives.
        recency.flush().expect("flush");
        let data = std::fs::read_to_string(&path).expect("read back");
        let parsed: serde_json::Value = serde_json::from_str(&data).expect("valid json");
        assert_eq!(parsed["v"], 2);
        assert!(parsed["rooms"].as_object().expect("rooms map").is_empty());
    }

    #[test]
    fn recency_flush_skips_when_clean() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("last_activity.json");

        let recency = RecencyState::default();
        recency.init(path.clone());
        recency.flush().expect("flush without changes is Ok");
        assert!(!path.exists(), "clean flush must not write");

        recency.bump("!a:x", 1);
        recency.flush().expect("dirty flush");
        assert!(path.exists());

        std::fs::remove_file(&path).expect("remove");
        recency.flush().expect("second clean flush");
        assert!(!path.exists(), "flush after flush must be a no-op");
    }

    #[test]
    fn recency_flush_without_path_is_ok() {
        let recency = RecencyState::default();
        recency.bump("!a:x", 1);
        recency.flush().expect("no path attached — silently Ok");
    }

    // --- LastEventCache / snippet ---

    #[test]
    fn snippet_collapses_whitespace_and_truncates_char_safe() {
        assert_eq!(snippet("hello  world\nnew line", 100), "hello world new line");
        assert_eq!(snippet("abcdef", 3), "abc…");
        assert_eq!(snippet("abc", 3), "abc"); // exactly max — no ellipsis
        // Multi-byte chars must not split.
        assert_eq!(snippet("日本語のテスト", 3), "日本語…");
        assert_eq!(snippet("", 10), "");
    }

    #[test]
    fn last_event_cache_keeps_newest_only() {
        let cache = LastEventCache::default();
        let info = |body: &str, ts: u64| LastEventInfo {
            sender: "@a:x".into(),
            body: body.into(),
            msg_type: "m.text".into(),
            is_utd: false,
            ts,
        };
        cache.record("!r:x", info("first", 100));
        cache.record("!r:x", info("older replay", 50)); // ignored
        assert_eq!(cache.get("!r:x").unwrap().body, "first");
        cache.record("!r:x", info("newer", 200));
        assert_eq!(cache.get("!r:x").unwrap().body, "newer");
        assert!(cache.get("!other:x").is_none());
    }

    #[test]
    fn home_dm_info_serialization_roundtrip() {
        let info = HomeDmInfo {
            room_id: "!dm:example.com".into(),
            name: Some("Alice".into()),
            dm_user_id: Some("@alice:example.com".into()),
            avatar_url: Some("mxc://example.com/avatar".into()),
            last_activity_ts: Some(1_700_000_000_000),
            last_sender: Some("@alice:example.com".into()),
            last_body: Some("hey!".into()),
            last_msg_type: Some("m.text".into()),
            last_is_utd: false,
            unread_count: 2,
        };
        let json = serde_json::to_string(&info).expect("serialize");
        let back: HomeDmInfo = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.room_id, "!dm:example.com");
        assert_eq!(back.dm_user_id.as_deref(), Some("@alice:example.com"));
        assert_eq!(back.last_body.as_deref(), Some("hey!"));
        assert_eq!(back.unread_count, 2);
    }

    // --- RoomInfo serialization ---

    #[test]
    fn test_room_info_serialization_roundtrip() {
        let info = RoomInfo {
            room_id: "!abc:example.com".to_string(),
            name: Some("General".to_string()),
            topic: Some("Welcome!".to_string()),
            avatar_url: Some("mxc://example.com/avatar".to_string()),
            unread_count: 5,
            notification_count: 2,
            is_direct: false,
            is_encrypted: true,
            member_count: 42,
            last_activity_ts: Some(1_700_000_000_000),
        };
        let json = serde_json::to_string(&info).expect("serialize");
        let back: RoomInfo = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.room_id, "!abc:example.com");
        assert_eq!(back.name.as_deref(), Some("General"));
        assert_eq!(back.topic.as_deref(), Some("Welcome!"));
        assert_eq!(back.unread_count, 5);
        assert_eq!(back.notification_count, 2);
        assert!(back.is_encrypted);
        assert!(!back.is_direct);
        assert_eq!(back.member_count, 42);
        assert_eq!(back.last_activity_ts, Some(1_700_000_000_000));
    }

    #[test]
    fn test_room_info_optional_fields_can_be_none() {
        let info = make_room_info("!xyz:example.com", None, false, false);
        let json = serde_json::to_string(&info).expect("serialize");
        let back: RoomInfo = serde_json::from_str(&json).expect("deserialize");
        assert!(back.name.is_none());
        assert!(back.topic.is_none());
        assert!(back.avatar_url.is_none());
    }

    #[test]
    fn test_room_info_zero_counts() {
        let info = make_room_info("!zero:example.com", Some("Empty"), false, false);
        let json = serde_json::to_string(&info).expect("serialize");
        let back: RoomInfo = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.unread_count, 0);
        assert_eq!(back.notification_count, 0);
    }

    #[test]
    fn test_room_info_direct_and_encrypted_flags() {
        let info = make_room_info("!dm:example.com", Some("Alice"), true, true);
        let json = serde_json::to_string(&info).expect("serialize");
        let back: RoomInfo = serde_json::from_str(&json).expect("deserialize");
        assert!(back.is_direct);
        assert!(back.is_encrypted);
    }

    #[test]
    fn test_room_info_json_has_expected_keys() {
        let info = make_room_info("!test:example.com", Some("Test"), false, false);
        let json = serde_json::to_string(&info).expect("serialize");
        let val: serde_json::Value = serde_json::from_str(&json).expect("parse json");
        assert!(val.get("room_id").is_some());
        assert!(val.get("name").is_some());
        assert!(val.get("unread_count").is_some());
        assert!(val.get("notification_count").is_some());
        assert!(val.get("is_direct").is_some());
        assert!(val.get("is_encrypted").is_some());
        assert!(val.get("member_count").is_some());
        assert!(val.get("last_activity_ts").is_some());
    }

    // --- CreateRoomOptions serialization ---

    #[test]
    fn test_create_room_options_roundtrip() {
        let opts = CreateRoomOptions {
            name: Some("My Room".to_string()),
            topic: Some("A topic".to_string()),
            alias: Some("#myroom:example.com".to_string()),
            is_public: true,
            is_direct: false,
            invite: vec!["@alice:example.com".to_string()],
            enable_encryption: true,
        };
        let json = serde_json::to_string(&opts).expect("serialize");
        let back: CreateRoomOptions = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.name.as_deref(), Some("My Room"));
        assert!(back.is_public);
        assert!(back.enable_encryption);
        assert_eq!(back.invite.len(), 1);
        assert_eq!(back.invite[0], "@alice:example.com");
    }

    // --- ReadReceiptInfo serialization ---

    #[test]
    fn test_read_receipt_info_roundtrip() {
        let info = ReadReceiptInfo {
            user_id: "@alice:example.com".to_string(),
            event_id: "$event:example.com".to_string(),
            ts: Some(1_700_000_000_000),
        };
        let json = serde_json::to_string(&info).expect("serialize");
        let back: ReadReceiptInfo = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.user_id, "@alice:example.com");
        assert_eq!(back.event_id, "$event:example.com");
        assert_eq!(back.ts, Some(1_700_000_000_000));
    }

    #[test]
    fn test_create_room_options_empty_invite_list() {
        let opts = CreateRoomOptions {
            name: None,
            topic: None,
            alias: None,
            is_public: false,
            is_direct: true,
            invite: vec![],
            enable_encryption: false,
        };
        let json = serde_json::to_string(&opts).expect("serialize");
        let back: CreateRoomOptions = serde_json::from_str(&json).expect("deserialize");
        assert!(back.invite.is_empty());
        assert!(back.is_direct);
        assert!(!back.enable_encryption);
    }
}
