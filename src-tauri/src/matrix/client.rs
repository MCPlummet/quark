use matrix_sdk::{
    config::SyncSettings,
    ruma::{
        api::client::filter::{FilterDefinition, RoomEventFilter, RoomFilter},
        presence::PresenceState,
        UInt,
    },
    Client,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Emitter;
use tokio::task::JoinHandle;
use tracing::{error, info, warn};

/// Tauri state holding the Matrix client.
pub struct MatrixState(pub Mutex<Option<Client>>);

/// Tauri state holding the sync loop handle so we can prevent duplicate loops,
/// and a flag to track whether event handlers have been registered on the client
/// (since `client.add_event_handler()` accumulates — calling it again would
/// produce duplicate callbacks for every sync event).
pub struct SyncState {
    pub handle: Mutex<Option<JoinHandle<()>>>,
    pub handlers_registered: Mutex<bool>,
}

/// Tauri state holding the cancel flag for an in-progress server-side message
/// search. `search_room_messages` resets it on start and checks it each page;
/// `cancel_room_search` sets it to request an early stop.
#[derive(Default)]
pub struct SearchState(pub std::sync::atomic::AtomicBool);

/// Serializes event-cache back-pagination used by server-side search. The
/// matrix-sdk `RoomPagination` is a single per-room resource; overlapping
/// `run_backwards` calls error with "expected Idle, observed Paginating".
/// Searches set the cancel flag first (to stop any in-flight scan promptly)
/// then acquire this lock, so only one scan paginates the cache at a time.
#[derive(Default)]
pub struct PaginationLock(pub tokio::sync::Mutex<()>);

/// Per-room backward-pagination token for the live timeline. The initial-open
/// and "load older" commands fetch history with the raw `room.messages()` API
/// (transient, bounded — it does *not* persist into the event cache, so a room's
/// first open never deserializes a search-bloated cache). This map remembers the
/// `prev_batch` token between an `open_room_timeline` and subsequent
/// `load_older_timeline` calls. `None` value = start of history reached.
#[derive(Default)]
pub struct TimelineTokens(pub tokio::sync::Mutex<std::collections::HashMap<String, Option<String>>>);

/// Serializable session info for persistence.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub user_id: String,
    pub device_id: String,
    pub access_token: String,
    pub homeserver_url: String,
}

/// Build a Matrix client with an **encrypted** SQLite store at the given data
/// directory. `store_key` is the passphrase matrix-sdk uses to encrypt the
/// sensitive values in the state/crypto/event-cache stores at rest (room keys,
/// cross-signing secrets, cached event bodies, …). It must be a stable,
/// high-entropy value sourced from the OS keyring (see `crate::secrets`); the
/// same key has to be supplied on every open or the store won't decrypt.
pub async fn build_client(
    homeserver_url: &str,
    data_dir: PathBuf,
    store_key: &str,
) -> Result<Client, String> {
    let homeserver = homeserver_url
        .parse::<url::Url>()
        .map_err(|e| format!("Invalid homeserver URL: {e}"))?;

    let client = Client::builder()
        .homeserver_url(homeserver)
        .sqlite_store(&data_dir, Some(store_key))
        .build()
        .await
        .map_err(|e| format!("Failed to build Matrix client: {e}"))?;

    Ok(client)
}

/// Human-readable device name reported to the homeserver at login, so this
/// session is recognizable in device lists / the verification picker, e.g.
/// "Quark (macOS)", "Quark (Linux-Flatpak)", "Quark (Linux-AppImage)". The
/// platform comes from the build target; on Linux a packaging suffix is added
/// for the sandboxed/portable formats that can be identified at runtime
/// (Flatpak/AppImage/Snap). The native deb and rpm packages are produced from a
/// single shared binary in CI and install to the same prefix, so they can't be
/// told apart — both report plain "Quark (Linux)".
fn device_display_name() -> String {
    let platform = if cfg!(target_os = "macos") {
        "macOS"
    } else if cfg!(target_os = "windows") {
        "Windows"
    } else if cfg!(target_os = "ios") {
        "iOS"
    } else if cfg!(target_os = "android") {
        "Android"
    } else if cfg!(target_os = "linux") {
        "Linux"
    } else {
        "Unknown"
    };

    #[cfg(target_os = "linux")]
    {
        if let Some(suffix) = linux_packaging_suffix() {
            return format!("Quark ({platform}-{suffix})");
        }
    }

    format!("Quark ({platform})")
}

/// Detect sandboxed/portable Linux packaging at runtime. Native deb/rpm share a
/// single binary (bundled together in CI) and install to the same prefix, so
/// they can't be identified here and fall through to `None` → plain "Linux".
#[cfg(target_os = "linux")]
fn linux_packaging_suffix() -> Option<String> {
    use std::path::Path;
    if Path::new("/.flatpak-info").exists() || std::env::var_os("FLATPAK_ID").is_some() {
        return Some("Flatpak".to_string());
    }
    if std::env::var_os("APPIMAGE").is_some() {
        return Some("AppImage".to_string());
    }
    if std::env::var_os("SNAP").is_some() {
        return Some("Snap".to_string());
    }
    None
}

/// Perform a password login and return session info.
pub async fn login_with_password(
    client: &Client,
    username: &str,
    password: &str,
) -> Result<SessionInfo, String> {
    let device_name = device_display_name();
    let response = client
        .matrix_auth()
        .login_username(username, password)
        .initial_device_display_name(&device_name)
        .send()
        .await
        .map_err(|e| format!("Login failed: {e}"))?;

    let session = SessionInfo {
        user_id: response.user_id.to_string(),
        device_id: response.device_id.to_string(),
        access_token: response.access_token.clone(),
        homeserver_url: client.homeserver().to_string(),
    };

    info!(user_id = %session.user_id, "Logged in successfully");
    Ok(session)
}

/// Restore a previous session from saved credentials.
pub async fn restore_session_from_info(
    client: &Client,
    session: &SessionInfo,
) -> Result<(), String> {
    use matrix_sdk::matrix_auth::MatrixSession;
    use matrix_sdk::ruma::{OwnedDeviceId, OwnedUserId, UserId};

    let user_id: OwnedUserId = UserId::parse(&session.user_id)
        .map_err(|e| format!("Invalid user_id: {e}"))?;
    let device_id: OwnedDeviceId = session.device_id.as_str().into();

    let matrix_session = MatrixSession {
        meta: matrix_sdk::SessionMeta {
            user_id,
            device_id,
        },
        tokens: matrix_sdk::matrix_auth::MatrixSessionTokens {
            access_token: session.access_token.clone(),
            refresh_token: None,
        },
    };

    client
        .restore_session(matrix_session)
        .await
        .map_err(|e| format!("Failed to restore session: {e}"))?;

    info!(user_id = %session.user_id, "Session restored successfully");
    Ok(())
}

/// Own user profile info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OwnProfile {
    pub user_id: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
}

/// Fetch the current user's own profile (display name + avatar URL).
pub async fn get_own_profile(client: &Client) -> Result<OwnProfile, String> {
    let user_id = client
        .user_id()
        .ok_or("Not logged in")?
        .to_string();

    let display_name = client
        .account()
        .get_display_name()
        .await
        .map_err(|e| format!("Failed to get display name: {e}"))?;

    let avatar_url = client
        .account()
        .get_avatar_url()
        .await
        .ok()
        .flatten()
        .map(|u| u.to_string());

    Ok(OwnProfile {
        user_id,
        display_name,
        avatar_url,
    })
}

/// Set the current user's display name.
pub async fn set_display_name(client: &Client, name: String) -> Result<(), String> {
    client
        .account()
        .set_display_name(Some(&name))
        .await
        .map_err(|e| format!("Failed to set display name: {e}"))
}

/// Upload a new avatar image and set it as the account avatar. Returns the
/// mxc:// URI (`Account::upload_avatar` performs both steps in matrix-sdk 0.9).
pub async fn set_avatar(
    client: &Client,
    data_base64: &str,
    mime: &str,
) -> Result<String, String> {
    let bytes = crate::matrix::media::from_base64(data_base64)?;
    let content_type: mime::Mime = mime
        .parse()
        .map_err(|e| format!("Invalid mime type {mime:?}: {e}"))?;
    let mxc = client
        .account()
        .upload_avatar(&content_type, bytes)
        .await
        .map_err(|e| format!("Failed to upload avatar: {e}"))?;
    Ok(mxc.to_string())
}

/// Maximum backoff duration on sync errors (2 minutes).
const MAX_BACKOFF_SECS: u64 = 120;

/// The sync token persisted in the state store, if any.
///
/// Read straight from the store rather than trusting the client's in-memory
/// copy: when that copy is unset, `sync` and `sync_once` silently fall back to
/// an *initial* sync. On the push path that was the difference between a 42-byte
/// response and 2.6 MiB, and nothing about the outcome revealed which had
/// happened.
pub async fn stored_sync_token(client: &Client) -> Option<String> {
    client
        .store()
        .get_kv_data(matrix_sdk_base::StateStoreDataKey::SyncToken)
        .await
        .ok()
        .flatten()
        .and_then(|value| value.into_sync_token())
}

/// The sync filter used by **every** sync this app performs.
///
/// Shared rather than duplicated because a sync token is produced *under a
/// filter*, and presenting that token with a different filter makes the server
/// treat each room's timeline as limited and re-send a chunk of history. When
/// the push path used `SyncSettings::default()` here, one wake pulled 274
/// events spanning six months across every joined room — invisible to the user
/// (the read-marker filter dropped them all) but paid for in battery and in
/// load on a homeserver this app has overwhelmed before.
///
/// The timeline limit bounds a genuine initial sync; incremental syncs only
/// carry new events regardless.
pub fn sync_filter() -> FilterDefinition {
    let mut timeline_filter = RoomEventFilter::default();
    timeline_filter.limit = Some(UInt::from(20u32));

    let mut room_filter = RoomFilter::default();
    room_filter.timeline = timeline_filter;

    let mut filter = FilterDefinition::default();
    filter.room = room_filter;
    filter
}

/// Start a background sync task. Returns immediately; sync runs in background.
///
/// If a sync loop is already running (tracked via `SyncState`), it is aborted
/// before spawning a new one — this prevents duplicate loops that would flood
/// the homeserver with concurrent E2EE key uploads.
///
/// If an `app_handle` is provided, sync event handlers are registered before
/// the sync loop starts so the frontend receives push notifications for new
/// messages, typing indicators, and other sync events.
/// Listen for newly-received room keys (e.g. after verification or key-backup
/// restore) and forward the affected room IDs to the frontend so it can retry
/// decryption of any room it's showing. The base event cache doesn't re-decrypt
/// stored events when keys arrive, so this is what makes a displayed room
/// refresh from `🔒 unable to decrypt` to plaintext without a manual re-open.
fn spawn_room_key_listener(client: Client, app_handle: tauri::AppHandle) {
    use futures_util::StreamExt;
    tokio::spawn(async move {
        let Some(mut stream) = client.encryption().room_keys_received_stream().await else {
            warn!("room_keys_received_stream unavailable (no olm machine)");
            return;
        };
        while let Some(update) = stream.next().await {
            let Ok(infos) = update else { continue }; // lagged broadcast — skip
            let mut room_ids: Vec<String> = infos.into_iter().map(|i| i.room_id.to_string()).collect();
            room_ids.sort();
            room_ids.dedup();
            if room_ids.is_empty() {
                continue;
            }
            if let Err(e) = app_handle.emit(
                crate::events::EVENT_ROOM_KEYS,
                crate::events::RoomKeysReceived { room_ids },
            ) {
                error!("Failed to emit {}: {}", crate::events::EVENT_ROOM_KEYS, e);
            }
        }
    });
}

pub async fn start_sync(
    client: Client,
    app_handle: Option<tauri::AppHandle>,
    sync_state: &SyncState,
) {
    // Abort any existing sync loop before starting a new one.
    {
        let mut guard = sync_state.handle.lock().expect("SyncState lock poisoned");
        if let Some(prev) = guard.take() {
            warn!("Aborting previous sync loop before starting a new one");
            prev.abort();
        }
    }

    // Only register event handlers once per client lifetime — add_event_handler
    // accumulates, so calling it again would produce duplicate callbacks for
    // every sync event (duplicate messages, notifications, etc.).
    if let Some(ref handle) = app_handle {
        let mut registered = sync_state.handlers_registered.lock().expect("SyncState lock poisoned");
        if !*registered {
            info!("Registering sync event handlers");
            crate::events::setup_sync_event_handlers(&client, handle);
            spawn_room_key_listener(client.clone(), handle.clone());
            *registered = true;
        } else {
            warn!("Skipping event handler registration — already registered on this client");
        }
    }

    // Enable the global event cache + persistent storage so message search can
    // read locally-cached events offline (and they survive restarts). Both are
    // idempotent and cheap; log on error but never block sync startup.
    if let Err(e) = client.event_cache().subscribe() {
        warn!("Failed to subscribe event cache: {e}");
    }
    if let Err(e) = client.event_cache().enable_storage() {
        warn!("Failed to enable event cache storage: {e}");
    }

    let handle = tokio::spawn(async move {
        // Use Unavailable so Synapse does not write a presence update on every
        // sync poll — avoids lock contention on the presence table.
        let mut sync_settings = SyncSettings::default()
            .filter(sync_filter().into())
            .set_presence(PresenceState::Unavailable);
        // Same reason as the push path: without an explicit token the first
        // sync of a freshly-built client is a full initial sync. The loop then
        // carries its own token forward, so this is paid once per launch —
        // which is exactly often enough to matter on a homeserver this app has
        // overloaded before.
        if let Some(token) = stored_sync_token(&client).await {
            sync_settings = sync_settings.token(token);
        }
        let mut was_connected = false;
        let mut backoff_secs: u64 = 1;

        loop {
            match client.sync(sync_settings.clone()).await {
                Ok(_) => {
                    // Reset backoff on successful sync.
                    backoff_secs = 1;

                    info!("Sync completed");
                    if !was_connected {
                        was_connected = true;
                        if let Some(ref handle) = app_handle {
                            let _ = handle.emit(crate::events::EVENT_CONNECTED, true);
                        }
                    }
                }
                Err(e) => {
                    error!("Sync error: {e}");
                    if was_connected {
                        was_connected = false;
                        if let Some(ref handle) = app_handle {
                            let _ = handle.emit(crate::events::EVENT_CONNECTED, false);
                        }
                    }

                    // Exponential backoff with jitter to avoid thundering-herd
                    // retries that can overwhelm the homeserver (e.g. causing
                    // Synapse's OTK upload worker lock backoff to overflow).
                    let jitter = rand::random::<u64>() % (backoff_secs.max(1));
                    let delay = backoff_secs + jitter;
                    info!("Retrying sync in {delay}s (backoff {backoff_secs}s + jitter {jitter}s)");
                    tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
                    backoff_secs = (backoff_secs * 2).min(MAX_BACKOFF_SECS);
                }
            }
        }
    });

    // Store the handle so future calls can abort this loop.
    let mut guard = sync_state.handle.lock().expect("SyncState lock poisoned");
    *guard = Some(handle);

    // Tell the push path this process is already syncing. A push that wakes us
    // now must stand down rather than open a second connection to the
    // homeserver — the service runs in this same process but has no AppHandle
    // to discover that through, so it reads a process-wide flag instead.
    crate::push_wake::set_warm_sync_active(true);
}
