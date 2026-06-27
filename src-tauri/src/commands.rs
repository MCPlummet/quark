use crate::{
    config::{
        app_config::AppConfig,
        quarkrc::ParsedRc,
    },
    gif::GifResult,
    matrix::{
        client::{MatrixState, OwnProfile, SyncState},
        crypto::{CrossSigningInfo, SasInfo, VerificationStatus},
        emoji::EmojiPack,
        media::MediaDownload,
        reactions::ReactionGroup,
        rooms::{CreateRoomOptions, PinnedEventInfo, PublicRoomInfo, ReadReceiptInfo, RoomInfo, RoomMemberInfo},
        spaces::SpaceChild,
        threads::ThreadRoot,
        timeline::{TimelineEvent, TimelinePage},
    },
    media_cache::CacheStats,
    notifications::NotificationConfig,
    CacheState, MediaServerState,
};
use matrix_sdk::Client;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

/// Helper: clone the client out of the state so it doesn't hold the lock across awaits.
fn get_client(state: &State<'_, MatrixState>) -> Result<Client, String> {
    let guard = state.0.lock().map_err(|_| "State lock poisoned")?;
    guard.as_ref().cloned().ok_or_else(|| "Not logged in".to_string())
}

/// Open the encrypted message-search index for this session and install it in
/// managed state. Best-effort: a failure (keyring/SQLCipher issue, Android)
/// just leaves the index absent and search falls back to the event-cache scan,
/// so this never blocks login/restore. Runs the blocking open off the executor.
async fn open_search_index(app_handle: &AppHandle, data_dir: std::path::PathBuf, store_key: String) {
    let path = data_dir.join("search_index.sqlite3");
    match tokio::task::spawn_blocking(move || crate::search_index::SearchIndex::open(&path, &store_key))
        .await
    {
        Ok(Ok(idx)) => {
            if let Some(state) = app_handle.try_state::<crate::search_index::SearchIndexState>() {
                state.set(std::sync::Arc::new(idx));
                tracing::info!("Search index opened");
            }
        }
        Ok(Err(e)) => tracing::warn!("Search index unavailable: {e}"),
        Err(e) => tracing::warn!("Search index open task panicked: {e}"),
    }
}

/// Remove all matrix-sdk SQLite store files from the data directory.
/// Called on logout and before a fresh login to prevent crypto store conflicts
/// when switching accounts.
fn clear_store(data_dir: &Path) {
    if let Ok(entries) = std::fs::read_dir(data_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "sqlite3" || e == "db") {
                let _ = std::fs::remove_file(&path);
            }
        }
    }
}

/// Remove all local session state: the SQLite store files plus the keyring's
/// session and store-encryption key. Used on logout and before a fresh login so
/// switching accounts never reuses a prior account's encrypted store or key.
/// Synchronous (filesystem + blocking keyring I/O) — call inside `spawn_blocking`.
fn wipe_local_session(data_dir: &Path) {
    clear_store(data_dir);
    let _ = crate::secrets::clear_session(data_dir);
    let _ = crate::secrets::delete_store_key(data_dir);
}

// ─── Auth Commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn login(
    state: State<'_, MatrixState>,
    sync_state: State<'_, SyncState>,
    app_handle: AppHandle,
    homeserver_url: String,
    username: String,
    password: String,
) -> Result<(), String> {
    let data_path = app_handle.path().app_data_dir()
        .map_err(|e| format!("Could not resolve app data dir: {e}"))?;

    // Refuse to start an encrypted session if secure storage is unreachable —
    // we never silently fall back to writing the session/key in plaintext.
    {
        let dp = data_path.clone();
        let available = tokio::task::spawn_blocking(move || crate::secrets::is_available(&dp))
            .await
            .map_err(|e| format!("secrets task failed: {e}"))?;
        if !available {
            return Err(crate::secrets::unavailable_message());
        }
    }

    // Fresh login: wipe any leftover local state (old store, key, session) so a
    // different account never inherits the previous one's encrypted store, then
    // mint a fresh store-encryption key for the new store.
    let store_key = {
        let dp = data_path.clone();
        tokio::task::spawn_blocking(move || {
            wipe_local_session(&dp);
            crate::secrets::get_or_create_store_key(&dp)
        })
        .await
        .map_err(|e| format!("secrets task failed: {e}"))??
    };

    let client = crate::matrix::client::build_client(&homeserver_url, data_path.clone(), &store_key).await?;
    let session = crate::matrix::client::login_with_password(&client, &username, &password).await?;

    // Persist the session in the OS keyring — it is never returned to the
    // frontend or written to localStorage.
    {
        let dp = data_path.clone();
        tokio::task::spawn_blocking(move || crate::secrets::save_session(&dp, &session))
            .await
            .map_err(|e| format!("secrets task failed: {e}"))??;
    }

    {
        let mut guard = state.0.lock().map_err(|_| "State lock poisoned")?;
        *guard = Some(client.clone());
    }
    // `handlers_registered` tracks the *current* client. We just built a fresh one
    // (which has no event handlers), so reset the flag — otherwise start_sync skips
    // registration and the new client's sync loop emits nothing, leaving the
    // frontend with no live updates after a re-login or page reload.
    *sync_state.handlers_registered.lock().map_err(|_| "Sync state lock poisoned")? = false;

    open_search_index(&app_handle, data_path.clone(), store_key.clone()).await;

    crate::matrix::client::start_sync(client, Some(app_handle), &sync_state).await;
    Ok(())
}

/// Outcome of a session-restore attempt. The discriminant tells the frontend
/// whether it is safe to wipe local state: only `Invalid` means "the stored
/// session is genuinely unusable, throw it away." `Unavailable` (a locked or
/// unreachable keyring) must **not** trigger a wipe, or a transient lock at
/// startup would destroy the encrypted SQLite crypto store on disk.
#[derive(Serialize)]
pub enum RestoreOutcome {
    /// A session was found and the client is now syncing.
    Restored,
    /// Nothing to restore (fresh install or pre-keyring upgrade) — show login.
    NoSession,
    /// Secure storage is locked/unreachable — show login with the unlock
    /// guidance, but leave all local state untouched so a retry can recover.
    Unavailable,
    /// A stored session existed but can't be used (missing key, bad token,
    /// undecryptable store) — the frontend should `clear_session` and show login.
    Invalid,
}

/// Restore a previously saved session from the OS keyring.
///
/// Never returns `Err` for an expected keyring/session condition — those map to
/// a `RestoreOutcome` so the frontend can tell a transient lock (`Unavailable`,
/// don't wipe) apart from a dead session (`Invalid`, wipe). `Err` is reserved
/// for unexpected internal failures (e.g. the blocking task panicking).
#[tauri::command]
pub async fn restore_session(
    state: State<'_, MatrixState>,
    sync_state: State<'_, SyncState>,
    app_handle: AppHandle,
) -> Result<RestoreOutcome, String> {
    let data_path = app_handle.path().app_data_dir()
        .map_err(|e| format!("Could not resolve app data dir: {e}"))?;

    // Secure storage unreachable/locked → do not touch anything. Wiping here on a
    // transient lock would delete the encrypted crypto store (forcing device
    // re-verification + full re-sync). Tell the frontend to show login instead.
    {
        let dp = data_path.clone();
        let available = tokio::task::spawn_blocking(move || crate::secrets::is_available(&dp))
            .await
            .map_err(|e| format!("secrets task failed: {e}"))?;
        if !available {
            return Ok(RestoreOutcome::Unavailable);
        }
    }

    // Load the saved session. A keyring read error here is treated as transient
    // (Unavailable, non-destructive) rather than wiping — a later fresh login
    // cleans up on its own if the stored value really is bad.
    let session = {
        let dp = data_path.clone();
        match tokio::task::spawn_blocking(move || crate::secrets::load_session(&dp))
            .await
            .map_err(|e| format!("secrets task failed: {e}"))?
        {
            Ok(s) => s,
            Err(_) => return Ok(RestoreOutcome::Unavailable),
        }
    };

    let Some(session) = session else {
        // Nothing to restore. Proactively wipe any orphaned store left by an
        // older (pre-encryption) version: without a key/session it is unusable,
        // and leaving it keeps plaintext crypto/state data on disk.
        let dp = data_path.clone();
        let _ = tokio::task::spawn_blocking(move || clear_store(&dp)).await;
        return Ok(RestoreOutcome::NoSession);
    };

    // The store-encryption key must accompany the saved session.
    let store_key = {
        let dp = data_path.clone();
        match tokio::task::spawn_blocking(move || crate::secrets::get_store_key(&dp))
            .await
            .map_err(|e| format!("secrets task failed: {e}"))?
        {
            Ok(Some(k)) => k,
            // Keyring read failed → transient, don't wipe.
            Err(_) => return Ok(RestoreOutcome::Unavailable),
            // Session present but its key is gone → the on-disk store can't be
            // decrypted, so it's dead weight. Safe to discard.
            Ok(None) => return Ok(RestoreOutcome::Invalid),
        }
    };

    let client = match crate::matrix::client::build_client(
        &session.homeserver_url,
        data_path.clone(),
        &store_key,
    )
    .await
    {
        Ok(c) => c,
        Err(_) => return Ok(RestoreOutcome::Invalid),
    };
    if crate::matrix::client::restore_session_from_info(&client, &session)
        .await
        .is_err()
    {
        return Ok(RestoreOutcome::Invalid);
    }

    {
        let mut guard = state.0.lock().map_err(|_| "State lock poisoned")?;
        *guard = Some(client.clone());
    }
    // Fresh client → reset the handler-registration guard so start_sync re-registers
    // event handlers on it. Without this, a page reload (which rebuilds the client
    // and calls restore_session again) leaves the new sync loop with no handlers,
    // so no messages/typing/badges reach the frontend until a full app restart.
    *sync_state.handlers_registered.lock().map_err(|_| "Sync state lock poisoned")? = false;

    open_search_index(&app_handle, data_path.clone(), store_key.clone()).await;

    crate::matrix::client::start_sync(client, Some(app_handle), &sync_state).await;
    Ok(RestoreOutcome::Restored)
}

/// Start the background sync loop and register push-event handlers.
///
/// The frontend should call this command after a successful login or session
/// restore if it needs to restart sync (e.g., after the app was suspended).
/// If a sync loop is already running it is aborted first — only one loop is
/// ever active at a time to avoid flooding the homeserver with duplicate
/// requests (which can trigger exponential backoff overflow in Synapse's
/// E2EE key upload worker).
#[tauri::command]
pub async fn start_sync(
    state: State<'_, MatrixState>,
    sync_state: State<'_, SyncState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::client::start_sync(client, Some(app_handle), &sync_state).await;
    Ok(())
}

#[tauri::command]
pub async fn logout(
    state: State<'_, MatrixState>,
    sync_state: State<'_, SyncState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    // Abort the sync loop before logging out to stop all background requests.
    {
        let mut guard = sync_state.handle.lock().map_err(|_| "SyncState lock poisoned")?;
        if let Some(handle) = guard.take() {
            handle.abort();
        }
    }
    // Reset handler registration flag so a fresh login re-registers handlers
    // on the new client instance.
    {
        let mut registered = sync_state.handlers_registered.lock().map_err(|_| "SyncState lock poisoned")?;
        *registered = false;
    }

    let client = {
        let mut guard = state.0.lock().map_err(|_| "State lock poisoned")?;
        guard.take()
    };

    if let Some(c) = client {
        // Best-effort server-side token revocation; don't fail if the network is down.
        let _ = c.matrix_auth().logout().await;
    }

    // Always clear local session state (SQLite store + keyring session + store
    // key) so the next login starts clean, regardless of whether the server-side
    // revocation succeeded.
    if let Ok(data_path) = app_handle.path().app_data_dir() {
        let _ = tokio::task::spawn_blocking(move || wipe_local_session(&data_path)).await;
    }

    Ok(())
}

/// Clear local session state without contacting the server. The frontend calls
/// this when `restore_session` fails (stale token, missing key, keyring error)
/// so the next launch starts from a clean login rather than looping on the bad
/// session.
#[tauri::command]
pub async fn clear_session(app_handle: AppHandle) -> Result<(), String> {
    if let Ok(data_path) = app_handle.path().app_data_dir() {
        let _ = tokio::task::spawn_blocking(move || wipe_local_session(&data_path)).await;
    }
    Ok(())
}

// ─── Room Commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_rooms(
    state: State<'_, MatrixState>,
    recency: State<'_, crate::matrix::rooms::RecencyState>,
) -> Result<Vec<RoomInfo>, String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::get_rooms(&client, &recency).await
}

#[tauri::command]
pub async fn get_room_members(
    state: State<'_, MatrixState>,
    room_id: String,
) -> Result<Vec<RoomMemberInfo>, String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::get_room_members(&client, &room_id).await
}

#[tauri::command]
pub async fn join_room(
    state: State<'_, MatrixState>,
    room_id_or_alias: String,
) -> Result<String, String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::join_room(&client, &room_id_or_alias).await
}

#[tauri::command]
pub async fn leave_room(
    state: State<'_, MatrixState>,
    room_id: String,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::leave_room(&client, &room_id).await
}

#[tauri::command]
pub async fn create_room(
    state: State<'_, MatrixState>,
    options: CreateRoomOptions,
) -> Result<String, String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::create_room(&client, options).await
}

#[tauri::command]
pub async fn mark_room_read(
    state: State<'_, MatrixState>,
    config_state: State<'_, Mutex<AppConfig>>,
    room_id: String,
) -> Result<(), String> {
    let client = get_client(&state)?;
    // Respect the "send my read receipts" privacy setting; default to sending
    // the public receipt if the config lock is somehow unavailable.
    let send_public = config_state
        .lock()
        .map(|c| c.general.send_read_receipts)
        .unwrap_or(true);
    crate::matrix::rooms::mark_room_read(&client, &room_id, send_public).await
}

/// Load other members' latest public read positions for a room (initial seed).
#[tauri::command]
pub async fn get_room_receipts(
    state: State<'_, MatrixState>,
    room_id: String,
) -> Result<Vec<ReadReceiptInfo>, String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::get_room_receipts(&client, &room_id).await
}

/// Get pinned events for a room.
#[tauri::command]
pub async fn get_pinned_events(
    state: State<'_, MatrixState>,
    room_id: String,
) -> Result<Vec<PinnedEventInfo>, String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::get_pinned_events(&client, &room_id).await
}

/// Search the public room directory.
#[tauri::command]
pub async fn search_room_directory(
    state: State<'_, MatrixState>,
    filter: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<PublicRoomInfo>, String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::search_room_directory(&client, filter, limit).await
}

// ─── Room Settings Commands ───────────────────────────────────────────────────

#[tauri::command]
pub async fn get_power_levels(
    state: State<'_, MatrixState>,
    room_id: String,
) -> Result<crate::matrix::rooms::PowerLevels, String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::get_power_levels(&client, &room_id).await
}

#[tauri::command]
pub async fn set_power_levels(
    state: State<'_, MatrixState>,
    room_id: String,
    levels: crate::matrix::rooms::PowerLevels,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::set_power_levels(&client, &room_id, levels).await
}

#[tauri::command]
pub async fn set_room_name(
    state: State<'_, MatrixState>,
    room_id: String,
    name: String,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::set_room_name(&client, &room_id, name).await
}

#[tauri::command]
pub async fn set_room_topic(
    state: State<'_, MatrixState>,
    room_id: String,
    topic: String,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::set_room_topic(&client, &room_id, topic).await
}

#[tauri::command]
pub async fn set_room_join_rule(
    state: State<'_, MatrixState>,
    room_id: String,
    rule: String,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::set_room_join_rule(&client, &room_id, &rule).await
}

#[tauri::command]
pub async fn set_room_history_visibility(
    state: State<'_, MatrixState>,
    room_id: String,
    visibility: String,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::set_room_history_visibility(&client, &room_id, &visibility).await
}

#[tauri::command]
pub async fn get_room_state_events(
    state: State<'_, MatrixState>,
    room_id: String,
) -> Result<Vec<crate::matrix::rooms::RawStateEvent>, String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::get_room_state_events(&client, &room_id).await
}

#[tauri::command]
pub async fn get_raw_event(
    state: State<'_, MatrixState>,
    room_id: String,
    event_id: String,
) -> Result<String, String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::get_raw_event(&client, &room_id, &event_id).await
}

// ─── Timeline Commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_timeline(
    state: State<'_, MatrixState>,
    room_id: String,
    limit: Option<usize>,
    before: Option<String>,
) -> Result<TimelinePage, String> {
    let client = get_client(&state)?;
    crate::matrix::timeline::get_timeline(&client, &room_id, limit.unwrap_or(50), before).await
}

#[tauri::command]
pub async fn get_event_context(
    state: State<'_, MatrixState>,
    room_id: String,
    event_id: String,
    context_size: Option<usize>,
) -> Result<crate::matrix::timeline::EventContextPage, String> {
    let client = get_client(&state)?;
    crate::matrix::timeline::get_event_context(&client, &room_id, &event_id, context_size.unwrap_or(25)).await
}

#[tauri::command]
pub async fn paginate_forward(
    state: State<'_, MatrixState>,
    room_id: String,
    after: String,
    limit: Option<usize>,
) -> Result<crate::matrix::timeline::TimelineForwardPage, String> {
    let client = get_client(&state)?;
    crate::matrix::timeline::paginate_forward(&client, &room_id, after, limit.unwrap_or(50)).await
}

/// Open a room's live timeline via the raw `room.messages()` API (transient,
/// bounded — does not persist into the event cache). Fetches the most recent
/// `limit` events and remembers the backward-pagination token for subsequent
/// `load_older_timeline` calls. Cancels any in-flight search first so the open
/// isn't queued behind a long scan.
#[tauri::command]
pub async fn open_room_timeline(
    state: State<'_, MatrixState>,
    search_state: State<'_, crate::matrix::client::SearchState>,
    tokens: State<'_, crate::matrix::client::TimelineTokens>,
    room_id: String,
    limit: Option<usize>,
) -> Result<crate::matrix::timeline::CachedTimelinePage, String> {
    let client = get_client(&state)?;
    search_state.0.store(true, std::sync::atomic::Ordering::Relaxed);
    let page =
        crate::matrix::timeline::get_timeline(&client, &room_id, limit.unwrap_or(100), None).await?;
    let reached_start = page.prev_batch.is_none();
    tokens.0.lock().await.insert(room_id.clone(), page.prev_batch);
    Ok(crate::matrix::timeline::CachedTimelinePage { events: page.events, reached_start })
}

/// Load older history for the live timeline via raw `room.messages()`, resuming
/// from the stored backward-pagination token, and return the newly-fetched
/// events (oldest-first) for prepending.
#[tauri::command]
pub async fn load_older_timeline(
    state: State<'_, MatrixState>,
    tokens: State<'_, crate::matrix::client::TimelineTokens>,
    room_id: String,
    batch_size: Option<usize>,
) -> Result<crate::matrix::timeline::CachedTimelinePage, String> {
    let client = get_client(&state)?;

    // Resume from the token left by the last open/load. A missing entry or a
    // stored `None` means we've already reached the start of history.
    let before = match tokens.0.lock().await.get(&room_id) {
        Some(Some(tok)) => tok.clone(),
        _ => {
            return Ok(crate::matrix::timeline::CachedTimelinePage {
                events: Vec::new(),
                reached_start: true,
            })
        }
    };

    let page =
        crate::matrix::timeline::get_timeline(&client, &room_id, batch_size.unwrap_or(300), Some(before))
            .await?;
    let reached_start = page.prev_batch.is_none();
    tokens.0.lock().await.insert(room_id.clone(), page.prev_batch);
    Ok(crate::matrix::timeline::CachedTimelinePage { events: page.events, reached_start })
}

/// Tier 2 — search locally cached/persisted events (offline, fast).
#[tauri::command]
pub async fn search_room_cache(
    state: State<'_, MatrixState>,
    index_state: State<'_, crate::search_index::SearchIndexState>,
    room_id: String,
    query: String,
) -> Result<Vec<TimelineEvent>, String> {
    let client = get_client(&state)?;
    let index = index_state.get();
    crate::matrix::timeline::search_room_cache(&client, &room_id, &query, index.as_deref()).await
}

/// Tiers 3/4 — streaming server-side search. Emits hits/progress as Tauri
/// events; resolves with a summary when the scan ends. Resets the cancel flag
/// on entry so a prior cancel doesn't abort this run.
#[tauri::command]
pub async fn search_room_messages(
    state: State<'_, MatrixState>,
    search_state: State<'_, crate::matrix::client::SearchState>,
    pagination_lock: State<'_, crate::matrix::client::PaginationLock>,
    index_state: State<'_, crate::search_index::SearchIndexState>,
    app_handle: AppHandle,
    room_id: String,
    query: String,
    until_ts: Option<u64>,
    max_events: Option<u32>,
) -> Result<crate::matrix::timeline::SearchSummary, String> {
    let client = get_client(&state)?;
    let index = index_state.get();
    // Ask any in-flight scan to stop, then serialize on the shared paginator.
    // Reset our own cancel flag only *after* acquiring the lock, so the prior
    // scan (which we just signalled) isn't confused with this fresh run.
    search_state.0.store(true, std::sync::atomic::Ordering::Relaxed);
    let _guard = pagination_lock.0.lock().await;
    search_state.0.store(false, std::sync::atomic::Ordering::Relaxed);
    crate::matrix::timeline::search_messages(
        &client,
        &app_handle,
        &room_id,
        &query,
        until_ts,
        max_events,
        &search_state.0,
        index.as_deref(),
    )
    .await
}

/// Request cancellation of an in-progress server-side search.
#[tauri::command]
pub async fn cancel_room_search(
    search_state: State<'_, crate::matrix::client::SearchState>,
) -> Result<(), String> {
    search_state.0.store(true, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

/// Last-known total event count for a room, recorded by a prior completed
/// entire-history search (now stored in the search index). `None` if no full
/// scan has run yet, or the index is unavailable. Lets the search dialog show a
/// real percentage bar for the "entire history" tier.
#[tauri::command]
pub async fn get_room_scan_total(
    index_state: State<'_, crate::search_index::SearchIndexState>,
    room_id: String,
) -> Result<Option<u64>, String> {
    Ok(index_state.get().and_then(|idx| idx.room_total(&room_id).ok().flatten()))
}

#[tauri::command]
pub async fn send_message(
    state: State<'_, MatrixState>,
    room_id: String,
    body: String,
    formatted_body: Option<String>,
    in_reply_to: Option<String>,
) -> Result<String, String> {
    let client = get_client(&state)?;
    crate::matrix::timeline::send_message(&client, &room_id, &body, formatted_body.as_deref(), in_reply_to.as_deref()).await
}

#[tauri::command]
pub async fn edit_message(
    state: State<'_, MatrixState>,
    room_id: String,
    event_id: String,
    new_body: String,
    new_formatted_body: Option<String>,
) -> Result<String, String> {
    let client = get_client(&state)?;
    crate::matrix::timeline::edit_message(&client, &room_id, &event_id, &new_body, new_formatted_body.as_deref()).await
}

#[tauri::command]
pub async fn redact_message(
    state: State<'_, MatrixState>,
    room_id: String,
    event_id: String,
    reason: Option<String>,
) -> Result<String, String> {
    let client = get_client(&state)?;
    crate::matrix::timeline::redact_message(&client, &room_id, &event_id, reason.as_deref()).await
}

#[tauri::command]
pub async fn get_message_revisions(
    state: State<'_, MatrixState>,
    room_id: String,
    event_id: String,
) -> Result<Vec<crate::matrix::timeline::TimelineEvent>, String> {
    let client = get_client(&state)?;
    crate::matrix::timeline::get_message_revisions(&client, &room_id, &event_id).await
}

// ─── Reaction Commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn send_reaction(
    state: State<'_, MatrixState>,
    room_id: String,
    event_id: String,
    key: String,
) -> Result<String, String> {
    let client = get_client(&state)?;
    crate::matrix::reactions::send_reaction(&client, &room_id, &event_id, &key).await
}

#[tauri::command]
pub async fn get_reactions(
    state: State<'_, MatrixState>,
    room_id: String,
    event_id: String,
) -> Result<Vec<ReactionGroup>, String> {
    let client = get_client(&state)?;
    crate::matrix::reactions::get_reactions(&client, &room_id, &event_id).await
}

// ─── Emoji Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_emoji_packs(
    state: State<'_, MatrixState>,
    room_id: Option<String>,
) -> Result<Vec<EmojiPack>, String> {
    let client = get_client(&state)?;
    crate::matrix::emoji::get_emoji_packs(&client, room_id.as_deref()).await
}

// ─── Sticker Commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_sticker_packs(
    state: State<'_, MatrixState>,
    room_id: Option<String>,
) -> Result<Vec<EmojiPack>, String> {
    let client = get_client(&state)?;
    crate::matrix::stickers::get_sticker_packs(&client, room_id.as_deref()).await
}

// ─── Media Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn download_media(
    state: State<'_, MatrixState>,
    cache_state: State<'_, CacheState>,
    mxc_url: String,
    thumbnail: bool,
    thumbnail_width: Option<u32>,
    thumbnail_height: Option<u32>,
    encryption_info: Option<String>,
) -> Result<MediaDownload, String> {
    let client = get_client(&state)?;
    crate::matrix::media::download_media_with_cache(
        &client,
        &mxc_url,
        thumbnail,
        thumbnail_width,
        thumbnail_height,
        Some(&cache_state.0),
        encryption_info.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn upload_media(
    state: State<'_, MatrixState>,
    file_path: String,
) -> Result<String, String> {
    let client = get_client(&state)?;
    crate::matrix::media::upload_file(&client, &file_path).await
}

/// Map a media MIME type to a file extension. Returns "bin" for unknown types.
fn ext_for_media_mime(mime: &str) -> &'static str {
    match mime {
        "video/mp4" | "video/x-m4v" => "mp4",
        "video/webm" => "webm",
        "video/ogg" => "ogv",
        "video/quicktime" => "mov",
        "video/x-matroska" => "mkv",
        "video/x-msvideo" => "avi",
        "audio/mpeg" => "mp3",
        "audio/ogg" => "ogg",
        "audio/wav" => "wav",
        "audio/flac" => "flac",
        _ => "bin",
    }
}

/// If `filename` already carries a recognised media extension, return it
/// (lowercased) so it can be preserved verbatim.
fn known_media_ext(filename: &str) -> Option<String> {
    let ext = std::path::Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())?
        .to_ascii_lowercase();
    const KNOWN: &[&str] = &[
        "mp4", "m4v", "webm", "ogv", "mov", "mkv", "avi", "mp3", "ogg", "wav", "flac",
    ];
    KNOWN.contains(&ext.as_str()).then_some(ext)
}

/// Decode the downloaded media bytes and write them to a stable temp file whose
/// extension reflects the real media type, returning the absolute path.
///
/// The extension is critical: Tauri's asset protocol (used for inline video
/// streaming) derives the HTTP `Content-Type` from it, and WebKit refuses to
/// play `application/octet-stream`. `sniff_mime_type` can't recognise webm/mkv,
/// so the extension is chosen by preference: (1) a known extension already on
/// `filename`, then (2) the event's declared mimetype (`mime_hint`), then
/// (3) the sniffed download mime.
///
/// The file is named `quark-media-<mxc-hash>.<ext>` so repeated views of the
/// same message reuse one file (no duplicates, no collisions between videos).
fn write_media_to_temp(
    mxc_url: &str,
    dl: &crate::matrix::media::MediaDownload,
    filename: Option<&str>,
    mime_hint: Option<&str>,
) -> Result<std::path::PathBuf, String> {
    // Extension precedence: the event's declared mimetype is the most reliable
    // signal of the actual content type — a user-supplied filename can be
    // mislabelled — so it wins over a known extension on the filename; the
    // sniffed download mime is the last resort.
    let ext: String = mime_hint
        .map(ext_for_media_mime)
        .filter(|e| *e != "bin")
        .map(str::to_string)
        .or_else(|| filename.and_then(known_media_ext))
        .unwrap_or_else(|| ext_for_media_mime(&dl.mime_type).to_string());

    let basename = {
        use sha2::{Digest, Sha256};
        let mut h = Sha256::new();
        h.update(mxc_url.as_bytes());
        format!("quark-media-{:x}.{}", h.finalize(), ext)
    };

    let dest = std::env::temp_dir().join(basename);
    let bytes = crate::matrix::media::decode_base64(&dl.data_base64)?;
    // The name is content-addressed (mxc hash), so an existing file of the same
    // size already holds the right bytes. Skip the rewrite — truncating to
    // rewrite could corrupt a read the media server is doing for a still-playing
    // copy of the same video.
    let already_complete = std::fs::metadata(&dest)
        .map(|m| m.len() == bytes.len() as u64)
        .unwrap_or(false);
    if !already_complete {
        std::fs::write(&dest, &bytes).map_err(|e| format!("Failed to write temp file: {e}"))?;
    }
    Ok(dest)
}

/// Download a video/audio file from the homeserver and write it to a temporary
/// file on disk, returning the absolute path. The frontend converts the path to
/// an asset-protocol URL (`convertFileSrc`) for inline `<video>` streaming, or
/// passes it to the system player.
///
/// `mime_type` carries the event's declared mimetype (`info.mimetype`), which is
/// more reliable than the sniffed download mime for choosing the file extension
/// — see `write_media_to_temp`. A stable name derived from the mxc URL hash is
/// used so repeated clicks on the same message don't create duplicate files.
#[tauri::command]
pub async fn save_media_to_temp(
    state: State<'_, MatrixState>,
    cache_state: State<'_, CacheState>,
    mxc_url: String,
    encryption_info: Option<String>,
    filename: Option<String>,
    mime_type: Option<String>,
) -> Result<String, String> {
    let client = get_client(&state)?;

    let dl = crate::matrix::media::download_media_with_cache(
        &client,
        &mxc_url,
        false,
        None,
        None,
        Some(&cache_state.0),
        encryption_info.as_deref(),
    )
    .await?;

    let dest = write_media_to_temp(&mxc_url, &dl, filename.as_deref(), mime_type.as_deref())?;

    dest.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Temp path is not valid UTF-8".to_string())
}

/// Download a video/audio file to a temp file and return a loopback HTTP URL
/// (`http://127.0.0.1:<port>/<token>/<name>`) that streams it with Range
/// support. This is the transport for inline `<video>`: unlike the asset
/// protocol or a `blob:` URL, a real localhost HTTP source is seekable in
/// WebKitGTK and streams from disk. Errors if the media server isn't running,
/// in which case the frontend falls back to the external player.
#[tauri::command]
pub async fn serve_media(
    state: State<'_, MatrixState>,
    cache_state: State<'_, CacheState>,
    server: State<'_, MediaServerState>,
    mxc_url: String,
    encryption_info: Option<String>,
    mime_type: Option<String>,
    filename: Option<String>,
) -> Result<String, String> {
    let server = server
        .0
        .clone()
        .ok_or_else(|| "Media server is not running".to_string())?;
    let client = get_client(&state)?;
    let dl = crate::matrix::media::download_media_with_cache(
        &client,
        &mxc_url,
        false,
        None,
        None,
        Some(&cache_state.0),
        encryption_info.as_deref(),
    )
    .await?;
    let path = write_media_to_temp(&mxc_url, &dl, filename.as_deref(), mime_type.as_deref())?;
    let basename = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Temp filename is not valid UTF-8".to_string())?;
    Ok(server.url_for(basename))
}

/// Download a media file from the homeserver and save it to disk via the OS
/// **native save dialog**. The destination comes from the dialog — the user
/// picks it — never from the frontend, so this can't be turned into an
/// arbitrary-file-write primitive the way a frontend-supplied path could.
///
/// On Linux the dialog goes through the XDG desktop portal: it works in `tauri
/// dev` and inside the Flatpak sandbox (where the portal is the only way to
/// write outside the sandbox), and it avoids the GTK/GSettings stack that
/// crashed the previous native picker on some Linux setups. macOS/Windows use
/// the native picker. Returns the written path, or `None` if the user cancelled.
#[tauri::command]
pub async fn save_media_with_dialog(
    app_handle: AppHandle,
    state: State<'_, MatrixState>,
    cache_state: State<'_, CacheState>,
    mxc_url: String,
    encryption_info: Option<String>,
    suggested_filename: Option<String>,
) -> Result<Option<String>, String> {
    let client = get_client(&state)?;

    let dl = crate::matrix::media::download_media_with_cache(
        &client,
        &mxc_url,
        false,
        None,
        None,
        Some(&cache_state.0),
        encryption_info.as_deref(),
    )
    .await?;

    let bytes = crate::matrix::media::decode_base64(&dl.data_base64)?;
    save_bytes_via_dialog(&app_handle, bytes, suggested_filename.as_deref()).await
}

/// macOS builds the save panel on the main (AppKit) thread. A Tauri `async`
/// command runs on a tokio worker, and `rfd`'s `AsyncFileDialog` constructs its
/// panel synchronously on the calling thread — off the main thread that lookup
/// is unreliable and `rfd` panics building the modal (`modal_future.rs`), so the
/// dialog never appears. Hop to the main thread via `run_on_main_thread` and run
/// the *blocking* picker there (the standard `runModal` path), ferrying the
/// chosen path back over a oneshot channel.
#[cfg(target_os = "macos")]
async fn save_bytes_via_dialog(
    app_handle: &AppHandle,
    bytes: Vec<u8>,
    suggested_filename: Option<&str>,
) -> Result<Option<String>, String> {
    let suggested = suggested_filename.map(str::to_owned);
    let (tx, rx) = tokio::sync::oneshot::channel();

    app_handle
        .run_on_main_thread(move || {
            let mut dialog = rfd::FileDialog::new();
            if let Some(name) = suggested {
                dialog = dialog.set_file_name(name);
            }
            let _ = tx.send(dialog.save_file());
        })
        .map_err(|e| format!("Failed to open save dialog: {e}"))?;

    let Some(path) = rx
        .await
        .map_err(|_| "Save dialog closed unexpectedly".to_string())?
    else {
        return Ok(None); // user cancelled
    };

    std::fs::write(&path, &bytes).map_err(|e| format!("Failed to write file: {e}"))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Linux (`xdg-portal`, pure D-Bus) and Windows are thread-agnostic enough to
/// drive `rfd`'s async picker directly from the command's worker thread.
#[cfg(any(target_os = "linux", target_os = "windows"))]
async fn save_bytes_via_dialog(
    _app_handle: &AppHandle,
    bytes: Vec<u8>,
    suggested_filename: Option<&str>,
) -> Result<Option<String>, String> {
    let mut dialog = rfd::AsyncFileDialog::new();
    if let Some(name) = suggested_filename {
        dialog = dialog.set_file_name(name);
    }

    let Some(handle) = dialog.save_file().await else {
        return Ok(None); // user cancelled
    };

    let path = handle.path().to_path_buf();
    std::fs::write(&path, &bytes).map_err(|e| format!("Failed to write file: {e}"))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Mobile (iOS/Android) has no desktop file picker, and saving arbitrary files
/// isn't wired up there yet.
#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
async fn save_bytes_via_dialog(
    _app_handle: &AppHandle,
    _bytes: Vec<u8>,
    _suggested_filename: Option<&str>,
) -> Result<Option<String>, String> {
    Err("Saving files isn't supported on this platform yet".to_string())
}

/// Return the compile-time target OS ("linux", "macos", "windows", "ios",
/// "android"). The frontend uses this to pick the inline-video transport:
/// Linux/WebKitGTK needs the loopback HTTP server (its media pipeline can't read
/// the asset protocol for `<video>`); other webviews use the asset protocol,
/// which avoids loading `http://127.0.0.1` (and the App Transport Security /
/// loopback restrictions that come with it on Apple/Windows).
#[tauri::command]
pub fn get_platform() -> String {
    std::env::consts::OS.to_string()
}

/// Download a video/audio file to a temp path and open it in the system's
/// default media player. Uses xdg-open (Linux), open (macOS), or start
/// (Windows) directly, bypassing the shell-plugin URL scope restrictions.
#[tauri::command]
pub async fn open_media_externally(
    state: State<'_, MatrixState>,
    cache_state: State<'_, CacheState>,
    mxc_url: String,
    encryption_info: Option<String>,
    filename: Option<String>,
) -> Result<(), String> {
    // Re-use the download+write logic from save_media_to_temp.
    // We inline the call rather than calling the command directly because
    // Tauri commands can't invoke other commands; both share the same State.
    let path = {
        let client = get_client(&state)?;
        let dl = crate::matrix::media::download_media_with_cache(
            &client,
            &mxc_url,
            false,
            None,
            None,
            Some(&cache_state.0),
            encryption_info.as_deref(),
        )
        .await?;

        write_media_to_temp(&mxc_url, &dl, filename.as_deref(), None)?
    };

    // Open with the platform default handler.
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("xdg-open failed: {e}"))?;

    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("open failed: {e}"))?;

    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("explorer failed: {e}"))?;

    Ok(())
}

/// Upload image data (base64-encoded) and send it as an m.image event.
/// Used for clipboard paste of images from the frontend.
#[tauri::command]
pub async fn send_pasted_image(
    state: State<'_, MatrixState>,
    room_id: String,
    data_base64: String,
    mime_type: String,
    filename: String,
) -> Result<String, String> {
    let client = get_client(&state)?;

    let data = crate::matrix::media::decode_base64(&data_base64)?;

    let mxc_url = crate::matrix::media::upload_media(
        &client,
        data,
        &mime_type,
        Some(&filename),
    )
    .await?;

    crate::matrix::timeline::send_image(
        &client,
        &room_id,
        &filename,
        &mxc_url,
        &mime_type,
        None,
        None,
    )
    .await
}

/// Upload file data (base64-encoded) and send it as an m.file event.
/// Used for the file picker attach flow.
#[tauri::command]
pub async fn send_file(
    state: State<'_, MatrixState>,
    room_id: String,
    data_base64: String,
    mime_type: String,
    filename: String,
    file_size: Option<u64>,
) -> Result<String, String> {
    let client = get_client(&state)?;

    let data = crate::matrix::media::decode_base64(&data_base64)?;

    let mxc_url = crate::matrix::media::upload_media(
        &client,
        data,
        &mime_type,
        Some(&filename),
    )
    .await?;

    crate::matrix::timeline::send_file(
        &client,
        &room_id,
        &filename,
        &mxc_url,
        &mime_type,
        file_size,
    )
    .await
}

/// Upload video data (base64-encoded) and send it as an m.video event.
/// Used for the file picker attach flow when a video file is chosen, so it
/// renders as a playable embed rather than a generic file attachment.
#[tauri::command]
pub async fn send_video(
    state: State<'_, MatrixState>,
    room_id: String,
    data_base64: String,
    mime_type: String,
    filename: String,
    width: Option<u64>,
    height: Option<u64>,
    duration_ms: Option<u64>,
    file_size: Option<u64>,
) -> Result<String, String> {
    let client = get_client(&state)?;

    let data = crate::matrix::media::decode_base64(&data_base64)?;

    let mxc_url = crate::matrix::media::upload_media(
        &client,
        data,
        &mime_type,
        Some(&filename),
    )
    .await?;

    crate::matrix::timeline::send_video(
        &client,
        &room_id,
        &filename,
        &mxc_url,
        &mime_type,
        width,
        height,
        duration_ms,
        file_size,
    )
    .await
}

#[tauri::command]
pub async fn send_sticker(
    state: State<'_, MatrixState>,
    room_id: String,
    shortcode: String,
    url: String,
    body: Option<String>,
    pack_id: String,
    pack_name: Option<String>,
) -> Result<String, String> {
    let client = get_client(&state)?;
    let sticker = crate::matrix::stickers::StickerInfo {
        shortcode,
        url,
        body,
        pack_id,
        pack_name,
    };
    crate::matrix::stickers::send_sticker(&client, &room_id, &sticker).await
}

// ─── URL Preview Commands ─────────────────────────────────────────────────────

/// OpenGraph-like metadata returned by the homeserver's URL preview API.
#[derive(Debug, serde::Serialize)]
pub struct UrlPreview {
    pub title: Option<String>,
    pub description: Option<String>,
    /// mxc:// URL for the preview image (resolve via download_media).
    pub image_url: Option<String>,
    pub site_name: Option<String>,
}

/// Fetch URL preview metadata from the homeserver (MSC or /_matrix/media/v3/preview_url).
/// Falls back to a direct HTTP GET + OG-tag extraction if the homeserver API fails.
/// Returns None if neither source yields usable metadata.
#[tauri::command]
pub async fn get_url_preview(
    state: State<'_, MatrixState>,
    url: String,
) -> Result<Option<UrlPreview>, String> {
    let client = get_client(&state)?;

    // Only http(s) URLs have a page to preview; anything else (matrix:, mailto:,
    // javascript:, …) is dropped before it can reach the homeserver preview API
    // or the direct fetch below.
    match url::Url::parse(&url).ok().as_ref().map(|u| u.scheme()) {
        Some("http") | Some("https") => {}
        _ => return Ok(None),
    }

    // ── 1. Try the Matrix homeserver URL-preview API ──────────────────────
    #[allow(deprecated)]
    let hs_result = {
        use matrix_sdk::ruma::api::client::media::get_media_preview::v3::Request as PreviewRequest;
        #[allow(deprecated)]
        let request = PreviewRequest::new(url.clone());
        #[allow(deprecated)]
        client.send(request, None).await
    };

    if let Ok(response) = hs_result {
        if let Some(data) = response.data {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(data.get()) {
                let title = value.get("og:title").and_then(|v| v.as_str()).map(str::to_string);
                let description = value.get("og:description").and_then(|v| v.as_str()).map(str::to_string);
                let image_url = value.get("og:image").and_then(|v| v.as_str()).map(str::to_string);
                let site_name = value.get("og:site_name").and_then(|v| v.as_str()).map(str::to_string);

                if title.is_some() || description.is_some() || image_url.is_some() {
                    return Ok(Some(UrlPreview { title, description, image_url, site_name }));
                }
            }
        }
    }

    // ── 2. Direct HTTP fallback: fetch the page and extract OG tags ───────
    //
    // `url` is attacker-controlled (it comes straight from message content and
    // auto-previews fire on it), so the fetch goes through the SSRF guard:
    // http(s) only, no private/loopback/link-local targets, redirects
    // re-validated per hop, the connect IP pinned to the validated address, and
    // a capped body read. A blocked or failed target just means "no preview".
    const PREVIEW_UA: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    let resp = match crate::net_guard::guarded_get(
        &url,
        PREVIEW_UA,
        std::time::Duration::from_secs(8),
        &[
            // Mimic a real browser request so CDN/bot-detection layers serve full HTML
            ("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
            ("Accept-Language", "en-US,en;q=0.5"),
            // Request uncompressed content; reqwest doesn't have gzip enabled by default
            ("Accept-Encoding", "identity"),
            ("Cache-Control", "no-cache"),
            ("Upgrade-Insecure-Requests", "1"),
        ],
    )
    .await
    {
        Ok(r) => r,
        Err(_) => return Ok(None),
    };

    // Only parse HTML responses
    let content_type = resp.headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();

    if !content_type.contains("text/html") {
        return Ok(None);
    }

    // Read up to 128 KB — OG tags live in <head> which is usually within 32 KB,
    // but some JS-heavy sites push it further down. Capped so a hostile target
    // can't stream an unbounded body into memory.
    let bytes = crate::net_guard::read_body_capped(resp, 131_072).await?;
    let html = String::from_utf8_lossy(&bytes).into_owned();

    let title = extract_og_tag(&html, "og:title")
        .or_else(|| extract_html_title(&html));
    let description = extract_og_tag(&html, "og:description");
    let image_url = extract_og_tag(&html, "og:image");
    let site_name = extract_og_tag(&html, "og:site_name");

    if title.is_none() && description.is_none() && image_url.is_none() {
        return Ok(None);
    }

    Ok(Some(UrlPreview { title, description, image_url, site_name }))
}

/// Extract a `<meta property="og:…" content="…">` value from HTML.
///
/// Handles:
/// - Both attribute orderings (property before/after content)
/// - Both double-quote and single-quote attribute delimiters
/// - ASCII-case-insensitive matching
fn extract_og_tag(html: &str, property: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let prop_lc = property.to_ascii_lowercase();

    // Build both quote variants of the property needle once.
    let dq_prop = format!("property=\"{}\"", prop_lc);
    let sq_prop = format!("property='{}'", prop_lc);

    let mut search_from = 0;
    loop {
        // Find the earliest occurrence of either quote style.
        let found = [dq_prop.as_str(), sq_prop.as_str()]
            .iter()
            .filter_map(|n| lower[search_from..].find(n).map(|i| i + search_from))
            .min();
        let prop_pos = found?;

        // Walk back to the opening <meta of this tag.
        let tag_start = lower[..prop_pos].rfind("<meta")?;
        // Walk forward to the closing > of this tag.
        let tag_end = lower[prop_pos..].find('>').map(|i| i + prop_pos + 1)
            .unwrap_or(lower.len());

        // Extract the content attribute value (both quote styles).
        let tag_lower = &lower[tag_start..tag_end];
        if let Some(val) = extract_attr(html, tag_lower, tag_start, "content") {
            if !val.is_empty() {
                return Some(decode_html_entities(&val));
            }
        }

        search_from = prop_pos + 1;
    }
}

/// Extract an attribute value from a tag, supporting both `attr="val"` and `attr='val'`.
/// `tag_lower` is the lowercased slice; `tag_start` is its byte offset in the original `html`.
fn extract_attr(html: &str, tag_lower: &str, tag_start: usize, attr: &str) -> Option<String> {
    for (open, close) in [("=\"", '"'), ("='", '\'')] {
        let needle = format!("{}{}", attr, open);
        if let Some(rel_start) = tag_lower.find(&needle) {
            let val_start = tag_start + rel_start + needle.len();
            if let Some(val_len) = html[val_start..].find(close) {
                return Some(html[val_start..val_start + val_len].to_string());
            }
        }
    }
    None
}

/// Extract `<title>` text as a last-resort title source.
fn extract_html_title(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let start = lower.find("<title>")? + 7;
    let end = lower[start..].find("</title>").map(|i| i + start)?;
    let raw = html[start..end].trim();
    if raw.is_empty() { None } else { Some(decode_html_entities(raw)) }
}

/// Decode the most common HTML entities found in OG attribute values.
fn decode_html_entities(s: &str) -> String {
    s.replace("&amp;", "&")
     .replace("&lt;", "<")
     .replace("&gt;", ">")
     .replace("&quot;", "\"")
     .replace("&#39;", "'")
     .replace("&apos;", "'")
     .replace("&nbsp;", " ")
}

// ─── Crypto Commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_verification_status(
    state: State<'_, MatrixState>,
) -> Result<VerificationStatus, String> {
    let client = get_client(&state)?;
    crate::matrix::crypto::get_own_verification_status(&client).await
}

#[tauri::command]
pub async fn start_sas_verification(
    state: State<'_, MatrixState>,
    user_id: String,
    device_id: String,
) -> Result<String, String> {
    let client = get_client(&state)?;
    crate::matrix::crypto::start_sas_verification(&client, &user_id, &device_id).await
}

#[tauri::command]
pub async fn accept_verification_request(
    state: State<'_, MatrixState>,
    user_id: String,
    flow_id: String,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::crypto::accept_verification_request(&client, &user_id, &flow_id).await
}

#[tauri::command]
pub async fn accept_sas_verification(
    state: State<'_, MatrixState>,
    user_id: String,
    flow_id: String,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::crypto::accept_sas_verification(&client, &user_id, &flow_id).await
}

#[tauri::command]
pub async fn confirm_sas_verification(
    state: State<'_, MatrixState>,
    user_id: String,
    flow_id: String,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::crypto::confirm_sas_verification(&client, &user_id, &flow_id).await
}

#[tauri::command]
pub async fn cancel_sas_verification(
    state: State<'_, MatrixState>,
    user_id: String,
    flow_id: String,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::crypto::cancel_sas_verification(&client, &user_id, &flow_id).await
}

#[tauri::command]
pub async fn get_sas_info(
    state: State<'_, MatrixState>,
    user_id: String,
    flow_id: String,
) -> Result<Option<SasInfo>, String> {
    let client = get_client(&state)?;
    crate::matrix::crypto::get_sas_info(&client, &user_id, &flow_id).await
}

#[tauri::command]
pub async fn get_cross_signing_status(
    state: State<'_, MatrixState>,
) -> Result<CrossSigningInfo, String> {
    let client = get_client(&state)?;
    crate::matrix::crypto::get_cross_signing_status(&client).await
}

#[tauri::command]
pub async fn bootstrap_cross_signing(
    state: State<'_, MatrixState>,
    password: Option<String>,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::crypto::bootstrap_cross_signing(&client, password).await
}

#[tauri::command]
pub async fn get_user_devices(
    state: State<'_, MatrixState>,
    user_id: String,
) -> Result<Vec<VerificationStatus>, String> {
    let client = get_client(&state)?;
    crate::matrix::crypto::get_user_verification_statuses(&client, &user_id).await
}

#[tauri::command]
pub async fn list_sessions(
    state: State<'_, MatrixState>,
) -> Result<Vec<crate::matrix::devices::SessionInfo>, String> {
    let client = get_client(&state)?;
    crate::matrix::devices::list_sessions(&client).await
}

/// Decide whether the post-login "verify this session" prompt should be shown,
/// logging the reason at INFO so the decision is visible in the app log.
///
/// Returns `Some(own_user_id)` when the prompt should appear (the caller starts
/// the SAS flow for that user), or `None` to skip. Skips when the user turned the
/// prompt off, this session is already cross-signed, or there is no other device
/// to emoji-compare against. Centralised here (rather than in the frontend) so
/// the gating inputs are read where they live and the skip reason lands in the
/// backend log.
#[tauri::command]
pub async fn verification_prompt_target(
    state: State<'_, MatrixState>,
    config_state: State<'_, Mutex<AppConfig>>,
) -> Result<Option<String>, String> {
    let enabled = {
        let guard = config_state.lock().map_err(|_| "App config lock poisoned")?;
        guard.general.prompt_session_verification
    };
    if !enabled {
        tracing::info!("verification prompt: skipped (disabled in settings)");
        return Ok(None);
    }

    let client = get_client(&state)?;
    let status = crate::matrix::crypto::get_own_verification_status(&client).await?;
    if status.is_cross_signed {
        tracing::info!("verification prompt: skipped (session already cross-signed)");
        return Ok(None);
    }

    let devices =
        crate::matrix::crypto::get_user_verification_statuses(&client, &status.user_id).await?;
    let others = devices.iter().filter(|d| d.device_id != status.device_id).count();
    if others == 0 {
        tracing::info!("verification prompt: skipped (no other device to compare against)");
        return Ok(None);
    }

    tracing::info!(other_devices = others, "verification prompt: showing (session unverified)");
    Ok(Some(status.user_id))
}

/// Record (at INFO) which action the user took on the verify-this-session prompt
/// — "verify", "later", or "never" — so the choice is visible in the app log
/// alongside the show/skip decision above.
#[tauri::command]
pub fn log_verification_prompt_choice(choice: String) {
    tracing::info!(choice = %choice, "verification prompt: user choice");
}

// ─── Spaces Commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_space_hierarchy(
    state: State<'_, MatrixState>,
    space_room_id: String,
    max_depth: Option<u8>,
) -> Result<Vec<SpaceChild>, String> {
    let client = get_client(&state)?;
    crate::matrix::spaces::get_space_hierarchy(&client, &space_room_id, max_depth).await
}

#[tauri::command]
pub async fn get_user_spaces(
    state: State<'_, MatrixState>,
) -> Result<Vec<SpaceChild>, String> {
    let client = get_client(&state)?;
    crate::matrix::spaces::get_user_spaces(&client).await
}

// ─── Profile Commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_own_profile(
    state: State<'_, MatrixState>,
) -> Result<OwnProfile, String> {
    let client = get_client(&state)?;
    crate::matrix::client::get_own_profile(&client).await
}

#[tauri::command]
pub async fn set_display_name(
    state: State<'_, MatrixState>,
    name: String,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::client::set_display_name(&client, name).await
}

/// Upload and set the account avatar from base64 image data. Returns the
/// mxc:// URI.
#[tauri::command]
pub async fn set_avatar(
    state: State<'_, MatrixState>,
    data_base64: String,
    mime: String,
) -> Result<String, String> {
    let client = get_client(&state)?;
    crate::matrix::client::set_avatar(&client, &data_base64, &mime).await
}

/// The `limit` most recently active 1:1 DMs with latest-message previews,
/// for the Home view.
#[tauri::command]
pub async fn get_home_data(
    state: State<'_, MatrixState>,
    recency: State<'_, crate::matrix::rooms::RecencyState>,
    last_events: State<'_, crate::matrix::rooms::LastEventCache>,
    limit: u32,
) -> Result<Vec<crate::matrix::rooms::HomeDmInfo>, String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::get_home_data(&client, &recency, &last_events, limit as usize).await
}

#[tauri::command]
pub async fn invite_user(
    state: State<'_, MatrixState>,
    room_id: String,
    user_id: String,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::invite_user(&client, &room_id, &user_id).await
}

#[tauri::command]
pub async fn kick_user(
    state: State<'_, MatrixState>,
    room_id: String,
    user_id: String,
    reason: Option<String>,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::kick_user(&client, &room_id, &user_id, reason.as_deref()).await
}

#[tauri::command]
pub async fn ban_user(
    state: State<'_, MatrixState>,
    room_id: String,
    user_id: String,
    reason: Option<String>,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::ban_user(&client, &room_id, &user_id, reason.as_deref()).await
}

#[tauri::command]
pub async fn unban_user(
    state: State<'_, MatrixState>,
    room_id: String,
    user_id: String,
) -> Result<(), String> {
    let client = get_client(&state)?;
    crate::matrix::rooms::unban_user(&client, &room_id, &user_id).await
}

#[tauri::command]
pub async fn set_presence_status(
    state: State<'_, MatrixState>,
    status_msg: String,
) -> Result<(), String> {
    use matrix_sdk::ruma::{
        api::client::presence::set_presence::v3::Request as SetPresenceRequest,
        presence::PresenceState,
    };
    let client = get_client(&state)?;
    let user_id = client
        .user_id()
        .ok_or_else(|| "Not logged in".to_string())?
        .to_owned();
    let mut req = SetPresenceRequest::new(user_id, PresenceState::Online);
    req.status_msg = if status_msg.is_empty() { None } else { Some(status_msg) };
    client
        .send(req, None)
        .await
        .map_err(|e| format!("Failed to set presence: {e}"))?;
    Ok(())
}

/// Presence state for a user, returned by `get_presence_status`.
#[derive(Debug, Serialize, Deserialize)]
pub struct PresenceInfo {
    pub user_id: String,
    pub presence: String,
    pub status_msg: Option<String>,
}

#[tauri::command]
pub async fn get_presence_status(
    state: State<'_, MatrixState>,
    user_id: String,
) -> Result<PresenceInfo, String> {
    use matrix_sdk::ruma::{
        api::client::presence::get_presence::v3::Request as GetPresenceRequest,
        OwnedUserId,
    };
    let client = get_client(&state)?;
    let uid: OwnedUserId = user_id
        .parse()
        .map_err(|e| format!("Invalid user ID: {e}"))?;
    let req = GetPresenceRequest::new(uid);
    let resp = client
        .send(req, None)
        .await
        .map_err(|e| format!("Failed to fetch presence: {e}"))?;
    Ok(PresenceInfo {
        user_id,
        presence: resp.presence.to_string(),
        status_msg: resp.status_msg,
    })
}

// ─── Thread Commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_thread_roots(
    state: State<'_, MatrixState>,
    room_id: String,
) -> Result<Vec<ThreadRoot>, String> {
    let client = get_client(&state)?;
    crate::matrix::threads::get_thread_roots(&client, &room_id).await
}

#[tauri::command]
pub async fn get_thread_timeline(
    state: State<'_, MatrixState>,
    room_id: String,
    thread_root_event_id: String,
) -> Result<Vec<TimelineEvent>, String> {
    let client = get_client(&state)?;
    crate::matrix::threads::get_thread_timeline(&client, &room_id, &thread_root_event_id).await
}

#[tauri::command]
pub async fn send_thread_reply(
    state: State<'_, MatrixState>,
    room_id: String,
    thread_root_event_id: String,
    body: String,
    formatted_body: Option<String>,
) -> Result<String, String> {
    let client = get_client(&state)?;
    crate::matrix::threads::send_thread_reply(
        &client,
        &room_id,
        &thread_root_event_id,
        &body,
        formatted_body.as_deref(),
    )
    .await
}

// ─── GIF Commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn search_gifs(
    query: String,
    provider: String,
    api_key: String,
    limit: Option<u32>,
    rating: Option<String>,
) -> Result<Vec<GifResult>, String> {
    use crate::gif::GifProvider;

    let limit = limit.unwrap_or(20);
    let rating_str = rating.as_deref().unwrap_or("pg");

    match provider.as_str() {
        "tenor" => {
            let client = crate::gif::tenor::TenorClient::new(api_key);
            client.search(&query, limit, rating_str).await
        }
        "giphy" => {
            let client = crate::gif::giphy::GiphyClient::new(api_key);
            client.search(&query, limit, rating_str).await
        }
        "klipy" => {
            let client = crate::gif::klipy::KlipyClient::new(api_key);
            client.search(&query, limit, rating_str).await
        }
        other => Err(format!("Unknown GIF provider: '{}'", other)),
    }
}

/// Parse the pixel dimensions from the GIF header (logical screen descriptor).
///
/// A GIF starts with the 6-byte signature "GIF87a"/"GIF89a" followed by the
/// logical screen width and height as little-endian u16s. GIF providers (and
/// remote clients) frequently omit dimensions, leaving the frontend to reserve
/// no layout space and jump as the image decodes — so we read them straight
/// from the bytes we already downloaded. Returns None if the data isn't a GIF
/// or the dimensions are zero.
fn gif_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 10 || &bytes[0..3] != b"GIF" {
        return None;
    }
    let w = u16::from_le_bytes([bytes[6], bytes[7]]) as u32;
    let h = u16::from_le_bytes([bytes[8], bytes[9]]) as u32;
    if w == 0 || h == 0 {
        None
    } else {
        Some((w, h))
    }
}

/// Download a GIF from an external URL, upload it to the homeserver, and send
/// it as an `m.image` event. This avoids leaking external URLs to recipients.
#[tauri::command]
pub async fn send_gif(
    state: State<'_, MatrixState>,
    room_id: String,
    gif_url: String,
    title: String,
    width: u32,
    height: u32,
) -> Result<String, String> {
    let client = get_client(&state)?;

    // Download GIF bytes from the external URL.
    let http = reqwest::Client::new();
    let response = http
        .get(&gif_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download GIF: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("GIF download failed: HTTP {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read GIF bytes: {e}"))?
        .to_vec();

    // Prefer dimensions probed from the actual bytes — providers often pass 0×0
    // (e.g. when no HD rendition metadata is available), which would leave the
    // recipient's client with no layout space to reserve. Fall back to the
    // caller's values only when they're non-zero, else send None. Computed
    // before the upload moves `bytes`.
    let (w, h) = match gif_dimensions(&bytes) {
        Some((w, h)) => (Some(w as u64), Some(h as u64)),
        None if width > 0 && height > 0 => (Some(width as u64), Some(height as u64)),
        None => (None, None),
    };

    // Upload to the homeserver and get an mxc:// URL.
    let mxc_url = crate::matrix::media::upload_media(
        &client,
        bytes,
        "image/gif",
        Some(&format!("{title}.gif")),
    )
    .await?;

    // Send as m.image event.
    crate::matrix::timeline::send_image(&client, &room_id, &title, &mxc_url, "image/gif", w, h)
        .await
}

#[cfg(test)]
mod tests {
    use super::gif_dimensions;

    /// Minimal GIF header: "GIF89a" + logical screen width/height as LE u16.
    fn gif_header(w: u16, h: u16) -> Vec<u8> {
        let mut b = b"GIF89a".to_vec();
        b.extend_from_slice(&w.to_le_bytes());
        b.extend_from_slice(&h.to_le_bytes());
        b.extend_from_slice(&[0u8; 4]); // packed fields etc. — unused by the parser
        b
    }

    #[test]
    fn reads_dimensions_from_header() {
        assert_eq!(gif_dimensions(&gif_header(480, 270)), Some((480, 270)));
        assert_eq!(gif_dimensions(&gif_header(1, 1)), Some((1, 1)));
    }

    #[test]
    fn rejects_non_gif_or_zero_or_truncated() {
        assert_eq!(gif_dimensions(b"PNG\x89 not a gif here"), None);
        assert_eq!(gif_dimensions(&gif_header(0, 200)), None);
        assert_eq!(gif_dimensions(&gif_header(200, 0)), None);
        assert_eq!(gif_dimensions(b"GIF"), None); // too short
        assert_eq!(gif_dimensions(&[]), None);
    }
}

// ─── App Config Commands ──────────────────────────────────────────────────────

/// Return the current application configuration.
#[tauri::command]
pub async fn get_app_config(
    config_state: State<'_, Mutex<AppConfig>>,
) -> Result<AppConfig, String> {
    let guard = config_state.lock().map_err(|_| "App config lock poisoned")?;
    Ok(guard.clone())
}

/// Persist updated application configuration to disk and update in-memory state.
/// Also syncs the media cache size limit when `media.cache_size_mb` changes.
#[tauri::command]
pub async fn set_app_config(
    config_state: State<'_, Mutex<AppConfig>>,
    cache_state: State<'_, CacheState>,
    paths: State<'_, crate::Paths>,
    config: AppConfig,
) -> Result<(), String> {
    let path = crate::config::app_config::config_path_in(&paths.config_dir);
    crate::config::app_config::save_app_config_to(&path, &config)?;
    let new_cache_mb = config.media.cache_size_mb;
    let mut guard = config_state.lock().map_err(|_| "App config lock poisoned")?;
    *guard = config;
    drop(guard);
    // Sync MediaCache size limit in case it changed.
    let _ = cache_state.0.set_max_size_mb(new_cache_mb);
    Ok(())
}

/// Check the user's configured channel for an available update. Returns
/// metadata when one exists (the `Update` itself is stashed in `UpdaterState`
/// for `update_install`), `None` when up to date. Desktop-only.
#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    config_state: State<'_, Mutex<AppConfig>>,
    updater_state: State<'_, crate::updater::UpdaterState>,
) -> Result<Option<crate::updater::UpdateInfo>, String> {
    let channel = {
        let guard = config_state.lock().map_err(|_| "App config lock poisoned")?;
        guard.updater.channel
    };
    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
    {
        crate::updater::check(&app, channel, &updater_state).await
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        let _ = (&app, channel, &updater_state);
        Err("auto-update is desktop-only".into())
    }
}

/// Download + install the pending update (from the last `update_check`), then
/// relaunch the app. Desktop-only.
#[tauri::command]
pub async fn update_install(
    app: AppHandle,
    updater_state: State<'_, crate::updater::UpdaterState>,
) -> Result<(), String> {
    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
    {
        crate::updater::install(&app, &updater_state).await
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        let _ = (&app, &updater_state);
        Err("auto-update is desktop-only".into())
    }
}

// ─── Config Commands ──────────────────────────────────────────────────────────

/// Load a theme file and return it as a JSON value.
///
/// The TOML is parsed leniently — only valid TOML syntax is required; missing
/// theme fields are fine because the TypeScript `applyTheme` already handles
/// partial data (all fields optional).  Strict per-field color validation
/// (validate_theme) is NOT run here: bad values just fall back to CSS defaults
/// on the frontend, which is better UX than blocking with an error.
#[tauri::command]
pub async fn load_theme(theme_path: String) -> Result<serde_json::Value, String> {
    let path = Path::new(&theme_path);
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read theme file '{}': {e}", path.display()))?;
    let toml_val: toml::Value = toml::from_str(&content)
        .map_err(|e| format!("Failed to parse theme TOML: {e}"))?;
    serde_json::to_value(&toml_val)
        .map_err(|e| format!("Failed to convert theme to JSON: {e}"))
}

/// A custom theme entry returned by `list_custom_themes`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomThemeEntry {
    /// Display name from the [meta] section of the TOML file.
    pub name: String,
    /// Absolute path to the .toml file on disk.
    pub path: String,
}

/// Lenient TOML shape used only for extracting a display name from a theme
/// file without requiring every field to be present.
#[derive(Deserialize)]
struct PartialThemeMeta {
    name: Option<String>,
}
#[derive(Deserialize)]
struct PartialTheme {
    meta: Option<PartialThemeMeta>,
}

/// Scan `<config_dir>/themes/` for *.toml files and return their names and
/// paths.  Every .toml file is included regardless of whether it is a complete
/// valid theme — display name falls back to the filename stem when the [meta]
/// table is absent.  Full validation happens later when the user clicks Apply.
#[tauri::command]
pub async fn list_custom_themes(
    paths: State<'_, crate::Paths>,
) -> Result<Vec<CustomThemeEntry>, String> {
    let themes_dir = paths.config_dir.join("themes");

    if !themes_dir.exists() {
        return Ok(vec![]);
    }

    let mut entries = Vec::new();
    let read = std::fs::read_dir(&themes_dir)
        .map_err(|e| format!("Failed to read themes directory: {e}"))?;

    for entry in read.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("toml") {
            continue;
        }

        // Try a lenient parse just to get the display name; fall back to the
        // filename stem so even incomplete themes appear in the list.
        let display_name = std::fs::read_to_string(&path)
            .ok()
            .and_then(|content| toml::from_str::<PartialTheme>(&content).ok())
            .and_then(|t| t.meta)
            .and_then(|m| m.name)
            .unwrap_or_else(|| {
                path.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown")
                    .to_string()
            });

        entries.push(CustomThemeEntry {
            name: display_name,
            path: path.to_string_lossy().into_owned(),
        });
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

#[tauri::command]
pub async fn parse_quarkrc(content: String) -> Result<ParsedRc, String> {
    Ok(crate::config::quarkrc::parse_quarkrc(&content))
}

/// Load and parse the user's quarkrc from the resolved config dir.
/// Returns an empty ParsedRc if the file does not exist.
#[tauri::command]
pub async fn load_quarkrc(paths: State<'_, crate::Paths>) -> Result<ParsedRc, String> {
    let rc_path = paths.config_dir.join("quarkrc");

    if !rc_path.exists() {
        return Ok(ParsedRc { directives: vec![], errors: vec![] });
    }

    let content = std::fs::read_to_string(&rc_path)
        .map_err(|e| format!("Failed to read quarkrc: {}", e))?;

    Ok(crate::config::quarkrc::parse_quarkrc(&content))
}

// ─── Cache Management Commands ────────────────────────────────────────────────

/// Return aggregate statistics about the on-disk media cache.
#[tauri::command]
pub async fn get_cache_stats(
    cache_state: State<'_, CacheState>,
) -> Result<CacheStats, String> {
    Ok(cache_state.0.stats())
}

/// Wipe all entries from the media cache.
#[tauri::command]
pub async fn clear_media_cache(
    cache_state: State<'_, CacheState>,
) -> Result<(), String> {
    cache_state.0.clear()
}

/// Update the maximum cache size. Evicts LRU entries if the current size exceeds the new limit.
#[tauri::command]
pub async fn set_cache_size_limit(
    cache_state: State<'_, CacheState>,
    size_mb: u64,
) -> Result<(), String> {
    cache_state.0.set_max_size_mb(size_mb)
}

/// On-disk size of the matrix-sdk event-cache store, split into the main SQLite
/// DB and its `-wal`/`-shm` sidecars. Returns `(main_bytes, sidecar_bytes)`.
fn event_cache_store_bytes(app_handle: &AppHandle) -> Result<(u64, u64), String> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve data dir: {e}"))?;
    let size_of = |suffix: &str| -> u64 {
        let path = data_dir.join(format!("matrix-sdk-event-cache.sqlite3{suffix}"));
        std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0)
    };
    let main = size_of("");
    let sidecars = size_of("-wal") + size_of("-shm");
    Ok((main, sidecars))
}

/// On-disk size of the matrix-sdk event-cache store (the SQLite DB that
/// server-side search persists scanned events into). Sums the main DB plus its
/// `-wal`/`-shm` sidecars. This is typically the largest local store, and grows
/// with deep history searches — surfaced so the user can clear it.
#[tauri::command]
pub async fn get_event_cache_size(
    app_handle: AppHandle,
    index_state: State<'_, crate::search_index::SearchIndexState>,
) -> Result<u64, String> {
    let (main, sidecars) = event_cache_store_bytes(&app_handle)?;
    // Include the search index — it's the other half of the on-disk "search
    // cache" and grows with indexed history, so the Settings readout should
    // reflect both.
    let index_bytes = index_state.get().map(|idx| idx.size_bytes()).unwrap_or(0);
    Ok(main + sidecars + index_bytes)
}

/// Global, on-demand diagnostics snapshot of the event cache: how much is
/// actually cached (events / rooms) alongside the on-disk store size. Used by
/// the `:debug cache` viewer and the Settings cache summary so cache behaviour
/// (e.g. "did search populate the cache?") is debuggable.
#[derive(Serialize)]
pub struct EventCacheDiagnostics {
    /// `matrix-sdk-event-cache.sqlite3` main DB size in bytes.
    store_main_bytes: u64,
    /// `-wal` + `-shm` sidecar size in bytes.
    store_wal_bytes: u64,
    /// main + sidecars.
    store_total_bytes: u64,
    /// Joined rooms (the population we inspect).
    rooms_total: usize,
    /// Joined rooms that currently hold at least one cached event.
    rooms_with_cached_events: usize,
    /// Total cached events summed across all joined rooms.
    total_cached_events: usize,
}

/// Build an [`EventCacheDiagnostics`] snapshot. Iterates joined rooms and reads
/// each room's cached event count via the same `event_cache().subscribe()`
/// pattern message search uses; per-room errors are skipped (best-effort) so one
/// bad room can't fail the whole snapshot. Note this subscribes each room's
/// cache into memory, which is acceptable for an on-demand debug command.
#[tauri::command]
pub async fn get_event_cache_diagnostics(
    state: State<'_, MatrixState>,
    app_handle: AppHandle,
) -> Result<EventCacheDiagnostics, String> {
    let client = get_client(&state)?;
    let (store_main_bytes, store_wal_bytes) = event_cache_store_bytes(&app_handle)?;

    let rooms = client.joined_rooms();
    let rooms_total = rooms.len();
    let mut rooms_with_cached_events = 0usize;
    let mut total_cached_events = 0usize;

    for room in rooms {
        let Ok((room_cache, _drop_handles)) = room.event_cache().await else {
            continue;
        };
        let Ok((events, _updates)) = room_cache.subscribe().await else {
            continue;
        };
        if !events.is_empty() {
            rooms_with_cached_events += 1;
            total_cached_events += events.len();
        }
    }

    Ok(EventCacheDiagnostics {
        store_main_bytes,
        store_wal_bytes,
        store_total_bytes: store_main_bytes + store_wal_bytes,
        rooms_total,
        rooms_with_cached_events,
        total_cached_events,
    })
}

/// Per-room event-cache footprint (cached event count + estimated bytes +
/// timestamp range) for the current room shown in the `:debug cache` viewer.
#[tauri::command]
pub async fn get_room_cache_diagnostics(
    state: State<'_, MatrixState>,
    room_id: String,
) -> Result<crate::matrix::timeline::RoomCacheDiagnostics, String> {
    let client = get_client(&state)?;
    crate::matrix::timeline::room_cache_diagnostics(&client, &room_id).await
}

/// Clear the matrix-sdk event-cache store. The event cache only backs
/// server-side search now (the live timeline uses raw `room.messages()`), so
/// this is a safe, rebuildable cache to wipe — it just means the next search
/// re-fetches from the homeserver. Clears the persisted chunks at the store
/// level, with no per-room reload.
///
/// Notes: (1) SQLite frees the pages for reuse but doesn't shrink the file on
/// disk until it's compacted on a later restart, so the on-disk size may not
/// drop immediately even though the content is gone. (2) Rooms whose cache was
/// already loaded into memory this session keep that copy until restart; the
/// persisted store is what's wiped.
#[tauri::command]
pub async fn clear_event_cache(
    state: State<'_, MatrixState>,
    index_state: State<'_, crate::search_index::SearchIndexState>,
) -> Result<(), String> {
    let client = get_client(&state)?;
    let store = client.event_cache_store();
    let locked = store
        .lock()
        .await
        .map_err(|e| format!("Event cache store lock failed: {e}"))?;
    locked
        .clear_all_rooms_chunks()
        .await
        .map_err(|e| format!("Failed to clear event cache: {e}"))?;
    // Also wipe the search index — it's the other half of the "search cache" and
    // would otherwise keep serving (now-orphaned) results. Rooms drop back to
    // re-scanning until indexed again.
    if let Some(idx) = index_state.get() {
        if let Err(e) = idx.clear() {
            tracing::warn!("failed to clear search index: {e}");
        }
    }
    Ok(())
}

// ─── Notification Commands ────────────────────────────────────────────────────

/// Return the current notification configuration.
#[tauri::command]
pub async fn get_notification_config(
    config_state: State<'_, Mutex<NotificationConfig>>,
) -> Result<NotificationConfig, String> {
    let guard = config_state.lock().map_err(|_| "Notification config lock poisoned")?;
    Ok(guard.clone())
}

/// Replace the current notification configuration and persist it to disk.
#[tauri::command]
pub async fn set_notification_config(
    config_state: State<'_, Mutex<NotificationConfig>>,
    paths: State<'_, crate::Paths>,
    config: NotificationConfig,
) -> Result<(), String> {
    crate::notifications::save_notification_config_to(&paths.config_dir, &config)?;
    let mut guard = config_state.lock().map_err(|_| "Notification config lock poisoned")?;
    *guard = config;
    Ok(())
}

/// Add a room to the mute list so notifications from it are suppressed.
#[tauri::command]
pub async fn mute_room(
    config_state: State<'_, Mutex<NotificationConfig>>,
    room_id: String,
) -> Result<(), String> {
    let mut guard = config_state.lock().map_err(|_| "Notification config lock poisoned")?;
    if !guard.mute_rooms.contains(&room_id) {
        guard.mute_rooms.push(room_id);
    }
    Ok(())
}

/// Remove a room from the mute list.
#[tauri::command]
pub async fn unmute_room(
    config_state: State<'_, Mutex<NotificationConfig>>,
    room_id: String,
) -> Result<(), String> {
    let mut guard = config_state.lock().map_err(|_| "Notification config lock poisoned")?;
    guard.mute_rooms.retain(|r| r != &room_id);
    Ok(())
}

/// Create the Android notification channels (Messages / Mentions / Background
/// sync). No-op on other platforms. Invoked from the frontend's notification
/// init rather than app setup, because the mobile plugin's Kotlin side only
/// becomes callable once the webview has loaded.
#[tauri::command]
pub async fn init_notification_channels(app_handle: AppHandle) -> Result<(), String> {
    crate::notify::setup_channels(&app_handle);
    Ok(())
}

/// Dismiss all live OS notifications for a room (e.g. when it's opened
/// locally; the read-receipt sync path covers reads from other devices).
#[tauri::command]
pub async fn clear_room_notifications(
    app_handle: AppHandle,
    room_id: String,
) -> Result<(), String> {
    crate::notify::cancel_room(&app_handle, &room_id);
    Ok(())
}

/// Enable or disable background sync: persists the choice in the notification
/// config and starts/stops the Android foreground service to match. On
/// platforms without the service this only persists the flag.
#[tauri::command]
pub async fn set_background_sync(
    app_handle: AppHandle,
    config_state: State<'_, Mutex<NotificationConfig>>,
    paths: State<'_, crate::Paths>,
    enabled: bool,
) -> Result<(), String> {
    {
        let mut guard = config_state
            .lock()
            .map_err(|_| "Notification config lock poisoned")?;
        guard.background_sync = enabled;
        let snapshot = guard.clone();
        crate::notifications::save_notification_config_to(&paths.config_dir, &snapshot)?;
    }
    crate::mobile_sync::apply(&app_handle, enabled)
}

/// Current background-sync state for the Settings UI.
#[tauri::command]
pub async fn get_background_sync_state(
    app_handle: AppHandle,
    config_state: State<'_, Mutex<NotificationConfig>>,
) -> Result<crate::mobile_sync::BackgroundSyncState, String> {
    let enabled = config_state
        .lock()
        .map_err(|_| "Notification config lock poisoned")?
        .background_sync;
    Ok(crate::mobile_sync::state(&app_handle, enabled))
}

/// Surface the Android battery-optimization exemption prompt (no-op elsewhere).
#[tauri::command]
pub async fn request_battery_exemption(app_handle: AppHandle) -> Result<(), String> {
    crate::mobile_sync::request_battery_exemption(&app_handle)
}

/// Read-and-delete the cold-start notification action MainActivity captured
/// (Android only — see `notify::PendingNotificationAction`). The frontend
/// calls this at boot to replay a tap that arrived before its listener was
/// registered, and after warm taps to discard the duplicate file.
#[tauri::command]
pub async fn take_pending_notification_action(
    app_handle: AppHandle,
) -> Result<Option<crate::notify::PendingNotificationAction>, String> {
    #[cfg(target_os = "android")]
    {
        let path = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join(crate::notify::PENDING_ACTION_FILENAME);
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        Ok(crate::notify::take_pending_action_from(&path, now_ms))
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app_handle;
        Ok(None)
    }
}

/// Send a test OS notification to verify the system is working.
#[tauri::command]
pub async fn test_notification(app_handle: AppHandle) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app_handle
        .notification()
        .builder()
        .title("Quark")
        .body("Notifications are working!")
        .show()
        .map_err(|e| format!("Failed to send test notification: {e}"))
}

// ─── Shell Commands ──────────────────────────────────────────────────────────

/// Open an http(s) URL in the system browser.
///
/// Wraps `tauri-plugin-shell`'s `Shell::open` because the plugin's mobile JS
/// surface (`plugin:shell|open`) is broken on iOS and Android: the Swift /
/// Kotlin plugins call `parseArgs(String)` expecting a raw JSON string, but
/// `@tauri-apps/plugin-shell` (and the equivalent raw `invoke`) sends
/// `{ path, with }`, which fails to decode. Going through the Rust API
/// serializes the URL as a raw string, which the mobile plugins accept.
#[tauri::command]
pub async fn open_external_url(app_handle: AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;

    // Only hand safe, web-style schemes to the OS opener. This is reachable from
    // message links, so the gate must live here, not only in the (bypassable)
    // frontend: `file:`, `javascript:`, `data:`, and OS-specific custom-protocol
    // handlers must never make it to `shell().open`. (`matrix:`/`mxc:` survive
    // HTML sanitization but aren't externally openable resources, so they're
    // dropped here too.)
    let scheme = url::Url::parse(&url)
        .map_err(|_| "Invalid URL".to_string())?
        .scheme()
        .to_ascii_lowercase();
    if !matches!(scheme.as_str(), "http" | "https" | "mailto" | "ftp" | "magnet") {
        return Err(format!("refusing to open URL with scheme '{scheme}'"));
    }

    #[allow(deprecated)]
    app_handle.shell().open(url, None).map_err(|e| e.to_string())
}
