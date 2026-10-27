// SAS device verification — the frontend side of a flow.
//
// The backend (src-tauri/src/matrix/verification.rs) drives each flow from the
// SDK's own state and pushes a `VerificationUpdate` on every change; it also
// takes every protocol step that needs no user input (accepting the other
// side's SAS start, the initiator's start fallback). This module only:
//   - shows the ONE flow on screen, keyed by flow ID (never by user),
//   - turns user decisions (accept / they match / cancel) into commands,
//   - merges updates monotonically (a flow never moves backwards; done and
//     cancelled are final), from events plus a slow backstop poll in case an
//     event was missed,
//   - keeps other overlays (the startup "verify this session" prompt, the
//     device picker) from hiding an incoming request.
//
// It replaces a 2 s / 60 s polling loop that kept no flow identity: it gave up
// after 60 s without telling the other device, retried "accept" on the wrong
// side, never saw a remote cancel, and a stale poll could overwrite the dialog
// of a newer attempt.

import {
  acceptVerificationRequest,
  cancelSasVerification,
  confirmSasVerification,
  getUserDevices,
  getVerificationState,
  getVerificationStatus,
  pendingVerificationRequests,
  startSasVerification,
} from "../../ipc/index.js";
import type {
  IncomingVerificationRequest,
  VerificationPhase,
  VerificationStatus,
  VerificationUpdate,
} from "../../ipc/types.js";
import type { VerificationState } from "../../ui/Verification.js";
import { showError, showSuccess, showToast } from "../../ui/NotificationToast.js";

import { getComponents } from "./context.js";

// ── Pure core (unit-tested) ──────────────────────────────────────────────────

const PHASE_RANK: Record<VerificationPhase, number> = {
  requested: 0,
  ready: 1,
  started: 2,
  accepted: 3,
  keys_exchanged: 4,
  confirmed: 5,
  done: 6,
  cancelled: 6,
};

export function isTerminal(phase: VerificationPhase): boolean {
  return phase === "done" || phase === "cancelled";
}

/** The flow currently on screen. */
export interface FlowView {
  flowId: string;
  userId: string;
  deviceId: string | null;
  deviceName: string | null;
  /** We sent the request (initiator). */
  weStarted: boolean;
  phase: VerificationPhase;
  emoji: [string, string][];
  /** Responder: the user pressed Accept. */
  accepted: boolean;
  cancelCode: string | null;
  cancelReason: string | null;
  cancelledByUs: boolean | null;
}

export function newFlow(init: Partial<FlowView> & Pick<FlowView, "flowId" | "userId" | "weStarted">): FlowView {
  return {
    deviceId: null,
    deviceName: null,
    phase: "requested",
    emoji: [],
    accepted: false,
    cancelCode: null,
    cancelReason: null,
    cancelledByUs: null,
    ...init,
  };
}

/**
 * Fold a backend update into the flow. Returns the new flow, or `null` when
 * the update changes nothing (other flow, older phase, or flow already final).
 */
export function mergeUpdate(flow: FlowView, u: VerificationUpdate): FlowView | null {
  if (u.flow_id !== flow.flowId) return null;
  if (isTerminal(flow.phase)) return null;
  if (PHASE_RANK[u.phase] < PHASE_RANK[flow.phase]) return null;
  const emoji = u.emoji.length > 0 ? u.emoji : flow.emoji;
  const next: FlowView = {
    ...flow,
    deviceId: flow.deviceId ?? u.other_device_id,
    // The backend knows who sent the request (matters when it joined an
    // incoming request in place of the outgoing one we asked for).
    weStarted: u.we_started,
    phase: u.phase,
    emoji,
    cancelCode: u.cancel_code,
    cancelReason: u.cancel_reason,
    cancelledByUs: u.cancelled_by_us,
  };
  if (next.phase === flow.phase && next.emoji === flow.emoji && next.deviceId === flow.deviceId
      && next.cancelCode === flow.cancelCode && next.weStarted === flow.weStarted) {
    return null;
  }
  return next;
}

/** Human message for a cancelled flow. */
export function cancelMessage(code: string | null, reason: string | null, byUs: boolean | null): string {
  switch (code) {
    case "m.mismatched_sas":
      return "The emoji did not match — the device was not verified.";
    case "m.timeout":
      return "Verification timed out.";
    case "m.user":
      return byUs ? "Verification cancelled." : "Verification was cancelled on the other device.";
    case "m.accepted":
      return "Another of your devices answered this request.";
    case "tel.quark.unknown_device":
      return byUs
        ? (reason ?? "This session didn't have the other device's keys yet. Try again in a few seconds.")
        : "The other device didn't have this device's keys yet. Try again in a few seconds.";
    case null:
      return reason ?? "Verification was cancelled.";
    default:
      return `Verification failed: ${reason ?? code}`;
  }
}

/** What the dialog should show for a flow. */
export function viewFor(flow: FlowView): { state: VerificationState; message: string | null } {
  switch (flow.phase) {
    case "cancelled":
      return {
        state: flow.cancelCode === "m.mismatched_sas" ? "failed" : "cancelled",
        message: cancelMessage(flow.cancelCode, flow.cancelReason, flow.cancelledByUs),
      };
    case "done":
      return { state: "verified", message: null };
    case "keys_exchanged":
      return { state: "comparing", message: null };
    case "confirmed":
      return { state: "confirmed", message: null };
    case "requested":
      if (!flow.weStarted && !flow.accepted) return { state: "incoming", message: null };
      if (flow.weStarted) {
        const who = flow.deviceName ?? flow.deviceId ?? "the other device";
        return { state: "waiting", message: `Waiting for ${who} to accept…` };
      }
      return { state: "waiting", message: "Accepting…" };
    case "ready":
    case "started":
      return { state: "waiting", message: "Starting emoji comparison…" };
    case "accepted":
      return { state: "waiting", message: "Exchanging keys…" };
  }
}

/** Toast text for an update about a flow that is NOT on screen, or null. */
export function offscreenNotice(u: VerificationUpdate, deviceLabel: string): string | null {
  if (u.phase !== "cancelled" || u.we_started) return null;
  if (u.cancel_code === "tel.quark.unknown_device") {
    return `A verification request from ${deviceLabel} couldn't be used: this session didn't have that device's keys yet. Start it again in a few seconds.`;
  }
  return `A verification request from ${deviceLabel} was cancelled — another verification with this account was still open. Try again.`;
}

// ── Controller ───────────────────────────────────────────────────────────────

/** The dialog surface the controller drives (the real `Verification`). */
export interface VerificationUi {
  readonly state: VerificationState;
  setState(state: VerificationState): void;
  setMessage(text: string | null): void;
  setBusy(busy: boolean): void;
  setSasEmoji(emoji: { emoji: string; description: string }[]): void;
  setIncomingRequest(userId: string, deviceId: string, deviceName?: string | null): void;
  show(): void;
  hide(): void;
  isVisible(): boolean;
  onConfirm(cb: () => void): void;
  onDeny(cb: () => void): void;
  onDismiss(cb: () => void): void;
}

/** An overlay that must step aside for an incoming request. */
export interface Supersedable {
  isVisible(): boolean;
  hide(): void;
}

export interface VerificationIpc {
  start(userId: string, deviceId: string): Promise<string>;
  accept(userId: string, flowId: string): Promise<void>;
  confirm(userId: string, flowId: string): Promise<void>;
  cancel(userId: string, flowId: string, mismatch: boolean): Promise<void>;
  state(userId: string, flowId: string): Promise<VerificationUpdate | null>;
}

export interface Notifier {
  info(msg: string): void;
  error(msg: string): void;
  success(msg: string): void;
}

/** Backstop poll interval while a flow is live (events are primary). */
export const BACKSTOP_POLL_MS = 4000;
/** Consecutive "backend doesn't know this flow" answers before giving up. */
const MAX_UNKNOWN_POLLS = 3;

export class VerificationController {
  private _flow: FlowView | null = null;
  private _busy = false;
  private _shownState: VerificationState | null = null;
  private _shownEmojiKey = "";
  private _pollTimer: ReturnType<typeof setTimeout> | null = null;
  private _unknownPolls = 0;
  /** Flows this controller has put on screen (bounded). */
  private _seen: string[] = [];
  private _recentDone = 0;

  constructor(
    private readonly ui: VerificationUi,
    private readonly ipc: VerificationIpc,
    private readonly notify: Notifier,
    private readonly supersede: () => Supersedable[] = () => [],
  ) {
    ui.onConfirm(() => void this._onConfirm());
    ui.onDeny(() => void this._onDeny());
    ui.onDismiss(() => this._onDismiss());
  }

  /** The flow on screen, if any (for tests and gating). */
  get flow(): FlowView | null {
    return this._flow;
  }

  /** A flow is in progress (not finished). */
  hasLiveFlow(): boolean {
    return this._flow !== null && !isTerminal(this._flow.phase);
  }

  /** Begin verifying `deviceId` of `userId` (outgoing). */
  async startOutgoing(userId: string, deviceId: string, deviceName: string | null = null): Promise<void> {
    const prev = this._flow;
    // The backend cancels older flows with the same user itself; one with a
    // different user would just vanish from the single dialog, so end it.
    if (prev && !isTerminal(prev.phase) && prev.userId !== userId) {
      void this.ipc.cancel(prev.userId, prev.flowId, false).catch(() => {});
    }
    const flowId = await this.ipc.start(userId, deviceId);
    if (prev && prev.flowId === flowId) {
      // The backend joined the incoming request from this very device instead
      // of sending a competing one — that request is now accepted.
      this._flow = { ...prev, accepted: true };
      this._render();
      this.ui.show();
      return;
    }
    this._activate(newFlow({
      flowId,
      userId,
      deviceId,
      deviceName,
      weStarted: true,
      // If the backend joined an incoming request we never had on screen, the
      // first update flips weStarted to false; it's accepted either way.
      accepted: true,
    }));
  }

  /** An incoming request the backend says is answerable. */
  handleIncoming(req: IncomingVerificationRequest): void {
    const prev = this._flow;
    if (prev && prev.flowId === req.flow_id) {
      // Already on screen (its state update can beat the request event); just
      // fill in the device name if we didn't have it.
      if (req.device_name && !prev.deviceName && viewFor(prev).state === "incoming") {
        this._flow = { ...prev, deviceName: req.device_name };
        this.ui.setIncomingRequest(req.user_id, req.device_id, req.device_name);
      }
      return;
    }
    if (prev && !isTerminal(prev.phase) && prev.userId !== req.user_id) {
      // Same user: the SDK only lets a new request through once older ones are
      // cancelled, so `prev` is already dead. Different user: end it, the
      // dialog can only show one.
      void this.ipc.cancel(prev.userId, prev.flowId, false).catch(() => {});
    }
    // Nothing may cover the request (seen live: the startup prompt did).
    for (const o of this.supersede()) {
      if (o.isVisible()) o.hide();
    }
    this.ui.setIncomingRequest(req.user_id, req.device_id, req.device_name ?? null);
    this._activate(newFlow({
      flowId: req.flow_id,
      userId: req.user_id,
      deviceId: req.device_id,
      deviceName: req.device_name ?? null,
      weStarted: false,
    }));
  }

  /** A `quark://verification/state` update (or a poll result). */
  handleUpdate(u: VerificationUpdate): void {
    const flow = this._flow;
    if (!flow || flow.flowId !== u.flow_id) {
      if (this._seen.includes(u.flow_id)) return; // an older flow finishing
      if (u.phase === "requested" && !u.we_started && u.other_device_id) {
        // The request event itself was missed — the state says it's answerable.
        this.handleIncoming({ user_id: u.user_id, device_id: u.other_device_id, flow_id: u.flow_id });
        return;
      }
      const notice = offscreenNotice(u, u.other_device_id ?? "another device");
      if (notice) this.notify.info(notice);
      return;
    }
    const next = mergeUpdate(flow, u);
    if (!next) return;
    this._flow = next;
    this._unknownPolls = 0;
    if (next.phase === "done") this._recentDone = Date.now();
    this._render();
  }

  /** Own trust re-read after a finished verification. */
  handleOwnTrust(status: VerificationStatus): void {
    if (Date.now() - this._recentDone > 5 * 60_000) return;
    if (status.is_cross_signed) {
      this.notify.success("This session is now cross-signed.");
    } else {
      this.notify.info(
        "Verification finished, but this session isn't cross-signed yet. It will be once the device that holds your cross-signing keys signs it.",
      );
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private _activate(flow: FlowView): void {
    this._flow = flow;
    this._busy = false;
    this._unknownPolls = 0;
    this._shownState = null;
    this._shownEmojiKey = "";
    this._seen.push(flow.flowId);
    if (this._seen.length > 32) this._seen.shift();
    this._render();
    this.ui.show();
    this._schedulePoll();
  }

  private _render(): void {
    const flow = this._flow;
    if (!flow) return;
    const view = viewFor(flow);
    // Only re-enter a state when it changes: setState moves focus, which a
    // backstop poll must not keep yanking back to the first button.
    if (view.state !== this._shownState) {
      this.ui.setState(view.state);
      this._shownState = view.state;
      this._shownEmojiKey = "";
    }
    if (view.state === "comparing") {
      const key = flow.emoji.map((e) => e[0]).join("");
      if (key !== this._shownEmojiKey) {
        this.ui.setSasEmoji(flow.emoji.map(([emoji, description]) => ({ emoji, description })));
        this._shownEmojiKey = key;
      }
    }
    this.ui.setMessage(view.message);
    this.ui.setBusy(this._busy);
  }

  private _schedulePoll(): void {
    if (this._pollTimer) clearTimeout(this._pollTimer);
    this._pollTimer = null;
    const flow = this._flow;
    if (!flow || isTerminal(flow.phase)) return;
    this._pollTimer = setTimeout(() => void this._poll(flow.flowId), BACKSTOP_POLL_MS);
  }

  private async _poll(flowId: string): Promise<void> {
    const flow = this._flow;
    if (!flow || flow.flowId !== flowId || isTerminal(flow.phase)) return;
    try {
      const u = await this.ipc.state(flow.userId, flowId);
      if (u) {
        this.handleUpdate(u);
      } else if (this._flow?.flowId === flowId && ++this._unknownPolls >= MAX_UNKNOWN_POLLS) {
        this._finishLocally("cancelled", null, "This verification is no longer known to this session.", null);
      }
    } catch {
      // Transient IPC failure — keep polling.
    }
    this._schedulePoll();
  }

  private _finishLocally(phase: "cancelled", code: string | null, reason: string | null, byUs: boolean | null): void {
    const flow = this._flow;
    if (!flow || isTerminal(flow.phase)) return;
    this._flow = { ...flow, phase, cancelCode: code, cancelReason: reason, cancelledByUs: byUs };
    this._render();
  }

  private async _onConfirm(): Promise<void> {
    const flow = this._flow;
    if (!flow || this._busy) return;
    const view = viewFor(flow).state;
    if (view !== "incoming" && view !== "comparing") return;
    this._busy = true;
    if (view === "incoming") {
      this._flow = { ...flow, accepted: true };
    }
    this._render();
    try {
      if (view === "incoming") {
        await this.ipc.accept(flow.userId, flow.flowId);
      } else {
        await this.ipc.confirm(flow.userId, flow.flowId);
        const cur = this._flow;
        if (cur && cur.flowId === flow.flowId && PHASE_RANK[cur.phase] < PHASE_RANK.confirmed) {
          this._flow = { ...cur, phase: "confirmed" };
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (this._flow?.flowId === flow.flowId) this._finishLocally("cancelled", null, msg, null);
      this.notify.error(msg);
    } finally {
      this._busy = false;
      if (this._flow?.flowId === flow.flowId) this._render();
    }
  }

  private async _onDeny(): Promise<void> {
    const flow = this._flow;
    if (!flow || isTerminal(flow.phase)) return;
    const mismatch = flow.phase === "keys_exchanged";
    // Show the outcome at once; the backend's cancelled update agrees with it.
    this._finishLocally("cancelled", mismatch ? "m.mismatched_sas" : "m.user", null, true);
    try {
      await this.ipc.cancel(flow.userId, flow.flowId, mismatch);
    } catch (err) {
      console.warn("Cancelling verification failed:", err);
    }
  }

  private _onDismiss(): void {
    // Only reachable in a terminal state; nothing to tell the backend.
    if (this._pollTimer) clearTimeout(this._pollTimer);
    this._pollTimer = null;
  }
}

// ── App wiring ───────────────────────────────────────────────────────────────

let _controller: VerificationController | null = null;

function controller(): VerificationController {
  if (_controller) return _controller;
  const { verification, verificationPrompt, devicePicker } = getComponents();
  _controller = new VerificationController(
    verification,
    {
      start: startSasVerification,
      accept: acceptVerificationRequest,
      confirm: confirmSasVerification,
      cancel: cancelSasVerification,
      state: getVerificationState,
    },
    {
      info: (m) => showToast(m, "info"),
      error: (m) => showError(m),
      success: (m) => showSuccess(m),
    },
    () => [verificationPrompt, devicePicker],
  );
  return _controller;
}

/** Whether a verification flow is in progress (gates the startup prompt). */
export function verificationInProgress(): boolean {
  return _controller?.hasLiveFlow() ?? false;
}

/**
 * Start a SAS device verification flow for a user.
 *
 * Lists the user's devices; with more than one, shows the DevicePicker so the
 * user can choose. If the chosen device already sent us a request, the backend
 * accepts that one instead of sending a competing request.
 */
export async function startVerification(userId: string): Promise<void> {
  const { devicePicker } = getComponents();

  try {
    let devices = await getUserDevices(userId);

    // You can't emoji-verify the current device against itself, so drop it from
    // the picker when verifying your own devices — otherwise the self entry
    // (shown as "self-verified") is a dead-end that requests verification from
    // the very device making the request.
    const own = await getVerificationStatus();
    if (userId === own.user_id) {
      devices = devices.filter((d) => d.device_id !== own.device_id);
    }

    if (devices.length === 0) {
      showError(`No other devices to verify against for ${userId}`);
      return;
    }

    const begin = async (deviceId: string, name: string | null): Promise<void> => {
      try {
        await controller().startOutgoing(userId, deviceId, name);
      } catch (err) {
        showError(`Failed to start verification: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    if (devices.length === 1) {
      await begin(devices[0].device_id, devices[0].display_name);
    } else {
      devicePicker.show(devices, userId);
      devicePicker.onPick((device) => void begin(device.device_id, device.display_name));
      devicePicker.onCancel(() => {
        // Nothing to do — user closed the picker.
      });
    }
  } catch (err) {
    showError(`Failed to start verification: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** `quark://sync/verification_request`: an answerable incoming request. */
export function handleIncomingVerificationRequest(req: IncomingVerificationRequest): void {
  controller().handleIncoming(req);
}

/** `quark://verification/state`. */
export function handleVerificationUpdate(u: VerificationUpdate): void {
  controller().handleUpdate(u);
}

/** `quark://verification/own_trust`. */
export function handleOwnTrustChanged(status: VerificationStatus): void {
  controller().handleOwnTrust(status);
}

/**
 * Pick up incoming requests that were emitted before the listeners existed
 * (the backend starts syncing before the frontend registers them).
 */
export async function catchUpPendingVerificationRequests(): Promise<void> {
  try {
    const pending = await pendingVerificationRequests();
    for (const req of pending) controller().handleIncoming(req);
  } catch (err) {
    console.warn("Checking for pending verification requests failed:", err);
  }
}
