use matrix_sdk::{
    room::MessagesOptions,
    ruma::{
        events::{
            relation::InReplyTo,
            room::message::{
                MessageType, OriginalSyncRoomMessageEvent, Relation,
                RoomMessageEventContent, TextMessageEventContent,
            },
            sticker::StickerEventContent,
            AnySyncMessageLikeEvent, AnySyncTimelineEvent, SyncMessageLikeEvent,
        },
        serde::Raw,
        EventId, OwnedEventId, RoomId, TransactionId, UInt,
    },
    Client,
};
use matrix_sdk::ruma::events::relation::RelationType;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tracing::info;

use crate::matrix::reactions::ReactionGroup;

/// Serializable timeline event for IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineEvent {
    pub event_id: String,
    pub sender: String,
    pub body: String,
    pub formatted_body: Option<String>,
    pub timestamp: u64,
    pub msg_type: String,
    pub is_edit: bool,
    pub relates_to_event_id: Option<String>,
    pub in_reply_to: Option<String>,
    pub thread_root: Option<String>,
    /// URL for media messages (images, videos, files, stickers).
    pub media_url: Option<String>,
    pub media_mimetype: Option<String>,
    pub media_width: Option<u64>,
    pub media_height: Option<u64>,
    /// Media caption (MSC2530) for image/media messages: the `body` field when a
    /// distinct `filename` is present. `None` when the body is merely the filename.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caption: Option<String>,
    /// JSON-serialized EncryptedFile for E2EE media; None for plain (unencrypted) media.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_encryption_info: Option<String>,
    /// mxc:// URL of the video thumbnail image (from VideoInfo.thumbnail_source).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_thumbnail_url: Option<String>,
    /// JSON-serialized EncryptedFile for E2EE video thumbnails.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_thumbnail_encryption_info: Option<String>,
    /// Aggregated reactions from the same fetch batch.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reactions: Vec<ReactionGroup>,
}

/// A page of timeline events plus a token for loading the previous (older) page.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelinePage {
    pub events: Vec<TimelineEvent>,
    /// Pagination token: pass as `before` to `get_timeline` to load older messages.
    /// `None` means the beginning of the room history has been reached.
    pub prev_batch: Option<String>,
}

/// A page of newer events fetched via forward pagination.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineForwardPage {
    pub events: Vec<TimelineEvent>,
    /// Token to pass as `after` to fetch the next (newer) page.
    /// `None` means the live tail of the timeline has been reached.
    pub next_batch: Option<String>,
}

/// A page of events served from the matrix-sdk event cache (used by the
/// cache-backed live-timeline path: initial open + backward scroll).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedTimelinePage {
    /// Events oldest-first.
    pub events: Vec<TimelineEvent>,
    /// True once back-pagination has reached the start of the room's history
    /// (replaces the `prev_batch == None` signal of the raw-messages path).
    pub reached_start: bool,
}

/// Events surrounding a specific event, returned by `get_event_context`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventContextPage {
    /// All events in the context window, oldest first. Includes the target event.
    pub events: Vec<TimelineEvent>,
    /// The event ID that was requested.
    pub target_event_id: String,
    /// Pagination token for loading messages older than this context window.
    pub prev_batch: Option<String>,
    /// Pagination token for loading messages newer than this context window.
    /// `None` means this context window reaches the live end of the timeline.
    pub next_batch: Option<String>,
}

/// Summary of a completed (or canceled) server-side search scan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchSummary {
    /// Total events examined across all paginated pages.
    pub scanned: u64,
    /// Number of events that matched the query (also emitted as hit events).
    pub matched: u64,
    /// True if pagination reached the start of the room's history.
    pub reached_start: bool,
    /// True if the scan was stopped early by a cancel request.
    pub canceled: bool,
}

/// Case-insensitive substring match used by all search tiers. Matches against
/// the plain body and, when present, the formatted (HTML) body. Skips
/// undecryptable events so the "unable to decrypt" placeholder never matches.
fn event_matches(ev: &TimelineEvent, query_lower: &str) -> bool {
    if ev.msg_type == "m.room.encrypted" {
        return false;
    }
    if ev.body.to_lowercase().contains(query_lower) {
        return true;
    }
    if let Some(fb) = &ev.formatted_body {
        if fb.to_lowercase().contains(query_lower) {
            return true;
        }
    }
    false
}

/// Fetch recent timeline events for a room.
/// Also aggregates any reaction events found in the same batch and attaches
/// them to their target messages so the frontend can display them immediately.
pub async fn get_timeline(
    client: &Client,
    room_id: &str,
    limit: usize,
    before: Option<String>,
) -> Result<TimelinePage, String> {
    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;

    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {} not found", room_id))?;

    let mut opts = MessagesOptions::backward();
    opts.limit = UInt::try_from(limit as u64).unwrap_or(UInt::from(50u32));
    opts.from = before;

    let messages = room
        .messages(opts)
        .await
        .map_err(|e| format!("Failed to fetch timeline: {e}"))?;
    let prev_batch = messages.end.clone();

    let own_user_id = client.user_id().map(|u| u.to_string()).unwrap_or_default();

    let mut events = aggregate_chunk(
        messages.chunk.into_iter().map(|e| e.raw().clone()),
        &own_user_id,
    );

    // Reverse so oldest messages come first
    events.reverse();
    Ok(TimelinePage { events, prev_batch })
}

/// Tier 2 — search the locally cached/persisted events for a room via the
/// matrix-sdk event cache. No network round-trip: it reads whatever sync (and
/// any cache-backed pagination) has already stored, decrypting in memory using
/// the on-disk keys. Returns matches oldest-first.
pub async fn search_room_cache(
    client: &Client,
    room_id: &str,
    query: &str,
    index: Option<&crate::search_index::SearchIndex>,
) -> Result<Vec<TimelineEvent>, String> {
    let q = query.to_lowercase();

    // Prefer the index: it holds everything ever scanned/synced for the room,
    // decrypted and ready to query — no event-cache deserialize pass. Use it
    // whenever it has anything for this room (or the room is fully indexed).
    if let Some(idx) = index {
        let hits = idx.search(room_id, &q, None, crate::search_index::EMIT_CAP)?;
        if !hits.is_empty() || idx.is_indexed_to_start(room_id).unwrap_or(false) {
            return Ok(hits.into_iter().map(index_msg_to_event).collect());
        }
        // Index empty for this room yet → fall through, and seed it below.
    }

    let room_id_parsed = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let room = client
        .get_room(&room_id_parsed)
        .ok_or_else(|| format!("Room {} not found", room_id_parsed))?;

    let (room_cache, _drop_handles) = room
        .event_cache()
        .await
        .map_err(|e| format!("Event cache unavailable: {e}"))?;
    let (events, _updates) = room_cache
        .subscribe()
        .await
        .map_err(|e| format!("Event cache read failed: {e}"))?;

    let mut out: Vec<TimelineEvent> = Vec::new();
    let mut to_index: Vec<crate::search_index::IndexedMessage> = Vec::new();
    for cached in events {
        if let Ok(any) = cached.raw().deserialize() {
            if let Some(te) = convert_sync_timeline_event(any) {
                if index.is_some() && te.msg_type != "m.room.encrypted" {
                    to_index.push(crate::search_index::IndexedMessage {
                        event_id: te.event_id.clone(),
                        sender: te.sender.clone(),
                        timestamp: te.timestamp,
                        body: te.body.clone(),
                        formatted_body: te.formatted_body.clone(),
                        msg_type: te.msg_type.clone(),
                    });
                }
                if event_matches(&te, &q) {
                    out.push(te);
                }
            }
        }
    }
    // Seed the index with what the cache held, so the next tier-2 search of this
    // room is served from the index without a deserialize pass.
    if let Some(idx) = index {
        if let Err(e) = idx.upsert(room_id, &to_index) {
            tracing::warn!("search index upsert (cache tier) failed: {e}");
        }
    }
    Ok(out)
}

/// Per-room event-cache footprint for the `:debug cache` viewer. `bytes` is an
/// estimate: the summed length of each cached event's raw JSON (the wire form
/// the SDK persists), not the exact on-disk SQLite cost, since the store is a
/// shared DB with no per-room byte accounting.
#[derive(serde::Serialize)]
pub struct RoomCacheDiagnostics {
    /// Number of events currently cached for this room.
    cached_events: usize,
    /// Estimated bytes: sum of each cached event's raw JSON length.
    estimated_bytes: u64,
    /// Oldest cached event timestamp (ms since epoch), if any.
    oldest_ts: Option<u64>,
    /// Newest cached event timestamp (ms since epoch), if any.
    newest_ts: Option<u64>,
}

/// Build a [`RoomCacheDiagnostics`] snapshot for a single room. Reads the same
/// cached events `search_room_cache` does and measures their footprint.
pub async fn room_cache_diagnostics(
    client: &Client,
    room_id: &str,
) -> Result<RoomCacheDiagnostics, String> {
    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {} not found", room_id))?;

    let (room_cache, _drop_handles) = room
        .event_cache()
        .await
        .map_err(|e| format!("Event cache unavailable: {e}"))?;
    let (events, _updates) = room_cache
        .subscribe()
        .await
        .map_err(|e| format!("Event cache read failed: {e}"))?;

    let cached_events = events.len();
    let mut estimated_bytes = 0u64;
    let mut oldest_ts: Option<u64> = None;
    let mut newest_ts: Option<u64> = None;
    for cached in events {
        estimated_bytes += cached.raw().json().get().len() as u64;
        if let Ok(any) = cached.raw().deserialize() {
            if let Some(te) = convert_sync_timeline_event(any) {
                oldest_ts = Some(oldest_ts.map_or(te.timestamp, |o| o.min(te.timestamp)));
                newest_ts = Some(newest_ts.map_or(te.timestamp, |n| n.max(te.timestamp)));
            }
        }
    }

    Ok(RoomCacheDiagnostics {
        cached_events,
        estimated_bytes,
        oldest_ts,
        newest_ts,
    })
}

/// Pure in-range decision for a date-bounded ("Back to date…") search, extracted
/// so it can be unit-tested. A hit is in range when no cutoff is set, or its
/// timestamp is at/after the cutoff. `>=` keeps the boundary inclusive, matching
/// the `oldest <= until` stop semantics in `search_should_break`.
fn hit_in_range(ts: u64, until_ts: Option<u64>) -> bool {
    until_ts.map_or(true, |until| ts >= until)
}

/// Pure stop decision for a search scan, extracted so it can be unit-tested
/// without a live client. Returns true when the scan should halt.
fn search_should_break(
    scanned: u64,
    cap: u64,
    oldest_ts: Option<u64>,
    until_ts: Option<u64>,
    reached_start: bool,
    canceled: bool,
) -> bool {
    if canceled || reached_start || scanned >= cap {
        return true;
    }
    // Date-range stop: we've paginated to an event older than the cutoff, so
    // the requested range is fully covered.
    if let (Some(until), Some(oldest)) = (until_ts, oldest_ts) {
        if oldest <= until {
            return true;
        }
    }
    false
}

/// Running minimum of two optional timestamps (`None` acts as "no value yet").
fn min_opt(a: Option<u64>, b: Option<u64>) -> Option<u64> {
    match (a, b) {
        (Some(x), Some(y)) => Some(x.min(y)),
        (Some(x), None) | (None, Some(x)) => Some(x),
        (None, None) => None,
    }
}

/// Rebuild a minimal search-result `TimelineEvent` from an index row. Only the
/// id/sender/timestamp/body fields are meaningful for a search result; the rest
/// default (results don't render media/reactions/replies, and clicking one
/// re-loads the full event by id).
fn index_msg_to_event(m: crate::search_index::IndexedMessage) -> TimelineEvent {
    TimelineEvent {
        event_id: m.event_id,
        sender: m.sender,
        body: m.body,
        formatted_body: m.formatted_body,
        timestamp: m.timestamp,
        msg_type: m.msg_type,
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
        reactions: Vec::new(),
    }
}

/// Tiers 3/4 — server-side streaming search, backed by the matrix-sdk event
/// cache. First scans the events already cached for the room (no network),
/// then drives `RoomPagination::run_backwards` to page older history. Crucially,
/// `run_backwards` *persists* each (decrypted) batch into the SQLite-backed
/// cache, so: tier-2 (`search_room_cache`) becomes meaningful, re-running the
/// same search is fast and returns consistent results (no E2EE decryption
/// race), and only one batch plus transient hits live in memory at a time.
///
/// Matches are emitted incrementally via `EVENT_SEARCH_HIT` (+ periodic
/// `EVENT_SEARCH_PROGRESS`). Stops at the start of history, when an event
/// crosses `until_ts` (date-range scan), when `max_events` is exhausted, or
/// when `cancel` is set.
pub async fn search_messages(
    client: &Client,
    app_handle: &tauri::AppHandle,
    room_id: &str,
    query: &str,
    until_ts: Option<u64>,
    max_events: Option<u32>,
    cancel: &std::sync::atomic::AtomicBool,
    index: Option<&crate::search_index::SearchIndex>,
) -> Result<SearchSummary, String> {
    use matrix_sdk::event_cache::{BackPaginationOutcome, TimelineHasBeenResetWhilePaginating};
    use std::future::ready;
    use std::ops::ControlFlow;
    use std::sync::atomic::Ordering;
    use tauri::Emitter;

    /// Per-batch matcher shared by the cache pre-scan and back-pagination:
    /// counts events, emits hits, tracks the oldest timestamp seen, and upserts
    /// every (non-encrypted) event into the search index so a later search of
    /// this room can skip pagination entirely. Takes raw events so it's agnostic
    /// to the SDK's event-wrapper type (the cache subscribe and back-pagination
    /// return different wrappers, both of which expose `.raw()`).
    fn scan_batch(
        raws: impl IntoIterator<Item = Raw<AnySyncTimelineEvent>>,
        q: &str,
        until_ts: Option<u64>,
        room_id: &str,
        app_handle: &tauri::AppHandle,
        index: Option<&crate::search_index::SearchIndex>,
        scanned: &mut u64,
        matched: &mut u64,
    ) -> Option<u64> {
        let mut oldest_ts: Option<u64> = None;
        let mut to_index: Vec<crate::search_index::IndexedMessage> = Vec::new();
        for raw in raws {
            *scanned += 1;
            if let Ok(any) = raw.deserialize() {
                if let Some(te) = convert_sync_timeline_event(any) {
                    // Track the oldest *scanned* timestamp over every event so the
                    // date stop condition can fire; only the emit below is filtered.
                    oldest_ts = Some(oldest_ts.map_or(te.timestamp, |o| o.min(te.timestamp)));
                    // Feed the index (skip undecryptable events — their placeholder
                    // body would pollute matches and go stale once decrypted).
                    if index.is_some() && te.msg_type != "m.room.encrypted" {
                        to_index.push(crate::search_index::IndexedMessage {
                            event_id: te.event_id.clone(),
                            sender: te.sender.clone(),
                            timestamp: te.timestamp,
                            body: te.body.clone(),
                            formatted_body: te.formatted_body.clone(),
                            msg_type: te.msg_type.clone(),
                        });
                    }
                    if event_matches(&te, q) && hit_in_range(te.timestamp, until_ts) {
                        *matched += 1;
                        let _ = app_handle.emit(
                            crate::events::EVENT_SEARCH_HIT,
                            crate::events::SearchHit {
                                room_id: room_id.to_string(),
                                event: te,
                            },
                        );
                    }
                }
            }
        }
        if let Some(idx) = index {
            if let Err(e) = idx.upsert(room_id, &to_index) {
                tracing::warn!("search index upsert failed: {e}");
            }
        }
        oldest_ts
    }

    const BATCH_SIZE: u16 = 500;
    let cap = max_events.map(|m| m as u64).unwrap_or(u64::MAX);
    let q = query.to_lowercase();

    let room_id_parsed = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;

    // Fast path: a fully-indexed room is served entirely from the encrypted
    // index — no event-cache read, no pagination, no network. This is what makes
    // repeat and post-restart searches instant *and* complete (it doesn't depend
    // on what the SDK happens to keep in memory).
    if let Some(idx) = index {
        if idx.is_indexed_to_start(room_id).unwrap_or(false) {
            let hits = idx.search(room_id, &q, until_ts, crate::search_index::EMIT_CAP)?;
            let matched = idx.count(room_id, &q, until_ts)?;
            let total = idx.room_total(room_id)?.unwrap_or(0);
            for m in hits {
                let _ = app_handle.emit(
                    crate::events::EVENT_SEARCH_HIT,
                    crate::events::SearchHit { room_id: room_id.to_string(), event: index_msg_to_event(m) },
                );
            }
            let _ = app_handle.emit(
                crate::events::EVENT_SEARCH_PROGRESS,
                crate::events::SearchProgress { scanned: total, oldest_ts: None },
            );
            return Ok(SearchSummary {
                scanned: total,
                matched,
                reached_start: true,
                canceled: cancel.load(Ordering::Relaxed),
            });
        }
    }

    let room = client
        .get_room(&room_id_parsed)
        .ok_or_else(|| format!("Room {} not found", room_id_parsed))?;
    let (room_cache, _drop_handles) = room
        .event_cache()
        .await
        .map_err(|e| format!("Event cache unavailable: {e}"))?;

    let mut scanned: u64 = 0;
    let mut matched: u64 = 0;
    let mut reached_start = false;
    let mut canceled = cancel.load(Ordering::Relaxed);

    // 1. Scan events already cached for this room (no network). run_backwards
    //    below extends the chunk *older* than these, so there's no overlap.
    let (cached, _updates) = room_cache
        .subscribe()
        .await
        .map_err(|e| format!("Event cache read failed: {e}"))?;
    // `oldest` is the running minimum timestamp scanned across *all* batches, so
    // the emitted progress (and the date stop decision) can never jump backward
    // if a batch arrives slightly out of order.
    let mut oldest = scan_batch(
        cached.into_iter().map(|e| e.raw().clone()),
        &q,
        until_ts,
        room_id,
        app_handle,
        index,
        &mut scanned,
        &mut matched,
    );
    let _ = app_handle.emit(
        crate::events::EVENT_SEARCH_PROGRESS,
        crate::events::SearchProgress { scanned, oldest_ts: oldest },
    );

    // NOTE: this fallback (room not yet fully indexed) intentionally does NOT
    // short-circuit run_backwards on `pagination().hit_timeline_start()`. The
    // event cache's `subscribe()` above only returns events held *in memory* (a
    // window), so skipping pagination here would miss older on-disk events and
    // leave the index incomplete. We re-walk history — wasteful, but it builds a
    // complete index, after which the fast path above serves future searches.

    // 2. Page older history through the cache (persisting as it goes), unless
    //    the cached range already satisfies the stop condition.
    if !search_should_break(scanned, cap, oldest, until_ts, reached_start, canceled) {
        let outcome = room_cache
            .pagination()
            .run_backwards(
                BATCH_SIZE,
                |outcome: BackPaginationOutcome, _reset: TimelineHasBeenResetWhilePaginating| {
                    if cancel.load(Ordering::Relaxed) {
                        canceled = true;
                        return ready(ControlFlow::Break(()));
                    }
                    let batch_oldest = scan_batch(
                        outcome.events.into_iter().map(|e| e.raw().clone()),
                        &q,
                        until_ts,
                        room_id,
                        app_handle,
                        index,
                        &mut scanned,
                        &mut matched,
                    );
                    oldest = min_opt(oldest, batch_oldest);
                    let _ = app_handle.emit(
                        crate::events::EVENT_SEARCH_PROGRESS,
                        crate::events::SearchProgress { scanned, oldest_ts: oldest },
                    );
                    if outcome.reached_start {
                        reached_start = true;
                    }
                    if search_should_break(scanned, cap, oldest, until_ts, reached_start, canceled) {
                        ready(ControlFlow::Break(()))
                    } else {
                        ready(ControlFlow::Continue(()))
                    }
                },
            )
            .await;
        // Recover silently: if the shared paginator was busy (or any pagination
        // error), keep whatever we matched from the cache pre-scan / earlier
        // batches rather than surfacing an error. Emit a final progress tick.
        if let Err(e) = outcome {
            tracing::warn!("search back-pagination stopped early: {e}");
            let _ = app_handle.emit(
                crate::events::EVENT_SEARCH_PROGRESS,
                crate::events::SearchProgress { scanned, oldest_ts: oldest },
            );
        }
    }

    // A full scan that reached the start of history has now indexed the whole
    // room: record it (with the total event count) so the fast path above serves
    // every future search of this room from the index. Best-effort — a write
    // failure must not fail the search. Skip date-bounded scans: they stop at the
    // cutoff, so `reached_start` there means "reached the cutoff", not the room
    // start, and the room isn't fully indexed.
    if reached_start && !canceled && until_ts.is_none() {
        if let Some(idx) = index {
            if let Err(e) = idx.set_indexed_to_start(room_id, scanned) {
                tracing::warn!("failed to mark room fully indexed: {e}");
            }
        }
    }

    Ok(SearchSummary {
        scanned,
        matched,
        reached_start,
        canceled,
    })
}

/// Fetch newer events from a forward-pagination token.
/// `after` should be a `next_batch` token from a prior `get_event_context` or
/// `paginate_forward` response. Returns events strictly newer than the token.
/// When the returned `next_batch` is `None`, the live tail has been reached.
pub async fn paginate_forward(
    client: &Client,
    room_id: &str,
    after: String,
    limit: usize,
) -> Result<TimelineForwardPage, String> {
    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;

    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {} not found", room_id))?;

    let mut opts = MessagesOptions::forward();
    opts.limit = UInt::try_from(limit as u64).unwrap_or(UInt::from(50u32));
    opts.from = Some(after);

    let messages = room
        .messages(opts)
        .await
        .map_err(|e| format!("Failed to paginate forward: {e}"))?;
    let next_batch = messages.end.clone();

    let own_user_id = client.user_id().map(|u| u.to_string()).unwrap_or_default();

    // Forward fetch returns events oldest-first already.
    let events = aggregate_chunk(
        messages.chunk.into_iter().map(|e| e.raw().clone()),
        &own_user_id,
    );

    Ok(TimelineForwardPage { events, next_batch })
}

/// Convert a single raw timeline event into a `TimelineEvent` if it's a
/// message-like event worth previewing (m.room.message / m.sticker /
/// undecryptable m.room.encrypted). Used by `get_home_data`'s cold-launch
/// fallback to find a room's latest message without the full aggregate pass.
pub(crate) fn convert_raw_message_like(
    raw: &Raw<AnySyncTimelineEvent>,
) -> Option<TimelineEvent> {
    match raw.deserialize().ok()? {
        AnySyncTimelineEvent::MessageLike(AnySyncMessageLikeEvent::RoomMessage(
            SyncMessageLikeEvent::Original(ev),
        )) => Some(convert_sync_room_message(ev)),
        AnySyncTimelineEvent::MessageLike(AnySyncMessageLikeEvent::Sticker(
            SyncMessageLikeEvent::Original(ev),
        )) => Some(convert_sync_sticker(ev)),
        AnySyncTimelineEvent::MessageLike(AnySyncMessageLikeEvent::RoomEncrypted(
            SyncMessageLikeEvent::Original(ev),
        )) => Some(convert_sync_encrypted(ev)),
        _ => None,
    }
}

/// Convert a batch of raw timeline events into displayable `TimelineEvent`s,
/// aggregating any reaction events found in the batch onto their target
/// messages. Input order is preserved (callers reverse if they need
/// oldest-first). Takes raw events so it works with any SDK event wrapper
/// (`room.messages()` chunks and event-cache chunks expose different types,
/// both with `.raw()`).
fn aggregate_chunk(
    raws: impl IntoIterator<Item = Raw<AnySyncTimelineEvent>>,
    own_user_id: &str,
) -> Vec<TimelineEvent> {
    let mut events: Vec<TimelineEvent> = Vec::new();
    // target_event_id -> Vec<(key, sender_id, reaction_event_id)>
    let mut reaction_raw: HashMap<String, Vec<(String, String, String)>> = HashMap::new();

    for raw in raws {
        if let Ok(deserialized) = raw.deserialize() {
            match deserialized {
                AnySyncTimelineEvent::MessageLike(
                    AnySyncMessageLikeEvent::RoomMessage(SyncMessageLikeEvent::Original(ev)),
                ) => {
                    events.push(convert_sync_room_message(ev));
                }
                AnySyncTimelineEvent::MessageLike(
                    AnySyncMessageLikeEvent::Sticker(SyncMessageLikeEvent::Original(ev)),
                ) => {
                    events.push(convert_sync_sticker(ev));
                }
                AnySyncTimelineEvent::MessageLike(
                    AnySyncMessageLikeEvent::Reaction(SyncMessageLikeEvent::Original(ev)),
                ) => {
                    let target = ev.content.relates_to.event_id.to_string();
                    let key = ev.content.relates_to.key.clone();
                    let sender = ev.sender.to_string();
                    let rev_id = ev.event_id.to_string();
                    reaction_raw.entry(target).or_default().push((key, sender, rev_id));
                }
                AnySyncTimelineEvent::MessageLike(
                    AnySyncMessageLikeEvent::RoomEncrypted(SyncMessageLikeEvent::Original(ev)),
                ) => {
                    events.push(convert_sync_encrypted(ev));
                }
                _ => {}
            }
        }
    }

    // Aggregate and attach reactions to their target messages.
    for ev in &mut events {
        if let Some(rxns) = reaction_raw.get(&ev.event_id) {
            let mut agg: HashMap<String, (u64, Vec<String>, bool, Option<String>)> = HashMap::new();
            for (key, sender, rev_id) in rxns {
                let e = agg.entry(key.clone()).or_insert((0, Vec::new(), false, None));
                e.0 += 1;
                e.1.push(sender.clone());
                if sender == own_user_id {
                    e.2 = true;
                    e.3 = Some(rev_id.clone());
                }
            }
            ev.reactions = agg
                .into_iter()
                .map(|(key, (count, senders, own_reaction, own_event_id))| ReactionGroup {
                    key,
                    count,
                    senders,
                    own_reaction,
                    own_event_id,
                })
                .collect();
        }
    }

    events
}

fn convert_sync_timeline_event(event: AnySyncTimelineEvent) -> Option<TimelineEvent> {
    match event {
        AnySyncTimelineEvent::MessageLike(msg_event) => convert_sync_message_event(msg_event),
        _ => None,
    }
}

fn convert_sync_message_event(event: AnySyncMessageLikeEvent) -> Option<TimelineEvent> {
    match event {
        AnySyncMessageLikeEvent::RoomMessage(SyncMessageLikeEvent::Original(ev)) => {
            Some(convert_sync_room_message(ev))
        }
        AnySyncMessageLikeEvent::Sticker(SyncMessageLikeEvent::Original(ev)) => {
            Some(convert_sync_sticker(ev))
        }
        AnySyncMessageLikeEvent::RoomEncrypted(SyncMessageLikeEvent::Original(ev)) => {
            Some(convert_sync_encrypted(ev))
        }
        _ => None,
    }
}

pub fn convert_sync_sticker_event(ev: matrix_sdk::ruma::events::OriginalSyncMessageLikeEvent<StickerEventContent>) -> TimelineEvent {
    convert_sync_sticker(ev)
}

fn convert_sync_sticker(ev: matrix_sdk::ruma::events::OriginalSyncMessageLikeEvent<StickerEventContent>) -> TimelineEvent {
    use matrix_sdk::ruma::events::sticker::StickerMediaSource;
    let timestamp: u64 = ev.origin_server_ts.get().into();
    let sender = ev.sender.to_string();
    let event_id = ev.event_id.to_string();
    let (url, enc) = match &ev.content.source {
        StickerMediaSource::Plain(uri) => (Some(uri.to_string()), None),
        StickerMediaSource::Encrypted(file) => (Some(file.url.to_string()), serde_json::to_string(file.as_ref()).ok()),
        _ => (None, None),
    };
    let mime = ev.content.info.mimetype.clone();
    let w: Option<u64> = ev.content.info.width.map(|v| v.into());
    let h: Option<u64> = ev.content.info.height.map(|v| v.into());
    TimelineEvent {
        event_id,
        sender,
        body: ev.content.body.clone(),
        formatted_body: None,
        timestamp,
        msg_type: "m.sticker".to_string(),
        is_edit: false,
        relates_to_event_id: None,
        in_reply_to: None,
        thread_root: None,
        media_url: url,
        media_mimetype: mime,
        media_width: w,
        media_height: h,
        caption: None,
        media_encryption_info: enc,
        media_thumbnail_url: None,
        media_thumbnail_encryption_info: None,
        reactions: vec![],
    }
}

fn convert_sync_encrypted(
    ev: matrix_sdk::ruma::events::OriginalSyncMessageLikeEvent<
        matrix_sdk::ruma::events::room::encrypted::RoomEncryptedEventContent,
    >,
) -> TimelineEvent {
    let timestamp: u64 = ev.origin_server_ts.get().into();
    TimelineEvent {
        event_id: ev.event_id.to_string(),
        sender: ev.sender.to_string(),
        body: "\u{1f512} unable to decrypt".to_string(),
        formatted_body: None,
        timestamp,
        msg_type: "m.room.encrypted".to_string(),
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

fn convert_sync_room_message(ev: OriginalSyncRoomMessageEvent) -> TimelineEvent {
    let timestamp = ev.origin_server_ts.get().into();
    let sender = ev.sender.to_string();
    let event_id = ev.event_id.to_string();

    // For replacement (edit) events use m.new_content so the actual updated body
    // is used rather than the "* fallback" stored in the top-level msgtype.
    let effective_content: std::borrow::Cow<RoomMessageEventContent> =
        if let Some(Relation::Replacement(r)) = &ev.content.relates_to {
            let mut c = ev.content.clone();
            c.msgtype = r.new_content.msgtype.clone();
            std::borrow::Cow::Owned(c)
        } else {
            std::borrow::Cow::Borrowed(&ev.content)
        };

    let (body, formatted_body, msg_type, media_url, media_mimetype, media_width, media_height, media_encryption_info, media_thumbnail_url, media_thumbnail_encryption_info) =
        extract_message_content(&effective_content);

    let (is_edit, relates_to_event_id, in_reply_to, thread_root) =
        extract_relations(&ev.content);

    // Media captions (MSC2530): only present when the message carries a distinct
    // filename, so a bare-filename body is not surfaced as a caption.
    let caption = match &effective_content.msgtype {
        MessageType::Image(image) => image.caption().map(|c| c.to_owned()),
        _ => None,
    };

    TimelineEvent {
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
        media_thumbnail_url,
        media_thumbnail_encryption_info,
        reactions: vec![],
    }
}

fn extract_message_content(
    content: &RoomMessageEventContent,
) -> (
    String,
    Option<String>,
    String,
    Option<String>,
    Option<String>,
    Option<u64>,
    Option<u64>,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    use matrix_sdk::ruma::events::room::MediaSource;

    fn enc_info(source: &MediaSource) -> Option<String> {
        if let MediaSource::Encrypted(file) = source {
            serde_json::to_string(file.as_ref()).ok()
        } else {
            None
        }
    }

    match &content.msgtype {
        MessageType::Text(text) => (
            text.body.clone(),
            text.formatted.as_ref().map(|f| crate::matrix::html::sanitize(&f.body)),
            "m.text".to_string(),
            None, None, None, None, None, None, None,
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
            (image.body.clone(), None, "m.image".to_string(), url, mime, w, h, enc, None, None)
        }
        MessageType::Video(video) => {
            let url = match &video.source {
                MediaSource::Plain(uri) => Some(uri.to_string()),
                MediaSource::Encrypted(file) => Some(file.url.to_string()),
            };
            let enc = enc_info(&video.source);
            let (w, h, mime, thumb_url, thumb_enc) = if let Some(info) = &video.info {
                let thumb_url = info.thumbnail_source.as_ref().map(|src| match src {
                    MediaSource::Plain(uri) => uri.to_string(),
                    MediaSource::Encrypted(file) => file.url.to_string(),
                });
                let thumb_enc = info.thumbnail_source.as_ref().and_then(|src| {
                    if let MediaSource::Encrypted(file) = src {
                        serde_json::to_string(file.as_ref()).ok()
                    } else {
                        None
                    }
                });
                (
                    info.width.map(|v| v.into()),
                    info.height.map(|v| v.into()),
                    info.mimetype.clone(),
                    thumb_url,
                    thumb_enc,
                )
            } else {
                (None, None, None, None, None)
            };
            (video.body.clone(), None, "m.video".to_string(), url, mime, w, h, enc, thumb_url, thumb_enc)
        }
        MessageType::Audio(audio) => {
            let url = match &audio.source {
                MediaSource::Plain(uri) => Some(uri.to_string()),
                MediaSource::Encrypted(file) => Some(file.url.to_string()),
            };
            let enc = enc_info(&audio.source);
            (audio.body.clone(), None, "m.audio".to_string(), url, None, None, None, enc, None, None)
        }
        MessageType::File(file_msg) => {
            let url = match &file_msg.source {
                MediaSource::Plain(uri) => Some(uri.to_string()),
                MediaSource::Encrypted(f) => Some(f.url.to_string()),
            };
            let enc = enc_info(&file_msg.source);
            (file_msg.body.clone(), None, "m.file".to_string(), url, None, None, None, enc, None, None)
        }
        MessageType::Emote(emote) => (
            emote.body.clone(),
            emote.formatted.as_ref().map(|f| crate::matrix::html::sanitize(&f.body)),
            "m.emote".to_string(),
            None, None, None, None, None, None, None,
        ),
        MessageType::Notice(notice) => (
            notice.body.clone(),
            notice.formatted.as_ref().map(|f| crate::matrix::html::sanitize(&f.body)),
            "m.notice".to_string(),
            None, None, None, None, None, None, None,
        ),
        _ => (
            "[unsupported message type]".to_string(),
            None,
            "m.unknown".to_string(),
            None, None, None, None, None, None, None,
        ),
    }
}

fn extract_relations(
    content: &RoomMessageEventContent,
) -> (bool, Option<String>, Option<String>, Option<String>) {
    let mut is_edit = false;
    let mut relates_to_event_id = None;
    let mut in_reply_to = None;
    let mut thread_root = None;

    if let Some(relation) = &content.relates_to {
        match relation {
            Relation::Replacement(replacement) => {
                is_edit = true;
                relates_to_event_id = Some(replacement.event_id.to_string());
            }
            Relation::Reply { in_reply_to: r } => {
                in_reply_to = Some(r.event_id.to_string());
            }
            Relation::Thread(thread) => {
                thread_root = Some(thread.event_id.to_string());
                if let Some(r) = &thread.in_reply_to {
                    in_reply_to = Some(r.event_id.to_string());
                }
            }
            _ => {}
        }
    }

    (is_edit, relates_to_event_id, in_reply_to, thread_root)
}

/// Send a plain text message to a room, optionally as a reply.
pub async fn send_message(
    client: &Client,
    room_id: &str,
    body: &str,
    formatted_body: Option<&str>,
    in_reply_to: Option<&str>,
) -> Result<String, String> {
    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;

    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {} not found", room_id))?;

    let mut content = if let Some(formatted) = formatted_body {
        RoomMessageEventContent::text_html(body, formatted)
    } else {
        RoomMessageEventContent::text_plain(body)
    };

    if let Some(reply_event_id) = in_reply_to {
        let owned_id = OwnedEventId::try_from(reply_event_id)
            .map_err(|e| format!("Invalid reply event ID: {e}"))?;
        content.relates_to = Some(Relation::Reply {
            in_reply_to: InReplyTo::new(owned_id),
        });
    }

    let response = room
        .send(content)
        .await
        .map_err(|e| format!("Failed to send message: {e}"))?;

    let event_id = response.event_id.to_string();
    info!(event_id = %event_id, "Message sent");
    Ok(event_id)
}

/// Edit an existing message.
pub async fn edit_message(
    client: &Client,
    room_id: &str,
    event_id: &str,
    new_body: &str,
    new_formatted_body: Option<&str>,
) -> Result<String, String> {
    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let event_id = EventId::parse(event_id).map_err(|e| format!("Invalid event ID: {e}"))?;

    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {} not found", room_id))?;

    let new_content = if let Some(formatted) = new_formatted_body {
        RoomMessageEventContent::text_html(new_body, formatted)
    } else {
        RoomMessageEventContent::text_plain(new_body)
    };

    use matrix_sdk::ruma::events::room::message::ReplacementMetadata;
    let metadata = ReplacementMetadata::new(event_id.clone(), None);
    let edit_content =
        RoomMessageEventContent::new(MessageType::Text(TextMessageEventContent::plain(
            format!("* {}", new_body),
        )))
        .make_replacement(metadata, None);

    let response = room
        .send(edit_content)
        .await
        .map_err(|e| format!("Failed to edit message: {e}"))?;

    let response_event_id = response.event_id.to_string();
    info!(original = %event_id, edit_event = %response_event_id, "Message edited");
    Ok(response_event_id)
}

/// MSC2530 body mapping for outgoing images: with a caption, the event body is
/// the caption and `filename` carries the real name; without one, the body is
/// the filename and the field is omitted — matching the pre-caption wire format,
/// which ruma's `caption()` reader treats as captionless.
fn build_image_body(filename: &str, caption: Option<&str>) -> (String, Option<String>) {
    match caption.map(str::trim).filter(|c| !c.is_empty()) {
        Some(c) => (c.to_string(), Some(filename.to_string())),
        None => (filename.to_string(), None),
    }
}

/// Send an image (m.image) event to a room, with an optional MSC2530 caption,
/// optionally as a reply.
pub async fn send_image(
    client: &Client,
    room_id: &str,
    filename: &str,
    caption: Option<&str>,
    mxc_url: &str,
    mime_type: &str,
    width: Option<u64>,
    height: Option<u64>,
    in_reply_to: Option<&str>,
) -> Result<String, String> {
    use matrix_sdk::ruma::{
        events::room::{
            message::ImageMessageEventContent,
            ImageInfo, MediaSource,
        },
        MxcUri,
    };

    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {} not found", room_id))?;

    let mxc_uri = <&MxcUri>::try_from(mxc_url).map_err(|e| format!("Invalid mxc URI: {e}"))?;
    let source = MediaSource::Plain(mxc_uri.to_owned());

    let mut img_info = ImageInfo::default();
    img_info.mimetype = Some(mime_type.to_string());
    img_info.width = width.and_then(|w| UInt::try_from(w).ok());
    img_info.height = height.and_then(|h| UInt::try_from(h).ok());

    let (body, filename_field) = build_image_body(filename, caption);
    let mut img_content = ImageMessageEventContent::new(body, source);
    img_content.info = Some(Box::new(img_info));
    img_content.filename = filename_field;

    let mut msg_content = RoomMessageEventContent::new(MessageType::Image(img_content));

    if let Some(reply_event_id) = in_reply_to {
        let owned_id = OwnedEventId::try_from(reply_event_id)
            .map_err(|e| format!("Invalid reply event ID: {e}"))?;
        msg_content.relates_to = Some(Relation::Reply {
            in_reply_to: InReplyTo::new(owned_id),
        });
    }

    let response = room
        .send(msg_content)
        .await
        .map_err(|e| format!("Failed to send image: {e}"))?;

    let event_id = response.event_id.to_string();
    info!(event_id = %event_id, "Image sent");
    Ok(event_id)
}

/// Send a generic file (m.file) event to a room.
pub async fn send_file(
    client: &Client,
    room_id: &str,
    body: &str,
    mxc_url: &str,
    mime_type: &str,
    file_size: Option<u64>,
) -> Result<String, String> {
    use matrix_sdk::ruma::{
        events::room::{
            message::{FileMessageEventContent, FileInfo},
            MediaSource,
        },
        MxcUri,
    };

    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {} not found", room_id))?;

    let mxc_uri = <&MxcUri>::try_from(mxc_url).map_err(|e| format!("Invalid mxc URI: {e}"))?;
    let source = MediaSource::Plain(mxc_uri.to_owned());

    let mut file_info = FileInfo::default();
    file_info.mimetype = Some(mime_type.to_string());
    file_info.size = file_size.and_then(|s| UInt::try_from(s).ok());

    let mut file_content = FileMessageEventContent::new(body.to_string(), source);
    file_content.info = Some(Box::new(file_info));

    let msg_content = RoomMessageEventContent::new(MessageType::File(file_content));

    let response = room
        .send(msg_content)
        .await
        .map_err(|e| format!("Failed to send file: {e}"))?;

    let event_id = response.event_id.to_string();
    info!(event_id = %event_id, "File sent");
    Ok(event_id)
}

/// Send a video (m.video) event to a room.
pub async fn send_video(
    client: &Client,
    room_id: &str,
    body: &str,
    mxc_url: &str,
    mime_type: &str,
    width: Option<u64>,
    height: Option<u64>,
    duration_ms: Option<u64>,
    file_size: Option<u64>,
) -> Result<String, String> {
    use matrix_sdk::ruma::{
        events::room::{
            message::{VideoMessageEventContent, VideoInfo},
            MediaSource,
        },
        MxcUri,
    };
    use std::time::Duration;

    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {} not found", room_id))?;

    let mxc_uri = <&MxcUri>::try_from(mxc_url).map_err(|e| format!("Invalid mxc URI: {e}"))?;
    let source = MediaSource::Plain(mxc_uri.to_owned());

    let mut video_info = VideoInfo::default();
    video_info.mimetype = Some(mime_type.to_string());
    video_info.width = width.and_then(|w| UInt::try_from(w).ok());
    video_info.height = height.and_then(|h| UInt::try_from(h).ok());
    video_info.size = file_size.and_then(|s| UInt::try_from(s).ok());
    video_info.duration = duration_ms.map(Duration::from_millis);

    let mut video_content = VideoMessageEventContent::new(body.to_string(), source);
    video_content.info = Some(Box::new(video_info));

    let msg_content = RoomMessageEventContent::new(MessageType::Video(video_content));

    let response = room
        .send(msg_content)
        .await
        .map_err(|e| format!("Failed to send video: {e}"))?;

    let event_id = response.event_id.to_string();
    info!(event_id = %event_id, "Video sent");
    Ok(event_id)
}

/// Fetch events surrounding a specific event using the Matrix /context endpoint.
/// Returns a window of messages centered on the target event, ordered oldest-first.
pub async fn get_event_context(
    client: &Client,
    room_id: &str,
    event_id: &str,
    context_size: usize,
) -> Result<EventContextPage, String> {
    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let event_id = <&matrix_sdk::ruma::EventId>::try_from(event_id)
        .map_err(|e| format!("Invalid event ID: {e}"))?;

    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {} not found", room_id))?;

    let size = UInt::try_from(context_size as u64).unwrap_or(UInt::from(25u32));
    let response = room
        .event_with_context(event_id, false, size, None)
        .await
        .map_err(|e| format!("Failed to fetch event context: {e}"))?;

    let mut events: Vec<TimelineEvent> = Vec::new();

    // events_before is reverse-chronological (newest first), so reverse it
    for ev in response.events_before.into_iter().rev() {
        if let Ok(deserialized) = ev.raw().deserialize() {
            if let Some(te) = convert_sync_timeline_event(deserialized) {
                events.push(te);
            }
        }
    }

    // Target event
    if let Some(target) = response.event {
        if let Ok(deserialized) = target.raw().deserialize() {
            if let Some(te) = convert_sync_timeline_event(deserialized) {
                events.push(te);
            }
        }
    }

    // events_after is already chronological
    for ev in response.events_after {
        if let Ok(deserialized) = ev.raw().deserialize() {
            if let Some(te) = convert_sync_timeline_event(deserialized) {
                events.push(te);
            }
        }
    }

    Ok(EventContextPage {
        events,
        target_event_id: event_id.to_string(),
        prev_batch: response.prev_batch_token,
        next_batch: response.next_batch_token,
    })
}

/// Fetch all edit-revision events (m.replace relations) for a given event.
/// Returns them sorted oldest-first.
pub async fn get_message_revisions(
    client: &Client,
    room_id: &str,
    event_id: &str,
) -> Result<Vec<TimelineEvent>, String> {
    use matrix_sdk::ruma::api::client::relations::get_relating_events_with_rel_type::v1::Request;

    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let event_id = EventId::parse(event_id).map_err(|e| format!("Invalid event ID: {e}"))?;

    let request = Request::new(room_id.into(), event_id.into(), RelationType::Replacement);
    let response = client
        .send(request, None)
        .await
        .map_err(|e| format!("Failed to fetch revisions: {e}"))?;

    let mut revisions: Vec<TimelineEvent> = Vec::new();
    for raw_ev in response.chunk {
        if let Ok(deserialized) = raw_ev.deserialize_as::<AnySyncTimelineEvent>() {
            if let Some(te) = convert_sync_timeline_event(deserialized) {
                revisions.push(te);
            }
        }
    }

    revisions.sort_by_key(|e| e.timestamp);
    Ok(revisions)
}

/// Redact (delete) a message.
pub async fn redact_message(
    client: &Client,
    room_id: &str,
    event_id: &str,
    reason: Option<&str>,
) -> Result<String, String> {
    let room_id = RoomId::parse(room_id).map_err(|e| format!("Invalid room ID: {e}"))?;
    let event_id = EventId::parse(event_id).map_err(|e| format!("Invalid event ID: {e}"))?;

    let room = client
        .get_room(&room_id)
        .ok_or_else(|| format!("Room {} not found", room_id))?;

    let txn_id = TransactionId::new();
    let response = room
        .redact(&event_id, reason, Some(txn_id))
        .await
        .map_err(|e| format!("Failed to redact message: {e}"))?;

    let redact_event_id = response.event_id.to_string();
    info!(original = %event_id, redaction = %redact_event_id, "Message redacted");
    Ok(redact_event_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json;

    fn make_text_event(event_id: &str, sender: &str, body: &str) -> TimelineEvent {
        TimelineEvent {
            event_id: event_id.to_string(),
            sender: sender.to_string(),
            body: body.to_string(),
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

    // --- TimelineEvent serialization ---

    #[test]
    fn test_timeline_event_text_roundtrip() {
        let ev = make_text_event("$ev1:example.com", "@alice:example.com", "Hello, world!");
        let json = serde_json::to_string(&ev).expect("serialize");
        let back: TimelineEvent = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.event_id, "$ev1:example.com");
        assert_eq!(back.sender, "@alice:example.com");
        assert_eq!(back.body, "Hello, world!");
        assert_eq!(back.msg_type, "m.text");
        assert_eq!(back.timestamp, 1_700_000_000_000);
        assert!(!back.is_edit);
        assert!(back.formatted_body.is_none());
        assert!(back.media_url.is_none());
    }

    #[test]
    fn test_timeline_event_with_formatted_body() {
        let ev = TimelineEvent {
            formatted_body: Some("<b>Hello</b>".to_string()),
            ..make_text_event("$ev2:example.com", "@bob:example.com", "Hello")
        };
        let json = serde_json::to_string(&ev).expect("serialize");
        let back: TimelineEvent = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.formatted_body.as_deref(), Some("<b>Hello</b>"));
    }

    #[test]
    fn test_timeline_event_image_message() {
        let ev = TimelineEvent {
            msg_type: "m.image".to_string(),
            body: "photo.png".to_string(),
            media_url: Some("mxc://example.com/photo".to_string()),
            media_mimetype: Some("image/png".to_string()),
            media_width: Some(1920),
            media_height: Some(1080),
            ..make_text_event("$ev3:example.com", "@alice:example.com", "photo.png")
        };
        let json = serde_json::to_string(&ev).expect("serialize");
        let back: TimelineEvent = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.msg_type, "m.image");
        assert_eq!(back.media_url.as_deref(), Some("mxc://example.com/photo"));
        assert_eq!(back.media_mimetype.as_deref(), Some("image/png"));
        assert_eq!(back.media_width, Some(1920));
        assert_eq!(back.media_height, Some(1080));
    }

    #[test]
    fn test_timeline_event_edit_flag() {
        let ev = TimelineEvent {
            is_edit: true,
            relates_to_event_id: Some("$original:example.com".to_string()),
            ..make_text_event("$edit:example.com", "@alice:example.com", "* edited")
        };
        let json = serde_json::to_string(&ev).expect("serialize");
        let back: TimelineEvent = serde_json::from_str(&json).expect("deserialize");
        assert!(back.is_edit);
        assert_eq!(back.relates_to_event_id.as_deref(), Some("$original:example.com"));
    }

    #[test]
    fn test_timeline_event_reply() {
        let ev = TimelineEvent {
            in_reply_to: Some("$parent:example.com".to_string()),
            ..make_text_event("$reply:example.com", "@bob:example.com", "Me too!")
        };
        let json = serde_json::to_string(&ev).expect("serialize");
        let back: TimelineEvent = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.in_reply_to.as_deref(), Some("$parent:example.com"));
        assert!(back.thread_root.is_none());
    }

    #[test]
    fn test_timeline_event_thread() {
        let ev = TimelineEvent {
            thread_root: Some("$thread:example.com".to_string()),
            in_reply_to: Some("$prev:example.com".to_string()),
            ..make_text_event("$threaded:example.com", "@carol:example.com", "Thread reply")
        };
        let json = serde_json::to_string(&ev).expect("serialize");
        let back: TimelineEvent = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.thread_root.as_deref(), Some("$thread:example.com"));
        assert_eq!(back.in_reply_to.as_deref(), Some("$prev:example.com"));
    }

    #[test]
    fn test_timeline_event_json_has_expected_keys() {
        let ev = make_text_event("$ev:example.com", "@alice:example.com", "hi");
        let json = serde_json::to_string(&ev).expect("serialize");
        let val: serde_json::Value = serde_json::from_str(&json).expect("parse json");
        for key in &[
            "event_id", "sender", "body", "formatted_body", "timestamp",
            "msg_type", "is_edit", "relates_to_event_id", "in_reply_to",
            "thread_root", "media_url", "media_mimetype", "media_width", "media_height",
        ] {
            assert!(val.get(key).is_some(), "Missing key: {}", key);
        }
    }

    #[test]
    fn test_timeline_event_zero_timestamp() {
        let ev = TimelineEvent {
            timestamp: 0,
            ..make_text_event("$ev:example.com", "@alice:example.com", "old message")
        };
        let json = serde_json::to_string(&ev).expect("serialize");
        let back: TimelineEvent = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.timestamp, 0);
    }

    // --- Search matcher ---

    #[test]
    fn test_event_matches_is_case_insensitive() {
        let ev = make_text_event("$e:example.com", "@a:example.com", "Hello World");
        assert!(event_matches(&ev, "hello"));
        assert!(event_matches(&ev, "WORLD".to_lowercase().as_str()));
        assert!(!event_matches(&ev, "absent"));
    }

    #[test]
    fn test_event_matches_searches_formatted_body() {
        let ev = TimelineEvent {
            body: "plain".to_string(),
            formatted_body: Some("<b>fancy</b>".to_string()),
            ..make_text_event("$e:example.com", "@a:example.com", "plain")
        };
        assert!(event_matches(&ev, "fancy"));
    }

    #[test]
    fn test_event_matches_skips_undecryptable() {
        // The placeholder body for an undecryptable event must never match, even
        // if the query happens to appear in the placeholder text.
        let ev = TimelineEvent {
            msg_type: "m.room.encrypted".to_string(),
            ..make_text_event("$e:example.com", "@a:example.com", "unable to decrypt")
        };
        assert!(!event_matches(&ev, "decrypt"));
    }

    #[test]
    fn test_search_summary_roundtrip() {
        let summary = SearchSummary { scanned: 1234, matched: 7, reached_start: true, canceled: false };
        let json = serde_json::to_string(&summary).expect("serialize");
        let back: SearchSummary = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.scanned, 1234);
        assert_eq!(back.matched, 7);
        assert!(back.reached_start);
        assert!(!back.canceled);
    }

    // --- Search stop decision ---

    #[test]
    fn test_search_should_break_keeps_going_by_default() {
        // Mid-scan, no limits hit: keep paginating.
        assert!(!search_should_break(50, u64::MAX, Some(1_700_000_000_000), None, false, false));
    }

    #[test]
    fn test_search_should_break_on_cancel_start_and_cap() {
        assert!(search_should_break(10, u64::MAX, None, None, false, true), "canceled");
        assert!(search_should_break(10, u64::MAX, None, None, true, false), "reached_start");
        assert!(search_should_break(5000, 5000, None, None, false, false), "cap reached");
        assert!(search_should_break(5001, 5000, None, None, false, false), "past cap");
    }

    // --- aggregate_chunk ---

    fn raw_event(json: serde_json::Value) -> Raw<AnySyncTimelineEvent> {
        Raw::new(&json).expect("serialize raw event").cast()
    }

    #[test]
    fn test_aggregate_chunk_attaches_reactions() {
        // A message plus two reactions targeting it (one from us, one from a peer).
        let chunk = vec![
            raw_event(serde_json::json!({
                "type": "m.room.message",
                "event_id": "$msg:example.com",
                "sender": "@alice:example.com",
                "origin_server_ts": 1_700_000_000_000u64,
                "content": { "msgtype": "m.text", "body": "hello" }
            })),
            raw_event(serde_json::json!({
                "type": "m.reaction",
                "event_id": "$rx1:example.com",
                "sender": "@me:example.com",
                "origin_server_ts": 1_700_000_001_000u64,
                "content": { "m.relates_to": { "rel_type": "m.annotation", "event_id": "$msg:example.com", "key": "👍" } }
            })),
            raw_event(serde_json::json!({
                "type": "m.reaction",
                "event_id": "$rx2:example.com",
                "sender": "@bob:example.com",
                "origin_server_ts": 1_700_000_002_000u64,
                "content": { "m.relates_to": { "rel_type": "m.annotation", "event_id": "$msg:example.com", "key": "👍" } }
            })),
        ];

        let out = aggregate_chunk(chunk, "@me:example.com");

        // Reaction events are not returned as their own messages.
        assert_eq!(out.len(), 1);
        let msg = &out[0];
        assert_eq!(msg.event_id, "$msg:example.com");
        assert_eq!(msg.reactions.len(), 1);
        let group = &msg.reactions[0];
        assert_eq!(group.key, "👍");
        assert_eq!(group.count, 2);
        assert!(group.own_reaction, "our own reaction should be flagged");
        assert_eq!(group.own_event_id.as_deref(), Some("$rx1:example.com"));
    }

    #[test]
    fn test_aggregate_chunk_preserves_input_order() {
        let chunk = vec![
            raw_event(serde_json::json!({
                "type": "m.room.message", "event_id": "$a:example.com", "sender": "@a:example.com",
                "origin_server_ts": 1u64, "content": { "msgtype": "m.text", "body": "first" }
            })),
            raw_event(serde_json::json!({
                "type": "m.room.message", "event_id": "$b:example.com", "sender": "@a:example.com",
                "origin_server_ts": 2u64, "content": { "msgtype": "m.text", "body": "second" }
            })),
        ];
        let out = aggregate_chunk(chunk, "@me:example.com");
        assert_eq!(out.iter().map(|e| e.event_id.as_str()).collect::<Vec<_>>(),
                   vec!["$a:example.com", "$b:example.com"]);
    }

    // --- convert_raw_message_like (recency probe filter) ---

    #[test]
    fn test_convert_raw_message_like_accepts_messages_stickers_encrypted() {
        let msg = raw_event(serde_json::json!({
            "type": "m.room.message", "event_id": "$m:example.com", "sender": "@a:example.com",
            "origin_server_ts": 10u64, "content": { "msgtype": "m.text", "body": "hi" }
        }));
        assert_eq!(convert_raw_message_like(&msg).expect("message").msg_type, "m.text");

        let sticker = raw_event(serde_json::json!({
            "type": "m.sticker", "event_id": "$s:example.com", "sender": "@a:example.com",
            "origin_server_ts": 11u64,
            "content": { "body": "a sticker", "url": "mxc://example.com/sticker",
                         "info": { "w": 256, "h": 256, "mimetype": "image/png" } }
        }));
        assert_eq!(convert_raw_message_like(&sticker).expect("sticker").msg_type, "m.sticker");

        // Still-encrypted (UTD) events count: a message we can't read yet is
        // still a message.
        let encrypted = raw_event(serde_json::json!({
            "type": "m.room.encrypted", "event_id": "$e:example.com", "sender": "@a:example.com",
            "origin_server_ts": 12u64,
            "content": { "algorithm": "m.megolm.v1.aes-sha2", "ciphertext": "AwgAEnAC",
                         "device_id": "DEV", "sender_key": "key", "session_id": "sess" }
        }));
        assert_eq!(
            convert_raw_message_like(&encrypted).expect("encrypted").msg_type,
            "m.room.encrypted"
        );
    }

    #[test]
    fn test_convert_raw_message_like_rejects_state_and_reaction_events() {
        // Member events fan out to every shared room on display-name/avatar
        // changes — counting them made dormant rooms outrank real chats.
        let member = raw_event(serde_json::json!({
            "type": "m.room.member", "event_id": "$mem:example.com",
            "sender": "@a:example.com", "state_key": "@a:example.com",
            "origin_server_ts": 20u64,
            "content": { "membership": "join", "displayname": "new name" }
        }));
        assert!(convert_raw_message_like(&member).is_none());

        // Reactions are deliberately not activity.
        let reaction = raw_event(serde_json::json!({
            "type": "m.reaction", "event_id": "$rx:example.com", "sender": "@a:example.com",
            "origin_server_ts": 21u64,
            "content": { "m.relates_to": {
                "rel_type": "m.annotation", "event_id": "$m:example.com", "key": "👍"
            } }
        }));
        assert!(convert_raw_message_like(&reaction).is_none());

        let topic = raw_event(serde_json::json!({
            "type": "m.room.topic", "event_id": "$t:example.com",
            "sender": "@a:example.com", "state_key": "",
            "origin_server_ts": 22u64,
            "content": { "topic": "new topic" }
        }));
        assert!(convert_raw_message_like(&topic).is_none());
    }

    #[test]
    fn test_search_should_break_date_cutoff() {
        let cutoff = 1_700_000_000_000u64;
        // Oldest event is still newer than the cutoff → keep going.
        assert!(!search_should_break(100, u64::MAX, Some(cutoff + 5_000), Some(cutoff), false, false));
        // Oldest event has crossed (== or older than) the cutoff → stop.
        assert!(search_should_break(100, u64::MAX, Some(cutoff), Some(cutoff), false, false));
        assert!(search_should_break(100, u64::MAX, Some(cutoff - 5_000), Some(cutoff), false, false));
        // No cutoff set → date rule never fires.
        assert!(!search_should_break(100, u64::MAX, Some(0), None, false, false));
        // Cutoff set but no events seen yet → can't decide on date, keep going.
        assert!(!search_should_break(0, u64::MAX, None, Some(cutoff), false, false));
    }

    #[test]
    fn test_min_opt_tracks_running_minimum() {
        // None is the identity: either side carries through.
        assert_eq!(min_opt(None, None), None);
        assert_eq!(min_opt(Some(5), None), Some(5));
        assert_eq!(min_opt(None, Some(7)), Some(7));
        // With both present, the smaller (older) timestamp wins, regardless of
        // argument order — so a late out-of-order batch can't raise the floor.
        assert_eq!(min_opt(Some(10), Some(3)), Some(3));
        assert_eq!(min_opt(Some(3), Some(10)), Some(3));
    }

    #[test]
    fn test_search_hit_within_back_to_date_cutoff() {
        let cutoff = 1_700_000_000_000u64;
        // Newer than the cutoff → in range.
        assert!(hit_in_range(cutoff + 5_000, Some(cutoff)));
        // Exactly at the cutoff → inclusive, in range.
        assert!(hit_in_range(cutoff, Some(cutoff)));
        // Older than the cutoff → filtered out (this is the leak being fixed).
        assert!(!hit_in_range(cutoff - 5_000, Some(cutoff)));
        // No cutoff (e.g. "Entire history") → every hit is in range.
        assert!(hit_in_range(0, None));
        assert!(hit_in_range(cutoff, None));
    }

    #[test]
    fn test_build_image_body_msc2530_mapping() {
        use super::build_image_body;
        // With a caption: body carries the caption, filename the real name.
        assert_eq!(
            build_image_body("cat.png", Some("look at this")),
            ("look at this".to_string(), Some("cat.png".to_string()))
        );
        // Caption is trimmed.
        assert_eq!(
            build_image_body("cat.png", Some("  hi  ")),
            ("hi".to_string(), Some("cat.png".to_string()))
        );
        // No caption → body = filename, field omitted (pre-caption wire format).
        assert_eq!(
            build_image_body("cat.png", None),
            ("cat.png".to_string(), None)
        );
        // Whitespace-only caption counts as no caption.
        assert_eq!(
            build_image_body("cat.png", Some("   ")),
            ("cat.png".to_string(), None)
        );
    }

    #[test]
    fn test_convert_sync_captioned_image_surfaces_caption() {
        // An MSC2530 image event as it arrives over sync: body = caption,
        // filename = the real name (what Quark sends and Element renders).
        let json = serde_json::json!({
            "type": "m.room.message",
            "event_id": "$img1:example.com",
            "sender": "@alice:example.com",
            "origin_server_ts": 1_700_000_000_000i64,
            "content": {
                "msgtype": "m.image",
                "body": "look at this cat",
                "filename": "pasted-image-123.png",
                "url": "mxc://example.com/abc123",
                "info": { "mimetype": "image/png", "w": 800, "h": 600 }
            }
        });
        let ev: OriginalSyncRoomMessageEvent =
            serde_json::from_value(json).expect("deserialize image event");
        let te = convert_sync_room_message(ev);
        assert_eq!(te.msg_type, "m.image");
        assert_eq!(te.body, "look at this cat");
        assert_eq!(te.caption.as_deref(), Some("look at this cat"));
    }

    #[test]
    fn test_convert_sync_uncaptioned_image_has_no_caption() {
        // No filename → body is the bare name, not a caption.
        let json = serde_json::json!({
            "type": "m.room.message",
            "event_id": "$img2:example.com",
            "sender": "@alice:example.com",
            "origin_server_ts": 1_700_000_000_000i64,
            "content": {
                "msgtype": "m.image",
                "body": "pasted-image-123.png",
                "url": "mxc://example.com/abc123",
                "info": { "mimetype": "image/png" }
            }
        });
        let ev: OriginalSyncRoomMessageEvent =
            serde_json::from_value(json).expect("deserialize image event");
        let te = convert_sync_room_message(ev);
        assert_eq!(te.caption, None);
    }
}
