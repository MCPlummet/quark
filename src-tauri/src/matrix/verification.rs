//! Interactive (SAS emoji) device verification — the flow lifecycle.
//!
//! Every to-device verification flow Quark takes part in is driven from here,
//! for both roles: the **initiator** (we sent `m.key.verification.request`) and
//! the **responder** (we received it). The frontend no longer polls the SDK and
//! nudges it along; instead each flow gets one backend *watcher* task that
//! subscribes to the SDK's own state observables (`VerificationRequest::changes`
//! and `SasVerification::changes`), takes the protocol steps that need no user
//! input, logs every transition, and pushes a [`VerificationUpdate`] to the
//! frontend on [`EVENT_VERIFICATION_STATE`].
//!
//! Facts about matrix-sdk(-crypto) 0.9 this module is built around (checked
//! against the crate source, not assumed):
//!
//! - **One flow per user at a time.** `VerificationMachine::insert_request` and
//!   `VerificationCache::insert` cancel *both* the old and the new flow when a
//!   second request/SAS with the same user appears while an older one is not
//!   cancelled. For self-verification that user is our own account, so any
//!   abandoned-but-not-cancelled attempt silently kills the next one. Hence:
//!   every flow is registered in [`VerificationFlows`], abandoned flows are
//!   cancelled for real, and a new outgoing request first cancels the live
//!   flows with that user.
//! - **`start_sas()` on a request that already has a SAS starts a second SAS**,
//!   which the cache's duplicate rule then cancels together with the first. So
//!   starting is guarded per flow and only done from the `Ready` state.
//! - **A start collision is resolved by the SDK** (the start from the
//!   lexicographically smaller user/device ID wins), but a `start_sas()` racing
//!   the processing of the other side's start can still trip the duplicate
//!   rule. So exactly one side starts in the normal case: the responder, right
//!   after it sends `ready`. The initiator starts only as a fallback, if no start
//!   has arrived [`INITIATOR_START_GRACE`] after the request turned `Ready`
//!   (for responders that wait to be started).
//! - **The SDK drops some incoming requests without telling anyone**: from a
//!   device whose keys we haven't fetched yet, or with a timestamp more than
//!   10 min old / 5 min in the future. The to-device event still reaches our
//!   handler, so [`on_incoming_request`] checks whether the SDK actually holds a
//!   usable request before the UI offers "Accept".
//! - **`SasState::Started` means *they* started; `Created` means *we* did.** A
//!   SAS the other side started must be accepted (`m.key.verification.accept`)
//!   before keys are exchanged; the watcher does that automatically — consent was
//!   given when the request was sent/accepted.
//! - **Emoji exist only in `KeysExchanged` / `MacReceived`.**
//! - **Observables coalesce**: a subscriber sees the latest value, not every
//!   intermediate one, so the watcher re-reads full state on each wake-up.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::pin::Pin;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use futures_util::{Stream, StreamExt};
use matrix_sdk::{
    encryption::verification::{
        CancelInfo, SasState, SasVerification, Verification, VerificationRequest,
        VerificationRequestState,
    },
    ruma::{
        api::client::to_device::send_event_to_device,
        events::{
            key::verification::{
                cancel::{CancelCode, ToDeviceKeyVerificationCancelEventContent},
                request::ToDeviceKeyVerificationRequestEventContent,
                VerificationMethod,
            },
            ToDeviceEvent, ToDeviceEventType,
        },
        serde::Raw,
        to_device::DeviceIdOrAllDevices,
        DeviceId, MilliSecondsSinceUnixEpoch, TransactionId, UserId,
    },
    Client,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tracing::{debug, error, info, warn};

use crate::events::{SyncVerificationRequest, EVENT_VERIFICATION_REQUEST};

// ─── Constants ────────────────────────────────────────────────────────────────

/// Emitted on every state change of a verification flow we take part in.
pub const EVENT_VERIFICATION_STATE: &str = "quark://verification/state";

/// Emitted after a verification finished and our own device's trust was
/// re-read from the server (payload: [`crate::matrix::crypto::VerificationStatus`]).
pub const EVENT_OWN_TRUST: &str = "quark://verification/own_trust";

/// How long the initiator waits, once the other device accepted, for the other
/// device to start SAS before starting it itself. Quark responders start right
/// after accepting, so between two Quark sessions this never fires and there is
/// no start collision; it exists for responders that wait to be started.
pub const INITIATOR_START_GRACE: Duration = Duration::from_secs(5);

/// How often a watcher re-reads state even without a change notification.
const RECHECK_INTERVAL: Duration = Duration::from_secs(15);

/// Upper bound on a watcher's life: the SDK's request timeout (10 min) plus
/// margin. A flow still not finished then is cancelled.
const WATCH_LIMIT: Duration = Duration::from_secs(11 * 60);

/// The SDK ignores requests older than this (`VerificationMachine::is_timestamp_valid`).
const SDK_MAX_REQUEST_AGE: Duration = Duration::from_secs(10 * 60);
/// … or further than this in the future.
const SDK_MAX_REQUEST_SKEW: Duration = Duration::from_secs(5 * 60);

/// Registry entries of finished flows are kept this long (so a late
/// `get_verification_state` still sees the outcome), then pruned.
const PRUNE_AFTER: Duration = Duration::from_secs(30 * 60);

/// Cancel code we send back when the SDK dropped a request because it didn't
/// know the requesting device's keys yet (custom codes use Java package naming).
pub const CANCEL_UNKNOWN_DEVICE: &str = "tel.quark.unknown_device";

/// Cancel code we send back when the SDK dropped a request for a reason we
/// can't name (the device's keys are known and the timestamp is in range).
pub const CANCEL_REQUEST_DROPPED: &str = "tel.quark.request_dropped";

// ─── Public types ─────────────────────────────────────────────────────────────

/// Where a flow is. Ordered: the frontend never moves a flow backwards.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    /// Request sent / received, not yet accepted.
    Requested,
    /// Request accepted (`ready`), SAS not started yet.
    Ready,
    /// A SAS `start` has been sent or received.
    Started,
    /// The SAS start was accepted; keys being exchanged.
    Accepted,
    /// Emoji available — waiting for the user to compare.
    KeysExchanged,
    /// We confirmed the emoji; waiting for the other side.
    Confirmed,
    Done,
    Cancelled,
}

impl Phase {
    pub fn is_terminal(self) -> bool {
        matches!(self, Phase::Done | Phase::Cancelled)
    }
}

/// One snapshot of a verification flow, pushed on [`EVENT_VERIFICATION_STATE`]
/// and returned by `get_verification_state`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VerificationUpdate {
    pub flow_id: String,
    /// The other party's user ID (our own for self-verification).
    pub user_id: String,
    pub other_device_id: Option<String>,
    /// `true` when we sent the request (initiator), `false` when we received it.
    pub we_started: bool,
    pub phase: Phase,
    /// `[symbol, description]` × 7 once keys are exchanged, else empty.
    pub emoji: Vec<[String; 2]>,
    pub decimals: Option<[u16; 3]>,
    pub cancel_code: Option<String>,
    pub cancel_reason: Option<String>,
    pub cancelled_by_us: Option<bool>,
}

/// SAS emoji info for a flow (legacy polling API, kept for `get_sas_info`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SasInfo {
    pub flow_id: String,
    pub other_user_id: String,
    pub other_device_id: String,
    /// The emoji list for SAS verification (index 0..6, each is [emoji, description]).
    pub emoji: Vec<[String; 2]>,
    pub decimals: Option<[u16; 3]>,
}

// ─── Pure state mapping (unit-tested) ─────────────────────────────────────────

/// What the `VerificationRequest` alone says.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RequestPhase {
    Created,
    Requested,
    Ready,
    Transitioned,
    Done,
    Cancelled,
}

impl From<&VerificationRequestState> for RequestPhase {
    fn from(s: &VerificationRequestState) -> Self {
        match s {
            VerificationRequestState::Created { .. } => RequestPhase::Created,
            VerificationRequestState::Requested { .. } => RequestPhase::Requested,
            VerificationRequestState::Ready { .. } => RequestPhase::Ready,
            VerificationRequestState::Transitioned { .. } => RequestPhase::Transitioned,
            VerificationRequestState::Done => RequestPhase::Done,
            VerificationRequestState::Cancelled(_) => RequestPhase::Cancelled,
        }
    }
}

/// What the SAS alone says.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SasPhase {
    /// `SasState::Created`: we sent the start, waiting for their accept.
    WeStarted,
    /// `SasState::Started`: they sent the start, we must accept it.
    TheyStarted,
    Accepted,
    KeysExchanged,
    Confirmed,
    Done,
    Cancelled,
}

impl From<&SasState> for SasPhase {
    fn from(s: &SasState) -> Self {
        match s {
            SasState::Created { .. } => SasPhase::WeStarted,
            SasState::Started { .. } => SasPhase::TheyStarted,
            SasState::Accepted { .. } => SasPhase::Accepted,
            SasState::KeysExchanged { .. } => SasPhase::KeysExchanged,
            SasState::Confirmed => SasPhase::Confirmed,
            SasState::Done { .. } => SasPhase::Done,
            SasState::Cancelled(_) => SasPhase::Cancelled,
        }
    }
}

/// Combine request and SAS state into one [`Phase`]. `None` when the SDK knows
/// neither (flow unknown or already garbage-collected).
pub(crate) fn combine_phase(req: Option<RequestPhase>, sas: Option<SasPhase>) -> Option<Phase> {
    if req == Some(RequestPhase::Cancelled) || sas == Some(SasPhase::Cancelled) {
        return Some(Phase::Cancelled);
    }
    if req == Some(RequestPhase::Done) || sas == Some(SasPhase::Done) {
        return Some(Phase::Done);
    }
    if let Some(s) = sas {
        return Some(match s {
            SasPhase::WeStarted | SasPhase::TheyStarted => Phase::Started,
            SasPhase::Accepted => Phase::Accepted,
            SasPhase::KeysExchanged => Phase::KeysExchanged,
            SasPhase::Confirmed => Phase::Confirmed,
            SasPhase::Done => Phase::Done,
            SasPhase::Cancelled => Phase::Cancelled,
        });
    }
    req.map(|r| match r {
        RequestPhase::Created | RequestPhase::Requested => Phase::Requested,
        RequestPhase::Ready => Phase::Ready,
        RequestPhase::Transitioned => Phase::Started,
        RequestPhase::Done => Phase::Done,
        RequestPhase::Cancelled => Phase::Cancelled,
    })
}

/// The protocol step a watcher should take for the state it just observed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum NextStep {
    Wait,
    /// They started SAS — send our accept.
    AcceptSas,
    /// We are the initiator, the request is ready and nobody started SAS:
    /// arm the start fallback.
    ArmStartFallback,
    /// Terminal state reached.
    Finish,
}

pub(crate) fn next_step(we_started: bool, req: Option<RequestPhase>, sas: Option<SasPhase>) -> NextStep {
    match combine_phase(req, sas) {
        Some(p) if p.is_terminal() => NextStep::Finish,
        None => NextStep::Wait,
        Some(_) => {
            if sas == Some(SasPhase::TheyStarted) {
                NextStep::AcceptSas
            } else if we_started && req == Some(RequestPhase::Ready) && sas.is_none() {
                NextStep::ArmStartFallback
            } else {
                NextStep::Wait
            }
        }
    }
}

/// Why the SDK did not register an incoming request whose event we saw.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DropReason {
    /// Older than the SDK's 10 min limit.
    TooOld,
    /// More than 5 min in the future (clock skew).
    FromTheFuture,
    /// We have no device keys for the requesting device yet.
    UnknownDevice,
    Unknown,
}

pub(crate) fn classify_dropped_request(
    sent_ms: u64,
    now_ms: u64,
    device_known: bool,
) -> DropReason {
    if now_ms.saturating_sub(sent_ms) > SDK_MAX_REQUEST_AGE.as_millis() as u64 {
        DropReason::TooOld
    } else if sent_ms.saturating_sub(now_ms) > SDK_MAX_REQUEST_SKEW.as_millis() as u64 {
        DropReason::FromTheFuture
    } else if !device_known {
        DropReason::UnknownDevice
    } else {
        DropReason::Unknown
    }
}

/// The cancel to send for a dropped request: `(code, reason shown here, reason
/// sent to the requester)`, or `None` when the request is stale and nobody is
/// still waiting on it. Only a missing device is blamed on keys; a request
/// dropped for no reason we can name says so instead of sending the requester
/// to retry for keys we already have.
pub(crate) fn dropped_request_cancel(
    reason: DropReason,
) -> Option<(&'static str, &'static str, &'static str)> {
    match reason {
        DropReason::TooOld | DropReason::FromTheFuture => None,
        DropReason::UnknownDevice => Some((
            CANCEL_UNKNOWN_DEVICE,
            "This session didn't have the other device's keys yet. Try again in a few seconds.",
            "The other session did not know this device's keys yet; try again.",
        )),
        DropReason::Unknown => Some((
            CANCEL_REQUEST_DROPPED,
            "This session couldn't take up the request. Try again.",
            "The other session could not take up this request; try again.",
        )),
    }
}

fn role(we_started: bool) -> &'static str {
    if we_started { "initiator" } else { "responder" }
}

fn cancel_fields(info: Option<CancelInfo>) -> (Option<String>, Option<String>, Option<bool>) {
    match info {
        Some(c) => (
            Some(c.cancel_code().as_str().to_owned()),
            Some(c.reason().to_owned()),
            Some(c.cancelled_by_us()),
        ),
        None => (None, None, None),
    }
}

// ─── Flow registry ────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct FlowEntry {
    user_id: String,
    other_device_id: Option<String>,
    other_device_name: Option<String>,
    we_started: bool,
    watching: bool,
    last: Option<VerificationUpdate>,
    registered_at: Instant,
}

/// Every verification flow this process has taken part in, by flow ID.
///
/// The SDK exposes no "list the requests with this user" call on the public
/// `Client`, yet it cancels a new flow whenever an older one with the same user
/// is still open. This registry is how Quark knows which older flows to cancel
/// first, which flows already have a watcher, and what a finished flow ended in
/// after the SDK has garbage-collected it.
#[derive(Default)]
pub struct VerificationFlows {
    flows: Mutex<HashMap<String, FlowEntry>>,
    /// `"<flow_id>/<action>"` keys of protocol actions currently in progress.
    in_flight: Mutex<HashSet<String>>,
}

/// Held while a per-flow protocol action runs; dropping it releases the slot.
pub struct ActionGuard<'a> {
    set: &'a Mutex<HashSet<String>>,
    key: String,
}

impl Drop for ActionGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut set) = self.set.lock() {
            set.remove(&self.key);
        }
    }
}

impl VerificationFlows {
    /// Record a flow (idempotent; fills in device info learned later).
    pub fn register(
        &self,
        flow_id: &str,
        user_id: &str,
        other_device_id: Option<String>,
        other_device_name: Option<String>,
        we_started: bool,
    ) {
        let Ok(mut flows) = self.flows.lock() else { return };
        flows.retain(|_, e| {
            !(e.last.as_ref().is_some_and(|u| u.phase.is_terminal())
                && e.registered_at.elapsed() > PRUNE_AFTER)
        });
        let entry = flows.entry(flow_id.to_owned()).or_insert_with(|| FlowEntry {
            user_id: user_id.to_owned(),
            other_device_id: None,
            other_device_name: None,
            we_started,
            watching: false,
            last: None,
            registered_at: Instant::now(),
        });
        if entry.other_device_id.is_none() {
            entry.other_device_id = other_device_id;
        }
        if entry.other_device_name.is_none() {
            entry.other_device_name = other_device_name;
        }
    }

    /// Claim the watcher slot for a flow. `true` means the caller must spawn it.
    pub fn begin_watch(&self, flow_id: &str) -> bool {
        let Ok(mut flows) = self.flows.lock() else { return false };
        match flows.get_mut(flow_id) {
            Some(e) if !e.watching => {
                e.watching = true;
                true
            }
            _ => false,
        }
    }

    pub fn end_watch(&self, flow_id: &str) {
        if let Ok(mut flows) = self.flows.lock() {
            if let Some(e) = flows.get_mut(flow_id) {
                e.watching = false;
            }
        }
    }

    pub fn record(&self, update: &VerificationUpdate) {
        if let Ok(mut flows) = self.flows.lock() {
            if let Some(e) = flows.get_mut(&update.flow_id) {
                if e.other_device_id.is_none() {
                    e.other_device_id = update.other_device_id.clone();
                }
                e.last = Some(update.clone());
            }
        }
    }

    pub fn last(&self, flow_id: &str) -> Option<VerificationUpdate> {
        self.flows.lock().ok()?.get(flow_id)?.last.clone()
    }

    pub fn other_device(&self, flow_id: &str) -> (Option<String>, Option<String>) {
        self.flows
            .lock()
            .ok()
            .and_then(|f| f.get(flow_id).map(|e| (e.other_device_id.clone(), e.other_device_name.clone())))
            .unwrap_or((None, None))
    }

    /// Flows with `user_id` not known to have finished.
    pub fn live_flows_with(&self, user_id: &str) -> Vec<String> {
        let Ok(flows) = self.flows.lock() else { return vec![] };
        flows
            .iter()
            .filter(|(_, e)| e.user_id == user_id)
            .filter(|(_, e)| !e.last.as_ref().is_some_and(|u| u.phase.is_terminal()))
            .map(|(id, _)| id.clone())
            .collect()
    }

    /// An unanswered incoming request from this exact device, if any.
    pub fn pending_incoming_from(&self, user_id: &str, device_id: &str) -> Option<String> {
        self.pending_incoming()
            .into_iter()
            .find(|p| p.user_id == user_id && p.device_id == device_id)
            .map(|p| p.flow_id)
    }

    /// Incoming requests still waiting for the user to accept or reject.
    pub fn pending_incoming(&self) -> Vec<SyncVerificationRequest> {
        let Ok(flows) = self.flows.lock() else { return vec![] };
        flows
            .iter()
            .filter(|(_, e)| !e.we_started)
            // `None`: registered, watcher hasn't recorded yet — callers re-check
            // the SDK, so include it rather than miss a fresh request.
            .filter(|(_, e)| e.last.as_ref().is_none_or(|u| u.phase == Phase::Requested))
            .map(|(id, e)| SyncVerificationRequest {
                user_id: e.user_id.clone(),
                device_id: e.other_device_id.clone().unwrap_or_default(),
                device_name: e.other_device_name.clone(),
                flow_id: id.clone(),
            })
            .collect()
    }

    /// Claim a per-flow action slot; `None` if the same action is already
    /// running for this flow (double-click, key repeat, racing callers).
    pub fn try_begin(&self, flow_id: &str, action: &str) -> Option<ActionGuard<'_>> {
        let key = format!("{flow_id}/{action}");
        let mut set = self.in_flight.lock().ok()?;
        if !set.insert(key.clone()) {
            return None;
        }
        Some(ActionGuard { set: &self.in_flight, key })
    }
}

// ─── SDK access helpers ───────────────────────────────────────────────────────

async fn get_sas(client: &Client, user_id: &UserId, flow_id: &str) -> Option<SasVerification> {
    match client.encryption().get_verification(user_id, flow_id).await {
        Some(Verification::SasV1(s)) => Some(s),
        _ => None,
    }
}

fn own_device(client: &Client) -> String {
    client.device_id().map(|d| d.to_string()).unwrap_or_default()
}

/// Build the current [`VerificationUpdate`] from SDK objects.
fn build_update(
    flow_id: &str,
    user_id: &UserId,
    we_started: bool,
    request: Option<&VerificationRequest>,
    sas: Option<&SasVerification>,
    known_device: Option<String>,
) -> Option<VerificationUpdate> {
    let req_state = request.map(|r| r.state());
    let req_phase = req_state.as_ref().map(RequestPhase::from);
    let sas_phase = sas.map(|s| SasPhase::from(&s.state()));
    let phase = combine_phase(req_phase, sas_phase)?;

    let other_device_id = sas
        .map(|s| s.other_device().device_id().to_string())
        .or_else(|| match &req_state {
            Some(VerificationRequestState::Requested { other_device_data, .. })
            | Some(VerificationRequestState::Ready { other_device_data, .. }) => {
                Some(other_device_data.device_id().to_string())
            }
            _ => None,
        })
        .or(known_device);

    let emoji = sas
        .and_then(|s| s.emoji())
        .map(|e| e.iter().map(|e| [e.symbol.to_string(), e.description.to_string()]).collect())
        .unwrap_or_default();
    let decimals = sas.and_then(|s| s.decimals()).map(|(a, b, c)| [a, b, c]);

    let (cancel_code, cancel_reason, cancelled_by_us) = if phase == Phase::Cancelled {
        cancel_fields(sas.and_then(|s| s.cancel_info()).or_else(|| request.and_then(|r| r.cancel_info())))
    } else {
        (None, None, None)
    };

    Some(VerificationUpdate {
        flow_id: flow_id.to_owned(),
        user_id: user_id.to_string(),
        other_device_id,
        we_started,
        phase,
        emoji,
        decimals,
        cancel_code,
        cancel_reason,
        cancelled_by_us,
    })
}

/// Current state of a flow: live from the SDK, else the last state we saw.
pub async fn snapshot(
    client: &Client,
    flows: &VerificationFlows,
    user_id: &UserId,
    flow_id: &str,
) -> Option<VerificationUpdate> {
    let request = client.encryption().get_verification_request(user_id, flow_id).await;
    let sas = get_sas(client, user_id, flow_id).await;
    let we_started = request
        .as_ref()
        .map(|r| r.we_started())
        .or_else(|| sas.as_ref().map(|s| s.we_started()));
    match we_started {
        Some(ws) => {
            let (dev, _) = flows.other_device(flow_id);
            build_update(flow_id, user_id, ws, request.as_ref(), sas.as_ref(), dev)
        }
        None => flows.last(flow_id),
    }
}

fn emit_update(app: &AppHandle, update: &VerificationUpdate) {
    if let Err(e) = app.emit(EVENT_VERIFICATION_STATE, update) {
        error!("Failed to emit {}: {}", EVENT_VERIFICATION_STATE, e);
    }
}

/// Start SAS on a ready request — at most once, and never when a SAS already
/// exists (a second `start_sas()` makes the SDK cancel the flow). On failure
/// the flow is cancelled so the other side doesn't wait on a start that never
/// left: a half-started flow is worse than a cleanly failed one.
async fn start_sas_once(
    client: &Client,
    flows: &VerificationFlows,
    request: &VerificationRequest,
    why: &str,
) -> Result<bool, String> {
    let flow_id = request.flow_id().to_owned();
    let user_id = request.other_user_id().to_owned();
    let Some(_guard) = flows.try_begin(&flow_id, "start_sas") else {
        debug!(flow_id = %flow_id, "verification: start_sas already in progress, skipping");
        return Ok(false);
    };
    if !request.is_ready() {
        debug!(flow_id = %flow_id, state = ?RequestPhase::from(&request.state()), "verification: not starting SAS — request is not in Ready");
        return Ok(false);
    }
    if get_sas(client, &user_id, &flow_id).await.is_some() {
        debug!(flow_id = %flow_id, "verification: not starting SAS — one already exists");
        return Ok(false);
    }
    info!(
        flow_id = %flow_id, role = role(request.we_started()), own_device = %own_device(client),
        other_user = %user_id, why, "verification: starting SAS"
    );
    match request.start_sas().await {
        Ok(Some(_)) => {
            info!(flow_id = %flow_id, "verification: SAS start sent");
            Ok(true)
        }
        Ok(None) => {
            warn!(flow_id = %flow_id, "verification: SDK declined to start SAS (other side doesn't support m.sas.v1?)");
            Ok(false)
        }
        Err(e) => {
            error!(flow_id = %flow_id, error = %e, "verification: sending SAS start failed — cancelling the flow");
            let _ = request.cancel().await;
            Err(format!("Failed to start SAS: {e}"))
        }
    }
}

/// Cancel a flow everywhere it lives: the SAS (which also cancels its request)
/// and the request itself (which covers flows that never got a SAS — the
/// pre-fix code only did the former, leaving requests open to kill the next
/// attempt). Idempotent; cancelling a finished flow is a no-op.
pub async fn cancel_flow(client: &Client, user_id: &UserId, flow_id: &str, mismatch: bool, why: &str) {
    let enc = client.encryption();
    let sas = get_sas(client, user_id, flow_id).await;
    let request = enc.get_verification_request(user_id, flow_id).await;
    info!(
        flow_id, own_device = %own_device(client), other_user = %user_id, why, mismatch,
        has_sas = sas.is_some(), has_request = request.is_some(), "verification: cancelling flow"
    );
    if let Some(sas) = sas {
        if !sas.is_done() && !sas.is_cancelled() {
            let res = if mismatch { sas.mismatch().await } else { sas.cancel().await };
            if let Err(e) = res {
                warn!(flow_id, error = %e, "verification: sending SAS cancel failed");
            }
        }
    }
    if let Some(request) = request {
        if !request.is_done() && !request.is_cancelled() {
            if let Err(e) = request.cancel().await {
                warn!(flow_id, error = %e, "verification: sending request cancel failed");
            }
        }
    }
}

// ─── Watcher ──────────────────────────────────────────────────────────────────

type SasStream = Pin<Box<dyn Stream<Item = SasState> + Send>>;

/// Ensure a watcher task drives `request`. Safe to call repeatedly.
pub fn ensure_watcher(client: &Client, app: &AppHandle, request: VerificationRequest) {
    let flows = app.state::<VerificationFlows>();
    let flow_id = request.flow_id().to_owned();
    flows.register(&flow_id, request.other_user_id().as_str(), None, None, request.we_started());
    if !flows.begin_watch(&flow_id) {
        return;
    }
    let client = client.clone();
    let app = app.clone();
    tokio::spawn(async move {
        watch_flow(&client, &app, request).await;
        app.state::<VerificationFlows>().end_watch(&flow_id);
    });
}

async fn watch_flow(client: &Client, app: &AppHandle, request: VerificationRequest) {
    let flows = app.state::<VerificationFlows>();
    let flow_id = request.flow_id().to_owned();
    let user_id = request.other_user_id().to_owned();
    let we_started = request.we_started();
    let own = own_device(client);

    // Subscribe before the first read so no transition falls in between.
    let mut req_changes = Box::pin(request.changes());
    let mut req_stream_open = true;
    let mut last: Option<VerificationUpdate> = None;
    let mut start_deadline: Option<tokio::time::Instant> = None;
    let mut start_fallback_used = false;
    let mut accept_attempts = 0u8;
    let hard_deadline = tokio::time::Instant::now() + WATCH_LIMIT;

    info!(flow_id = %flow_id, role = role(we_started), own_device = %own, other_user = %user_id, "verification: watching flow");

    loop {
        // Re-fetch the SAS every time: it appears mid-flow, and a start
        // collision replaces it in the SDK cache with the winning one.
        let sas = get_sas(client, &user_id, &flow_id).await;
        let mut sas_changes: Option<SasStream> =
            sas.as_ref().map(|s| Box::pin(s.changes()) as SasStream);

        let req_phase = RequestPhase::from(&request.state());
        let sas_phase = sas.as_ref().map(|s| SasPhase::from(&s.state()));
        let (known_dev, _) = flows.other_device(&flow_id);
        let update = build_update(&flow_id, &user_id, we_started, Some(&request), sas.as_ref(), known_dev);

        if let Some(update) = &update {
            if last.as_ref() != Some(update) {
                info!(
                    flow_id = %flow_id, role = role(we_started), own_device = %own,
                    other_user = %user_id,
                    other_device = update.other_device_id.as_deref().unwrap_or("?"),
                    phase = ?update.phase, request = ?req_phase, sas = ?sas_phase,
                    sas_we_started = sas.as_ref().map(|s| s.we_started()),
                    cancel_code = update.cancel_code.as_deref(),
                    cancel_reason = update.cancel_reason.as_deref(),
                    cancelled_by_us = update.cancelled_by_us,
                    "verification: state"
                );
                flows.record(update);
                emit_update(app, update);
                last = Some(update.clone());
            }
        }

        match next_step(we_started, Some(req_phase), sas_phase) {
            NextStep::Finish => {
                if last.as_ref().is_some_and(|u| u.phase == Phase::Done) {
                    after_done(client, app, &flow_id, &user_id).await;
                }
                break;
            }
            NextStep::AcceptSas => {
                // Bounded: a start collision can legitimately need a second
                // accept (for the winning SAS), never more.
                if let (Some(sas), true) = (&sas, accept_attempts < 3) {
                    if let Some(_g) = flows.try_begin(&flow_id, "accept_sas") {
                        accept_attempts += 1;
                        info!(flow_id = %flow_id, role = role(we_started), own_device = %own, attempt = accept_attempts, "verification: other side started SAS — accepting");
                        if let Err(e) = sas.accept().await {
                            // The SDK has already moved to "we accepted", so the
                            // other side would wait on an accept that never left.
                            error!(flow_id = %flow_id, error = %e, "verification: sending SAS accept failed — cancelling the flow");
                            cancel_flow(client, &user_id, &flow_id, false, "accept send failed").await;
                        }
                        continue; // state changed locally; re-read at once
                    }
                }
            }
            NextStep::ArmStartFallback => {
                if start_deadline.is_none() && !start_fallback_used {
                    debug!(flow_id = %flow_id, grace_s = INITIATOR_START_GRACE.as_secs(), "verification: request ready — waiting for the other side to start SAS");
                    start_deadline = Some(tokio::time::Instant::now() + INITIATOR_START_GRACE);
                }
            }
            NextStep::Wait => {}
        }
        // A SAS appeared (or the request moved on): the fallback is moot.
        if sas_phase.is_some() || req_phase != RequestPhase::Ready {
            start_deadline = None;
        }

        tokio::select! {
            changed = req_changes.next(), if req_stream_open => {
                if changed.is_none() {
                    req_stream_open = false;
                }
            }
            Some(_) = async {
                match sas_changes.as_mut() {
                    Some(s) => s.next().await,
                    None => std::future::pending().await,
                }
            } => {}
            _ = async {
                match start_deadline {
                    Some(d) => tokio::time::sleep_until(d).await,
                    None => std::future::pending().await,
                }
            } => {
                start_deadline = None;
                start_fallback_used = true;
                info!(flow_id = %flow_id, own_device = %own, "verification: other side did not start SAS within the grace period");
                if let Err(e) = start_sas_once(client, &flows, &request, "initiator fallback").await {
                    warn!(flow_id = %flow_id, error = %e, "verification: fallback SAS start failed");
                }
            }
            _ = tokio::time::sleep(RECHECK_INTERVAL) => {}
            _ = tokio::time::sleep_until(hard_deadline) => {
                warn!(flow_id = %flow_id, own_device = %own, "verification: flow did not finish within the watch limit — cancelling");
                cancel_flow(client, &user_id, &flow_id, false, "watch limit").await;
                // One more pass to report the cancelled state, then stop.
                if let Some(u) = snapshot(client, &flows, &user_id, &flow_id).await {
                    flows.record(&u);
                    emit_update(app, &u);
                }
                break;
            }
        }
    }
    info!(flow_id = %flow_id, role = role(we_started), own_device = %own, "verification: watcher finished");
}

/// After a successful verification: log what it changed, re-fetch our own keys
/// so the other device's signature on this one is picked up now rather than on
/// the next device-list change, and tell the frontend the resulting own trust.
async fn after_done(client: &Client, app: &AppHandle, flow_id: &str, user_id: &UserId) {
    let enc = client.encryption();
    if let Some(cs) = enc.cross_signing_status().await {
        info!(
            flow_id, has_master = cs.has_master, has_self_signing = cs.has_self_signing,
            has_user_signing = cs.has_user_signing,
            "verification: done — local cross-signing keys (without self-signing this device cannot sign the other one)"
        );
    }
    // Own trust only changes when we verified one of our own devices.
    if client.user_id() != Some(user_id) {
        return;
    }
    let client = client.clone();
    let app = app.clone();
    let flow_id = flow_id.to_owned();
    let user_id = user_id.to_owned();
    tokio::spawn(async move {
        // Give the other side a moment to upload its signature of us.
        tokio::time::sleep(Duration::from_secs(2)).await;
        if let Err(e) = client.encryption().request_user_identity(&user_id).await {
            warn!(flow_id = %flow_id, error = %e, "verification: post-done key query failed");
        }
        match crate::matrix::crypto::get_own_verification_status(&client).await {
            Ok(status) => {
                info!(
                    flow_id = %flow_id, own_device = %status.device_id,
                    cross_signed = status.is_cross_signed, trust = %status.trust_level,
                    "verification: own trust after verification"
                );
                if let Err(e) = app.emit(EVENT_OWN_TRUST, &status) {
                    error!("Failed to emit {}: {}", EVENT_OWN_TRUST, e);
                }
            }
            Err(e) => warn!(flow_id = %flow_id, error = %e, "verification: reading own trust failed"),
        }
    });
}

// ─── Incoming requests ────────────────────────────────────────────────────────

/// Handle an `m.key.verification.request` to-device event. Runs after the SDK
/// processed the sync, so the SDK's verdict on the request is already in.
pub async fn on_incoming_request(
    client: Client,
    app: AppHandle,
    ev: ToDeviceEvent<ToDeviceKeyVerificationRequestEventContent>,
) {
    let flow_id = ev.content.transaction_id.to_string();
    let sender = ev.sender.clone();
    let from_device = ev.content.from_device.clone();
    let own = own_device(&client);
    info!(
        flow_id = %flow_id, role = "responder", own_device = %own, other_user = %sender,
        other_device = %from_device, methods = ?ev.content.methods,
        "verification: incoming request event"
    );

    let enc = client.encryption();
    let flows = app.state::<VerificationFlows>();

    match enc.get_verification_request(&sender, &flow_id).await {
        Some(request) => {
            let state = request.state();
            let device_name = match &state {
                VerificationRequestState::Requested { other_device_data, .. } => {
                    other_device_data.display_name().map(str::to_owned)
                }
                _ => None,
            };
            flows.register(&flow_id, sender.as_str(), Some(from_device.to_string()), device_name.clone(), false);
            let actionable = matches!(state, VerificationRequestState::Requested { .. });
            if actionable {
                let payload = SyncVerificationRequest {
                    user_id: sender.to_string(),
                    device_id: from_device.to_string(),
                    device_name,
                    flow_id: flow_id.clone(),
                };
                // Watcher first so the frontend's first state query finds it.
                ensure_watcher(&client, &app, request);
                if let Err(e) = app.emit(EVENT_VERIFICATION_REQUEST, &payload) {
                    error!("Failed to emit {}: {}", EVENT_VERIFICATION_REQUEST, e);
                }
            } else {
                // Most likely cancelled on arrival: the SDK allows one flow per
                // user and cancels old *and* new when a second one shows up.
                let others = flows.live_flows_with(sender.as_str());
                warn!(
                    flow_id = %flow_id, own_device = %own, other_device = %from_device,
                    state = ?RequestPhase::from(&state), cancel = ?request.cancel_info(),
                    other_live_flows = ?others,
                    "verification: incoming request is not actionable (SDK cancelled it on arrival — another flow with this user was open)"
                );
                // Report it so the UI can say why instead of showing a dead prompt.
                ensure_watcher(&client, &app, request);
            }
        }
        None => {
            let sent_ms: u64 = ev.content.timestamp.get().into();
            let now_ms: u64 = MilliSecondsSinceUnixEpoch::now().get().into();
            let device_known = matches!(enc.get_device(&sender, &from_device).await, Ok(Some(_)));
            let reason = classify_dropped_request(sent_ms, now_ms, device_known);
            let age_s = (now_ms as i64 - sent_ms as i64) / 1000;
            match dropped_request_cancel(reason) {
                None => {
                    info!(
                        flow_id = %flow_id, own_device = %own, other_device = %from_device, age_s, ?reason,
                        "verification: SDK ignored a stale request (timestamp outside its window) — not prompting"
                    );
                }
                Some((code, local_reason, peer_reason)) => {
                    let keys_missing = reason == DropReason::UnknownDevice;
                    if keys_missing {
                        warn!(
                            flow_id = %flow_id, own_device = %own, other_device = %from_device, age_s, ?reason,
                            "verification: SDK dropped the request — the requesting device's keys are not known here yet"
                        );
                    } else {
                        warn!(
                            flow_id = %flow_id, own_device = %own, other_device = %from_device, age_s, ?reason,
                            "verification: SDK dropped the request for an unknown reason (device keys known, timestamp in range)"
                        );
                    }
                    flows.register(&flow_id, sender.as_str(), Some(from_device.to_string()), None, false);
                    let update = VerificationUpdate {
                        flow_id: flow_id.clone(),
                        user_id: sender.to_string(),
                        other_device_id: Some(from_device.to_string()),
                        we_started: false,
                        phase: Phase::Cancelled,
                        emoji: vec![],
                        decimals: None,
                        cancel_code: Some(code.to_owned()),
                        cancel_reason: Some(local_reason.to_owned()),
                        cancelled_by_us: Some(true),
                    };
                    flows.record(&update);
                    emit_update(&app, &update);
                    // Network work off the sync handler: tell the requester (so
                    // its UI stops waiting and its request can't block the
                    // retry), and, when keys were the problem, fetch them so the
                    // retry succeeds.
                    tokio::spawn(async move {
                        if let Err(e) = send_raw_cancel(
                            &client,
                            &sender,
                            &from_device,
                            &flow_id,
                            CancelCode::from(code),
                            peer_reason,
                        )
                        .await
                        {
                            warn!(flow_id = %flow_id, error = %e, "verification: sending cancel for dropped request failed");
                        }
                        if !keys_missing {
                            return;
                        }
                        match client.encryption().request_user_identity(&sender).await {
                            Ok(_) => {
                                let known = matches!(client.encryption().get_device(&sender, &from_device).await, Ok(Some(_)));
                                info!(flow_id = %flow_id, other_device = %from_device, now_known = known, "verification: re-queried keys after dropped request");
                            }
                            Err(e) => warn!(flow_id = %flow_id, error = %e, "verification: key query after dropped request failed"),
                        }
                    });
                }
            }
        }
    }
}

/// Send an `m.key.verification.cancel` for a flow the SDK has no object for.
async fn send_raw_cancel(
    client: &Client,
    user_id: &UserId,
    device_id: &DeviceId,
    flow_id: &str,
    code: CancelCode,
    reason: &str,
) -> Result<(), String> {
    let content =
        ToDeviceKeyVerificationCancelEventContent::new(flow_id.into(), reason.to_owned(), code);
    let raw = Raw::new(&content).map_err(|e| format!("serialize cancel: {e}"))?.cast();
    let mut per_device = BTreeMap::new();
    per_device.insert(DeviceIdOrAllDevices::DeviceId(device_id.to_owned()), raw);
    let mut messages = BTreeMap::new();
    messages.insert(user_id.to_owned(), per_device);
    let request = send_event_to_device::v3::Request::new_raw(
        ToDeviceEventType::KeyVerificationCancel,
        TransactionId::new(),
        messages,
    );
    client.send(request, None).await.map_err(|e| format!("send cancel: {e}"))?;
    info!(flow_id, other_device = %device_id, "verification: sent cancel for a request the SDK dropped");
    Ok(())
}

// ─── Command implementations ──────────────────────────────────────────────────

fn parse_user(user_id: &str) -> Result<matrix_sdk::ruma::OwnedUserId, String> {
    UserId::parse(user_id).map_err(|e| format!("Invalid user ID: {e}"))
}

/// Send a verification request to one device and start watching it. Live
/// flows with the same user are cancelled first — otherwise the SDK cancels
/// the new request on the spot (one flow per user).
///
/// If that device already sent *us* a request we haven't answered, it is
/// accepted instead and its flow ID returned: the user wants to verify against
/// that device and the request is already there, and a second request would
/// make the SDK cancel both (seen live: the startup "verify this session"
/// prompt hid an incoming request, and "Verify now" raced it).
pub async fn start_sas_verification(
    client: &Client,
    app: &AppHandle,
    user_id_str: &str,
    device_id_str: &str,
) -> Result<String, String> {
    let user_id = parse_user(user_id_str)?;
    let flows = app.state::<VerificationFlows>();
    let own = own_device(client);

    if let Some(flow_id) = flows.pending_incoming_from(user_id.as_str(), device_id_str) {
        let live = client
            .encryption()
            .get_verification_request(&user_id, &flow_id)
            .await
            .is_some_and(|r| matches!(r.state(), VerificationRequestState::Requested { .. }));
        if live {
            info!(
                flow_id = %flow_id, own_device = %own, other_device = %device_id_str,
                "verification: that device already sent us a request — accepting it instead of sending a competing one"
            );
            accept_verification_request(client, app, user_id_str, &flow_id).await?;
            return Ok(flow_id);
        }
    }

    let device = client
        .encryption()
        .get_device(&user_id, device_id_str.into())
        .await
        .map_err(|e| format!("Failed to get device: {e}"))?
        .ok_or_else(|| {
            format!("Device {device_id_str} not found for {user_id_str} — its keys may not have synced yet")
        })?;

    let stale = flows.live_flows_with(user_id.as_str());
    if !stale.is_empty() {
        info!(own_device = %own, other_user = %user_id, flows = ?stale, "verification: cancelling earlier flows with this user before a new request");
        for flow in &stale {
            cancel_flow(client, &user_id, flow, false, "superseded by a new request").await;
        }
    }

    let request = device
        .request_verification()
        .await
        .map_err(|e| format!("Failed to send verification request: {e}"))?;
    let flow_id = request.flow_id().to_owned();
    flows.register(&flow_id, user_id.as_str(), Some(device_id_str.to_owned()), device.display_name().map(str::to_owned), true);
    if request.is_cancelled() {
        warn!(
            flow_id = %flow_id, own_device = %own, other_device = %device_id_str, cancel = ?request.cancel_info(),
            "verification: SDK cancelled the new request immediately — another flow with this user was still open"
        );
    } else {
        info!(flow_id = %flow_id, role = "initiator", own_device = %own, other_user = %user_id, other_device = %device_id_str, "verification: request sent");
    }
    ensure_watcher(client, app, request);
    Ok(flow_id)
}

/// Accept an incoming request (send `ready`) and start SAS. Idempotent: a
/// second call (double-click, Enter repeat) is a no-op instead of a second
/// `start_sas()` that would make the SDK cancel the flow.
pub async fn accept_verification_request(
    client: &Client,
    app: &AppHandle,
    user_id_str: &str,
    flow_id: &str,
) -> Result<(), String> {
    let user_id = parse_user(user_id_str)?;
    let flows = app.state::<VerificationFlows>();
    let Some(_guard) = flows.try_begin(flow_id, "accept_request") else {
        debug!(flow_id, "verification: accept already in progress, ignoring duplicate");
        return Ok(());
    };
    let request = client
        .encryption()
        .get_verification_request(&user_id, flow_id)
        .await
        .ok_or_else(|| "This verification request is no longer known — it may have timed out. Start a new one.".to_string())?;
    if let Some(c) = request.cancel_info() {
        return Err(format!("This verification was cancelled: {}", c.reason()));
    }
    ensure_watcher(client, app, request.clone());

    match RequestPhase::from(&request.state()) {
        RequestPhase::Requested => {
            info!(flow_id, role = "responder", own_device = %own_device(client), other_user = %user_id, "verification: accepting request (ready, methods=[m.sas.v1])");
            // Only SAS: this build has no QR support (matrix-sdk `qrcode`
            // feature off), so advertising QR methods would offer a flow we
            // can't complete.
            if let Err(e) = request.accept_with_methods(vec![VerificationMethod::SasV1]).await {
                // Left open, the request would block the next attempt with this
                // user (one live flow per user) and keep the requester waiting.
                error!(flow_id, error = %e, "verification: sending ready failed — cancelling the flow");
                cancel_flow(client, &user_id, flow_id, false, "ready send failed").await;
                return Err(format!("Failed to accept verification request: {e}"));
            }
        }
        other => {
            info!(flow_id, state = ?other, "verification: request already accepted — not sending ready again");
        }
    }
    // Responder starts SAS right away (see module docs); a no-op if it exists.
    start_sas_once(client, &flows, &request, "responder after ready").await?;
    Ok(())
}

/// Accept a SAS the other side started. The watcher already does this; kept as
/// a safe, idempotent command. Never starts SAS.
pub async fn accept_sas_verification(
    client: &Client,
    app: &AppHandle,
    user_id_str: &str,
    flow_id: &str,
) -> Result<(), String> {
    let user_id = parse_user(user_id_str)?;
    let flows = app.state::<VerificationFlows>();
    let Some(sas) = get_sas(client, &user_id, flow_id).await else { return Ok(()) };
    if !matches!(sas.state(), SasState::Started { .. }) {
        return Ok(());
    }
    let Some(_g) = flows.try_begin(flow_id, "accept_sas") else { return Ok(()) };
    info!(flow_id, "verification: accepting SAS (command)");
    sas.accept().await.map_err(|e| format!("Failed to accept verification: {e}"))
}

/// Confirm the emoji match. Errors when the flow is gone or cancelled instead
/// of silently "succeeding" (the old behaviour showed "verified" for a flow the
/// other side had already cancelled).
pub async fn confirm_sas_verification(
    client: &Client,
    app: &AppHandle,
    user_id_str: &str,
    flow_id: &str,
) -> Result<(), String> {
    let user_id = parse_user(user_id_str)?;
    let flows = app.state::<VerificationFlows>();
    let sas = get_sas(client, &user_id, flow_id)
        .await
        .ok_or_else(|| format!("Verification flow {flow_id} not found"))?;
    if let Some(c) = sas.cancel_info() {
        return Err(format!("The verification was cancelled: {}", c.reason()));
    }
    if !sas.can_be_presented() {
        info!(flow_id, state = ?SasPhase::from(&sas.state()), "verification: confirm ignored — not at the emoji step");
        return Ok(());
    }
    let Some(_g) = flows.try_begin(flow_id, "confirm") else { return Ok(()) };
    info!(flow_id, own_device = %own_device(client), other_device = %sas.other_device().device_id(), "verification: user confirmed emoji match — sending MAC");
    if let Err(e) = sas.confirm().await {
        // The SDK already counts the SAS as confirmed here, so without a cancel
        // the other device waits for a MAC that never comes and the flow stays
        // live, blocking the next attempt with this user. The cancel moves the
        // local state to cancelled even if sending it fails too.
        error!(flow_id, error = %e, "verification: sending MAC failed — cancelling the flow");
        cancel_flow(client, &user_id, flow_id, false, "MAC send failed").await;
        return Err(format!("Failed to confirm verification: {e}"));
    }
    Ok(())
}

/// Cancel a flow (request and/or SAS). `mismatch` sends `m.mismatched_sas`.
pub async fn cancel_sas_verification(
    client: &Client,
    user_id_str: &str,
    flow_id: &str,
    mismatch: bool,
) -> Result<(), String> {
    let user_id = parse_user(user_id_str)?;
    cancel_flow(client, &user_id, flow_id, mismatch, if mismatch { "user: emoji mismatch" } else { "user" }).await;
    Ok(())
}

/// Legacy: SAS emoji for a flow, `None` until a SAS exists.
pub async fn get_sas_info(
    client: &Client,
    user_id_str: &str,
    flow_id: &str,
) -> Result<Option<SasInfo>, String> {
    let user_id = parse_user(user_id_str)?;
    let Some(sas) = get_sas(client, &user_id, flow_id).await else { return Ok(None) };
    let emoji = sas
        .emoji()
        .map(|e| e.iter().map(|e| [e.symbol.to_string(), e.description.to_string()]).collect())
        .unwrap_or_default();
    Ok(Some(SasInfo {
        flow_id: flow_id.to_owned(),
        other_user_id: user_id_str.to_owned(),
        other_device_id: sas.other_device().device_id().to_string(),
        emoji,
        decimals: sas.decimals().map(|(a, b, c)| [a, b, c]),
    }))
}

pub async fn get_verification_state(
    client: &Client,
    app: &AppHandle,
    user_id_str: &str,
    flow_id: &str,
) -> Result<Option<VerificationUpdate>, String> {
    let user_id = parse_user(user_id_str)?;
    Ok(snapshot(client, &app.state::<VerificationFlows>(), &user_id, flow_id).await)
}

/// Incoming requests still awaiting an answer — the frontend asks once its
/// listeners are up, since the first sync can emit before they are.
pub async fn pending_verification_requests(
    client: &Client,
    app: &AppHandle,
) -> Result<Vec<SyncVerificationRequest>, String> {
    let flows = app.state::<VerificationFlows>();
    let mut out = vec![];
    for p in flows.pending_incoming() {
        let Ok(user_id) = UserId::parse(&p.user_id) else { continue };
        // Re-check live: the registry may lag the SDK.
        if let Some(r) = client.encryption().get_verification_request(&user_id, &p.flow_id).await {
            if matches!(r.state(), VerificationRequestState::Requested { .. }) {
                out.push(p);
            }
        }
    }
    Ok(out)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn upd(flow: &str, user: &str, phase: Phase) -> VerificationUpdate {
        VerificationUpdate {
            flow_id: flow.into(),
            user_id: user.into(),
            other_device_id: Some("DEV".into()),
            we_started: false,
            phase,
            emoji: vec![],
            decimals: None,
            cancel_code: None,
            cancel_reason: None,
            cancelled_by_us: None,
        }
    }

    #[test]
    fn cancellation_on_either_side_wins() {
        assert_eq!(combine_phase(Some(RequestPhase::Cancelled), Some(SasPhase::KeysExchanged)), Some(Phase::Cancelled));
        assert_eq!(combine_phase(Some(RequestPhase::Transitioned), Some(SasPhase::Cancelled)), Some(Phase::Cancelled));
        assert_eq!(combine_phase(Some(RequestPhase::Cancelled), None), Some(Phase::Cancelled));
    }

    #[test]
    fn sas_state_takes_precedence_over_request_state() {
        assert_eq!(combine_phase(Some(RequestPhase::Transitioned), Some(SasPhase::WeStarted)), Some(Phase::Started));
        assert_eq!(combine_phase(Some(RequestPhase::Transitioned), Some(SasPhase::TheyStarted)), Some(Phase::Started));
        assert_eq!(combine_phase(Some(RequestPhase::Transitioned), Some(SasPhase::Accepted)), Some(Phase::Accepted));
        assert_eq!(combine_phase(Some(RequestPhase::Transitioned), Some(SasPhase::KeysExchanged)), Some(Phase::KeysExchanged));
        assert_eq!(combine_phase(Some(RequestPhase::Transitioned), Some(SasPhase::Confirmed)), Some(Phase::Confirmed));
        assert_eq!(combine_phase(Some(RequestPhase::Transitioned), Some(SasPhase::Done)), Some(Phase::Done));
    }

    #[test]
    fn request_only_states_map_to_early_phases() {
        assert_eq!(combine_phase(Some(RequestPhase::Created), None), Some(Phase::Requested));
        assert_eq!(combine_phase(Some(RequestPhase::Requested), None), Some(Phase::Requested));
        assert_eq!(combine_phase(Some(RequestPhase::Ready), None), Some(Phase::Ready));
        assert_eq!(combine_phase(Some(RequestPhase::Done), None), Some(Phase::Done));
        assert_eq!(combine_phase(None, None), None);
    }

    #[test]
    fn phases_are_ordered_for_monotonic_merging() {
        assert!(Phase::Requested < Phase::Ready);
        assert!(Phase::Ready < Phase::Started);
        assert!(Phase::Started < Phase::Accepted);
        assert!(Phase::Accepted < Phase::KeysExchanged);
        assert!(Phase::KeysExchanged < Phase::Confirmed);
        assert!(Phase::Confirmed < Phase::Done);
        assert!(Phase::Done.is_terminal() && Phase::Cancelled.is_terminal());
        assert!(!Phase::Confirmed.is_terminal());
    }

    #[test]
    fn a_sas_they_started_is_accepted_by_either_role() {
        for we_started in [true, false] {
            assert_eq!(
                next_step(we_started, Some(RequestPhase::Transitioned), Some(SasPhase::TheyStarted)),
                NextStep::AcceptSas
            );
        }
    }

    #[test]
    fn only_the_initiator_arms_the_start_fallback_and_only_without_a_sas() {
        assert_eq!(next_step(true, Some(RequestPhase::Ready), None), NextStep::ArmStartFallback);
        assert_eq!(next_step(false, Some(RequestPhase::Ready), None), NextStep::Wait);
        assert_eq!(next_step(true, Some(RequestPhase::Transitioned), Some(SasPhase::WeStarted)), NextStep::Wait);
        assert_eq!(next_step(true, Some(RequestPhase::Created), None), NextStep::Wait);
    }

    #[test]
    fn terminal_states_finish_the_watcher() {
        assert_eq!(next_step(true, Some(RequestPhase::Cancelled), None), NextStep::Finish);
        assert_eq!(next_step(false, Some(RequestPhase::Done), Some(SasPhase::Done)), NextStep::Finish);
        assert_eq!(next_step(false, Some(RequestPhase::Transitioned), Some(SasPhase::Cancelled)), NextStep::Finish);
    }

    #[test]
    fn dropped_requests_are_classified() {
        let now = 1_000_000_000u64;
        assert_eq!(classify_dropped_request(now - 11 * 60_000, now, true), DropReason::TooOld);
        assert_eq!(classify_dropped_request(now + 6 * 60_000, now, true), DropReason::FromTheFuture);
        assert_eq!(classify_dropped_request(now - 1_000, now, false), DropReason::UnknownDevice);
        assert_eq!(classify_dropped_request(now - 1_000, now, true), DropReason::Unknown);
        // Age checks come first: an old request from an unknown device is just old.
        assert_eq!(classify_dropped_request(now - 11 * 60_000, now, false), DropReason::TooOld);
    }

    #[test]
    fn only_a_missing_device_is_blamed_on_keys() {
        assert_eq!(dropped_request_cancel(DropReason::TooOld), None);
        assert_eq!(dropped_request_cancel(DropReason::FromTheFuture), None);
        let (code, _, peer) = dropped_request_cancel(DropReason::UnknownDevice).unwrap();
        assert_eq!(code, CANCEL_UNKNOWN_DEVICE);
        assert!(peer.contains("keys"));
        let (code, local, peer) = dropped_request_cancel(DropReason::Unknown).unwrap();
        assert_eq!(code, CANCEL_REQUEST_DROPPED);
        assert!(!local.contains("keys") && !peer.contains("keys"));
    }

    #[test]
    fn live_flows_exclude_finished_ones() {
        let flows = VerificationFlows::default();
        flows.register("f1", "@me:x", None, None, true);
        flows.register("f2", "@me:x", None, None, false);
        flows.register("f3", "@other:x", None, None, true);
        flows.record(&upd("f2", "@me:x", Phase::Cancelled));
        let mut live = flows.live_flows_with("@me:x");
        live.sort();
        assert_eq!(live, vec!["f1".to_string()]);
        flows.record(&upd("f1", "@me:x", Phase::Done));
        assert!(flows.live_flows_with("@me:x").is_empty());
    }

    #[test]
    fn a_flow_gets_one_watcher_until_released() {
        let flows = VerificationFlows::default();
        assert!(!flows.begin_watch("f1"), "unregistered flows are not watched");
        flows.register("f1", "@me:x", None, None, true);
        assert!(flows.begin_watch("f1"));
        assert!(!flows.begin_watch("f1"));
        flows.end_watch("f1");
        assert!(flows.begin_watch("f1"));
    }

    #[test]
    fn duplicate_actions_are_refused_while_one_runs() {
        let flows = VerificationFlows::default();
        let g = flows.try_begin("f1", "start_sas");
        assert!(g.is_some());
        assert!(flows.try_begin("f1", "start_sas").is_none());
        assert!(flows.try_begin("f1", "confirm").is_some(), "different action is independent");
        assert!(flows.try_begin("f2", "start_sas").is_some(), "different flow is independent");
        drop(g);
        assert!(flows.try_begin("f1", "start_sas").is_some());
    }

    #[test]
    fn pending_incoming_lists_only_unanswered_requests_we_received() {
        let flows = VerificationFlows::default();
        flows.register("in", "@me:x", Some("DEVA".into()), Some("Quark on Linux".into()), false);
        flows.register("out", "@me:x", Some("DEVB".into()), None, true);
        flows.register("gone", "@me:x", Some("DEVC".into()), None, false);
        flows.register("accepted", "@me:x", Some("DEVD".into()), None, false);
        flows.record(&upd("in", "@me:x", Phase::Requested));
        flows.record(&upd("out", "@me:x", Phase::Requested));
        flows.record(&upd("gone", "@me:x", Phase::Cancelled));
        flows.record(&upd("accepted", "@me:x", Phase::Ready));
        let pending = flows.pending_incoming();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].flow_id, "in");
        assert_eq!(pending[0].device_id, "DEVA");
        assert_eq!(pending[0].device_name.as_deref(), Some("Quark on Linux"));
        assert_eq!(flows.pending_incoming_from("@me:x", "DEVA").as_deref(), Some("in"));
        assert_eq!(flows.pending_incoming_from("@me:x", "DEVB"), None);

        // Registered but not yet recorded by its watcher: still offered.
        flows.register("fresh", "@me:x", Some("DEVE".into()), None, false);
        assert!(flows.pending_incoming().iter().any(|p| p.flow_id == "fresh"));
    }

    #[test]
    fn registering_again_keeps_role_and_fills_device_info() {
        let flows = VerificationFlows::default();
        flows.register("f", "@me:x", None, None, true);
        flows.register("f", "@me:x", Some("DEV".into()), Some("Name".into()), false);
        assert_eq!(flows.other_device("f"), (Some("DEV".into()), Some("Name".into())));
        flows.record(&upd("f", "@me:x", Phase::Requested));
        // we_started stays true (first registration wins), so it isn't "incoming".
        assert!(flows.pending_incoming().is_empty());
    }

    #[test]
    fn update_serializes_with_snake_case_phase() {
        let json = serde_json::to_value(upd("f", "@me:x", Phase::KeysExchanged)).unwrap();
        assert_eq!(json["phase"], "keys_exchanged");
        assert_eq!(json["we_started"], false);
    }
}
