// SAS / QR device verification UI

import { keymapManager } from "../vim/keybindings.js";
import { DialogBase } from "./DialogBase.js";

export type VerificationState =
  | "incoming"   // Received a request from another device — show accept prompt
  | "waiting"    // Waiting on the other device / the key exchange
  | "comparing"  // Emoji are ready; user compares them
  | "confirmed"  // We said they match; waiting for the other device to confirm
  | "verified"
  | "failed"
  | "cancelled";

export interface SasEmoji {
  /** Unicode emoji glyph */
  emoji: string;
  /** Human-readable description */
  description: string;
}

type VerificationCallback = () => void;

const STATE_MESSAGES: Record<VerificationState, string> = {
  incoming: "Incoming verification request",
  waiting: "Waiting for other device…",
  comparing: "Compare these emoji with the other device:",
  confirmed: "Waiting for the other device to confirm…",
  verified: "Verification successful!",
  failed: "Verification failed. The emoji did not match.",
  cancelled: "Verification was cancelled.",
};

/**
 * SAS emoji verification overlay.
 * Displays as a centered modal dialog with backdrop, matching the HelpDialog style.
 */
export class Verification extends DialogBase {
  private _panelEl: HTMLElement;
  private _statusEl: HTMLElement;
  private _emojiGridEl: HTMLElement;
  private _actionsEl: HTMLElement;
  private _confirmBtn: HTMLButtonElement;
  private _denyBtn: HTMLButtonElement;
  private _dismissBtn: HTMLButtonElement;

  private _state: VerificationState = "waiting";
  private _sasEmoji: SasEmoji[] = [];
  private _focusedAction: "confirm" | "deny" = "confirm";
  private _incomingSubtitleEl: HTMLElement;

  private _onConfirm: VerificationCallback | null = null;
  private _onDeny: VerificationCallback | null = null;
  private _onCancel: VerificationCallback | null = null;
  private _onDismiss: VerificationCallback | null = null;

  constructor() {
    // Original did not reset the key sequence on hide.
    super({ prefix: "verification-dialog", ariaLabel: "Device verification", resetSequenceOnHide: false });
    this._panelEl = this.content;

    // ── Header ────────────────────────────────────────────────────────────
    const header = document.createElement("div");
    header.className = "verification-dialog__header";
    this._panelEl.appendChild(header);

    const title = document.createElement("span");
    title.className = "verification-dialog__title";
    title.textContent = "verify device";
    header.appendChild(title);

    // Same as Escape: cancel the flow (never a mismatch) and close.
    const closeBtn = this.makeCloseButton("Close verification", () => this._userClose());
    header.appendChild(closeBtn);

    // ── Body ──────────────────────────────────────────────────────────────
    const body = document.createElement("div");
    body.className = "verification-dialog__body";
    this._panelEl.appendChild(body);

    // ── Incoming request subtitle (device / user info) ────────────────────
    this._incomingSubtitleEl = document.createElement("div");
    this._incomingSubtitleEl.className = "verification-dialog__incoming-subtitle";
    this._incomingSubtitleEl.style.display = "none";
    body.appendChild(this._incomingSubtitleEl);

    // ── Status message ────────────────────────────────────────────────────
    this._statusEl = document.createElement("div");
    this._statusEl.className = "verification-dialog__status";
    this._statusEl.setAttribute("role", "status");
    this._statusEl.setAttribute("aria-live", "polite");
    this._statusEl.textContent = STATE_MESSAGES.waiting;
    body.appendChild(this._statusEl);

    // ── SAS emoji grid ────────────────────────────────────────────────────
    this._emojiGridEl = document.createElement("div");
    this._emojiGridEl.className = "verification-dialog__emoji-grid";
    this._emojiGridEl.setAttribute("role", "list");
    this._emojiGridEl.setAttribute("aria-label", "Verification emoji");
    body.appendChild(this._emojiGridEl);

    // ── Action buttons ────────────────────────────────────────────────────
    this._actionsEl = document.createElement("div");
    this._actionsEl.className = "verification-dialog__actions";
    body.appendChild(this._actionsEl);

    this._confirmBtn = document.createElement("button");
    this._confirmBtn.className = "verification-dialog__btn verification-dialog__btn--confirm";
    this._confirmBtn.type = "button";
    this._confirmBtn.textContent = "[ They Match ]";
    this._confirmBtn.setAttribute("aria-label", "Confirm — emoji match");
    this._confirmBtn.addEventListener("click", () => {
      this._onConfirm?.();
    });
    this._actionsEl.appendChild(this._confirmBtn);

    this._denyBtn = document.createElement("button");
    this._denyBtn.className = "verification-dialog__btn verification-dialog__btn--deny";
    this._denyBtn.type = "button";
    this._denyBtn.textContent = "[ They Don't Match ]";
    this._denyBtn.setAttribute("aria-label", "Deny — emoji do not match");
    this._denyBtn.addEventListener("click", () => {
      this._onDeny?.();
    });
    this._actionsEl.appendChild(this._denyBtn);

    // ── Dismiss button (shown after terminal state) ───────────────────────
    this._dismissBtn = document.createElement("button");
    this._dismissBtn.className = "verification-dialog__btn verification-dialog__btn--dismiss";
    this._dismissBtn.type = "button";
    this._dismissBtn.textContent = "[ Dismiss ]";
    this._dismissBtn.setAttribute("aria-label", "Dismiss verification");
    this._dismissBtn.style.display = "none";
    this._dismissBtn.addEventListener("click", () => {
      this._onDismiss?.();
      this.hide();
    });
    this._actionsEl.appendChild(this._dismissBtn);

    // ── Footer hint ───────────────────────────────────────────────────────
    const footer = document.createElement("div");
    footer.className = "verification-dialog__footer";
    footer.textContent = "Tab / h/l switch · Enter confirm · Esc cancel";
    footer.setAttribute("aria-hidden", "true");
    this._panelEl.appendChild(footer);
  }

  onConfirm(cb: VerificationCallback): void {
    this._onConfirm = cb;
  }

  /** The deny button: Reject, Cancel, or "They Don't Match", by state. */
  onDeny(cb: VerificationCallback): void {
    this._onDeny = cb;
  }

  /**
   * The user closed the dialog (Escape, the X, the backdrop, Android back).
   * Kept apart from `onDeny` so backing out at the emoji step is a plain
   * cancel, not a report that the emoji didn't match.
   */
  onCancel(cb: VerificationCallback): void {
    this._onCancel = cb;
  }

  onDismiss(cb: VerificationCallback): void {
    this._onDismiss = cb;
  }

  show(): void {
    this.reveal();
    this._updateFocus();
  }

  // Clicking the backdrop cancels, matching the close button and Escape.
  protected override onBackdropClick(): void {
    this._userClose();
  }

  /** Escape with focus outside the dialog, or Android back (`modalManager`). */
  requestClose(): void {
    this._userClose();
  }

  private _userClose(): void {
    this._onCancel?.();
    this.hide();
  }

  // The panel is not focusable (no tabindex); real focus is driven by
  // _updateFocus / the dismiss button after setState.
  protected override focusTarget(): HTMLElement {
    return this._panelEl;
  }

  /** Current state (as last set by `setState`). */
  get state(): VerificationState {
    return this._state;
  }

  setState(state: VerificationState): void {
    this._state = state;
    this._statusEl.textContent = STATE_MESSAGES[state];

    const isTerminal = state === "verified" || state === "failed" || state === "cancelled";
    const isComparing = state === "comparing";
    const isIncoming = state === "incoming";
    const isPending = state === "waiting" || state === "confirmed";

    // Entering a new flow ("incoming" popup or outbound "waiting") must not
    // show emoji left over from a previous attempt — clear the grid. Leaving
    // the comparison clears it too, so stale emoji never sit under a result.
    if (isIncoming || state === "waiting" || isTerminal) {
      this._sasEmoji = [];
      this._renderEmojiGrid();
    }

    // Confirm visible for the two decisions: accept/reject an incoming request
    // and match/mismatch the emoji. Deny doubles as a Cancel button while
    // waiting — touch devices have no Esc key.
    const showActions = isComparing || isIncoming;
    this._confirmBtn.style.display = showActions ? "" : "none";
    this._denyBtn.style.display = showActions || isPending ? "" : "none";
    this._dismissBtn.style.display = isTerminal ? "" : "none";
    this.setBusy(false);

    // Relabel buttons for incoming vs comparing contexts
    if (isIncoming) {
      this._confirmBtn.textContent = "[ Accept ]";
      this._confirmBtn.setAttribute("aria-label", "Accept verification request");
      this._denyBtn.textContent = "[ Reject ]";
      this._denyBtn.setAttribute("aria-label", "Reject verification request");
    } else if (isPending) {
      this._denyBtn.textContent = "[ Cancel ]";
      this._denyBtn.setAttribute("aria-label", "Cancel verification");
    } else {
      this._confirmBtn.textContent = "[ They Match ]";
      this._confirmBtn.setAttribute("aria-label", "Confirm — emoji match");
      this._denyBtn.textContent = "[ They Don't Match ]";
      this._denyBtn.setAttribute("aria-label", "Deny — emoji do not match");
    }

    // Show subtitle only for incoming state
    this._incomingSubtitleEl.style.display = isIncoming ? "" : "none";

    // Add state class to panel for styling
    const allStates: VerificationState[] = ["incoming", "waiting", "comparing", "confirmed", "verified", "failed", "cancelled"];
    for (const s of allStates) {
      this._panelEl.classList.toggle(`verification-dialog__panel--${s}`, state === s);
    }

    if (showActions) {
      this._focusedAction = "confirm";
      this._updateFocus();
    } else if (isTerminal) {
      this._dismissBtn.focus();
    }
  }

  /**
   * Populate the "incoming" subtitle with who is asking to verify.
   * Call this before setState("incoming").
   */
  setIncomingRequest(fromUserId: string, fromDeviceId: string, fromDeviceName?: string | null): void {
    const who = fromDeviceName ? `${fromDeviceName} (${fromDeviceId})` : fromDeviceId;
    this._incomingSubtitleEl.textContent =
      `${who} from ${fromUserId} wants to verify this Quark session.`;
  }

  /**
   * Replace the status line's text (call after `setState`, which resets it to
   * the state's default). `null` restores the default.
   */
  setMessage(text: string | null): void {
    this._statusEl.textContent = text ?? STATE_MESSAGES[this._state];
  }

  /**
   * While an action is in flight, disable the confirm button so a double click
   * or key repeat can't fire it twice. Deny/cancel stay usable.
   */
  setBusy(busy: boolean): void {
    this._confirmBtn.disabled = busy;
    this._confirmBtn.setAttribute("aria-busy", busy ? "true" : "false");
  }

  /** Set the 7 SAS emoji to display for comparison. */
  setSasEmoji(emoji: SasEmoji[]): void {
    this._sasEmoji = emoji.slice(0, 7);
    this._renderEmojiGrid();
  }

  // ── Private ────────────────────────────────────────────────────────────

  private _renderEmojiGrid(): void {
    this._emojiGridEl.innerHTML = "";

    for (const item of this._sasEmoji) {
      const cell = document.createElement("div");
      cell.className = "verification-dialog__emoji-cell";
      cell.setAttribute("role", "listitem");

      const glyph = document.createElement("span");
      glyph.className = "verification-dialog__emoji-glyph";
      glyph.textContent = item.emoji;
      glyph.setAttribute("aria-hidden", "true");
      cell.appendChild(glyph);

      const desc = document.createElement("span");
      desc.className = "verification-dialog__emoji-desc";
      desc.textContent = item.description;
      cell.appendChild(desc);

      this._emojiGridEl.appendChild(cell);
    }
  }

  private _updateFocus(): void {
    if (this._state !== "comparing" && this._state !== "incoming") return;
    if (this._focusedAction === "confirm") {
      this._confirmBtn.focus();
      this._confirmBtn.classList.add("verification-dialog__btn--focused");
      this._denyBtn.classList.remove("verification-dialog__btn--focused");
    } else {
      this._denyBtn.focus();
      this._denyBtn.classList.add("verification-dialog__btn--focused");
      this._confirmBtn.classList.remove("verification-dialog__btn--focused");
    }
  }

  protected override handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();

    if (this.isEscape(e)) {
      e.preventDefault();
      this._userClose();
      return;
    }

    if (e.key === "Enter") {
      // Handled by button's own keydown via focus
      return;
    }

    if (e.key === "Tab") {
      if (this._state === "comparing" || this._state === "incoming") {
        e.preventDefault();
        this._focusedAction =
          this._focusedAction === "confirm" ? "deny" : "confirm";
        this._updateFocus();
      }
      return;
    }

    const result = keymapManager.resolveKey(e.key, "picker");

    if (result.kind === "action") {
      if (result.action === "nav-left" || result.action === "nav-right") {
        if (this._state === "comparing" || this._state === "incoming") {
          e.preventDefault();
          this._focusedAction =
            this._focusedAction === "confirm" ? "deny" : "confirm";
          this._updateFocus();
        }
      }
    } else if (result.kind === "partial") {
      e.preventDefault();
    }
  }
}
