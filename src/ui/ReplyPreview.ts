// Compose banner — the bar above the input that says where the next message
// goes: a reply, an edit, the open thread, or a reply inside the open thread.
//
// A pure view. It used to carry its own "thread mode" flag, which is how it
// and the app state came apart: dismissing the banner cleared the flag and hid
// the bar while the thread stayed open and kept receiving every message (#131).
// What the bar shows is now decided in one place, `refreshComposeBanner`
// (app/actions/compose_target.ts), from AppState alone.

type DismissCallback = () => void;

export interface ReplyPreviewData {
  /** Matrix event ID of the message being replied to */
  eventId: string;
  /** Display name of the message sender */
  senderName: string;
  /** Plain-text snippet of the quoted message body */
  snippet: string;
}

const MAX_SNIPPET = 80;

function clip(snippet: string): string {
  return snippet.length > MAX_SNIPPET ? snippet.slice(0, MAX_SNIPPET) + "…" : snippet;
}

/**
 * Shows a quoted message preview above the input bar while the user is
 * composing a reply. The caller is responsible for inserting this element
 * into the DOM immediately above the input bar.
 */
export class ReplyPreview {
  private _el: HTMLElement;
  private _senderEl: HTMLElement;
  private _snippetEl: HTMLElement;
  private _closeBtn: HTMLButtonElement;

  private _currentReply: ReplyPreviewData | null = null;
  private _onDismiss: DismissCallback | null = null;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "reply-preview-bar";
    this._el.setAttribute("role", "region");
    this._el.setAttribute("aria-label", "Reply preview");
    this._el.style.display = "none";

    // ── Left gutter / indicator ───────────────────────────────────────────
    const indicator = document.createElement("span");
    indicator.className = "reply-preview-bar__indicator";
    indicator.textContent = "┊";
    indicator.setAttribute("aria-hidden", "true");
    this._el.appendChild(indicator);

    // ── Content area ──────────────────────────────────────────────────────
    const content = document.createElement("div");
    content.className = "reply-preview-bar__content";
    this._el.appendChild(content);

    this._senderEl = document.createElement("span");
    this._senderEl.className = "reply-preview-bar__sender";
    content.appendChild(this._senderEl);

    this._snippetEl = document.createElement("span");
    this._snippetEl.className = "reply-preview-bar__snippet";
    content.appendChild(this._snippetEl);

    // ── Close / cancel button ─────────────────────────────────────────────
    this._closeBtn = document.createElement("button");
    this._closeBtn.className = "reply-preview-bar__close";
    this._closeBtn.type = "button";
    this._closeBtn.textContent = "[x]";
    this._closeBtn.setAttribute("aria-label", "Cancel reply");
    this._closeBtn.addEventListener("click", () => this._onDismiss?.());
    this._el.appendChild(this._closeBtn);

    // ── Keyboard handling ─────────────────────────────────────────────────
    this._el.addEventListener("keydown", (e) => {
      if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) {
        e.preventDefault();
        this._onDismiss?.();
      }
    });
  }

  getElement(): HTMLElement {
    return this._el;
  }

  /** The [x] button (or Escape on the bar). What it cancels is the caller's
   *  call — see `dismissComposeBanner`. */
  onDismiss(cb: DismissCallback): void {
    this._onDismiss = cb;
  }

  /** A reply banner. `inThread` marks a reply inside the open thread, which
   *  is sent into that thread quoting the message. */
  show(data: ReplyPreviewData, opts: { inThread?: boolean } = {}): void {
    const inThread = opts.inThread ?? false;
    this._render({
      variant: inThread ? "thread" : null,
      sender: inThread ? `⌥ ↩ <${data.senderName}>` : `<${data.senderName}>`,
      snippet: data.snippet,
      label: inThread ? `Replying in thread to ${data.senderName}` : `Replying to ${data.senderName}`,
      close: inThread ? "Cancel reply (stay in thread)" : "Cancel reply",
    });
    this._currentReply = data;
  }

  /** Show an edit-mode banner (sending will edit the original message). */
  showEdit(snippet: string): void {
    this._render({
      variant: "edit",
      sender: "Editing",
      snippet,
      label: "Editing message",
      close: "Cancel edit",
    });
  }

  /** Show the thread banner: everything sent goes into the open thread. */
  showThread(snippet: string): void {
    this._render({
      variant: "thread",
      sender: "⌥ Replying in thread",
      snippet,
      label: "Replying in thread",
      close: "Close thread",
    });
  }

  hide(): void {
    this._el.style.display = "none";
    this._currentReply = null;
    this._el.classList.remove("reply-preview-bar--thread", "reply-preview-bar--edit");
  }

  isVisible(): boolean {
    return this._el.style.display !== "none";
  }

  /** Returns the event ID currently being replied to, or null. */
  getCurrentReplyEventId(): string | null {
    return this._currentReply?.eventId ?? null;
  }

  // ── Private ────────────────────────────────────────────────────────────

  private _render(opts: {
    variant: "thread" | "edit" | null;
    sender: string;
    snippet: string;
    label: string;
    close: string;
  }): void {
    this._currentReply = null;
    this._el.classList.toggle("reply-preview-bar--thread", opts.variant === "thread");
    this._el.classList.toggle("reply-preview-bar--edit", opts.variant === "edit");
    this._senderEl.textContent = opts.sender;
    this._snippetEl.textContent = clip(opts.snippet);
    this._closeBtn.setAttribute("aria-label", opts.close);
    this._closeBtn.title = opts.close;
    this._el.style.display = "";
    this._el.setAttribute("aria-label", opts.label);
  }
}
