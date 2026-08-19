//! Handling an inbound push: what a wake-up means, and who is allowed to act on
//! it.
//!
//! Transport-agnostic on purpose. What arrives on the wire is the Matrix Push
//! Gateway API's notification body — UnifiedPush's Matrix gateway forwards it
//! verbatim, and Sygnal derives its APNs payload from the same object — so
//! everything here is about the *protocol*, not about Android. The Android glue
//! that receives it lives in `unifiedpush.rs`.

use std::sync::atomic::{AtomicBool, Ordering};

// ─── What a push is asking for ───────────────────────────────────────────────

/// The actionable content of a push.
///
/// Under `event_id_only` (the only format we register — see `push.rs`) a push
/// carries no sender, body or room name. Everything the user eventually sees is
/// resolved on-device afterwards; this is just the address to resolve.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PushWake {
    /// An event happened. Sync and let the existing pipeline decide whether it
    /// is worth showing — the push rules already said it might be, but quiet
    /// hours, focus and mutes have not been consulted yet.
    Event { room_id: String, event_id: String },
    /// A counts-only push: the unread count moved with no event to show. Sent
    /// when notifications are read elsewhere, so the answer is never "notify"
    /// — but it is often "un-notify", which is why the room id is kept. A
    /// homeserver that omits it leaves nothing actionable at all.
    Clear { room_id: Option<String> },
}

/// Parse a push gateway notification body.
///
/// `Err` is reserved for a payload that is not a notification at all — a
/// distributor's own test message, or a truncated body. Anything shaped like a
/// notification but missing the ids is a [`PushWake::Clear { room_id: None }`]: the spec allows
/// exactly that, and erroring would log noise on every read receipt.
pub fn parse_wake(payload: &str) -> Result<PushWake, String> {
    let value: serde_json::Value =
        serde_json::from_str(payload).map_err(|e| format!("Unparsable push payload: {e}"))?;
    let notification = value
        .get("notification")
        .ok_or("Push payload has no `notification` object")?;

    let room_id = notification.get("room_id").and_then(|v| v.as_str());
    let event_id = notification.get("event_id").and_then(|v| v.as_str());

    match (room_id, event_id) {
        (Some(room_id), Some(event_id)) if !room_id.is_empty() && !event_id.is_empty() => {
            Ok(PushWake::Event {
                room_id: room_id.to_owned(),
                event_id: event_id.to_owned(),
            })
        }
        // Keeping the room id here is what lets a "read elsewhere" push clear
        // this device's shade without a sync. Dropping it, as this used to,
        // left notifications the user had already dealt with sitting there
        // until they next opened the app.
        _ => Ok(PushWake::Clear {
            room_id: room_id.filter(|id| !id.is_empty()).map(str::to_owned),
        }),
    }
}

// ─── Deciding whether to act ─────────────────────────────────────────────────

/// What a wake-up should do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WakePlan {
    /// Run a bounded sync and let the notification pipeline decide the rest.
    Sync,
    /// Take down this room's notifications. The user read it somewhere else, so
    /// the work is subtraction: no network, no store, no lease — just tell the
    /// OS to drop what it is still showing.
    Dismiss { room_id: String },
    /// Stand down. The reason is kept because these are the interesting lines
    /// in a bug report about push that "does nothing".
    Ignore(IgnoreReason),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IgnoreReason {
    /// The user turned push off. A pusher can outlive the preference — an
    /// opt-out we could not deliver to the homeserver is owed, not applied —
    /// so pushes keep arriving for a while afterwards.
    PushDisabled,
    /// The app's own sync loop is live *and recently made progress*, so it will
    /// deliver this event itself. Liveness is half the claim: a loop that
    /// exists but has been stalled in backoff (or frozen by Doze) is not going
    /// to deliver anything, and standing down for it is how push comes to do
    /// nothing in exactly the situation it was added for.
    WarmSyncRunning,
    /// A counts-only push that named no room. Nothing to render and nothing to
    /// dismiss against.
    NothingToShow,
}

/// What a wake produced, once it ran.
///
/// Two lists rather than one, because a wake can now *subtract*: a push saying
/// the user read a room elsewhere is answered by taking that room's
/// notifications down, and the only thing that still knows what is on screen
/// after a cold push is the OS itself.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct WakeOutcome {
    /// Notifications to post.
    pub specs: Vec<crate::notify::NotificationSpec>,
    /// Room ids whose live notifications should be dismissed.
    pub dismiss: Vec<String>,
}

impl WakeOutcome {
    /// A wake that decided to do nothing at all.
    fn nothing() -> Self {
        Self::default()
    }

    fn posting(specs: Vec<crate::notify::NotificationSpec>) -> Self {
        WakeOutcome { specs, dismiss: Vec::new() }
    }

    fn dismissing(room_id: String) -> Self {
        WakeOutcome { specs: Vec::new(), dismiss: vec![room_id] }
    }
}

/// Decide what to do about a wake-up, before any network or store access.
pub fn plan_wake(wake: &PushWake, push_enabled: bool, warm_sync_active: bool) -> WakePlan {
    if !push_enabled {
        return WakePlan::Ignore(IgnoreReason::PushDisabled);
    }
    if warm_sync_active {
        return WakePlan::Ignore(IgnoreReason::WarmSyncRunning);
    }
    match wake {
        PushWake::Event { .. } => WakePlan::Sync,
        // A dismissal is cheap enough that it could run unconditionally, but it
        // stays behind the two gates above on purpose: a warm app clears its own
        // notifications from the receipt it will see, and a user who switched
        // push off should not have this device acting on pushes at all.
        PushWake::Clear { room_id: Some(room_id) } => {
            WakePlan::Dismiss { room_id: room_id.clone() }
        }
        PushWake::Clear { room_id: None } => WakePlan::Ignore(IgnoreReason::NothingToShow),
    }
}

// ─── Coalescing concurrent wakes ─────────────────────────────────────────────

/// Admits one push sync at a time, process-wide.
///
/// A burst of pushes — five messages arriving at once, or a distributor
/// re-delivering an unacknowledged one — must not become five concurrent syncs
/// against the homeserver. That failure mode has taken this homeserver down
/// before, and the cold path is the worst place for it: nothing else is running
/// to notice. One sync sees every event in the burst anyway, so the losers have
/// nothing to do but stand down.
#[derive(Default)]
pub struct WakeGuard(AtomicBool);

/// Proof that the holder is the one sync allowed to run. Releases on drop, so
/// an early return or a panic cannot wedge the guard shut for the rest of the
/// process's life.
pub struct WakeLease<'a>(&'a WakeGuard);

impl WakeGuard {
    pub const fn new() -> Self {
        WakeGuard(AtomicBool::new(false))
    }

    /// Take the lease, or `None` if a sync is already running.
    pub fn try_enter(&self) -> Option<WakeLease<'_>> {
        self.0
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| WakeLease(self))
    }
}

impl Drop for WakeLease<'_> {
    fn drop(&mut self) {
        self.0 .0.store(false, Ordering::Release);
    }
}

// ─── Is the app already syncing? ─────────────────────────────────────────────

/// The running app, if there is one.
///
/// Push work is reached from Kotlin, not from a Tauri command, so it arrives
/// with no `AppHandle` and no way to ask what this process already has. Set once
/// during app setup; absent means no Tauri is running here — which is itself the
/// answer to the question that matters most, "could another `Client` exist?"
static APP_HANDLE: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

/// Publish the app handle for the push paths. Called once from app setup.
pub fn set_app_handle(app: tauri::AppHandle) {
    let _ = APP_HANDLE.set(app);
}

pub fn app_handle() -> Option<&'static tauri::AppHandle> {
    APP_HANDLE.get()
}

/// A process-wide slot for a client that must not be built twice at once.
///
/// `tokio::sync::OnceCell` was the obvious fit and the wrong one. It gives the
/// "never build twice concurrently" half, but it cannot be emptied — clearing
/// needs `&mut`, which a `static` never yields — and what goes in this slot has
/// a lifetime much shorter than the process (see `release_cold_client`).
///
/// A mutex held across the build gives the same guarantee and adds the missing
/// one. Generic only so its rules can be tested without a Matrix session:
/// the cell just clones and drops what it is handed.
struct ClientCell<T> {
    slot: tokio::sync::Mutex<Option<T>>,
}

impl<T: Clone> ClientCell<T> {
    const fn new() -> Self {
        Self { slot: tokio::sync::Mutex::const_new(None) }
    }

    /// The cached value, building it under the lock if the slot is empty.
    ///
    /// A failed build leaves the slot empty, so a wake that arrives before the
    /// session is readable does not poison every later one.
    async fn get_or_try_init<F, Fut, E>(&self, build: F) -> Result<T, E>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<T, E>>,
    {
        let mut slot = self.slot.lock().await;
        if let Some(existing) = slot.as_ref() {
            return Ok(existing.clone());
        }
        let built = build().await?;
        *slot = Some(built.clone());
        Ok(built)
    }

    /// Empty the slot, handing back whatever was in it.
    async fn release(&self) -> Option<T> {
        self.slot.lock().await.take()
    }
}

/// The one `Client` this process builds for itself, when there is no app to
/// borrow one from.
static COLD_CLIENT: ClientCell<matrix_sdk::Client> = ClientCell::new();

/// Drop the client this module built for a Tauri-less wake, if there is one.
///
/// Both reasons are about lifetime rather than memory, and neither is optional.
///
/// The `Client` owns I/O registered against the runtime it was built on — a
/// connection pool, the send-queue and lock-refresh tasks. Every JNI entry
/// point builds its own runtime and drops it when the call returns, so a client
/// cached past that point outlives its reactor: the next push would drive
/// pooled sockets bound to a dead driver and the background tasks would simply
/// be gone. So the slot is emptied before the runtime that filled it goes.
///
/// And once Tauri starts in this process the app builds its own `Client` over
/// the same store. A leftover here would make two, which means two
/// `OlmMachine`s — the documented cause of Olm-account corruption when an app
/// and an extension share a store (element-ios#3817).
pub async fn release_cold_client() {
    if COLD_CLIENT.release().await.is_some() {
        tracing::debug!("Released the wake's own Matrix client");
    }
}

/// A Matrix client for work with no `AppHandle` behind it.
///
/// Prefers the app's own client, and this is not an optimisation: two `Client`s
/// over one store means two `OlmMachine`s, which is the documented cause of
/// Olm-account corruption when an app and an extension share a store
/// (element-ios#3817). Building a fresh one is safe only in the case this
/// reaches it — no Tauri in the process, so no other client can exist.
///
/// The serialisation has to live *here* rather than at the call sites, because
/// the callers do not share a lock: `run_wake` holds `WAKE_GUARD`, but
/// `unifiedpush::register_stored_endpoint` and `unifiedpush::on_unregistered`
/// are driven straight off distributor callbacks and hold nothing. A
/// distributor that re-announces its endpoint while delivering a queued message
/// — an ordinary wake-up, not an exotic race — would otherwise have two of
/// these under construction over one store at once.
pub async fn background_client(data_dir: &std::path::Path) -> Result<matrix_sdk::Client, String> {
    use tauri::Manager;

    if let Some(app) = app_handle() {
        // Tauri has started in this process since the last wake, so anything
        // built here is now a second `Client` over one store. Drop it before
        // handing back the app's own.
        release_cold_client().await;
        let existing = app
            .try_state::<crate::matrix::client::MatrixState>()
            .and_then(|state| state.0.lock().ok().and_then(|guard| guard.clone()));
        // Deliberately not cached: the app owns this client's lifetime, and
        // holding a clone past a logout would keep a dead session alive in a
        // static for the rest of the process.
        return existing.ok_or_else(|| "The app is running but not logged in".to_string());
    }

    COLD_CLIENT
        .get_or_try_init(|| async {
            let session = crate::secrets::load_session(data_dir)?.ok_or("No stored session")?;
            let store_key =
                crate::secrets::get_store_key(data_dir)?.ok_or("No store-encryption key")?;
            let client = crate::matrix::client::build_client(
                &session.homeserver_url,
                data_dir.to_path_buf(),
                &store_key,
            )
            .await?;
            crate::matrix::client::restore_session_from_info(&client, &session).await?;
            Ok::<_, String>(client)
        })
        .await
}

/// Set while the app's own sync loop is running.
///
/// Process-wide rather than Tauri-managed on purpose: the push service runs in
/// the same process as the app but has no `AppHandle` to ask, and this is the
/// one question it must be able to answer before opening a second connection to
/// the homeserver.
static WARM_SYNC_ACTIVE: AtomicBool = AtomicBool::new(false);

/// When the warm loop last completed a sync, in Unix ms. Zero means never.
///
/// A task handle existing is not the same claim as a sync happening, and on
/// Android the two come apart routinely: the process stays resident while Doze
/// freezes it and cuts its network, so the loop sits in backoff for minutes at
/// a time. Without this clock a push arriving then stands down for a loop that
/// cannot answer it — push declining to work in precisely the situation it was
/// added to fix.
static WARM_SYNC_PROGRESS_MS: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);

/// How stale the warm loop's last sync may be before push stops deferring to it.
///
/// Sits just under the loop's own `MAX_BACKOFF_SECS` (120 s): a loop that has
/// gone this long without a completed sync is either at the top of its backoff
/// ladder or frozen, and in both cases it is not about to deliver this event.
/// Erring long is the safer direction — the cost of waiting too eagerly is a
/// missed notification, while the cost of not waiting is a second sync against
/// a homeserver this app has overwhelmed before.
const WARM_SYNC_LIVENESS_MS: u64 = 90_000;

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Record whether the long-lived sync loop is running. Called by `start_sync`
/// and by the paths that abort it.
///
/// Starting also stamps the progress clock, so a loop that has just been spun
/// up counts as healthy through its first window rather than being written off
/// before it has had the chance to complete a sync.
pub fn set_warm_sync_active(active: bool) {
    WARM_SYNC_PROGRESS_MS.store(if active { now_ms() } else { 0 }, Ordering::Release);
    WARM_SYNC_ACTIVE.store(active, Ordering::Release);
}

/// Note that the warm loop completed a sync. Called from the loop's success arm.
pub fn note_warm_sync_progress() {
    WARM_SYNC_PROGRESS_MS.store(now_ms(), Ordering::Release);
}

/// Whether the warm loop is both running and recently alive.
///
/// Split out as a pure function because the interesting cases — a stalled loop,
/// a clock that jumped backwards — are the ones that would otherwise need a
/// frozen phone to reproduce.
pub fn warm_sync_is_live(running: bool, last_progress_ms: u64, now_ms: u64) -> bool {
    // `saturating_sub` rather than a subtraction: `SystemTime` is not monotonic
    // and a device that corrects its clock backwards (NTP after a cold boot, a
    // timezone-confused RTC) would otherwise underflow into "wildly stale" and
    // silently stop deferring to a perfectly healthy loop.
    running && now_ms.saturating_sub(last_progress_ms) <= WARM_SYNC_LIVENESS_MS
}

pub fn warm_sync_active() -> bool {
    warm_sync_is_live(
        WARM_SYNC_ACTIVE.load(Ordering::Acquire),
        WARM_SYNC_PROGRESS_MS.load(Ordering::Acquire),
        now_ms(),
    )
}

/// The one wake allowed to sync at a time, for the life of the process.
pub static WAKE_GUARD: WakeGuard = WakeGuard::new();

// ─── Running the wake ────────────────────────────────────────────────────────

/// Wall-clock ceiling for the whole wake, from cold client to rendered specs.
///
/// Not a race against Android: a `shortService` gets roughly three minutes
/// before `onTimeout`, so there is no cliff here to duck under. The budget is
/// about what a wake is *for*. Past twenty seconds a sync has stopped being a
/// wake-up and become a session — radio held open, battery spent — for a
/// notification whose whole value was arriving promptly. Stopping also leaves
/// the service ample headroom to post what we found, and bounds how long a
/// hung homeserver can hold the wake lease shut against the pushes behind it.
const WAKE_BUDGET: std::time::Duration = std::time::Duration::from_secs(20);

/// Most notifications one wake will post.
///
/// A wake syncs a *batch*, not the single event the push named, so a device
/// that has been off for a while can come back to a great many notifiable
/// events at once. Past a handful they stop being information and start being
/// a wall to swipe away; the room list and unread counts carry the rest.
const MAX_WAKE_NOTIFICATIONS: usize = 8;

/// Whether an event predates the user's read marker in its room.
///
/// The marker moves when the room is read on *any* device, which is what makes
/// this the right question to ask: "never delivered to this phone" and "never
/// seen by this person" are different things, and only the second one should
/// produce a notification.
///
/// No marker means no evidence either way, so the event still notifies —
/// suppressing there would silence precisely the rooms never opened.
pub fn already_seen(event_ts: u64, read_marker_ts: Option<u64>) -> bool {
    read_marker_ts.is_some_and(|marker| event_ts <= marker)
}

/// Trim a wake to [`MAX_WAKE_NOTIFICATIONS`], keeping the newest, and report
/// how many were dropped so the caller can say so rather than silently truncate.
pub fn cap_wake_notifications(
    mut specs: Vec<crate::notify::NotificationSpec>,
) -> (Vec<crate::notify::NotificationSpec>, usize) {
    if specs.len() <= MAX_WAKE_NOTIFICATIONS {
        return (specs, 0);
    }
    // Sync order is chronological, so the tail is the most recent.
    let dropped = specs.len() - MAX_WAKE_NOTIFICATIONS;
    specs.drain(..dropped);
    (specs, dropped)
}

/// Everything the collecting event handlers need. No `AppHandle` — that is the
/// entire point of this path.
#[derive(Clone)]
struct Collector {
    config: std::sync::Arc<crate::notifications::NotificationConfig>,
    out: std::sync::Arc<std::sync::Mutex<Vec<crate::notify::NotificationSpec>>>,
    /// Read-marker timestamp per room, so a batch of events in one room costs
    /// one store lookup rather than one per event.
    read_markers:
        std::sync::Arc<tokio::sync::Mutex<std::collections::HashMap<String, Option<u64>>>>,
    /// How many events this wake dropped as already read elsewhere. Reported
    /// afterwards, so "the filter did something" is visible rather than
    /// inferred from an absence.
    suppressed: std::sync::Arc<std::sync::atomic::AtomicUsize>,
    /// Oldest and newest event timestamp this wake saw. A wake is supposed to
    /// carry what arrived since the last one; a span of days means the sync is
    /// re-delivering history, which costs the homeserver and the battery even
    /// when the read-marker filter stops it reaching the user.
    span: std::sync::Arc<std::sync::Mutex<Option<(u64, u64)>>>,
}

/// The latest of several candidate marker timestamps.
///
/// Pure so the precedence is testable without a `Room`: the receipts differ in
/// *which* are present, never in what a later timestamp means, and picking the
/// newest is right for every combination.
fn latest_marker(candidates: impl IntoIterator<Item = Option<u64>>) -> Option<u64> {
    candidates.into_iter().flatten().max()
}

impl Collector {
    /// When the user last read this room, on any device.
    ///
    /// Reads all four receipts — public and private, unthreaded and main — and
    /// takes the newest. The private one is the load-bearing half: `mark_room_read`
    /// sends `Read` only when the `send_read_receipts` preference is on, while
    /// `ReadPrivate` goes out unconditionally. Consulting the public receipt
    /// alone made this filter a permanent no-op for anyone who had turned that
    /// preference off, so a cold wake re-notified their whole synced batch —
    /// silently, since a filter that never fires looks exactly like a filter
    /// with nothing to do. `Main` is checked alongside `Unthreaded` for the same
    /// reason `rooms.rs` does it: clients disagree about which a room-level read
    /// belongs in, and missing the one in use costs the whole signal.
    async fn read_marker(&self, room: &matrix_sdk::Room) -> Option<u64> {
        use matrix_sdk::ruma::events::receipt::{ReceiptThread, ReceiptType};

        let room_id = room.room_id().to_string();
        if let Some(cached) = self.read_markers.lock().await.get(&room_id) {
            return *cached;
        }

        let mut found = Vec::with_capacity(4);
        for (receipt_type, thread) in [
            (ReceiptType::Read, ReceiptThread::Unthreaded),
            (ReceiptType::Read, ReceiptThread::Main),
            (ReceiptType::ReadPrivate, ReceiptThread::Unthreaded),
            (ReceiptType::ReadPrivate, ReceiptThread::Main),
        ] {
            found.push(
                room.load_user_receipt(receipt_type, thread, room.own_user_id())
                    .await
                    .ok()
                    .flatten()
                    .and_then(|(_, receipt)| receipt.ts)
                    .map(|ts| u64::from(ts.0)),
            );
        }
        let marker = latest_marker(found);

        // Logged because a marker that is always absent turns this filter into a
        // permanent no-op, and a no-op filter is indistinguishable from a
        // working one whenever nothing happens to be already-read.
        tracing::debug!("Read marker for {room_id}: {marker:?}");
        self.read_markers.lock().await.insert(room_id, marker);
        marker
    }
}

/// Wake up, sync once, and render whatever the notification pipeline selects.
///
/// `data_dir` is Android's `Context.dataDir`, which is what Tauri's
/// `app_data_dir()` *and* `app_config_dir()` both resolve to there — so the
/// store, the secrets and `notifications.toml` are all under this one path.
///
/// Deliberately runs a real (if bounded) sync rather than fetching the single
/// event the push named. The SDK's `Vec<Action>` extractor hands the handler the
/// server's own push-rule evaluation, which means `notify::evaluate` sees
/// *identical* inputs to the warm path — same mute rules, same highlight
/// decision, no second implementation to drift. It also picks up everything else
/// that arrived in the same window, which is why a burst coalesces cleanly.
pub async fn run_wake(
    data_dir: &std::path::Path,
    wake: &PushWake,
) -> Result<WakeOutcome, String> {
    let config = crate::notifications::load_notification_config_from(data_dir);
    match plan_wake(wake, config.push_enabled, warm_sync_active()) {
        WakePlan::Sync => {}
        // Answered without a client, a lease or a byte of network: the whole
        // point of recognising this push is that it costs nothing to honour.
        WakePlan::Dismiss { room_id } => {
            tracing::info!("Push wake dismissing notifications for {room_id}");
            return Ok(WakeOutcome::dismissing(room_id));
        }
        WakePlan::Ignore(reason) => {
            tracing::info!("Push wake ignored: {reason:?}");
            return Ok(WakeOutcome::nothing());
        }
    }

    // Losing this race is a success, not an error: the sync that holds the
    // lease covers this event too.
    let Some(_lease) = WAKE_GUARD.try_enter() else {
        tracing::info!("Push wake coalesced into the sync already running");
        return Ok(WakeOutcome::nothing());
    };

    tokio::time::timeout(WAKE_BUDGET, sync_and_collect(data_dir, config))
        .await
        .map_err(|_| "Push sync exceeded its time budget".to_string())?
        .map(WakeOutcome::posting)
}

async fn sync_and_collect(
    data_dir: &std::path::Path,
    config: crate::notifications::NotificationConfig,
) -> Result<Vec<crate::notify::NotificationSpec>, String> {
    use matrix_sdk::config::SyncSettings;

    let client = background_client(data_dir).await?;

    let out = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let suppressed = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let span: std::sync::Arc<std::sync::Mutex<Option<(u64, u64)>>> = Default::default();
    // Held until this function returns, at which point the handlers come off
    // the client again — see `register_collectors`.
    let _collectors = register_collectors(
        &client,
        Collector {
            config: std::sync::Arc::new(config),
            out: out.clone(),
            read_markers: Default::default(),
            suppressed: suppressed.clone(),
            span: span.clone(),
        },
    );

    // `timeout(0)` asks the homeserver to answer with whatever it has instead of
    // long-polling. The push already told us there is something there, and a
    // long poll on a woken device is battery spent waiting for nothing.
    //
    // The filter must match the warm loop's exactly. A sync token is produced
    // under a filter, and presenting it under a different one makes the server
    // re-send a chunk of each room's history: syncing unfiltered here pulled 274
    // events spanning six months, every wake that followed a warm sync.
    // Whether this wake resumes or starts over is worth an initial sync's
    // traffic and is invisible from outside: the read-marker filter renders
    // zero either way. Logged as a short fingerprint — the token is not a
    // secret, but it is long and only its identity matters here.
    let token_before = crate::matrix::client::stored_sync_token(&client).await;
    tracing::info!("Push wake starting from sync token: {}", describe_token(&token_before));

    let mut settings = SyncSettings::default()
        .timeout(std::time::Duration::from_secs(0))
        .filter(crate::matrix::client::sync_filter().into())
        .set_presence(matrix_sdk::ruma::presence::PresenceState::Unavailable);

    // Pass the stored token explicitly rather than trusting the client to have
    // loaded it into memory. `sync_once` falls back to an *initial* sync when
    // its in-memory token is unset — a silent, 2.6 MiB difference that looks
    // identical from the outside once the read-marker filter drops the result.
    // The token on disk is the authoritative one; if it exists, say so.
    if let Some(token) = token_before.clone() {
        settings = settings.token(token);
    }
    let response = client
        .sync_once(settings)
        .await
        .map_err(|e| format!("Push sync failed: {e}"))?;

    // A room comes back `limited` when the server could not give a delta and
    // resent a chunk of timeline instead. One or two is ordinary; all of them
    // means this wake did an initial-sync's worth of work, which the
    // read-marker filter would hide by dropping every event it produced.
    let limited = response.rooms.join.values().filter(|r| r.timeline.limited).count();
    if limited > 0 {
        tracing::info!(
            "Push wake: {limited} of {} joined rooms returned a limited timeline",
            response.rooms.join.len()
        );
    }

    let token_after = crate::matrix::client::stored_sync_token(&client).await;
    if token_before == token_after {
        tracing::warn!(
            "Push wake did not advance the stored sync token ({}) — the next wake \
             will ask the homeserver for the same window again",
            describe_token(&token_after)
        );
    } else {
        tracing::info!("Push wake advanced the sync token to {}", describe_token(&token_after));
    }

    let collected = out.lock().map_err(|_| "Collector lock poisoned")?.clone();
    let (specs, dropped) = cap_wake_notifications(collected);
    if dropped > 0 {
        tracing::info!("Push wake capped at {MAX_WAKE_NOTIFICATIONS}; dropped {dropped} older");
    }
    if let Some((oldest, newest)) = span.lock().ok().and_then(|s| *s) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        tracing::info!(
            "Push wake saw events spanning {}s, oldest {}s before now",
            (newest.saturating_sub(oldest)) / 1000,
            (now.saturating_sub(oldest)) / 1000,
        );
    }
    let suppressed = suppressed.load(Ordering::Relaxed);
    if suppressed > 0 {
        tracing::info!("Push wake skipped {suppressed} event(s) already read elsewhere");
    }
    tracing::info!("Push wake rendered {} notification(s)", specs.len());
    Ok(specs)
}

/// A short, stable fingerprint of a sync token for logs.
///
/// Hashed rather than truncated: a Synapse token's trailing characters are its
/// least variable part, so a suffix makes two genuinely different tokens look
/// identical — which is exactly the question this is asked to answer.
fn describe_token(token: &Option<String>) -> String {
    match token {
        None => "<none>".to_owned(),
        Some(token) => {
            let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
            for byte in token.as_bytes() {
                hash ^= u64::from(*byte);
                hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
            }
            format!("#{hash:012x}")
        }
    }
}

/// Register the same event handlers the warm path uses, differing only in where
/// the rendered spec goes.
///
/// Returns drop guards, and they are load-bearing rather than tidy. The client
/// this registers against is not always ours to scribble on: `background_client`
/// hands back the *running app's* `Client` whenever there is one, and the cold
/// client is now reused for the life of the process. A handler left behind on
/// either would go on racing `events::maybe_notify` for `claim_notification`
/// long after this wake ended — and whenever the collector won that race the
/// user would get no notification at all, because the spec it claimed is
/// collected into a `Vec` nobody is reading any more.
#[must_use = "dropping the guards immediately unregisters the handlers"]
fn register_collectors(
    client: &matrix_sdk::Client,
    collector: Collector,
) -> Vec<matrix_sdk::event_handler::EventHandlerDropGuard> {
    use matrix_sdk::{
        event_handler::Ctx,
        ruma::events::{
            room::message::SyncRoomMessageEvent, sticker::StickerEventContent, SyncMessageLikeEvent,
        },
        Room,
    };

    client.add_event_handler_context(collector);

    let message = client.add_event_handler(
        |ev: SyncRoomMessageEvent,
         room: Room,
         Ctx(collector): Ctx<Collector>,
         push_actions: Vec<matrix_sdk::ruma::push::Action>| async move {
            let SyncRoomMessageEvent::Original(original) = ev else { return };
            let sender_id = original.sender.clone();
            let Some(event) = crate::events::convert_room_message_event(original) else { return };
            collect(&collector, &room, &sender_id, &event, &push_actions).await;
        },
    );

    let sticker = client.add_event_handler(
        |ev: SyncMessageLikeEvent<StickerEventContent>,
         room: Room,
         Ctx(collector): Ctx<Collector>,
         push_actions: Vec<matrix_sdk::ruma::push::Action>| async move {
            let SyncMessageLikeEvent::Original(original) = ev else { return };
            let sender_id = original.sender.clone();
            let event = crate::matrix::timeline::convert_sync_sticker_event(original);
            collect(&collector, &room, &sender_id, &event, &push_actions).await;
        },
    );

    vec![
        client.event_handler_drop_guard(message),
        client.event_handler_drop_guard(sticker),
    ]
}

/// The cold-path twin of `events::maybe_notify`: identical inputs into
/// `notify::evaluate`, but the spec is collected for Kotlin instead of posted
/// through Tauri.
async fn collect(
    collector: &Collector,
    room: &matrix_sdk::Room,
    sender_id: &matrix_sdk::ruma::UserId,
    event: &crate::matrix::timeline::TimelineEvent,
    push_actions: &[matrix_sdk::ruma::push::Action],
) {
    let room_id = room.room_id().to_string();
    let is_own = room.own_user_id() == sender_id;

    if let Ok(mut span) = collector.span.lock() {
        let ts = event.timestamp;
        *span = Some(match *span {
            Some((lo, hi)) => (lo.min(ts), hi.max(ts)),
            None => (ts, ts),
        });
    }

    // A wake syncs a batch, so most of what arrives may already have been read
    // on another device. Delivered-to-this-phone and seen-by-this-person are
    // different things, and only the second earns silence.
    if already_seen(event.timestamp, collector.read_marker(room).await) {
        collector.suppressed.fetch_add(1, Ordering::Relaxed);
        return;
    }

    let sender = if is_own {
        event.sender.clone()
    } else {
        room.get_member_no_sync(sender_id)
            .await
            .ok()
            .flatten()
            .and_then(|m| m.display_name().map(str::to_string))
            .unwrap_or_else(|| event.sender.clone())
    };

    let input = crate::notify::NotificationInput {
        room_id: room_id.clone(),
        room_name: crate::notify::resolve_room_title(room).await,
        event_id: event.event_id.clone(),
        sender,
        body: event.body.clone(),
        is_edit: event.is_edit,
        is_own,
        // No window exists on this path, and nothing here is catch-up replay:
        // the stored sync token means these events have never been seen.
        window_focused: false,
        pre_startup: false,
        push: crate::notify::PushEval::from_actions(push_actions),
    };

    let Some(spec) = crate::notify::evaluate(&input, &collector.config) else { return };
    // Shares the warm path's dedup ring, so a push that arrives for an event the
    // app already showed before its webview died does not show it twice.
    if !crate::events::claim_notification(&spec.event_id) {
        return;
    }
    if let Ok(mut out) = collector.out.lock() {
        out.push(spec);
    }
}

// ─── Self-test ───────────────────────────────────────────────────────────────

/// Render a notification from a synthetic event, touching neither the network
/// nor the session store.
///
/// A real wake needs a logged-in device, and until one exists the whole
/// render-and-post half of the cold path — spec serialisation, the JSON
/// crossing back to Kotlin, `NotificationCompat`, the channel ids, the tap
/// intent — is unexercised. This makes that half provable on its own, which
/// matters because the JNI boundary is the part with no test coverage at all.
///
/// It deliberately reads the *real* config and runs the *real* `evaluate`, so a
/// notification that fails to appear because of quiet hours or a disabled master
/// switch reports that rather than looking like a broken bridge.
pub fn self_test_spec(
    data_dir: &std::path::Path,
) -> Result<crate::notify::NotificationSpec, String> {
    let config = crate::notifications::load_notification_config_from(data_dir);
    let input = crate::notify::NotificationInput {
        room_id: "!quark-self-test:localhost".to_owned(),
        room_name: "Quark self-test".to_owned(),
        event_id: "$quark-self-test".to_owned(),
        sender: "Quark".to_owned(),
        body: "Push reached this device and rendered a notification.".to_owned(),
        is_edit: false,
        is_own: false,
        window_focused: false,
        pre_startup: false,
        push: crate::notify::PushEval { notify: true, highlight: false },
    };
    crate::notify::evaluate(&input, &config).ok_or_else(|| {
        "The push bridge worked, but your notification settings suppressed the result \
         (notifications disabled, quiet hours, or this room muted)."
            .to_owned()
    })
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    /// Stand-in for the `Client` a real cell holds: the cell only ever clones
    /// and drops what it is given, so a `String` exercises every path.
    async fn build_ok(builds: Arc<AtomicUsize>) -> Result<String, String> {
        builds.fetch_add(1, Ordering::SeqCst);
        // Force a suspension point so a concurrent caller has somewhere to
        // interleave — without it the first build would finish before the
        // second is ever polled and the test would prove nothing.
        tokio::task::yield_now().await;
        Ok("client".to_owned())
    }

    #[tokio::test]
    async fn a_cell_builds_once_for_concurrent_callers() {
        // Two `Client`s over one store means two `OlmMachine`s, which is the
        // documented cause of Olm-account corruption (element-ios#3817). A
        // distributor re-announcing its endpoint while delivering a message is
        // an ordinary wake-up, not an exotic race.
        let cell: ClientCell<String> = ClientCell::new();
        let builds = Arc::new(AtomicUsize::new(0));

        let (a, b) = tokio::join!(
            cell.get_or_try_init(|| build_ok(builds.clone())),
            cell.get_or_try_init(|| build_ok(builds.clone())),
        );

        assert_eq!(a.unwrap(), "client");
        assert_eq!(b.unwrap(), "client");
        assert_eq!(builds.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn releasing_lets_the_next_caller_build_again() {
        // The reason `release` has to exist: the runtime a push builds its
        // client on is dropped when the call returns, so the client must not
        // outlive it. The next push builds a fresh one.
        let cell: ClientCell<String> = ClientCell::new();
        let builds = Arc::new(AtomicUsize::new(0));

        cell.get_or_try_init(|| build_ok(builds.clone())).await.unwrap();
        assert_eq!(builds.load(Ordering::SeqCst), 1);

        assert_eq!(cell.release().await, Some("client".to_owned()));

        cell.get_or_try_init(|| build_ok(builds.clone())).await.unwrap();
        assert_eq!(builds.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn a_failed_build_leaves_the_cell_empty() {
        // A wake that arrives before the session is readable must not poison
        // every later one.
        let cell: ClientCell<String> = ClientCell::new();

        let failed: Result<String, String> =
            cell.get_or_try_init(|| async { Err("No stored session".to_owned()) }).await;
        assert_eq!(failed, Err("No stored session".to_owned()));

        let builds = Arc::new(AtomicUsize::new(0));
        cell.get_or_try_init(|| build_ok(builds.clone())).await.unwrap();
        assert_eq!(builds.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn releasing_an_empty_cell_is_harmless() {
        let cell: ClientCell<String> = ClientCell::new();
        assert_eq!(cell.release().await, None);
    }

    #[test]
    fn parses_an_event_id_only_notification() {
        // Exactly what a homeserver sends for a pusher registered with
        // `format: event_id_only` — no sender, no body, no room name.
        let payload = r#"{
            "notification": {
                "event_id": "$3957tyerfgewrf384",
                "room_id": "!slw48wfj34rpdEwuS:example.com",
                "counts": { "unread": 2 },
                "devices": [{ "app_id": "tel.quark.app.android", "pushkey": "https://ntfy.sh/x" }]
            }
        }"#;
        assert_eq!(
            parse_wake(payload).expect("valid notification"),
            PushWake::Event {
                room_id: "!slw48wfj34rpdEwuS:example.com".into(),
                event_id: "$3957tyerfgewrf384".into(),
            }
        );
    }

    #[test]
    fn a_counts_only_notification_is_a_clear_not_an_event() {
        // Sent when the unread count drops (read on another device). There is
        // no event to show, and notifying would resurrect a dismissed room.
        let payload = r#"{
            "notification": {
                "counts": { "unread": 0 },
                "devices": [{ "app_id": "tel.quark.app.android", "pushkey": "https://ntfy.sh/x" }]
            }
        }"#;
        assert_eq!(parse_wake(payload).expect("valid notification"), PushWake::Clear { room_id: None });
    }

    #[test]
    fn a_room_without_an_event_is_a_clear() {
        let payload = r#"{"notification": {"room_id": "!a:x", "counts": {"unread": 0}}}"#;
        assert_eq!(
            parse_wake(payload).expect("valid notification"),
            PushWake::Clear { room_id: Some("!a:x".to_owned()) }
        );
    }

    #[test]
    fn ignores_the_extra_fields_a_full_format_push_would_carry() {
        // We never register for this format, but a pusher left over from another
        // client — or a homeserver that ignores the format — must not break us.
        let payload = r#"{
            "notification": {
                "event_id": "$abc",
                "room_id": "!a:x",
                "type": "m.room.message",
                "sender": "@alice:x",
                "room_name": "General",
                "content": { "msgtype": "m.text", "body": "secret" },
                "counts": { "unread": 1 }
            }
        }"#;
        assert_eq!(
            parse_wake(payload).expect("valid notification"),
            PushWake::Event { room_id: "!a:x".into(), event_id: "$abc".into() }
        );
    }

    #[test]
    fn rejects_a_payload_that_is_not_a_notification() {
        // Distributors deliver their own test messages through the same channel.
        assert!(parse_wake("not json").is_err());
        assert!(parse_wake(r#"{"hello": "world"}"#).is_err());
        assert!(parse_wake("").is_err());
    }

    #[test]
    fn empty_ids_are_treated_as_absent() {
        let payload = r#"{"notification": {"room_id": "", "event_id": ""}}"#;
        assert_eq!(parse_wake(payload).expect("valid notification"), PushWake::Clear { room_id: None });
    }

    #[test]
    fn an_event_push_syncs() {
        let wake = PushWake::Event { room_id: "!a:x".into(), event_id: "$e".into() };
        assert_eq!(plan_wake(&wake, true, false), WakePlan::Sync);
    }

    #[test]
    fn a_push_arriving_after_the_user_turned_push_off_is_ignored() {
        // The pusher outlives the preference: an opt-out we could not deliver to
        // the homeserver (offline, broken session) leaves it pushing for a
        // while. Syncing here would be doing the exact work they switched off.
        let wake = PushWake::Event { room_id: "!a:x".into(), event_id: "$e".into() };
        assert_eq!(plan_wake(&wake, false, false), WakePlan::Ignore(IgnoreReason::PushDisabled));
    }

    #[test]
    fn a_push_is_ignored_while_the_app_is_already_syncing() {
        // The warm loop will deliver this event through the same pipeline. A
        // second sync would duplicate the notification and — worse — put two
        // concurrent syncs on the homeserver from one device.
        let wake = PushWake::Event { room_id: "!a:x".into(), event_id: "$e".into() };
        assert_eq!(plan_wake(&wake, true, true), WakePlan::Ignore(IgnoreReason::WarmSyncRunning));
    }

    #[test]
    fn the_preference_is_checked_before_the_sync_state() {
        // Both apply; the user's explicit "off" is the more informative reason
        // to report, and it holds whether or not the app happens to be running.
        let wake = PushWake::Event { room_id: "!a:x".into(), event_id: "$e".into() };
        assert_eq!(plan_wake(&wake, false, true), WakePlan::Ignore(IgnoreReason::PushDisabled));
    }

    #[test]
    fn a_clear_push_with_no_room_does_not_wake_the_network() {
        // Nothing to show and nothing to dismiss against: spending a sync on it
        // would burn battery for a push whose whole meaning is "less".
        assert_eq!(
            plan_wake(&PushWake::Clear { room_id: None }, true, false),
            WakePlan::Ignore(IgnoreReason::NothingToShow)
        );
    }

    #[test]
    fn a_clear_push_naming_a_room_dismisses_it() {
        // The counts-only push a homeserver sends when the room is read on
        // another device. It carries a room id, and taking the notifications
        // down is both the right answer and a free one — no sync involved.
        assert_eq!(
            plan_wake(&PushWake::Clear { room_id: Some("!a:x".into()) }, true, false),
            WakePlan::Dismiss { room_id: "!a:x".to_owned() }
        );
    }

    #[test]
    fn a_dismissal_still_defers_to_a_live_warm_app() {
        // Cheap enough to run unconditionally, but a warm app clears its own
        // notifications from the receipt it is about to see, and a user who
        // switched push off should not have this device acting on pushes.
        let wake = PushWake::Clear { room_id: Some("!a:x".into()) };
        assert_eq!(plan_wake(&wake, true, true), WakePlan::Ignore(IgnoreReason::WarmSyncRunning));
        assert_eq!(plan_wake(&wake, false, false), WakePlan::Ignore(IgnoreReason::PushDisabled));
    }

    #[test]
    fn the_newest_read_marker_wins_whichever_receipt_carried_it() {
        // The public receipt is optional — `send_read_receipts` gates it — so a
        // filter consulting it alone silently does nothing for anyone who turned
        // that off. Any one of the four present is enough, and the newest is
        // always the right answer.
        assert_eq!(latest_marker([None, Some(10), None, Some(40)]), Some(40));
        assert_eq!(latest_marker([Some(40), Some(10)]), Some(40));
        assert_eq!(latest_marker([None, Some(7)]), Some(7));
        assert_eq!(latest_marker([None, None, None, None]), None);
    }

    #[test]
    fn a_sync_loop_that_stopped_progressing_no_longer_holds_push_off() {
        // The failure this exists to stop: an Android process kept resident but
        // frozen by Doze still owns a sync task, so the old "is there a loop?"
        // check declined every push while the loop it deferred to was stalled
        // in backoff and could not deliver anything.
        let now = 1_000_000;
        assert!(warm_sync_is_live(true, now, now), "a loop syncing right now is live");
        assert!(warm_sync_is_live(true, now - 89_000, now), "inside the window is live");
        assert!(!warm_sync_is_live(true, now - 91_000, now), "past the window is not");
        assert!(!warm_sync_is_live(false, now, now), "no loop is never live");
        // A clock corrected backwards must not read as wildly stale.
        assert!(warm_sync_is_live(true, now + 5_000, now), "a backwards clock stays live");
    }

    #[test]
    fn the_self_test_renders_a_notification_without_a_session() {
        // The point of the self-test: prove the render-and-post half works on a
        // device that has never logged in, where a real wake declines long
        // before it would reach a notification.
        let dir = tempfile::tempdir().unwrap();
        let spec = self_test_spec(dir.path()).expect("a default config should notify");
        assert!(spec.title.contains("Quark"), "got: {}", spec.title);
        assert_eq!(spec.channel, crate::notify::CHANNEL_MESSAGES);
    }

    #[test]
    fn the_self_test_explains_a_config_that_suppresses_it() {
        // Otherwise "I ran the self-test and nothing appeared" is independently
        // consistent with a broken JNI boundary and with notifications simply
        // being switched off — and those need opposite investigations.
        let dir = tempfile::tempdir().unwrap();
        let mut config = crate::notifications::NotificationConfig::default();
        config.enabled = false;
        crate::notifications::save_notification_config_to(dir.path(), &config).unwrap();

        let err = self_test_spec(dir.path()).expect_err("a disabled config must not notify");
        assert!(err.contains("notifications"), "got: {err}");
    }

    #[test]
    fn an_event_the_user_already_read_elsewhere_is_not_notified() {
        // The whole point. A cold wake syncs a batch, not one event, so without
        // this it re-notifies everything read on another device since the app
        // last ran — the flood this filter exists to stop.
        assert!(already_seen(1_000, Some(2_000)));
        assert!(already_seen(1_000, Some(1_000)), "read marker on the event itself");
    }

    #[test]
    fn an_event_newer_than_the_read_marker_still_notifies() {
        assert!(!already_seen(2_000, Some(1_000)));
    }

    #[test]
    fn a_room_that_was_never_read_still_notifies() {
        // No marker is not evidence of having seen anything. Suppressing here
        // would silence exactly the rooms the user has never opened.
        assert!(!already_seen(1_000, None));
    }

    #[test]
    fn a_wake_keeps_the_newest_notifications_when_there_are_too_many() {
        // Sync order is chronological, so the tail is the most recent — the
        // part a person woken by their phone actually wants.
        let specs: Vec<_> = (0..MAX_WAKE_NOTIFICATIONS + 3)
            .map(|i| spec_named(&format!("$e{i}")))
            .collect();

        let (kept, dropped) = cap_wake_notifications(specs);

        assert_eq!(kept.len(), MAX_WAKE_NOTIFICATIONS);
        assert_eq!(dropped, 3);
        assert_eq!(kept.last().unwrap().event_id, format!("$e{}", MAX_WAKE_NOTIFICATIONS + 2));
    }

    #[test]
    fn a_wake_under_the_cap_is_left_alone() {
        let specs = vec![spec_named("$a"), spec_named("$b")];
        let (kept, dropped) = cap_wake_notifications(specs);
        assert_eq!(kept.len(), 2);
        assert_eq!(dropped, 0);
    }

    fn spec_named(event_id: &str) -> crate::notify::NotificationSpec {
        crate::notify::NotificationSpec {
            id: 1,
            summary_id: 2,
            title: "t".into(),
            body: "b".into(),
            channel: crate::notify::CHANNEL_MESSAGES,
            group: "!r:x".into(),
            room_id: "!r:x".into(),
            event_id: event_id.into(),
            room_name: "r".into(),
            highlight: false,
        }
    }

    #[test]
    fn only_one_wake_may_sync_at_a_time() {
        let guard = WakeGuard::new();
        let first = guard.try_enter().expect("first wake runs");
        assert!(guard.try_enter().is_none(), "a burst must coalesce, not stack");
        drop(first);
        assert!(guard.try_enter().is_some(), "the guard reopens once the sync ends");
    }

    #[test]
    fn the_guard_reopens_even_if_the_sync_panics() {
        let guard = WakeGuard::new();
        // The panic below is the point of the test, not a failure — silence the
        // default hook so it doesn't print a backtrace into a passing run.
        let hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _lease = guard.try_enter().expect("first wake runs");
            panic!("sync blew up");
        }));
        std::panic::set_hook(hook);
        assert!(result.is_err(), "the panic must actually happen");
        assert!(
            guard.try_enter().is_some(),
            "a panicking sync must not wedge push shut for the process's life"
        );
    }
}
