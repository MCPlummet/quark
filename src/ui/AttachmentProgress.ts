// Inline attachment progress — the composer row shown while a picked or pasted
// file is read, uploaded and published (#63).
//
// Deliberately INLINE (a row inside the compose region) rather than an overlay:
// it belongs to the composer the user just acted in, it must never cover the
// timeline, and being inline it captures no keyboard — so there is nothing for
// `app/keyboard.ts` to guard and no Esc / Ctrl+[ dismissal to wire. Its only
// interactive affordance (cancel / dismiss) is a real button, so mouse and
// touch parity comes for free.
//
// Styling lives in `src/style/base.css` under "Attachment progress".

/** The spans of an attachment send that the user perceives as one wait. */
export type AttachmentPhase =
  /** Reading the file out of the picker and encoding it for IPC. */
  | "reading"
  /** Bytes crossing to the backend and up to the homeserver. */
  | "uploading"
  /** Homeserver has the media; the timeline event is being sent. */
  | "sending";

const PHASE_LABEL: Record<AttachmentPhase, string> = {
  reading: "reading",
  uploading: "uploading",
  sending: "sending",
};

// Braille spinner — same frames the toast layer uses, and it stays monospace.
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;

/** Cells in the text progress bar. Kept short so a phone doesn't wrap the row. */
const BAR_CELLS = 12;
const BAR_FULL = "█";
const BAR_EMPTY = "░";

/** How long a finished row lingers before removing itself. */
const SUCCESS_LINGER_MS = 1200;
const ERROR_LINGER_MS = 10000;

/** Controls for one in-flight attachment row. All calls are no-ops once done. */
export interface AttachmentProgressHandle {
  /** Switch the phase label (and drop back to indeterminate). */
  setPhase(phase: AttachmentPhase): void;
  /** Report real byte progress. `total` of 0 means "not known yet". */
  setProgress(transferred: number, total: number): void;
  /** Show liveness without a percentage (no byte signal for this phase). */
  setIndeterminate(): void;
  /** Show or hide the cancel affordance (hidden once cancelling can't work). */
  setCancellable(cancellable: boolean): void;
  /** Finish successfully — a brief tick, then the row removes itself. */
  succeed(): void;
  /** Finish with an error the user can read; the row stays until dismissed. */
  fail(message: string): void;
  /** Remove the row immediately, with no terminal state. */
  dismiss(): void;
}

interface Row {
  el: HTMLElement;
  iconEl: HTMLElement;
  nameEl: HTMLElement;
  statusEl: HTMLElement;
  cancelEl: HTMLButtonElement;
  done: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Render `n` bytes as a short human-readable string ("1.2 MB"). */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Build the text progress bar for a 0–1 fraction. */
export function renderBar(fraction: number): string {
  const clamped = Math.max(0, Math.min(1, fraction));
  const filled = Math.round(clamped * BAR_CELLS);
  return `[${BAR_FULL.repeat(filled)}${BAR_EMPTY.repeat(BAR_CELLS - filled)}]`;
}

/**
 * A stack of attachment rows, owned by the composer (see `ui/Input.ts`). Hidden
 * whenever no attachment is in flight, so it costs no layout at rest.
 */
export class AttachmentProgressList {
  private _el: HTMLElement;
  private _rows: Set<Row> = new Set();
  private _spinTimer: ReturnType<typeof setInterval> | null = null;
  private _frame = 0;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "attach-progress";
    this._el.style.display = "none";
    this._el.setAttribute("role", "status");
    this._el.setAttribute("aria-live", "polite");
    this._el.setAttribute("aria-label", "Attachment progress");
  }

  /** The element to mount in the compose region. */
  getElement(): HTMLElement {
    return this._el;
  }

  /** True while at least one row is on screen (in flight or lingering). */
  isActive(): boolean {
    return this._rows.size > 0;
  }

  /**
   * Add a row for a file that is being attached.
   *
   * @param filename Shown verbatim; the user needs to know *which* file.
   * @param onCancel Called if the user cancels. Omit when the send can't be
   *                 stopped — no button is rendered rather than a fake one.
   */
  start(filename: string, onCancel?: () => void): AttachmentProgressHandle {
    const el = document.createElement("div");
    el.className = "attach-progress__row";

    const iconEl = document.createElement("span");
    iconEl.className = "attach-progress__icon";
    iconEl.setAttribute("aria-hidden", "true");
    iconEl.textContent = SPINNER_FRAMES[this._frame];
    el.appendChild(iconEl);

    const nameEl = document.createElement("span");
    nameEl.className = "attach-progress__name";
    nameEl.textContent = filename;
    el.appendChild(nameEl);

    const statusEl = document.createElement("span");
    statusEl.className = "attach-progress__status";
    statusEl.textContent = `${PHASE_LABEL.reading}…`;
    el.appendChild(statusEl);

    const cancelEl = document.createElement("button");
    cancelEl.type = "button";
    cancelEl.className = "attach-progress__cancel";
    cancelEl.textContent = "×";
    cancelEl.setAttribute("aria-label", `Cancel attaching ${filename}`);
    if (!onCancel) cancelEl.style.display = "none";
    el.appendChild(cancelEl);

    const row: Row = { el, iconEl, nameEl, statusEl, cancelEl, done: false, timer: null };

    cancelEl.addEventListener("click", () => {
      if (row.done) {
        // Post-terminal the button is a plain dismiss.
        this._remove(row);
        return;
      }
      onCancel?.();
      this._remove(row);
    });

    this._el.appendChild(el);
    this._rows.add(row);
    this._el.style.display = "";
    this._startSpinner();

    const handle: AttachmentProgressHandle = {
      setPhase: (phase) => {
        if (row.done) return;
        row.el.dataset.phase = phase;
        row.statusEl.textContent = `${PHASE_LABEL[phase]}…`;
      },
      setProgress: (transferred, total) => {
        if (row.done) return;
        const phase = (row.el.dataset.phase as AttachmentPhase | undefined) ?? "reading";
        if (!(total > 0)) {
          row.statusEl.textContent = `${PHASE_LABEL[phase]}…`;
          return;
        }
        const fraction = Math.max(0, Math.min(1, transferred / total));
        const pct = Math.floor(fraction * 100);
        row.statusEl.textContent =
          `${PHASE_LABEL[phase]} ${renderBar(fraction)} ${pct}% ` +
          `· ${formatBytes(transferred)}/${formatBytes(total)}`;
      },
      setIndeterminate: () => {
        if (row.done) return;
        const phase = (row.el.dataset.phase as AttachmentPhase | undefined) ?? "reading";
        row.statusEl.textContent = `${PHASE_LABEL[phase]}…`;
      },
      setCancellable: (cancellable) => {
        if (row.done) return;
        cancelEl.style.display = cancellable && onCancel ? "" : "none";
      },
      succeed: () => this._finish(row, "success", "sent"),
      fail: (message) => this._finish(row, "error", message),
      dismiss: () => this._remove(row),
    };

    return handle;
  }

  /** Remove every row (e.g. leaving the room / tearing down). */
  clear(): void {
    for (const row of Array.from(this._rows)) this._remove(row);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private _finish(row: Row, kind: "success" | "error", message: string): void {
    if (row.done || !this._rows.has(row)) return;
    row.done = true;
    row.el.classList.add(`attach-progress__row--${kind}`);
    row.iconEl.textContent = kind === "success" ? "[✓]" : "[!]";
    row.statusEl.textContent = message;
    // A failed row keeps a button, now meaning "dismiss" — an error the user
    // hasn't read yet must not be the only thing a timer takes away.
    row.cancelEl.style.display = kind === "error" ? "" : "none";
    row.cancelEl.setAttribute("aria-label", `Dismiss ${row.nameEl.textContent ?? "attachment"} error`);
    this._stopSpinnerIfIdle();
    row.timer = setTimeout(
      () => this._remove(row),
      kind === "success" ? SUCCESS_LINGER_MS : ERROR_LINGER_MS,
    );
  }

  private _remove(row: Row): void {
    if (!this._rows.has(row)) return;
    if (row.timer) clearTimeout(row.timer);
    this._rows.delete(row);
    row.el.remove();
    if (this._rows.size === 0) this._el.style.display = "none";
    this._stopSpinnerIfIdle();
  }

  private _startSpinner(): void {
    if (this._spinTimer) return;
    this._spinTimer = setInterval(() => {
      this._frame = (this._frame + 1) % SPINNER_FRAMES.length;
      for (const row of this._rows) {
        if (!row.done) row.iconEl.textContent = SPINNER_FRAMES[this._frame];
      }
    }, SPINNER_INTERVAL_MS);
  }

  private _stopSpinnerIfIdle(): void {
    if (!this._spinTimer) return;
    for (const row of this._rows) if (!row.done) return;
    clearInterval(this._spinTimer);
    this._spinTimer = null;
  }
}
