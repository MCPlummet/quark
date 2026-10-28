// Thread panel — the open thread, drawn in the room timeline at its root.
//
// The thread used to be an inline panel spliced into the timeline's own message
// list, under its root. Living inside the main scroller is what made it fragile:
// its rows carried `data-message-id` like the timeline's, so the windowed
// renderer's cull pivot could land on one and re-centre the window on older
// history (dropping the live tail — #132); the timeline's selection methods
// had to branch on "is a thread open" and `selectLast()` (jump-to-latest, `G`)
// ended up scrolling the room to the thread; and every re-open rebuilt the panel
// scrolled to its oldest reply (#131).
//
// It is now its own component, mounted (`embedIn`) inside the timeline's
// non-scrolling wrapper, so it covers exactly the timeline region: a backdrop
// dims (and blocks pointer access to) the room timeline, and the panel opens
// where the thread's root is, the room parting around it (`TimelineSplit`).
// That parting is paint only — the timeline keeps rendering underneath,
// untouched, and nothing here can move its scroll. The compose box below stays
// live and sends into the thread.

import { createReactionBar, type ReactionGroup } from "./Reactions.js";
import { appendLinkifiedText } from "../app/links.js";
import { attachLongPress } from "../app/long_press.js";
import { appendCaption, buildFileAffordance, renderFormattedBody } from "./message_body.js";
import { buildReplyPreview, buildVideoAffordance, playVideoInline, type ReplyPreviewData } from "./Timeline.js";
import { TimelineSplit, type SplitHost } from "./thread_split.js";

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
  /** The caption's `formatted_body`, when it has one — where inline custom
   *  emoji live. Mirrors Timeline's `MessageData.captionHtml` (#84). */
  captionHtml?: string;
  reactions?: ReactionGroup[];
  /** The message this one genuinely replies to, inside the thread. Absent for
   *  a plain thread message: a thread's `is_falling_back` pointer is not a
   *  reply, and the backend reports it as none. */
  replyTo?: ReplyPreviewData;
}

/** The root renders through the same row builder as the replies. */
export type ThreadRootData = ThreadMessageData;

/** Distance from the bottom within which the reply list counts as "at the
 *  latest reply" and keeps following new ones. */
const STICK_SLOP_PX = 24;

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

/** Placeholder ids for rows sent from this device and not yet confirmed. They
 *  get no action bar: there is no event to reply to or react to yet. */
function isProvisional(id: string): boolean {
  return id.startsWith("local-");
}

export class ThreadView {
  private _el: HTMLElement;
  private _backdropEl: HTMLElement;
  private _sheetEl: HTMLElement;
  private _countEl: HTMLElement;
  private _hintEl: HTMLElement;
  private _closeBtn: HTMLButtonElement;
  private _scrollEl: HTMLElement;
  private _rootEl: HTMLElement;
  private _dividerEl: HTMLElement;
  private _listEl: HTMLElement;
  private _statusEl: HTMLElement;

  private _root: ThreadRootData | null = null;
  private _messages: ThreadMessageData[] = [];
  /** Index into {@link _items} (root first), or -1 for no selection. */
  private _selectedIndex = -1;
  /** Follow the newest reply as content arrives or grows (images decoding).
   *  Disengaged when the user scrolls up, re-engaged at the bottom. */
  private _stickToBottom = true;
  /** Between open() and the replies arriving. */
  private _loading = false;
  /** Parts the room around the panel; null until embedded in a timeline. */
  private _split: TimelineSplit | null = null;

  private _onClose: (() => void) | null = null;
  private _onFocus: (() => void) | null = null;
  private _onContextMenu: ((eventId: string, x: number, y: number) => void) | null = null;
  private _onImageClick: ((src: string, alt: string, eventId: string) => void) | null = null;
  private _onJumpOutside: ((eventId: string) => void) | null = null;
  private _onUnresolvedReply: ((eventId: string) => void) | null = null;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "thread-view";
    this._el.setAttribute("role", "region");
    this._el.setAttribute("aria-label", "Thread");
    this._el.style.display = "none";

    // ── Backdrop: dims the room timeline and closes the thread on click ─────
    this._backdropEl = document.createElement("div");
    this._backdropEl.className = "thread-view__backdrop";
    this._backdropEl.setAttribute("aria-hidden", "true");
    this._backdropEl.title = "Close thread";
    this._backdropEl.addEventListener("click", () => this._onClose?.());
    // A wheel or drag over the dimmed room must not scroll anything behind it.
    this._backdropEl.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });
    this._backdropEl.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
    this._el.appendChild(this._backdropEl);

    this._sheetEl = document.createElement("section");
    this._sheetEl.className = "thread-view__sheet";
    this._el.appendChild(this._sheetEl);

    // ── Header ────────────────────────────────────────────────────────────
    const header = document.createElement("div");
    header.className = "thread-view__header";

    const title = document.createElement("span");
    title.className = "thread-view__title";
    title.textContent = "⌥ Thread";
    header.appendChild(title);

    this._countEl = document.createElement("span");
    this._countEl.className = "thread-view__count";
    header.appendChild(this._countEl);

    this._hintEl = document.createElement("span");
    this._hintEl.className = "thread-view__hint";
    header.appendChild(this._hintEl);

    this._closeBtn = document.createElement("button");
    this._closeBtn.className = "thread-view__close";
    this._closeBtn.type = "button";
    this._closeBtn.textContent = "[x]";
    this._closeBtn.setAttribute("aria-label", "Close thread");
    this._closeBtn.title = "Close thread";
    this._closeBtn.addEventListener("click", () => this._onClose?.());
    header.appendChild(this._closeBtn);
    this._sheetEl.appendChild(header);

    // ── One scroller: root, divider, replies ──────────────────────────────
    this._scrollEl = document.createElement("div");
    this._scrollEl.className = "thread-view__scroll";
    this._scrollEl.addEventListener("scroll", () => {
      this._stickToBottom = this._isAtBottom();
    });
    this._sheetEl.appendChild(this._scrollEl);

    this._rootEl = document.createElement("div");
    this._rootEl.className = "thread-view__root";
    this._rootEl.setAttribute("aria-label", "Thread root message");
    this._scrollEl.appendChild(this._rootEl);

    this._dividerEl = document.createElement("div");
    this._dividerEl.className = "thread-view__divider";
    this._dividerEl.setAttribute("role", "separator");
    this._scrollEl.appendChild(this._dividerEl);

    this._listEl = document.createElement("div");
    this._listEl.className = "thread-view__timeline";
    this._listEl.setAttribute("role", "list");
    this._listEl.setAttribute("aria-label", "Thread replies");
    this._scrollEl.appendChild(this._listEl);

    this._statusEl = document.createElement("div");
    this._statusEl.className = "thread-view__status";
    this._scrollEl.appendChild(this._statusEl);

    // Images decoding and emoji resolving grow the replies after they render;
    // keep the newest reply in view while the reader is following it.
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(() => {
        if (this._stickToBottom) this._scrollToBottom();
      }).observe(this._listEl);
    }

    // Clicking in the sheet makes the thread the active panel (j/k, r, e …).
    this._sheetEl.addEventListener("click", (e) => {
      this._onFocus?.();
      const target = e.target as HTMLElement;
      if (target.closest(".reply-preview, button, a, .message__video-affordance, .message__file-affordance")) return;
      if (
        target instanceof HTMLImageElement &&
        (target.classList.contains("thread-view__message-image") ||
          target.classList.contains("thread-view__message-sticker"))
      ) {
        const id = target.closest<HTMLElement>("[data-message-id]")?.dataset.messageId;
        if (id) this._onImageClick?.(target.src, target.alt, id);
        return;
      }
      const row = target.closest<HTMLElement>("[data-message-id]");
      if (row) {
        const idx = this._items().findIndex((m) => m.id === row.dataset.messageId);
        if (idx >= 0) this._setSelected(idx, { scroll: false });
      }
    });

    this._sheetEl.addEventListener("contextmenu", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>("[data-message-id]");
      const id = row?.dataset.messageId;
      if (!id || isProvisional(id)) return;
      e.preventDefault();
      this._onContextMenu?.(id, e.clientX, e.clientY);
    });

    // Long press → the message's action sheet, as in the timeline: on touch
    // there is no hover bar, so this is how a reply inside the thread is started.
    attachLongPress(this._sheetEl, {
      ignoreSelector: "a, button, img, .message__link",
      resolve: (target) => {
        const id = target.closest<HTMLElement>("[data-message-id]")?.dataset.messageId ?? null;
        return id && !isProvisional(id) ? id : null;
      },
      onLongPress: (id, x, y) => this._onContextMenu?.(id, x, y),
    });

    // A reply preview inside the thread jumps within it. Stopped here so the
    // event never reaches a listener that would scroll the room behind us.
    this._sheetEl.addEventListener("quark:jump-to-message", (e: Event) => {
      e.stopPropagation();
      const { eventId } = (e as CustomEvent<{ eventId: string }>).detail;
      if (!this.scrollToMessage(eventId)) this._onJumpOutside?.(eventId);
    });
  }

  getElement(): HTMLElement {
    return this._el;
  }

  /** Mount over `host`'s timeline region and open threads in it, at their
   *  root. Without this the panel has no room to part and simply appears. */
  embedIn(host: SplitHost): void {
    host.getElement().appendChild(this._el);
    this._split = new TimelineSplit(host, this._sheetEl, () => this._scrollEl.offsetTop);
  }

  /** The reply list's scroll container. */
  getScrollElement(): HTMLElement {
    return this._scrollEl;
  }

  // ── Callbacks ───────────────────────────────────────────────────────────

  /** The [x] button or a click on the dimmed backdrop. */
  onClose(cb: () => void): void {
    this._onClose = cb;
  }

  /** A click anywhere in the sheet. */
  onFocus(cb: () => void): void {
    this._onFocus = cb;
  }

  /** Right-click, long press or a row's ⋯ button. */
  onContextMenu(cb: (eventId: string, x: number, y: number) => void): void {
    this._onContextMenu = cb;
  }

  onImageClick(cb: (src: string, alt: string, eventId: string) => void): void {
    this._onImageClick = cb;
  }

  /** A reply preview pointing at something outside this thread was clicked. */
  onJumpOutside(cb: (eventId: string) => void): void {
    this._onJumpOutside = cb;
  }

  /** A reply preview was rendered as "loading" — its original needs fetching. */
  onUnresolvedReply(cb: (eventId: string) => void): void {
    this._onUnresolvedReply = cb;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  /** Event ID of the thread being shown, or null when closed. */
  get rootId(): string | null {
    return this._root?.id ?? null;
  }

  get isOpen(): boolean {
    return this._root !== null;
  }

  /**
   * Show the panel for `root`. Replies arrive separately ({@link setReplies});
   * until then the panel says it is loading, so the user sees the thread open
   * at once and knows where the compose box now sends.
   */
  open(root: ThreadRootData): void {
    // A thread still folding away is finished first; this one reuses its rows.
    this._split?.settle();
    this._root = root;
    this._messages = [];
    this._selectedIndex = -1;
    this._stickToBottom = true;
    this._rootEl.replaceChildren(this._buildRow(root, true));
    this._listEl.replaceChildren();
    this._loading = true;
    this._renderChrome();
    this._el.style.display = "";
    this._split?.open(root.id);
  }

  /** Replace the replies (the thread's own events, root excluded). Scrolls to
   *  the newest reply — a thread is read from its latest message, and opening
   *  it at the oldest left a long one scrolled to the top (#131). */
  setReplies(replies: ThreadMessageData[]): void {
    if (!this._root) return;
    // A reply that arrived live while the thread was loading is kept: the
    // fetch may have been answered before it was sent.
    const live = this._messages.filter((m) => !replies.some((r) => r.id === m.id));
    this._messages = [...replies, ...live];
    this._selectedIndex = -1;
    this._listEl.replaceChildren(...this._messages.map((m) => this._buildRow(m, false)));
    this._loading = false;
    this._renderChrome();
    this._announceUnresolved(replies);
    this._stickToBottom = true;
    this._scrollToBottom();
    // Once more after layout, for replies whose height settles late.
    if (typeof requestAnimationFrame !== "undefined") {
      requestAnimationFrame(() => {
        if (this._stickToBottom) this._scrollToBottom();
      });
    }
  }

  /** Swap the root row (e.g. once its full event arrives with the thread). */
  updateRoot(root: ThreadRootData): void {
    if (!this._root || this._root.id !== root.id) return;
    this._root = root;
    this._rootEl.replaceChildren(this._buildRow(root, true));
    this._announceUnresolved([root]);
  }

  /** Append one reply. Follows it only if the reader was already at the latest
   *  reply, or it is their own; someone reading further up stays put. */
  appendReply(msg: ThreadMessageData): void {
    if (!this._root || this._messages.some((m) => m.id === msg.id)) return;
    const follow = this._stickToBottom || this._isAtBottom() || !!msg.isOwn;
    this._messages.push(msg);
    this._listEl.appendChild(this._buildRow(msg, false));
    this._renderChrome();
    this._announceUnresolved([msg]);
    if (follow) {
      this._stickToBottom = true;
      this._scrollToBottom();
    }
  }

  /** Rename a provisional row to its real event ID, and give it its actions. */
  confirmMessage(provisionalId: string, eventId: string): void {
    const idx = this._messages.findIndex((m) => m.id === provisionalId);
    if (idx < 0) return;
    // The sync echo may have landed first, as its own row.
    if (this._messages.some((m) => m.id === eventId)) {
      this.removeMessage(provisionalId);
      return;
    }
    const msg = { ...this._messages[idx], id: eventId };
    this._messages[idx] = msg;
    this.getMessageEl(provisionalId)?.replaceWith(this._buildRow(msg, false));
  }

  removeMessage(eventId: string): void {
    const idx = this._messages.findIndex((m) => m.id === eventId);
    if (idx < 0) return;
    const selectedId = this.selectedMessageId;
    this._messages.splice(idx, 1);
    this.getMessageEl(eventId)?.remove();
    this._selectedIndex = selectedId && selectedId !== eventId
      ? this._items().findIndex((m) => m.id === selectedId)
      : -1;
    this._renderChrome();
  }

  /** Forget the thread now and fold the panel away. The rows stay drawn
   *  until the fold ends, but the thread is closed at once: nothing selects,
   *  counts or receives into it from here on. */
  close(): void {
    this._root = null;
    this._messages = [];
    this._selectedIndex = -1;
    this._loading = false;
    const hide = () => {
      this._el.classList.remove("thread-view--closing");
      this._rootEl.replaceChildren();
      this._listEl.replaceChildren();
      this._renderChrome();
      this._el.style.display = "none";
    };
    if (this._el.classList.contains("thread-view--closing")) return;
    if (!this._split || this._el.style.display === "none") {
      hide();
      return;
    }
    this._el.classList.add("thread-view--closing");
    this._split.close(hide);
  }

  /** The key that closes the thread, as the user has it bound (e.g. "Esc"). */
  setCloseHint(keyLabel: string | null): void {
    this._hintEl.textContent = keyLabel ? `${keyLabel} to close` : "";
    this._closeBtn.title = keyLabel ? `Close thread (${keyLabel})` : "Close thread";
  }

  // ── Content updates ─────────────────────────────────────────────────────

  getMessageEl(eventId: string): HTMLElement | null {
    return this._scrollEl.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(eventId)}"]`);
  }

  /** Play a video row inline, as the timeline does (`playVideoInline`). */
  showInlineVideo(eventId: string, src: string, onError?: (detail?: string) => void): void {
    playVideoInline(this.getMessageEl(eventId), src, onError);
  }

  hasMessage(eventId: string): boolean {
    return this._items().some((m) => m.id === eventId);
  }

  updateMessageMedia(eventId: string, dataUrl: string): void {
    const msg = this._items().find((m) => m.id === eventId);
    if (msg) msg.mediaUrl = dataUrl;
    const img = this.getMessageEl(eventId)?.querySelector<HTMLImageElement>(
      ".thread-view__message-image, .thread-view__message-sticker",
    );
    if (img) img.src = dataUrl;
  }

  updateMessageReactions(eventId: string, reactions: ReactionGroup[]): void {
    const msg = this._items().find((m) => m.id === eventId);
    const el = this.getMessageEl(eventId);
    if (!msg || !el) return;
    msg.reactions = reactions;
    el.querySelector(":scope > .reaction-bar")?.remove();
    if (reactions.length > 0) {
      const bar = createReactionBar(reactions);
      const actions = el.querySelector(":scope > .message__actions");
      el.insertBefore(bar, actions);
    }
  }

  /** Resolve every reply preview pointing at `originalEventId`. */
  updateReplyPreview(originalEventId: string, preview: ReplyPreviewData): void {
    for (const msg of this._items()) {
      if (msg.replyTo?.eventId !== originalEventId) continue;
      msg.replyTo = preview;
      this.getMessageEl(msg.id)?.querySelector(":scope > .reply-preview")?.replaceWith(buildReplyPreview(preview));
    }
  }

  /** Scroll a message of this thread into view and flash it. False if it is
   *  not part of the thread. */
  scrollToMessage(eventId: string): boolean {
    const idx = this._items().findIndex((m) => m.id === eventId);
    const el = this.getMessageEl(eventId);
    if (idx < 0 || !el) return false;
    this._setSelected(idx, { scroll: false });
    el.scrollIntoView?.({ block: "center" });
    this._stickToBottom = this._isAtBottom();
    el.classList.remove("message--highlight");
    void el.offsetWidth;
    el.classList.add("message--highlight");
    el.addEventListener("animationend", () => el.classList.remove("message--highlight"), { once: true });
    return true;
  }

  // ── Inline custom emoji (same contract as Timeline) ─────────────────────

  getPendingInlineEmojiUrls(): string[] {
    const imgs = this._scrollEl.querySelectorAll<HTMLImageElement>("img[data-mx-emoticon][data-mxc]");
    return [...new Set(Array.from(imgs).map((img) => img.dataset.mxc!))];
  }

  resolveInlineEmoji(mxcUrl: string, dataUrl: string): void {
    for (const img of this._scrollEl.querySelectorAll<HTMLImageElement>("img[data-mxc]")) {
      if (img.dataset.mxc === mxcUrl) img.src = dataUrl;
    }
  }

  // ── Keyboard selection (registered as the "thread" panel) ──────────────

  get selectedMessageId(): string | null {
    return this._items()[this._selectedIndex]?.id ?? null;
  }

  /** Move down. False at the newest reply, so the caller can hand focus to
   *  the compose box below — as the timeline does (#15). */
  selectNext(): boolean {
    const n = this._items().length;
    if (n === 0) return false;
    if (this._selectedIndex < 0) {
      this._setSelected(n - 1);
      return true;
    }
    if (this._selectedIndex >= n - 1) return false;
    this._setSelected(this._selectedIndex + 1);
    return true;
  }

  selectPrev(): boolean {
    const n = this._items().length;
    if (n === 0) return false;
    if (this._selectedIndex < 0) {
      this._setSelected(n - 1);
      return true;
    }
    if (this._selectedIndex === 0) return false;
    this._setSelected(this._selectedIndex - 1);
    return true;
  }

  selectFirst(): void {
    if (this._items().length > 0) this._setSelected(0);
  }

  /** Select the newest reply (the root if there are none). */
  selectLast(): boolean {
    const n = this._items().length;
    if (n === 0) return false;
    this._setSelected(n - 1);
    return true;
  }

  clearSelection(): void {
    this._setSelected(-1);
  }

  // ── Private ─────────────────────────────────────────────────────────────

  /** Root first, then replies — the order the sheet shows them in. */
  private _items(): ThreadMessageData[] {
    return this._root ? [this._root, ...this._messages] : this._messages;
  }

  private _setSelected(index: number, opts: { scroll?: boolean } = {}): void {
    const prevId = this.selectedMessageId;
    if (prevId) this.getMessageEl(prevId)?.classList.remove("thread-view__message--selected");
    this._selectedIndex = index;
    const id = this.selectedMessageId;
    if (!id) return;
    const el = this.getMessageEl(id);
    if (!el) return;
    el.classList.add("thread-view__message--selected");
    if (opts.scroll !== false) this._scrollRowIntoView(el);
  }

  /** Bring a row into the sheet's own viewport. Written against this scroller
   *  alone — `scrollIntoView` would also scroll every scrollable ancestor. */
  private _scrollRowIntoView(el: HTMLElement): void {
    const box = this._scrollEl.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.top < box.top) this._scrollEl.scrollTop -= box.top - r.top + 8;
    else if (r.bottom > box.bottom) this._scrollEl.scrollTop += r.bottom - box.bottom + 8;
    this._stickToBottom = this._isAtBottom();
  }

  private _isAtBottom(): boolean {
    const s = this._scrollEl;
    return s.scrollHeight - s.scrollTop - s.clientHeight <= STICK_SLOP_PX;
  }

  private _scrollToBottom(): void {
    this._scrollEl.scrollTop = this._scrollEl.scrollHeight;
  }

  /** Header count, divider and the loading / empty line, from the state. */
  private _renderChrome(): void {
    const n = this._messages.length;
    const label = n === 0 ? "no replies yet" : `${n} repl${n === 1 ? "y" : "ies"}`;
    this._countEl.textContent = this._loading ? "" : label;
    this._dividerEl.textContent = n === 0 ? "" : `── ${label} ──`;
    this._dividerEl.style.display = n === 0 ? "none" : "";
    const status = !this._root || n > 0
      ? ""
      : this._loading
        ? "loading replies…"
        : "No replies yet — what you send now starts the thread.";
    this._statusEl.textContent = status;
    this._statusEl.style.display = status ? "" : "none";
  }

  private _announceUnresolved(msgs: readonly ThreadMessageData[]): void {
    for (const m of msgs) {
      if (m.replyTo?.state === "loading") this._onUnresolvedReply?.(m.replyTo.eventId);
    }
  }

  private _buildRow(msg: ThreadMessageData, isRoot: boolean): HTMLElement {
    const row = document.createElement("div");
    row.className =
      "thread-view__message" +
      (isRoot ? " thread-view__message--root" : "") +
      (msg.isOwn ? " thread-view__message--own" : "");
    row.setAttribute("role", isRoot ? "article" : "listitem");
    row.dataset.messageId = msg.id;

    // A reply inside the thread — drawn the way the main timeline draws one,
    // for every in-thread reply alike (see timelineEventToThreadMessage).
    if (msg.replyTo) row.appendChild(buildReplyPreview(msg.replyTo));

    const header = document.createElement("div");
    header.className = "thread-view__message-header";
    const sender = document.createElement("span");
    sender.className = "thread-view__message-sender" + (msg.isOwn ? " thread-view__message-sender--own" : "");
    sender.textContent = msg.senderName;
    header.appendChild(sender);
    const ts = document.createElement("span");
    ts.className = "thread-view__message-timestamp";
    ts.textContent = formatTimestamp(msg.timestamp);
    ts.title = msg.timestamp;
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
      appendCaption(row, "thread-view__message-body", msg.caption, msg.captionHtml);
    } else if (type === "video") {
      row.appendChild(buildVideoAffordance(
        msg.mediaUrl, msg.mediaAlt, msg.mediaMimeType, msg.mediaEncryptionInfo,
        msg.mediaThumbnailUrl, msg.mediaThumbnailEncryptionInfo,
      ));
      appendCaption(row, "thread-view__message-body", msg.caption, msg.captionHtml);
    } else if (type === "file") {
      // mediaAlt over body: on a captioned upload the body is the caption,
      // which would name the saved file after it.
      row.appendChild(buildFileAffordance(msg.mediaUrl, msg.mediaAlt ?? msg.body, msg.mediaMimeType, msg.mediaEncryptionInfo));
      appendCaption(row, "thread-view__message-body", msg.caption, msg.captionHtml);
    } else {
      const body = document.createElement("div");
      body.className = "thread-view__message-body";
      if (msg.htmlBody) renderFormattedBody(body, msg.htmlBody);
      else appendLinkifiedText(body, msg.body);
      row.appendChild(body);
    }

    if (msg.reactions && msg.reactions.length > 0) row.appendChild(createReactionBar(msg.reactions));

    if (!isProvisional(msg.id)) row.appendChild(this._buildActions(row, msg));
    return row;
  }

  /** React / reply / ⋯ — the same custom events the timeline's bar bubbles, so
   *  one set of document-level handlers serves both surfaces. */
  private _buildActions(row: HTMLElement, msg: ThreadMessageData): HTMLElement {
    const actions = document.createElement("div");
    actions.className = "message__actions";
    actions.setAttribute("aria-hidden", "true");

    const button = (label: string, title: string, onClick: (btn: HTMLButtonElement) => void): HTMLButtonElement => {
      const btn = document.createElement("button");
      btn.className = "message__action-btn";
      btn.type = "button";
      btn.textContent = label;
      btn.title = title;
      btn.tabIndex = -1;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onClick(btn);
      });
      return btn;
    };
    const bubble = (name: string, detail: Record<string, unknown>) =>
      row.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));

    actions.appendChild(button("😀", "React (e)", () => bubble("quark:msg-react", { eventId: msg.id })));
    actions.appendChild(button("↩", "Reply in thread (r)", () => bubble("quark:msg-reply", { eventId: msg.id })));
    actions.appendChild(button("⋯", "More actions", (btn) => {
      const r = btn.getBoundingClientRect();
      this._onContextMenu?.(msg.id, r.left, r.bottom);
    }));
    return actions;
  }
}
