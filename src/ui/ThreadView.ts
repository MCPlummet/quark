// Thread timeline panel — scoped to a single thread

import { createReactionBar, type ReactionGroup } from "./Reactions.js";
import { attachResizeHandle } from "./ResizeHandle.js";
import { guardViewportPan } from "../app/mobile.js";
import { appendLinkifiedText, decorateMessageLinks } from "../app/links.js";

export interface ThreadMessageData {
  id: string;
  senderName: string;
  isOwn?: boolean;
  timestamp: string;
  body: string;
  htmlBody?: string;
  type?: "text" | "image" | "video" | "sticker" | "file";
  mediaUrl?: string;
  mediaAlt?: string;
  mediaMimeType?: string;
  mediaEncryptionInfo?: string;
  mediaThumbnailUrl?: string;
  mediaThumbnailEncryptionInfo?: string;
  /** Media caption (MSC2530) shown beneath the media, when the event carries a
   *  distinct filename. Mirrors Timeline's `MessageData.caption`. */
  caption?: string;
  reactions?: ReactionGroup[];
}

export interface ThreadRootData {
  id: string;
  senderName: string;
  timestamp: string;
  body: string;
  htmlBody?: string;
}

type ThreadReplyCallback = (body: string) => void;
type ThreadCloseCallback = () => void;

/** Render an MSC2530 media caption beneath the media, reusing Timeline's
 *  `.message__image-caption` styling so threads and the main timeline match.
 *  No-op when the event carried no caption (a bare-filename body isn't one).
 *
 *  `blockName` is the caller's BEM block — this panel and Timeline's inline
 *  thread panel style their message bodies separately. Shared rather than
 *  copied so the next caption change (escaping, a spoiler, a max-height)
 *  cannot land on one thread surface and miss the other. */
export function appendCaption(row: HTMLElement, blockName: string, caption?: string): void {
  if (!caption) return;
  const el = document.createElement("div");
  el.className = `${blockName}__message-body message__image-caption`;
  el.textContent = caption;
  row.appendChild(el);
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const h = d.getHours().toString().padStart(2, "0");
    const m = d.getMinutes().toString().padStart(2, "0");
    return `${h}:${m}`;
  } catch {
    return "";
  }
}

/** Thread timeline panel with root message and reply input. */
export class ThreadView {
  private _el: HTMLElement;
  private _headerEl: HTMLElement;
  private _closeBtn: HTMLButtonElement;
  private _rootEl: HTMLElement;
  private _timelineEl: HTMLElement;
  private _inputBarEl: HTMLElement;
  private _inputField: HTMLInputElement;

  private _onReply: ThreadReplyCallback | null = null;
  private _onClose: ThreadCloseCallback | null = null;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "thread-view";
    this._el.setAttribute("role", "region");
    this._el.setAttribute("aria-label", "Thread");
    this._el.style.display = "none";

    // ── Header ────────────────────────────────────────────────────────────
    this._headerEl = document.createElement("div");
    this._headerEl.className = "thread-view__header";

    const headerTitle = document.createElement("span");
    headerTitle.className = "thread-view__title";
    headerTitle.textContent = "Thread";
    this._headerEl.appendChild(headerTitle);

    this._closeBtn = document.createElement("button");
    this._closeBtn.className = "thread-view__close";
    this._closeBtn.type = "button";
    this._closeBtn.textContent = "[x]";
    this._closeBtn.setAttribute("aria-label", "Close thread");
    this._closeBtn.addEventListener("click", () => {
      this._onClose?.();
      this.hide();
    });
    this._headerEl.appendChild(this._closeBtn);
    this._el.appendChild(this._headerEl);

    // ── Thread root message ───────────────────────────────────────────────
    this._rootEl = document.createElement("div");
    this._rootEl.className = "thread-view__root";
    this._rootEl.setAttribute("role", "article");
    this._rootEl.setAttribute("aria-label", "Thread root message");
    this._el.appendChild(this._rootEl);

    // ── Divider ───────────────────────────────────────────────────────────
    const divider = document.createElement("div");
    divider.className = "thread-view__divider";
    divider.textContent = "── replies ──";
    divider.setAttribute("role", "separator");
    this._el.appendChild(divider);

    // ── Reply timeline ────────────────────────────────────────────────────
    this._timelineEl = document.createElement("div");
    this._timelineEl.className = "thread-view__timeline";
    this._timelineEl.setAttribute("role", "list");
    this._timelineEl.setAttribute("aria-label", "Thread replies");
    this._el.appendChild(this._timelineEl);

    // ── Reply input bar ───────────────────────────────────────────────────
    this._inputBarEl = document.createElement("div");
    this._inputBarEl.className = "thread-view__input-bar";

    const prompt = document.createElement("span");
    prompt.className = "thread-view__prompt";
    prompt.textContent = ":>";
    prompt.setAttribute("aria-hidden", "true");
    this._inputBarEl.appendChild(prompt);

    this._inputField = document.createElement("input");
    this._inputField.type = "text";
    this._inputField.className = "thread-view__input";
    this._inputField.placeholder = "Reply in thread…";
    this._inputField.setAttribute("aria-label", "Thread reply");
    this._inputField.setAttribute("autocomplete", "off");
    this._inputField.setAttribute("autocorrect", "off");
    this._inputField.setAttribute("autocapitalize", "off");
    this._inputField.setAttribute("spellcheck", "false");
    this._inputField.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const value = this._inputField.value.trim();
        if (value) {
          this._onReply?.(value);
          this._inputField.value = "";
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        this._inputField.blur();
      }
    });
    this._inputBarEl.appendChild(this._inputField);
    this._el.appendChild(this._inputBarEl);
    // On mobile this row is the compose bar of a full-screen overlay, and it is
    // this panel's own — not an Input — so it needs the same pan guard (#33).
    // Nothing in it scrolls (the reply field is one line), so nothing is exempt.
    guardViewportPan(this._inputBarEl);

    // Drag-to-resize handle at the left edge
    attachResizeHandle(this._el, "--thread-view-width", "left", 200, 600);
  }

  getElement(): HTMLElement {
    return this._el;
  }

  onReply(cb: ThreadReplyCallback): void {
    this._onReply = cb;
  }

  onClose(cb: ThreadCloseCallback): void {
    this._onClose = cb;
  }

  show(): void {
    this._el.style.display = "";
  }

  hide(): void {
    this._el.style.display = "none";
  }

  setRoot(root: ThreadRootData): void {
    this._rootEl.innerHTML = "";

    const header = document.createElement("div");
    header.className = "thread-view__root-header";

    const sender = document.createElement("span");
    sender.className = "thread-view__root-sender";
    sender.textContent = `<${root.senderName}>`;
    header.appendChild(sender);

    const ts = document.createElement("span");
    ts.className = "thread-view__root-timestamp";
    ts.textContent = formatTimestamp(root.timestamp);
    ts.setAttribute("title", root.timestamp);
    header.appendChild(ts);

    this._rootEl.appendChild(header);

    const body = document.createElement("div");
    body.className = "thread-view__root-body";
    if (root.htmlBody) {
      body.innerHTML = root.htmlBody;
      decorateMessageLinks(body);
    } else {
      appendLinkifiedText(body, root.body);
    }
    this._rootEl.appendChild(body);
  }

  setReplies(messages: ThreadMessageData[]): void {
    this._timelineEl.innerHTML = "";
    for (const msg of messages) {
      this._timelineEl.appendChild(this._buildMessageEl(msg));
    }
    this._scrollToBottom();
  }

  appendReply(msg: ThreadMessageData): void {
    this._timelineEl.appendChild(this._buildMessageEl(msg));
    this._scrollToBottom();
  }

  updateMessageMedia(eventId: string, dataUrl: string): void {
    const el = this._timelineEl.querySelector<HTMLElement>(`[data-message-id="${eventId}"]`);
    if (!el) return;
    const img = el.querySelector<HTMLImageElement>(".thread-view__message-image, .thread-view__message-sticker");
    if (img) img.src = dataUrl;
  }

  focusInput(): void {
    this._inputField.focus();
  }

  // ── Private ────────────────────────────────────────────────────────────

  private _buildMessageEl(msg: ThreadMessageData): HTMLElement {
    const row = document.createElement("div");
    row.className = "thread-view__message" + (msg.isOwn ? " thread-view__message--own" : "");
    row.setAttribute("role", "listitem");
    row.setAttribute("tabindex", "0");
    row.dataset.messageId = msg.id;

    const header = document.createElement("div");
    header.className = "thread-view__message-header";

    const sender = document.createElement("span");
    sender.className =
      "thread-view__message-sender" + (msg.isOwn ? " thread-view__message-sender--own" : "");
    sender.textContent = `<${msg.senderName}>`;
    header.appendChild(sender);

    const ts = document.createElement("span");
    ts.className = "thread-view__message-timestamp";
    ts.textContent = formatTimestamp(msg.timestamp);
    ts.setAttribute("title", msg.timestamp);
    header.appendChild(ts);

    row.appendChild(header);

    const type = msg.type ?? "text";

    if (type === "image" || type === "sticker") {
      const img = document.createElement("img");
      img.className = `thread-view__message-${type}`;
      img.src = msg.mediaUrl ?? "";
      img.alt = msg.mediaAlt ?? type;
      img.loading = "lazy";
      row.appendChild(img);
      appendCaption(row, "thread-view", msg.caption);
    } else if (type === "video") {
      const aff = document.createElement("div");
      aff.className = "message__video-affordance";
      aff.setAttribute("role", "button");
      aff.setAttribute("tabindex", "0");
      aff.title = "Click to play video";
      const icon = document.createElement("span");
      icon.className = "message__video-affordance-icon";
      icon.textContent = "▶";
      icon.setAttribute("aria-hidden", "true");
      aff.appendChild(icon);
      const label = document.createElement("span");
      label.className = "message__video-affordance-label";
      label.textContent = msg.mediaAlt || "video";
      aff.appendChild(label);
      const activate = () => {
        aff.dispatchEvent(new CustomEvent("quark:open-video", {
          bubbles: true,
          detail: { mxcUrl: msg.mediaUrl, filename: msg.mediaAlt, mimeType: msg.mediaMimeType, encryptionInfo: msg.mediaEncryptionInfo },
        }));
      };
      aff.addEventListener("click", activate);
      aff.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); }
      });
      row.appendChild(aff);
      appendCaption(row, "thread-view", msg.caption);
    } else {
      const body = document.createElement("div");
      body.className = "thread-view__message-body";
      if (msg.htmlBody) {
        body.innerHTML = msg.htmlBody;
        decorateMessageLinks(body);
      } else {
        appendLinkifiedText(body, msg.body);
      }
      row.appendChild(body);
    }

    if (msg.reactions && msg.reactions.length > 0) {
      row.appendChild(createReactionBar(msg.reactions));
    }

    return row;
  }

  private _scrollToBottom(): void {
    this._timelineEl.scrollTop = this._timelineEl.scrollHeight;
  }
}
