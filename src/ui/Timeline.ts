// Message timeline

import { createReactionBar, updateReactionBar, type ReactionGroup } from "./Reactions.js";
import { invoke } from "../ipc/invoke.js";
import type { SearchResult } from "../ipc/types.js";
import type { ThreadMessageData } from "./ThreadView.js";
import { isAnimatedUrl } from "../app/animated_urls.js";
import { hashColor } from "./avatarColors.js";
import { isMobile } from "../app/mobile.js";
import { openExternalUrl } from "../app/links.js";

// ── Blob URL management ───────────────────────────────────────────────────────
// Blob URLs are more memory-efficient than data: URIs — the binary data is held
// as typed arrays rather than being embedded inline in the DOM as a base64 string.

const _activeBlobUrls: string[] = [];

/**
 * Convert a base64+mime media download to a blob object URL.
 * Registers the URL for cleanup when the timeline is re-rendered.
 */
function createBlobUrl(data_base64: string, mime_type: string): string {
  const binary = atob(data_base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime_type });
  const url = URL.createObjectURL(blob);
  _activeBlobUrls.push(url);
  return url;
}

/** Revoke all tracked blob URLs and clear the registry. */
function revokeActiveBlobUrls(): void {
  for (const url of _activeBlobUrls) URL.revokeObjectURL(url);
  _activeBlobUrls.length = 0;
}

// ── URL linkification ─────────────────────────────────────────────────────────

const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/g;

/**
 * Render plain text with http/https URLs as clickable anchor elements.
 * Splits the text on URL boundaries and appends text nodes + <a> tags.
 */
function appendLinkifiedText(container: HTMLElement, text: string): void {
  let last = 0;
  let match: RegExpExecArray | null;
  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > last) {
      container.appendChild(document.createTextNode(text.slice(last, match.index)));
    }
    const url = match[0].replace(/[.,;:!?]+$/, ""); // strip trailing punctuation
    const a = document.createElement("a");
    a.href = url;
    // Only the mobile WebView needs target=_blank to register taps as a real
    // link. On desktop, target=_blank makes wry open the URL in the system
    // browser itself — which, together with the explicit openExternalUrl()
    // below, opened every link twice. So set it on mobile only.
    if (isMobile()) a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = url;
    a.className = "message__link";
    a.title = url;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      openExternalUrl(url);
    });
    container.appendChild(a);
    last = match.index + url.length;
  }
  if (last < text.length) {
    container.appendChild(document.createTextNode(text.slice(last)));
  }
}

/**
 * Activate Matrix spoilers (MSC2010 / `data-mx-spoiler`) inside a freshly
 * rendered message body. The server-supplied HTML already contains
 * `<span data-mx-spoiler[="reason"]>…</span>`; on its own that renders as plain
 * text. Here we obscure each spoiler (the CSS `.message__spoiler` rule blurs it)
 * and reveal it on click/tap. An optional reason is exposed as a tooltip.
 */
function setupSpoilers(container: HTMLElement): void {
  for (const span of Array.from(container.querySelectorAll<HTMLElement>("[data-mx-spoiler]"))) {
    if (span.classList.contains("message__spoiler")) continue; // already wired
    span.classList.add("message__spoiler");
    span.setAttribute("role", "button");
    span.setAttribute("tabindex", "0");
    const reason = span.getAttribute("data-mx-spoiler");
    span.title = reason ? `Spoiler: ${reason}` : "Spoiler — click to reveal";
    const reveal = (e: Event): void => {
      if (span.classList.contains("message__spoiler--revealed")) return;
      // Stop the reveal tap from also selecting the message / opening a menu.
      e.preventDefault();
      e.stopPropagation();
      span.classList.add("message__spoiler--revealed");
      span.removeAttribute("role");
      span.removeAttribute("tabindex");
    };
    span.addEventListener("click", reveal);
    span.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") reveal(e);
    });
  }
}

// ── URL preview cards ─────────────────────────────────────────────────────────

/** In-memory cache: url → preview data (null = fetched but no preview available) */
const _urlPreviewCache = new Map<string, { title: string | null; description: string | null; imageUrl: string | null; siteName: string | null } | null>();

/**
 * Extracts the first http/https URL from a text string.
 * Returns null if none found.
 */
function extractFirstUrl(text: string): string | null {
  const re = /https?:\/\/[^\s<>"')\]]+/g;
  const m = re.exec(text);
  if (!m) return null;
  return m[0].replace(/[.,;:!?]+$/, "");
}

/**
 * Builds a URL preview card element. The image (if present) is loaded async.
 */
function buildUrlPreviewCard(preview: { title: string | null; description: string | null; imageUrl: string | null; siteName: string | null }): HTMLElement {
  const card = document.createElement("div");
  card.className = "message__url-preview";

  if (preview.imageUrl) {
    const imgWrap = document.createElement("div");
    imgWrap.className = "message__url-preview-img-wrap";
    const img = document.createElement("img");
    img.className = "message__url-preview-img";
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    img.addEventListener("error", () => { imgWrap.style.display = "none"; });
    imgWrap.appendChild(img);
    card.appendChild(imgWrap);

    if (preview.imageUrl.startsWith("mxc://")) {
      // Matrix-proxied image — download via IPC and convert to data URL
      void invoke<{ data_base64: string; mime_type: string }>("download_media", {
        mxcUrl: preview.imageUrl,
        thumbnail: true,
        thumbnailWidth: 80,
        thumbnailHeight: 80,
        encryptionInfo: null,
      }).then((dl) => {
        img.src = createBlobUrl(dl.data_base64, dl.mime_type);
      }).catch(() => { imgWrap.style.display = "none"; });
    } else {
      // Plain https:// URL from direct-fetch fallback — set directly; CSP is null
      img.src = preview.imageUrl;
    }
  }

  const meta = document.createElement("div");
  meta.className = "message__url-preview-meta";

  if (preview.siteName) {
    const site = document.createElement("div");
    site.className = "message__url-preview-site";
    site.textContent = preview.siteName;
    meta.appendChild(site);
  }

  if (preview.title) {
    const title = document.createElement("div");
    title.className = "message__url-preview-title";
    title.textContent = preview.title;
    meta.appendChild(title);
  }

  if (preview.description) {
    const desc = document.createElement("div");
    desc.className = "message__url-preview-desc";
    desc.textContent = preview.description;
    meta.appendChild(desc);
  }

  card.appendChild(meta);
  return card;
}

/**
 * Append a URL preview card to a message container. No scrollTop compensation is
 * needed: the timeline is `flex-direction: column-reverse` (bottom-anchored), so
 * the browser keeps the viewport stationary when a card grows content above the
 * fold — same mechanism that makes prepended history not jump.
 */
function appendCardAboveViewportSafe(card: HTMLElement, container: HTMLElement): void {
  container.appendChild(card);
}

/**
 * Asynchronously fetch a URL preview and append the card to `container`.
 * Uses the module-level cache to avoid duplicate fetches.
 */
function attachUrlPreview(url: string, container: HTMLElement): void {
  if (_urlPreviewCache.has(url)) {
    const cached = _urlPreviewCache.get(url)!;
    if (cached !== null) appendCardAboveViewportSafe(buildUrlPreviewCard(cached), container);
    return;
  }
  void invoke<{ title: string | null; description: string | null; image_url: string | null; site_name: string | null } | null>("get_url_preview", { url })
    .then((preview) => {
      if (!preview) {
        _urlPreviewCache.set(url, null);
        return;
      }
      const data = { title: preview.title, description: preview.description, imageUrl: preview.image_url, siteName: preview.site_name };
      _urlPreviewCache.set(url, data);
      appendCardAboveViewportSafe(buildUrlPreviewCard(data), container);
    })
    .catch((err) => {
      console.warn("[url-preview] failed for", url, err);
      _urlPreviewCache.set(url, null);
    });
}

// ── Avatar generation ─────────────────────────────────────────────────────────

function senderColor(sender: string): string {
  return hashColor(sender);
}

function buildFallbackAvatar(sender: string): HTMLElement {
  const color = senderColor(sender);
  const initial = (sender.startsWith("@") ? sender[1] : sender[0]).toUpperCase();
  const el = document.createElement("span");
  el.className = "message-group__avatar-fallback";
  el.textContent = initial;
  el.style.color = color;
  el.style.border = `1px solid ${color}`;
  el.style.opacity = "0.85";
  el.setAttribute("aria-hidden", "true");
  return el;
}

function buildAvatarElement(sender: string, avatarUrl?: string): HTMLElement {
  if (avatarUrl) {
    const img = document.createElement("img");
    img.className = "message-group__avatar";
    img.src = avatarUrl;
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    if (isAnimatedUrl(avatarUrl)) img.dataset.gif = "1";
    img.onerror = () => img.replaceWith(buildFallbackAvatar(sender));
    return img;
  }
  return buildFallbackAvatar(sender);
}

export interface ReplyPreviewData {
  /** Matrix event ID of the message being replied to */
  eventId: string;
  senderName: string;
  body: string;
}

export interface MessageData {
  id: string;
  senderName: string;
  /** Matrix user ID of the sender — used for avatar lookup; falls back to senderName */
  senderId?: string;
  /** URL for the sender's avatar image (mxc:// resolved to https://) */
  senderAvatarUrl?: string;
  /** If true the sender is the local user */
  isOwn?: boolean;
  /** ISO 8601 timestamp string */
  timestamp: string;
  /** Plain text body */
  body: string;
  /** Optional HTML body (rendered into innerHTML safely via a template) */
  htmlBody?: string;
  /** Message type: "text" | "image" | "video" | "sticker" | "file" | "system" */
  type?: "text" | "image" | "video" | "sticker" | "file" | "system";
  /** URL for image / sticker messages (mxc:// for video) */
  mediaUrl?: string;
  /** Alt text for image / sticker messages; filename for video */
  mediaAlt?: string;
  /** Natural pixel dimensions of the image — used to reserve layout space before src loads */
  mediaWidth?: number;
  mediaHeight?: number;
  /** Media caption (MSC2530) shown beneath an image; absent when the body is just a filename. */
  caption?: string;
  /** MIME type for media messages (used for video canPlayType check) */
  mediaMimeType?: string;
  /** JSON-serialized EncryptedFile for E2EE video/audio; absent for plain media */
  mediaEncryptionInfo?: string;
  /** mxc:// URL of the video thumbnail image */
  mediaThumbnailUrl?: string;
  /** JSON-serialized EncryptedFile for E2EE video thumbnail */
  mediaThumbnailEncryptionInfo?: string;
  /** Reply preview */
  replyTo?: ReplyPreviewData;
  /** Reactions */
  reactions?: ReactionGroup[];
  /** If true, this message has thread replies — show a thread indicator */
  isThreadRoot?: boolean;
  /** Number of thread replies (shown in the indicator) */
  threadReplyCount?: number;
  /** If true, this message has been edited at least once — show the (edited) marker. */
  wasEdited?: boolean;
  /** The original body before any edits were applied. */
  originalBody?: string;
}

function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    const h = date.getHours().toString().padStart(2, "0");
    const m = date.getMinutes().toString().padStart(2, "0");
    return `${h}:${m}`;
  } catch {
    return "";
  }
}

/** Exact send time (HH:MM:SS) — shown in the hover action bar. */
function formatTimestampWithSeconds(isoString: string): string {
  try {
    const date = new Date(isoString);
    const h = date.getHours().toString().padStart(2, "0");
    const m = date.getMinutes().toString().padStart(2, "0");
    const s = date.getSeconds().toString().padStart(2, "0");
    return `${h}:${m}:${s}`;
  } catch {
    return "";
  }
}

/** Full localized date + time, for `title` tooltips on timestamps. */
function formatFullTimestamp(isoString: string): string {
  try {
    return new Date(isoString).toLocaleString();
  } catch {
    return isoString;
  }
}

const TIME_SEPARATOR_GAP_MS = 30 * 60 * 1000; // 30 minutes

interface TimeSeparator {
  type: "time-separator";
  timestamp: string;
}

function formatSeparatorLabel(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const h = date.getHours();
    const m = date.getMinutes().toString().padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    const hour12 = ((h % 12) || 12).toString();
    const time = `${hour12}:${m} ${ampm}`;

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (msgDay.getTime() === today.getTime()) return `Today at ${time}`;
    if (msgDay.getTime() === yesterday.getTime()) return `Yesterday at ${time}`;

    const weekday = date.toLocaleDateString(undefined, { weekday: "long" });
    const dateStr = date.toLocaleDateString(undefined, { month: "long", day: "numeric" });
    return `${weekday}, ${dateStr} at ${time}`;
  } catch {
    return "";
  }
}

function buildTimeSeparator(isoString: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "time-separator";
  el.setAttribute("role", "separator");
  const label = formatSeparatorLabel(isoString);
  el.textContent = label;
  return el;
}

/**
 * Build a click-to-play affordance for video messages.
 * Dispatches `quark:open-video` when activated so actions.ts can decide
 * whether to play inline (GStreamer available) or open externally.
 * If `thumbnailMxcUrl` is provided the thumbnail is loaded async and shown.
 */
function buildVideoAffordance(
  mxcUrl?: string,
  filename?: string,
  mimeType?: string,
  encryptionInfo?: string,
  thumbnailMxcUrl?: string,
  thumbnailEncryptionInfo?: string,
): HTMLElement {
  const el = document.createElement("div");
  el.className = "message__video-affordance";
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.title = "Click to play video";

  if (thumbnailMxcUrl) {
    const thumbWrap = document.createElement("div");
    thumbWrap.className = "message__video-affordance-thumb";
    const thumbImg = document.createElement("img");
    thumbImg.className = "message__video-affordance-thumb-img";
    thumbImg.alt = "";
    thumbImg.setAttribute("aria-hidden", "true");
    thumbWrap.appendChild(thumbImg);

    // Overlay play icon on thumbnail
    const overlay = document.createElement("span");
    overlay.className = "message__video-affordance-thumb-overlay";
    overlay.textContent = "▶";
    overlay.setAttribute("aria-hidden", "true");
    thumbWrap.appendChild(overlay);

    el.appendChild(thumbWrap);

    // Load thumbnail async
    void invoke<{ data_base64: string; mime_type: string }>("download_media", {
      mxcUrl: thumbnailMxcUrl,
      thumbnail: true,
      thumbnailWidth: 160,
      thumbnailHeight: 90,
      encryptionInfo: thumbnailEncryptionInfo ?? null,
    }).then((dl) => {
      thumbImg.src = createBlobUrl(dl.data_base64, dl.mime_type);
    }).catch(() => { /* thumbnail failed to load — affordance still works */ });
  } else {
    const icon = document.createElement("span");
    icon.className = "message__video-affordance-icon";
    icon.textContent = "▶";
    icon.setAttribute("aria-hidden", "true");
    el.appendChild(icon);
  }

  const label = document.createElement("span");
  label.className = "message__video-affordance-label";
  label.textContent = filename || "video";
  el.appendChild(label);

  const activate = () => {
    el.dispatchEvent(new CustomEvent("quark:open-video", {
      bubbles: true,
      detail: { mxcUrl, filename, mimeType, encryptionInfo },
    }));
  };
  el.addEventListener("click", activate);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); }
  });

  return el;
}

function buildFileAffordance(
  mxcUrl?: string,
  filename?: string,
  mimeType?: string,
  encryptionInfo?: string,
): HTMLElement {
  const el = document.createElement("div");
  el.className = "message__file-affordance";
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.title = "Click to open file";

  const icon = document.createElement("span");
  icon.className = "message__file-affordance-icon";
  icon.textContent = "📎";
  icon.setAttribute("aria-hidden", "true");
  el.appendChild(icon);

  const label = document.createElement("span");
  label.className = "message__file-affordance-label";
  label.textContent = filename || "file";
  el.appendChild(label);

  if (mimeType) {
    const type = document.createElement("span");
    type.className = "message__file-affordance-type";
    type.textContent = mimeType.split("/")[1]?.toUpperCase() ?? mimeType;
    el.appendChild(type);
  }

  const activate = () => {
    el.dispatchEvent(new CustomEvent("quark:open-file", {
      bubbles: true,
      detail: { mxcUrl, filename, mimeType, encryptionInfo },
    }));
  };
  el.addEventListener("click", activate);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); }
  });

  return el;
}

/**
 * Build the inner content of a single message (body, media, reactions) —
 * does NOT include the sender/timestamp header (that lives on the group).
 */
function buildMessageElement(msg: MessageData): HTMLElement {
  const row = document.createElement("div");
  row.className = "message";
  row.setAttribute("role", "listitem");
  row.setAttribute("tabindex", "0");
  row.dataset.messageId = msg.id;

  if (msg.type === "system") {
    row.classList.add("message--system");
  }

  // ── Reply preview ──────────────────────────────────────────────────────
  if (msg.replyTo) {
    const replyTo = msg.replyTo;

    const reply = document.createElement("div");
    reply.className = "reply-preview";
    reply.setAttribute("role", "button");
    reply.setAttribute("tabindex", "0");
    reply.setAttribute("aria-label", `Reply to ${replyTo.senderName}: ${replyTo.body}`);
    reply.title = "Jump to original message";

    // Reply icon — clicking jumps to the original
    const icon = document.createElement("span");
    icon.className = "reply-preview__icon";
    icon.textContent = "↩";
    icon.setAttribute("aria-hidden", "true");
    reply.appendChild(icon);

    const sender = document.createElement("span");
    sender.className = "reply-preview__sender";
    // Strip @user:server.org → just the local part for display
    const localPart = replyTo.senderName.startsWith("@")
      ? replyTo.senderName.slice(1).split(":")[0]
      : replyTo.senderName;
    sender.textContent = localPart;
    reply.appendChild(sender);

    const body = document.createElement("span");
    body.className = "reply-preview__body";
    body.textContent = replyTo.body;
    reply.appendChild(body);

    // Click / Enter → bubble a jump event up to the Timeline element
    const jump = () => {
      reply.dispatchEvent(
        new CustomEvent("quark:jump-to-message", {
          bubbles: true,
          detail: { eventId: replyTo.eventId },
        })
      );
    };
    reply.addEventListener("click", jump);
    reply.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); jump(); }
    });

    row.appendChild(reply);
  }

  // ── Header (sender + timestamp) — only for ungrouped/system messages ──
  if (msg.type !== "system") {
    const header = document.createElement("div");
    header.className = "message__header";

    const sender = document.createElement("span");
    sender.className = "message__sender" + (msg.isOwn ? " message__sender--own" : "");
    sender.textContent = `<${msg.senderName}>`;
    header.appendChild(sender);

    const ts = document.createElement("span");
    ts.className = "message__timestamp";
    ts.textContent = formatTimestamp(msg.timestamp);
    ts.setAttribute("title", formatFullTimestamp(msg.timestamp));
    header.appendChild(ts);

    row.appendChild(header);
  }

  // ── Body ───────────────────────────────────────────────────────────────
  const type = msg.type ?? "text";

  if (type === "image") {
    row.classList.add("message--image");
    const img = document.createElement("img");
    img.className = "message__image";
    img.src = msg.mediaUrl ?? "";
    img.alt = msg.mediaAlt ?? "image";
    // Setting width/height lets the browser reserve the correct layout space before
    // the image data loads, preventing a scroll jump when content is above the viewport.
    if (msg.mediaWidth && msg.mediaHeight) {
      img.width = msg.mediaWidth;
      img.height = msg.mediaHeight;
    } else {
      // No dimensions in the event (sender omitted info.w/h). Reserve a
      // placeholder box so the image isn't 0px tall before it decodes —
      // otherwise prepended history doesn't grow scrollHeight, the prepend's
      // scroll restore adds nothing, and the near-top prefetch re-fires on a
      // viewport that never moved. updateMessageMedia drops this class and
      // locks the real size once the bitmap loads.
      img.classList.add("message__image--unsized");
    }
    // Mark GIFs so the focus/blur handler can pause/resume animation
    if ((msg.mediaUrl ?? "").match(/\.gif($|\?)/i) || msg.mediaMimeType === "image/gif") {
      img.dataset.gif = "1";
    }
    row.appendChild(img);
    // Render the media caption (MSC2530) beneath the image, when present.
    if (msg.caption) {
      const caption = document.createElement("div");
      caption.className = "message__body message__image-caption";
      caption.textContent = msg.caption;
      row.appendChild(caption);
    }
  } else if (type === "video") {
    row.classList.add("message--video");
    const aff = buildVideoAffordance(msg.mediaUrl, msg.mediaAlt, msg.mediaMimeType, msg.mediaEncryptionInfo, msg.mediaThumbnailUrl, msg.mediaThumbnailEncryptionInfo);
    row.appendChild(aff);
  } else if (type === "sticker") {
    const img = document.createElement("img");
    img.className = "message__sticker";
    img.src = msg.mediaUrl ?? "";
    if (msg.mediaWidth && msg.mediaHeight) {
      img.width = msg.mediaWidth;
      img.height = msg.mediaHeight;
    } else {
      img.classList.add("message__sticker--unsized");
    }
    img.alt = msg.mediaAlt ?? "sticker";
    row.appendChild(img);
  } else if (type === "file") {
    const aff = buildFileAffordance(msg.mediaUrl, msg.body, msg.mediaMimeType, msg.mediaEncryptionInfo);
    row.appendChild(aff);
  } else {
    // Text / system
    const body = document.createElement("div");
    body.className = "message__body";

    if (msg.htmlBody) {
      // Render HTML body. In production this must be sanitized server-side or
      // with DOMPurify; for the UI shell we accept pre-trusted HTML.
      body.innerHTML = msg.htmlBody;
      // Stash mxc:// src in data-mxc so actions.ts can resolve them later,
      // and clear src to avoid broken-image icons in the meantime.
      for (const img of body.querySelectorAll<HTMLImageElement>("img[data-mx-emoticon]")) {
        if (img.src.startsWith("mxc://") || img.getAttribute("src")?.startsWith("mxc://")) {
          img.dataset.mxc = img.getAttribute("src") ?? img.src;
          img.removeAttribute("src");
        }
      }
      // Intercept all anchor clicks so they open in the system browser rather
      // than navigating the Tauri WebView away from the chat UI. Keep the href
      // attribute so iOS WebView treats the element as a real link (taps fire
      // click events; the OS popup blocker accepts window.open from the handler).
      for (const a of body.querySelectorAll<HTMLAnchorElement>("a[href]")) {
        const href = a.getAttribute("href") ?? "";
        if (href.startsWith("http://") || href.startsWith("https://")) {
          // Mobile-only target=_blank — see appendLinkifiedText: on desktop it
          // makes wry open the link a second time alongside openExternalUrl().
          if (isMobile()) a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.addEventListener("click", (e) => {
            e.preventDefault();
            openExternalUrl(href);
          });
        } else {
          a.removeAttribute("href");
          a.setAttribute("role", "link");
          a.style.cursor = "pointer";
        }
      }
      setupSpoilers(body);
    } else {
      appendLinkifiedText(body, msg.body);
    }

    if (msg.wasEdited) {
      const marker = document.createElement("span");
      marker.className = "message__edited-marker";
      marker.textContent = " (edited)";
      marker.title = "Click to view edit history";
      body.appendChild(marker);
    }

    row.appendChild(body);

    // ── URL preview card ─────────────────────────────────────────────────
    const previewUrl = extractFirstUrl(msg.body);
    if (previewUrl) {
      attachUrlPreview(previewUrl, row);
    }
  }

  // ── Reactions ──────────────────────────────────────────────────────────
  if (msg.reactions && msg.reactions.length > 0) {
    row.appendChild(createReactionBar(msg.reactions));
  }

  // ── Thread indicator ───────────────────────────────────────────────────
  if (msg.isThreadRoot) {
    const indicator = document.createElement("button");
    indicator.className = "message__thread-indicator";
    indicator.setAttribute("tabindex", "0");
    const count = msg.threadReplyCount ?? 0;
    indicator.textContent = count > 0 ? `⌥ ${count} repl${count === 1 ? "y" : "ies"}` : "⌥ thread";
    indicator.title = "Open thread (t)";
    indicator.addEventListener("click", (e) => {
      e.stopPropagation();
      row.dispatchEvent(
        new CustomEvent("quark:open-thread", {
          bubbles: true,
          detail: { eventId: msg.id },
        })
      );
    });
    row.appendChild(indicator);
  }

  // ── Hover action bar ───────────────────────────────────────────────────
  if (msg.type !== "system") {
    const actions = document.createElement("div");
    actions.className = "message__actions";
    actions.setAttribute("aria-hidden", "true");

    // Exact send time, revealed with the actions on hover
    const timeEl = document.createElement("span");
    timeEl.className = "message__actions-time";
    timeEl.textContent = formatTimestampWithSeconds(msg.timestamp);
    timeEl.title = formatFullTimestamp(msg.timestamp);
    actions.appendChild(timeEl);

    const reactBtn = document.createElement("button");
    reactBtn.className = "message__action-btn";
    reactBtn.textContent = "😀";
    reactBtn.title = "React (e)";
    reactBtn.setAttribute("tabindex", "-1");
    reactBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      row.dispatchEvent(
        new CustomEvent("quark:msg-react", {
          bubbles: true,
          detail: { eventId: msg.id },
        })
      );
    });

    const replyBtn = document.createElement("button");
    replyBtn.className = "message__action-btn";
    replyBtn.textContent = "↩";
    replyBtn.title = "Reply (r)";
    replyBtn.setAttribute("tabindex", "-1");
    replyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      row.dispatchEvent(
        new CustomEvent("quark:msg-reply", {
          bubbles: true,
          detail: { eventId: msg.id },
        })
      );
    });

    const threadBtn = document.createElement("button");
    threadBtn.className = "message__action-btn";
    threadBtn.textContent = "⌥";
    threadBtn.title = "Open thread (t)";
    threadBtn.setAttribute("tabindex", "-1");
    threadBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      row.dispatchEvent(
        new CustomEvent("quark:open-thread", {
          bubbles: true,
          detail: { eventId: msg.id },
        })
      );
    });

    actions.appendChild(reactBtn);
    actions.appendChild(replyBtn);
    actions.appendChild(threadBtn);
    row.appendChild(actions);
  }

  return row;
}

/**
 * Build a grouped wrapper for consecutive messages from the same sender.
 * CSS-bordered box with the sender label positioned as an inline legend
 * on the top border.
 */
function buildMessageGroup(msgs: MessageData[]): HTMLElement {
  const first = msgs[0];
  const group = document.createElement("div");
  group.className = "message-group";

  // ── Inline label (positioned on the top border via CSS) ────────────────
  const label = document.createElement("div");
  label.className = "message-group__header";

  const senderId = first.senderId ?? first.senderName;
  const sender = document.createElement("span");
  sender.className = "message-group__sender" + (first.isOwn ? " message-group__sender--own" : "");
  sender.textContent = first.senderName;
  sender.style.cursor = "pointer";
  sender.title = "View profile";
  sender.addEventListener("click", () => {
    sender.dispatchEvent(
      new CustomEvent("quark:open-profile", { bubbles: true, detail: { userId: senderId } })
    );
  });
  label.appendChild(sender);

  const ts = document.createElement("span");
  ts.className = "message-group__timestamp";
  ts.textContent = formatTimestamp(first.timestamp);
  ts.setAttribute("title", formatFullTimestamp(first.timestamp));
  label.appendChild(ts);

  group.appendChild(label);

  // ── Messages (body only, no per-message header) ────────────────────────
  for (const msg of msgs) {
    const el = buildMessageElement(msg);
    // Hide the per-message header since the group label covers it
    const msgHeader = el.querySelector(".message__header");
    if (msgHeader) (msgHeader as HTMLElement).style.display = "none";
    group.appendChild(el);
  }

  // ── Wrapper: avatar to the left, box to the right ─────────────────────
  const wrapper = document.createElement("div");
  wrapper.className = "message-group-wrapper";
  wrapper.dataset.sender = first.senderId ?? first.senderName;

  // Wrap the avatar in a column that stretches to the full group height.
  // This gives position:sticky on the avatar a proper containing block —
  // the sticky zone spans the whole group, not just the 32px avatar height.
  const avatarCol = document.createElement("div");
  avatarCol.className = "message-group__avatar-col";
  const avatar = buildAvatarElement(first.senderName, first.senderAvatarUrl);
  avatar.title = "View profile";
  // Keep listener on the col so it still fires if the img is replaced by
  // the onerror fallback, but only fire when the click is on the avatar
  // element itself (not on the blank column space below it).
  avatarCol.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (!t.classList.contains("message-group__avatar") &&
        !t.classList.contains("message-group__avatar-fallback")) return;
    avatarCol.dispatchEvent(
      new CustomEvent("quark:open-profile", { bubbles: true, detail: { userId: senderId } })
    );
  });
  avatarCol.appendChild(avatar);
  wrapper.appendChild(avatarCol);
  wrapper.appendChild(group);

  return wrapper;
}

/** Check whether a message can be grouped (non-system text-like message). */
function isGroupable(msg: MessageData): boolean {
  return msg.type !== "system";
}

/**
 * Group consecutive messages from the same sender into arrays.
 * System messages, sender changes, reply messages, and 30-minute time gaps
 * break the group. Time gaps also insert a TimeSeparator into the output.
 */
function groupMessages(msgs: MessageData[]): (MessageData | MessageData[] | TimeSeparator)[] {
  const result: (MessageData | MessageData[] | TimeSeparator)[] = [];
  let currentGroup: MessageData[] = [];
  let prevTimestamp = 0;

  const flushGroup = () => {
    if (currentGroup.length > 0) {
      result.push(currentGroup);
      currentGroup = [];
    }
  };

  for (const msg of msgs) {
    const ts = msg.timestamp ? new Date(msg.timestamp).getTime() : 0;
    const gap = ts - prevTimestamp;
    const bigGap = prevTimestamp > 0 && gap > TIME_SEPARATOR_GAP_MS;

    if (!isGroupable(msg)) {
      flushGroup();
      if (bigGap) result.push({ type: "time-separator", timestamp: msg.timestamp });
      result.push(msg);
    } else if (bigGap) {
      // Time gap — flush, insert separator, start new group
      flushGroup();
      result.push({ type: "time-separator", timestamp: msg.timestamp });
      currentGroup = [msg];
    } else if (
      currentGroup.length > 0 &&
      (currentGroup[0].senderId ?? currentGroup[0].senderName) === (msg.senderId ?? msg.senderName) &&
      !msg.replyTo // replies always start a fresh group
    ) {
      currentGroup.push(msg);
    } else {
      // Different sender or reply message — flush and start new group
      flushGroup();
      currentGroup = [msg];
    }

    if (ts > 0) prevTimestamp = ts;
  }

  flushGroup();
  return result;
}

export class Timeline {
  /** Maximum number of messages rendered into the DOM at once. The buffer
   *  (`_messages`) can hold more — windowing keeps DOM bounded. */
  private static readonly MAX_RENDERED = 250;
  /** How many messages to render or cull when extending/shrinking the window. */
  private static readonly RENDER_CHUNK = 50;

  /** Non-scrolling wrapper; `getElement()` returns this. Holds the scroller
   *  (`_el`) plus the viewport-pinned overlays (loading indicator, jump button). */
  private _wrapEl: HTMLElement;
  /** The scroll container (`.timeline`). All scrollTop math operates on this. */
  private _el: HTMLElement;
  private _listEl: HTMLElement;
  private _loadingEl: HTMLElement;
  /** Floating skeleton overlay shown while a room loads; null when not active */
  private _skeletonEl: HTMLElement | null = null;
  /** Keeps the (position:fixed) skeleton aligned to the timeline as it resizes. */
  private _skeletonResizeObserver: ResizeObserver | null = null;
  /** Timestamp when the skeleton was last shown, used to enforce a minimum display time */
  private _skeletonShownAt = 0;
  /** Whether the user has scrolled up away from the bottom */
  private _scrolledUp = false;
  /** Full known buffer of messages for the current room, oldest first.
   *  Only a window — `_messages[_renderStart..._renderEnd]` — is in the DOM.
   *  Extending the rendered window from the buffer is cheap; reaching the
   *  buffer edges fires server-fetch callbacks. */
  private _messages: MessageData[] = [];
  /** Inclusive start of the rendered window into `_messages`. */
  private _renderStart = 0;
  /** Exclusive end of the rendered window into `_messages`. */
  private _renderEnd = 0;
  /** Index of the currently selected (highlighted) message in `_messages`, or -1 for none */
  private _selectedIndex = -1;
  /** The last element appended via appendMessageHidden, pending reveal */
  private _lastHiddenEl: HTMLElement | null = null;
  private _onScrollTopCallback: (() => void) | null = null;
  private _onScrollBottomCallback: (() => void) | null = null;
  /** Fired when the user clicks inside the timeline area (used to update activePanel). */
  private _onFocusCallback: (() => void) | null = null;
  /** Fired when an image message is clicked — passes (src, alt). */
  private _onImageClickCallback: ((src: string, alt: string) => void) | null = null;
  /** Fired when a jump-to-message is requested but the message is not in the current view. */
  private _onJumpToMessageCallback: ((eventId: string) => void) | null = null;
  /** Fired when the "jump to latest" button is clicked. */
  private _onJumpToLatestCallback: (() => void) | null = null;
  /** The "jump to latest" button element. */
  private _jumpToLatestBtn!: HTMLButtonElement;
  /** True when the timeline is showing a context window, not the live end. */
  private _inContextView = false;
  private _scrollTopFired = false;
  private _scrollBottomFired = false;
  /** Handle for the cleanup timeout of the scroll animation, so we can cancel it */
  private _scrollAnimCleanupTimer: ReturnType<typeof setTimeout> | null = null;
  /** Debounce handle for the deferred window cull (runs at scroll-settle). */
  private _cullTimer: ReturnType<typeof setTimeout> | null = null;
  /** Observes the message list while pinned to the live tail so late content
   *  growth (images decoding, custom emoji and stickers resolving, GIFs
   *  resuming on window refocus) re-pins to the bottom in a single coalesced
   *  write. Replaces the per-image load→scrollToBottom handler and the
   *  post-render timer chain. null where ResizeObserver is unavailable (jsdom). */
  private _stickObserver: ResizeObserver | null = null;
  /** Reentrancy guard: true while the stick observer is adjusting scrollTop. */
  private _pinningToBottom = false;
  /** Authoritative "follow the live tail" intent that drives the stick observer.
   *  Distinct from _scrolledUp (which keeps a 40px hysteresis for the
   *  jump-to-latest button): this disengages the instant the user moves up by a
   *  pixel and only re-engages at the very bottom, so content growth can never
   *  trap the user against the tail. */
  private _stickToBottom = true;
  /** Last observed scrollTop, used to detect user scroll direction. */
  private _prevScrollTop = 0;
  /** Number of unread messages at the tail of the current message list. */
  private _unreadCount = 0;
  /** Fired when an "(edited)" marker is clicked — passes (eventId, originalBody). */
  private _onShowRevisionHistoryCallback: ((eventId: string, originalBody: string) => void) | null = null;
  /** Fired when the user right-clicks a message — passes (eventId, x, y). */
  private _onContextMenuCallback: ((eventId: string, x: number, y: number) => void) | null = null;

  // ── Read receipts ──────────────────────────────────────────────────────────
  /** Each user's latest-read position: the receipted event ID and its timestamp
   *  (ms, if known). Held outside the DOM so receipt state survives
   *  windowing/culling and full re-renders. The avatar is placed on the nearest
   *  rendered message at or before `ts` (receipts often point at non-message
   *  events — reactions, edits — that aren't in the timeline). */
  private _receiptByUser = new Map<string, { eventId: string; ts: number | null }>();
  /** Resolvers injected from the app layer so the decoration step can render
   *  real avatars/names without Timeline importing app/actions (layering). */
  private _receiptAvatarResolver: ((userId: string) => string | undefined) | null = null;
  private _receiptNameResolver: ((userId: string) => string) | null = null;
  /** Receipt avatars shown on one message before collapsing the rest into a
   *  single "…" chip (hover the group for the full reader list). */
  private static readonly MAX_RECEIPTS_SHOWN = 2;
  /** Themed hover card listing all readers of a message; lazily created on
   *  `<body>` (position:fixed) so the timeline's overflow can't clip it. */
  private _receiptTooltipEl: HTMLElement | null = null;

  constructor() {
    // Non-scrolling wrapper. The overlays (loading indicator, jump-to-latest
    // button) MUST live here as siblings of the scroller, not inside it: under
    // `flex-direction: column-reverse` an absolutely positioned descendant of a
    // scroll container scrolls *with the content* (it pins to the content edge,
    // not the viewport). That left the jump-to-latest button stuck at the bottom
    // of the timeline and scrolled out of view. Hosting them in the wrapper pins
    // them to the timeline viewport regardless of scroll position.
    this._wrapEl = document.createElement("div");
    this._wrapEl.className = "timeline-wrap";

    this._el = document.createElement("div");
    this._el.className = "timeline";
    this._wrapEl.appendChild(this._el);

    this._loadingEl = document.createElement("div");
    this._loadingEl.className = "timeline__loading-more";
    this._loadingEl.textContent = "Loading…";
    this._loadingEl.style.display = "none";
    this._wrapEl.appendChild(this._loadingEl);

    // The scroller's only in-flow child — keeps column-reverse anchoring clean.
    this._listEl = document.createElement("div");
    this._listEl.setAttribute("role", "list");
    this._listEl.setAttribute("aria-label", "Message timeline");
    this._el.appendChild(this._listEl);

    // "Jump to latest" button — shown when scrolled up or in context view.
    this._jumpToLatestBtn = document.createElement("button");
    this._jumpToLatestBtn.type = "button";
    this._jumpToLatestBtn.className = "timeline__jump-to-latest";
    this._jumpToLatestBtn.textContent = "↓ jump to latest";
    this._jumpToLatestBtn.style.display = "none";
    this._jumpToLatestBtn.addEventListener("click", () => this._onJumpToLatestCallback?.());
    this._wrapEl.appendChild(this._jumpToLatestBtn);

    // Track whether the user has scrolled away from the bottom, and fire
    // pagination callbacks when near either edge. Extending the rendered
    // window from the in-memory buffer happens first — only when the buffer
    // edge is reached does a server fetch get requested.
    this._el.addEventListener("scroll", () => {
      const scrollTop = this._el.scrollTop;
      // column-reverse convention: scrollTop is 0 at the live tail and negative
      // scrolling up toward history. So distance-from-bottom is just -scrollTop,
      // and distance-from-top is scrollHeight - clientHeight + scrollTop.
      const distanceFromBottom = this._distanceFromBottom;
      const distanceFromTop = this._distanceFromTop;

      // Stick-to-bottom intent (drives the stick observer). Check "at the
      // bottom" FIRST: when content shrinks (e.g. a GIF decoding to a shorter
      // box than was reserved) the browser clamps scrollTop and fires a scroll
      // event — that is not a user scroll-up, and while we're still at the bottom
      // we must stay stuck so the observer can re-pin. Only a genuine move up
      // *and away* from the bottom disengages. Re-engaging at <=4px keeps the
      // user from being trapped against the tail by content growth. (Scrolling up
      // makes scrollTop more negative, so `scrollTop < prevScrollTop` = moved up.)
      if (distanceFromBottom <= 4) {
        this._stickToBottom = true;
      } else if (scrollTop < this._prevScrollTop - 1) {
        this._stickToBottom = false;
      }
      this._prevScrollTop = scrollTop;

      this._scrolledUp = distanceFromBottom > 40;
      this._updateJumpToLatestVisibility();

      // Prefetch older history ~one viewport before the top — but only when the
      // approach would start a *server* fetch (`_renderStart === 0`). That fetch
      // is async, so overlapping it with the scrolling still to come hides its
      // latency: the messages are usually buffered by the time the top arrives.
      // The buffered-window extend (`_renderStart > 0`) inserts a chunk at the
      // top, which `column-reverse` anchors with no scrollTop write — so it stays
      // smooth under a fast fling and can stay edge-triggered (80px). Guarded on
      // !_stickToBottom so a room opened at the tail (where distanceFromTop is
      // ~0 while pinned) doesn't fire a spurious history fetch before the user
      // has scrolled up at all.
      const prefetchMargin = this._renderStart === 0 ? this._el.clientHeight : 80;
      if (!this._stickToBottom && distanceFromTop < prefetchMargin && !this._scrollTopFired) {
        this._scrollTopFired = true;
        this._handleScrollNearTop();
      } else if (distanceFromTop >= prefetchMargin || this._stickToBottom) {
        this._scrollTopFired = false;
      }

      if (distanceFromBottom < 80 && !this._scrollBottomFired) {
        this._scrollBottomFired = true;
        this._handleScrollNearBottom();
      } else if (distanceFromBottom >= 80) {
        this._scrollBottomFired = false;
      }
    });

    // Keep the viewport pinned to the live tail as late content settles. While
    // the stick intent holds (`_stickToBottom`), any growth of the message list
    // — images decoding, custom emoji and stickers resolving, GIFs resuming on
    // window refocus — re-pins to the bottom in a single coalesced write.
    // ResizeObserver fires once per frame after layout, so this replaces both
    // the per-image `load`→scrollToBottom handler (which snapped once per decode,
    // causing visible jitter on room load and refocus) and the 150 ms
    // post-render timer chain in setMessages.
    //
    // It keys on `_stickToBottom`, not `_scrolledUp`: the latter's 40px deadzone
    // would let a content resize re-pin the user while they were nudging up
    // within that band, making it impossible to escape the tail. `_stickToBottom`
    // disengages on any upward movement (see the scroll handler). When the user
    // has scrolled up, `column-reverse` keeps growth above the viewport anchored
    // for free, so no compensation is needed there.
    //
    // Note: under `column-reverse` the browser already holds the bottom on most
    // tail growth, so this observer is mostly a safety net (e.g. a resize that
    // momentarily clamps scrollTop). Re-pinning to the tail is `scrollTop = 0`.
    if (typeof ResizeObserver !== "undefined") {
      this._stickObserver = new ResizeObserver(() => {
        if (!this._stickToBottom || this._pinningToBottom) return;
        if (this._el.scrollTop === 0) return; // already pinned to the tail
        this._pinningToBottom = true;
        this._el.scrollTop = 0;
        this._prevScrollTop = 0;
        this._pinningToBottom = false;
      });
      this._stickObserver.observe(this._listEl);
    }

    // Reply preview "jump to original" — fired by reply-preview clicks
    this._listEl.addEventListener("quark:jump-to-message", (e: Event) => {
      const { eventId } = (e as CustomEvent<{ eventId: string }>).detail;
      const found = this.scrollToMessage(eventId);
      if (!found) this._onJumpToMessageCallback?.(eventId);
    });

    // Clicking inside the timeline notifies panels.ts so that activePanel is
    // updated to "timeline". This ensures keyboard navigation (j/k) works
    // immediately after a mouse click without needing to press l first.
    // Also sync _selectedIndex so subsequent keyboard actions (r/e/dd) target
    // the clicked message.
    this._el.addEventListener("click", (e) => {
      this._onFocusCallback?.();

      // Image lightbox — intercept clicks on message images
      const target = e.target as HTMLElement;
      if (target instanceof HTMLImageElement && target.classList.contains("message__image")) {
        e.preventDefault();
        e.stopPropagation();
        this._onImageClickCallback?.(target.src, target.alt);
        return;
      }

      // Revision history — clicking "(edited)" marker
      if (target.classList.contains("message__edited-marker")) {
        e.preventDefault();
        e.stopPropagation();
        const msgEl = target.closest<HTMLElement>("[data-message-id]");
        if (msgEl) {
          const eventId = msgEl.dataset.messageId!;
          const msg = this._messages.find((m) => m.id === eventId);
          this._onShowRevisionHistoryCallback?.(eventId, msg?.originalBody ?? msg?.body ?? "");
        }
        return;
      }

      const msgEl = target.closest<HTMLElement>("[data-message-id]");
      if (msgEl) {
        const eventId = msgEl.dataset.messageId;
        const idx = this._messages.findIndex((m) => m.id === eventId);
        if (idx >= 0) this._setSelected(idx);
      }
    });

    // Right-click context menu for messages
    this._el.addEventListener("contextmenu", (e) => {
      const target = e.target as HTMLElement;
      const msgEl = target.closest<HTMLElement>("[data-message-id]");
      if (msgEl?.dataset.messageId) {
        e.preventDefault();
        this._onContextMenuCallback?.(msgEl.dataset.messageId, e.clientX, e.clientY);
      }
    });

    // Long-press → context menu for touch input (mobile). The hover toolbar
    // doesn't reach finger-input users, so a 500ms press on a message opens
    // the full action menu instead. Cancelled by any move/scroll/end.
    this._setupLongPress();
  }

  private _setupLongPress(): void {
    const LONG_PRESS_MS = 500;
    const MOVE_TOLERANCE_PX = 10;
    let timer: number | null = null;
    let startX = 0;
    let startY = 0;
    let startEl: HTMLElement | null = null;
    let fired = false;

    const cancel = (): void => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      startEl = null;
    };

    this._el.addEventListener("touchstart", (e) => {
      // Single-finger only; ignore taps on interactive children
      if (e.touches.length !== 1) {
        cancel();
        return;
      }
      const target = e.target as HTMLElement;
      if (target.closest("a, button, img, .message__link, .message__edited-marker")) return;

      const msgEl = target.closest<HTMLElement>("[data-message-id]");
      if (!msgEl?.dataset.messageId) return;

      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      startEl = msgEl;
      fired = false;
      timer = window.setTimeout(() => {
        if (!startEl) return;
        const eventId = startEl.dataset.messageId!;
        fired = true;
        // Haptic feedback hint on iOS via brief vibration if available
        if (typeof navigator.vibrate === "function") navigator.vibrate(10);
        this._onContextMenuCallback?.(eventId, startX, startY);
        startEl = null;
      }, LONG_PRESS_MS);
    }, { passive: true });

    this._el.addEventListener("touchmove", (e) => {
      const touch = e.touches[0];
      if (!touch) return cancel();
      if (Math.abs(touch.clientX - startX) > MOVE_TOLERANCE_PX ||
          Math.abs(touch.clientY - startY) > MOVE_TOLERANCE_PX) {
        cancel();
      }
    }, { passive: true });

    this._el.addEventListener("touchend", () => {
      cancel();
    }, { passive: true });

    this._el.addEventListener("touchcancel", () => {
      cancel();
    }, { passive: true });

    // Suppress the click that follows a long-press so we don't also select-and-act.
    this._el.addEventListener("click", (e) => {
      if (fired) {
        fired = false;
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);
  }

  getElement(): HTMLElement {
    return this._wrapEl;
  }

  /** The scrolling element itself (inside the wrapper). Callers that need to
   *  measure the scrollbar gutter or observe scroll-area size use this. */
  getScrollElement(): HTMLElement {
    return this._el;
  }

  /**
   * Search the messages currently loaded in the timeline (the "instant" search
   * tier). Case-insensitive substring match against the plain-text body. Skips
   * system messages. Returns oldest-first results in a shape shared with the
   * server/cache search tiers.
   */
  searchLoaded(query: string): SearchResult[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: SearchResult[] = [];
    for (const msg of this._messages) {
      if (msg.type === "system") continue;
      if (!msg.body) continue;
      if (msg.body.toLowerCase().includes(q)) {
        out.push({
          eventId: msg.id,
          sender: msg.senderName || msg.senderId || "",
          timestamp: Date.parse(msg.timestamp) || 0,
          body: msg.body,
        });
      }
    }
    return out;
  }

  /** Epoch-ms timestamp of the newest loaded message, or null if none are
   *  loaded. Used as the anchor (100%-start) for a deep-history search's
   *  time-based progress bar. */
  newestTimestamp(): number | null {
    let newest: number | null = null;
    for (const msg of this._messages) {
      if (!msg.timestamp) continue;
      const ts = Date.parse(msg.timestamp);
      if (Number.isNaN(ts)) continue;
      if (newest === null || ts > newest) newest = ts;
    }
    return newest;
  }

  /** Register a callback fired when the user scrolls near the top and the
   *  in-memory buffer has been exhausted (i.e. server fetch is needed). */
  onScrollToTop(cb: () => void): void {
    this._onScrollTopCallback = cb;
  }

  /** Register a callback fired when the user scrolls near the bottom and the
   *  in-memory buffer has been exhausted (i.e. forward server fetch needed). */
  onScrollToBottom(cb: () => void): void {
    this._onScrollBottomCallback = cb;
  }

  /** Register a callback fired when the user right-clicks a message — passes (eventId, x, y). */
  onContextMenu(cb: (eventId: string, x: number, y: number) => void): void {
    this._onContextMenuCallback = cb;
  }

  /**
   * Register a callback fired when the user clicks inside the timeline.
   * Use this to update activePanel so keyboard nav immediately works.
   */
  onFocus(cb: () => void): void {
    this._onFocusCallback = cb;
  }

  /** Register a callback fired when the user clicks an image message. */
  onImageClick(cb: (src: string, alt: string) => void): void {
    this._onImageClickCallback = cb;
  }

  /** Register a callback fired when a jump-to-message is requested but the message isn't loaded. */
  onJumpToMessage(cb: (eventId: string) => void): void {
    this._onJumpToMessageCallback = cb;
  }

  /** Register a callback fired when the "jump to latest" button is clicked. */
  onJumpToLatest(cb: () => void): void {
    this._onJumpToLatestCallback = cb;
  }

  /** Register a callback fired when an "(edited)" marker is clicked. */
  onShowRevisionHistory(cb: (eventId: string, originalBody: string) => void): void {
    this._onShowRevisionHistoryCallback = cb;
  }

  /**
   * Set whether the timeline is in "context view" (showing a window around a
   * jumped-to message rather than the live end). Shows or hides the jump-to-latest button.
   */
  setContextView(inContext: boolean): void {
    this._inContextView = inContext;
    this._updateJumpToLatestVisibility();
  }

  /**
   * True when the rendered content is taller than the viewport by more than
   * `minExtraPx`, i.e. there is room to scroll. Used after a jump to detect the
   * deadlock where a short context window doesn't overflow the viewport — with
   * no overflow no scroll event ever fires, so edge-triggered pagination can
   * never load the surrounding history. The caller paginates until this is true.
   */
  hasScrollableOverflow(minExtraPx = 0): boolean {
    return this._el.scrollHeight - this._el.clientHeight > minExtraPx;
  }

  /** Height of the scroll viewport in px. */
  viewportHeight(): number {
    return this._el.clientHeight;
  }

  /**
   * Set the number of unread messages at the tail of the next `setMessages()` call.
   * A `── NEW ──` separator will be inserted before those messages, and the
   * timeline will scroll to the separator instead of the bottom.
   * Reset to 0 after the separator is consumed.
   */
  setUnreadCount(count: number): void {
    this._unreadCount = count;
  }

  /** Show a "Loading…" indicator above the message list. */
  showLoadingMore(): void {
    this._loadingEl.style.display = "block";
  }

  /** Hide the loading indicator. */
  hideLoadingMore(): void {
    this._loadingEl.style.display = "none";
  }

  /** Align the fixed skeleton overlay to the timeline's current viewport rect. */
  private _positionSkeleton(): void {
    if (!this._skeletonEl) return;
    const rect = this._el.getBoundingClientRect();
    this._skeletonEl.style.top = `${rect.top}px`;
    this._skeletonEl.style.left = `${rect.left}px`;
    this._skeletonEl.style.width = `${rect.width}px`;
    this._skeletonEl.style.height = `${rect.height}px`;
  }

  private _disconnectSkeletonResize(): void {
    if (this._skeletonResizeObserver) {
      this._skeletonResizeObserver.disconnect();
      this._skeletonResizeObserver = null;
    }
  }

  /**
   * Show a floating skeleton overlay while a room's timeline is loading.
   * The overlay sits on top of the existing content so real messages can render
   * beneath it. Call setMessages() to trigger the fade-out, which waits for
   * images to finish loading before dismissing.
   */
  showSkeleton(): void {
    // Dismiss any existing skeleton immediately (rapid room switching)
    if (this._skeletonEl) {
      this._skeletonEl.remove();
      this._skeletonEl = null;
    }
    this._disconnectSkeletonResize();

    this._skeletonShownAt = Date.now();

    // Use position:fixed coordinates matching the timeline's viewport rect so
    // the overlay isn't clipped or scrolled by the timeline's overflow:auto.
    const overlay = document.createElement("div");
    overlay.className = "skeleton-overlay";
    this._skeletonEl = overlay;
    this._positionSkeleton();

    // Keep it aligned as the timeline resizes (window resize, sidebar/panel
    // drag) — fixed px geometry would otherwise go stale.
    this._skeletonResizeObserver = new ResizeObserver(() => this._positionSkeleton());
    this._skeletonResizeObserver.observe(this._el);

    const groups: Array<{ nameWidth: number; lines: number[] }> = [
      { nameWidth: 38, lines: [72, 48] },
      { nameWidth: 52, lines: [88, 35, 61] },
      { nameWidth: 31, lines: [44] },
      { nameWidth: 65, lines: [79, 28] },
      { nameWidth: 43, lines: [91, 56] },
      { nameWidth: 58, lines: [67] },
      { nameWidth: 35, lines: [82, 44, 23] },
    ];

    const fragment = document.createDocumentFragment();
    groups.forEach((group, gi) => {
      const row = document.createElement("div");
      row.className = "skeleton-group";
      row.style.animationDelay = `${gi * 55}ms`;

      const avatar = document.createElement("div");
      avatar.className = "skeleton-group__avatar";
      avatar.style.animationDelay = `${gi * 55}ms`;

      const content = document.createElement("div");
      content.className = "skeleton-group__content";

      const name = document.createElement("div");
      name.className = "skeleton-group__name";
      name.style.width = `${group.nameWidth}%`;
      name.style.animationDelay = `${gi * 55}ms`;
      content.appendChild(name);

      group.lines.forEach((width, li) => {
        const line = document.createElement("div");
        line.className = "skeleton-group__line";
        line.style.width = `${width}%`;
        line.style.animationDelay = `${gi * 55 + li * 30}ms`;
        content.appendChild(line);
      });

      row.appendChild(avatar);
      row.appendChild(content);
      fragment.appendChild(row);
    });

    overlay.appendChild(fragment);
    // Append to body so it isn't clipped by the timeline's overflow or scroll position
    document.body.appendChild(overlay);
  }

  /**
   * Fade out the skeleton overlay, waiting for any images in the freshly-rendered
   * list to finish loading first. Enforces a minimum skeleton display time so
   * fast loads don't produce a jarring flash.
   */
  private _fadeOutSkeletonAfterImages(): void {
    const skeleton = this._skeletonEl;
    if (!skeleton) return;

    const MIN_MS = 600;

    const doFade = () => {
      // Guard against a new skeleton being shown before this fires
      if (this._skeletonEl !== skeleton) return;
      this._disconnectSkeletonResize();
      skeleton.classList.add("skeleton-overlay--out");
      skeleton.addEventListener("transitionend", () => skeleton.remove(), { once: true });
      this._skeletonEl = null;
    };

    const scheduleWithMinimum = () => {
      const elapsed = Date.now() - this._skeletonShownAt;
      const remaining = Math.max(0, MIN_MS - elapsed);
      setTimeout(doFade, remaining);
    };

    // Collect images that haven't finished loading yet
    const imgs = Array.from(this._listEl.querySelectorAll<HTMLImageElement>("img"));
    const pending = imgs.filter((img) => !img.complete);

    if (pending.length === 0) {
      scheduleWithMinimum();
      return;
    }

    // Wait for all pending images, then enforce the minimum
    let resolved = 0;
    const onSettled = () => {
      resolved++;
      if (resolved >= pending.length) scheduleWithMinimum();
    };
    pending.forEach((img) => {
      img.addEventListener("load", onSettled, { once: true });
      img.addEventListener("error", onSettled, { once: true });
    });

    // Hard timeout: don't hold the skeleton forever if an image stalls
    setTimeout(scheduleWithMinimum, 3000);
  }

  /** Prepend older messages above the current list.
   *
   * No scrollTop compensation: the timeline is `flex-direction: column-reverse`,
   * so the browser anchors the scroll position to the bottom and keeps the
   * visible content stationary when nodes are inserted at the top. This is the
   * whole point of the structural fix — there is no JS scrollTop write here for
   * WebKit's momentum engine to clobber mid-fling. */
  prependMessages(msgs: MessageData[]): void {
    if (msgs.length === 0) return;

    this._messages = [...msgs, ...this._messages];
    // Shift selection and render-window indices forward so they still point at
    // the same content after prepending.
    if (this._selectedIndex >= 0) {
      this._selectedIndex += msgs.length;
    }
    this._renderStart += msgs.length;
    this._renderEnd += msgs.length;
    // Extend the window backward so the freshly-prepended messages are visible.
    this._renderStart = Math.max(0, this._renderStart - msgs.length);

    // Insert new DOM nodes at the top without clearing existing content.
    const fragment = this._buildGroupedFragment(msgs);
    // Check for a time gap at the junction between prepended and existing messages
    const lastPrepended = msgs[msgs.length - 1];
    const firstExisting = this._messages[msgs.length];
    if (lastPrepended && firstExisting && firstExisting.timestamp && lastPrepended.timestamp) {
      const gap = new Date(firstExisting.timestamp).getTime() - new Date(lastPrepended.timestamp).getTime();
      if (gap > TIME_SEPARATOR_GAP_MS) {
        fragment.appendChild(buildTimeSeparator(firstExisting.timestamp));
      }
    }
    this._listEl.insertBefore(fragment, this._listEl.firstChild);

    // Prepending means the user is reading history, not following the tail —
    // disengage stick. scrollTop is unchanged (column-reverse held it), so the
    // derived state below reads the same position the user was already at.
    this._scrolledUp = this._distanceFromBottom > 40;
    this._stickToBottom = false;
    this._prevScrollTop = this._el.scrollTop;

    // Re-arm the near-top trigger so future scrolling / keyboard nav can page
    // again. Keep the latch SET if we're still within one viewport of the top
    // (a page too light to push the viewport past the prefetch band), to stop an
    // immediate duplicate fetch. _renderStart is 0 here (a prepend renders all
    // prepended messages), so the band is one viewport, matching the handler.
    this._scrollTopFired = this._distanceFromTop < this._el.clientHeight;
    // Trim the window back to MAX_RENDERED once the scroll settles — culling the
    // bottom needs a scrollTop write (down direction), which we must not do
    // mid-fling, so it's deferred. See _scheduleCull.
    this._scheduleCull();
  }

  /** Append newer messages below the current list. Used by forward pagination
   *  when the timeline is showing a context window in the middle of history.
   *  Leaves scrollTop alone so the new content appears below the user's
   *  viewport — they keep scrolling down to reach it. */
  appendMessages(msgs: MessageData[]): void {
    if (msgs.length === 0) return;
    this._messages = [...this._messages, ...msgs];
    this._renderEnd = this._messages.length;

    const oldScrollHeight = this._el.scrollHeight;
    this._listEl.appendChild(this._buildGroupedFragment(msgs));

    // DOWN direction: content was appended at the bottom. Under `column-reverse`
    // the browser anchors the bottom, so without compensation the viewport would
    // follow the new tail and jump downward by the added height. Subtract the
    // delta from scrollTop (more negative = scrolled up relative to the new
    // bottom) to keep the user's reading position fixed — they scroll into the
    // new content naturally. This is the one compensating write the bottom-anchor
    // trade requires; it only runs in context-view forward pagination, which is
    // rare and not a fast-fling path, so the momentum-clobber risk is minimal.
    this._el.scrollTop -= this._el.scrollHeight - oldScrollHeight;

    // Re-arm the bottom-edge trigger so the next approach can fire.
    this._scrollBottomFired = false;
    this._scrolledUp = this._distanceFromBottom > 40;
    this._stickToBottom = false;
    this._prevScrollTop = this._el.scrollTop;
    this._scheduleCull();
  }

  /** Replace the entire message list.
   *
   * By default (preserveScroll = false) scrolls to the bottom after rendering —
   * used when first loading a room.  Pass preserveScroll = true for async
   * re-renders (e.g. member-data refresh) so that a user who has already
   * scrolled up to read history keeps their position.
   */
  setMessages(msgs: MessageData[], opts?: { preserveScroll?: boolean; skipAutoScroll?: boolean }): void {
    // Cancel any in-progress scroll animation to prevent stuck transforms
    if (this._scrollAnimCleanupTimer !== null) {
      clearTimeout(this._scrollAnimCleanupTimer);
      this._scrollAnimCleanupTimer = null;
      this._listEl.style.transition = "";
      this._listEl.style.transform = "";
    }
    // Cancel a pending deferred cull so it can't fire against the new list.
    if (this._cullTimer !== null) {
      clearTimeout(this._cullTimer);
      this._cullTimer = null;
    }
    // Reset selection so _selectedIndex can't be out-of-range for the new message list.
    // Without this, navigating after a room switch can get stuck because _selectedIndex
    // still holds an index from the previous room's (longer) message list, making
    // selectNext/selectPrev think the selection is already at the boundary.
    this._selectedIndex = -1;

    const preserveScroll = opts?.preserveScroll ?? false;
    const skipAutoScroll = opts?.skipAutoScroll ?? false;
    // Capture scroll state before re-render so we can restore it
    const wasScrolledUp = this._scrolledUp;
    const savedScrollTop = this._el.scrollTop;

    this._messages = [...msgs];
    // Render only the most recent window. Older messages remain in the buffer
    // and become visible when the user scrolls up.
    this._renderEnd = this._messages.length;
    this._renderStart = Math.max(0, this._renderEnd - Timeline.MAX_RENDERED);
    this._renderAll();

    if (preserveScroll && wasScrolledUp) {
      // Restore the user's reading position. Under `column-reverse` scrollTop is
      // the distance from the live tail, so re-applying the saved value keeps the
      // same distance-from-bottom (the _renderAll teardown above resets it, so we
      // set it back explicitly — this path is a member-data refresh, not a fling,
      // so the write is safe). The browser would have held it for free on an
      // incremental change, but setMessages does a full rebuild.
      this._el.scrollTop = savedScrollTop;
      // Keep the user where they were reading; don't follow the tail.
      this._scrolledUp = true;
      this._stickToBottom = false;
      this._prevScrollTop = this._el.scrollTop;
    } else if (!skipAutoScroll) {
      // Draw the unread separator in-place (if any) but still open at the live
      // tail. Auto-jumping to the separator caused a variable mid-list landing:
      // it was centered in a rAF before media finished decoding, and any image
      // in the band above it that grew afterward shoved it downward by an
      // unpredictable amount. The marker now stays put; the user scrolls up or
      // uses jump-to-latest to reach it.
      if (this._unreadCount > 0 && !preserveScroll) {
        this._insertUnreadSeparator();
        this._unreadCount = 0;
      }
      this._scrolledUp = false;
      this._scrollTopFired = false;
      // Pin to the bottom now for text content, and once more after the next
      // layout. The stick observer keeps us pinned as images, emoji and stickers
      // settle afterwards — no timer guesswork needed.
      this._scrollToBottom();
      requestAnimationFrame(() => this._scrollToBottom());
    } else {
      // skipAutoScroll: caller will handle scrolling (e.g. jumpToMessage)
      this._scrolledUp = true;
      this._stickToBottom = false;
      this._scrollTopFired = false;
    }
    this._updateJumpToLatestVisibility();
    this._fadeOutSkeletonAfterImages();
  }

  /** Append a single message, scrolling to bottom if not scrolled up.
   *  If the rendered window does not currently include the buffer end, the
   *  message is added to the buffer only — the user will see it when they
   *  scroll back to the live tail. */
  appendMessage(msg: MessageData, opts?: { animate?: boolean }): void {
    const wasAtBufferEnd = this._renderEnd === this._messages.length;
    this._messages.push(msg);
    if (!wasAtBufferEnd) {
      // The DOM window doesn't extend to the live tail — leave DOM untouched.
      // (User has scrolled away into older history; their viewport stays put.)
      return;
    }
    this._renderEnd = this._messages.length;
    const animate = opts?.animate ?? false;
    // Height before the append, so a scrolled-up reader's position can be held
    // (column-reverse anchors the bottom — see _settleTailAppend).
    const oldScrollHeight = this._el.scrollHeight;

    // Check 30-minute time gap from the previous message
    const prevMsg = this._messages[this._messages.length - 2];
    const prevTs = prevMsg?.timestamp ? new Date(prevMsg.timestamp).getTime() : 0;
    const newTs = msg.timestamp ? new Date(msg.timestamp).getTime() : 0;
    const bigGap = prevTs > 0 && newTs - prevTs > TIME_SEPARATOR_GAP_MS;

    if (bigGap) {
      this._listEl.appendChild(buildTimeSeparator(msg.timestamp));
    }

    // Check if this message can be merged into the last group on screen.
    // Never merge across a time gap — same condition as groupMessages().
    if (!bigGap) {
      const lastWrapper = this._listEl.lastElementChild;
      if (
        lastWrapper &&
        lastWrapper.classList.contains("message-group-wrapper") &&
        isGroupable(msg)
      ) {
        // Check sender of the existing group (compare by Matrix user ID, not display name)
        const wrapperSenderId = (lastWrapper as HTMLElement).dataset.sender;
        if (wrapperSenderId === (msg.senderId ?? msg.senderName) && !msg.replyTo) {
          // Append into existing group (replies always start a new group)
          const innerGroup = lastWrapper.querySelector<HTMLElement>(".message-group");
          if (!innerGroup) return;
          const el = buildMessageElement(msg);
          const msgHeader = el.querySelector(".message__header");
          if (msgHeader) (msgHeader as HTMLElement).style.display = "none";
          if (animate) el.classList.add("message--entering");
          innerGroup.appendChild(el);
          this._scheduleCull();
          this._settleTailAppend(oldScrollHeight);
          return;
        }
      }
    }

    // Otherwise, render as a new group or ungrouped element
    if (isGroupable(msg)) {
      const wrapper = buildMessageGroup([msg]);
      if (animate) wrapper.classList.add("message-group-wrapper--entering");
      this._listEl.appendChild(wrapper);
    } else {
      const el = buildMessageElement(msg);
      el.classList.add("message--ungrouped");
      this._listEl.appendChild(el);
    }

    this._scheduleCull();
    this._settleTailAppend(oldScrollHeight);
  }

  /** After appending live content at the tail: pin to the bottom if the user is
   *  following the live tail, otherwise hold their reading position. Under
   *  `flex-direction: column-reverse` the bottom is anchored, so appending below
   *  shifts the viewport toward the new tail — when scrolled up we subtract the
   *  added height to keep the previously-visible content fixed. `animate` uses the
   *  send counter-animation instead of an instant pin. */
  private _settleTailAppend(oldScrollHeight: number, animate = false): void {
    if (this._scrolledUp) {
      this._el.scrollTop -= this._el.scrollHeight - oldScrollHeight;
      this._prevScrollTop = this._el.scrollTop;
    } else if (animate) {
      this._scrollAnimated();
    } else {
      this._scrollToBottom();
    }
  }

  /** Force scroll to the latest message */
  scrollToBottom(): void {
    this._scrollToBottom();
  }

  // ── Inline thread panel ────────────────────────────────────────────────────

  private _inlineThreadEl: HTMLElement | null = null;
  private _inlineThreadRootId: string | null = null;
  private _inlineThreadMessages: ThreadMessageData[] = [];
  private _threadSelectedIndex = -1;
  private _inlineThreadCloseCallback: (() => void) | null = null;

  /** Register callback fired when the user closes the inline thread. */
  onInlineThreadClose(cb: () => void): void {
    this._inlineThreadCloseCallback = cb;
  }

  /** The event ID of the currently-open inline thread root, or null. */
  get inlineThreadRootId(): string | null {
    return this._inlineThreadRootId;
  }

  /**
   * Insert (or replace) the inline thread panel directly after the wrapper
   * element that contains the thread root message, then animate it open.
   */
  openInlineThread(rootEventId: string, replies: ThreadMessageData[]): void {
    // Remove any previously-open panel immediately (no close animation — the
    // new panel snaps open in the correct position).
    this._removeInlineThread(false);
    this._inlineThreadMessages = [...replies];
    this._threadSelectedIndex = -1;

    const rootMsgEl = this._listEl.querySelector<HTMLElement>(`[data-message-id="${rootEventId}"]`);
    const anchor =
      rootMsgEl?.closest<HTMLElement>(".message-group-wrapper") ??
      rootMsgEl?.closest<HTMLElement>(".message--ungrouped");
    if (!anchor) return;

    this._inlineThreadRootId = rootEventId;
    const panel = this._buildInlinePanel(rootEventId, replies);
    this._inlineThreadEl = panel;
    anchor.insertAdjacentElement("afterend", panel);

    // Animate open on the next frame so the browser has painted the 0fr state.
    requestAnimationFrame(() => {
      panel.classList.add("thread-inline--open");
    });

    // After the panel opens, scroll the anchor back into view so the root
    // message stays visible above the expanded panel.
    setTimeout(() => {
      anchor.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 240);
  }

  /** Animate the inline thread panel closed then remove it from the DOM. */
  closeInlineThread(): void {
    this._removeInlineThread(true);
  }

  /** Append a new reply to the already-open inline thread panel. */
  appendInlineReply(msg: ThreadMessageData): void {
    if (!this._inlineThreadEl) return;
    const tl = this._inlineThreadEl.querySelector<HTMLElement>(".thread-inline__timeline");
    if (!tl) return;
    this._inlineThreadMessages.push(msg);
    tl.appendChild(this._buildInlineMsgEl(msg));
    tl.scrollTop = tl.scrollHeight;
  }

  // ── Thread navigation ──────────────────────────────────────────────────────

  /** Navigate to the next thread reply (or first if nothing selected). */
  threadSelectNext(): void {
    if (!this._inlineThreadEl || this._inlineThreadMessages.length === 0) return;
    const next = this._threadSelectedIndex < this._inlineThreadMessages.length - 1
      ? this._threadSelectedIndex + 1
      : this._threadSelectedIndex;
    this._setThreadSelected(next);
  }

  /** Navigate to the previous thread reply. */
  threadSelectPrev(): void {
    if (!this._inlineThreadEl || this._inlineThreadMessages.length === 0) return;
    const prev = this._threadSelectedIndex > 0
      ? this._threadSelectedIndex - 1
      : 0;
    this._setThreadSelected(prev);
  }

  /** Jump to the first thread reply. */
  threadSelectFirst(): void {
    if (this._inlineThreadMessages.length > 0) this._setThreadSelected(0);
  }

  /** Jump to the last thread reply. */
  threadSelectLast(): void {
    const len = this._inlineThreadMessages.length;
    if (len > 0) this._setThreadSelected(len - 1);
  }

  /** Clear thread selection (but leave thread open). */
  threadClearSelection(): void {
    this._setThreadSelected(-1);
  }

  /** The event ID of the currently-selected thread reply, or null. */
  get threadSelectedMessageId(): string | null {
    if (this._threadSelectedIndex < 0 || this._threadSelectedIndex >= this._inlineThreadMessages.length) return null;
    return this._inlineThreadMessages[this._threadSelectedIndex].id;
  }

  /** Return the DOM element for a message inside the inline thread, or null. */
  getInlineThreadMessageEl(eventId: string): HTMLElement | null {
    return this._inlineThreadEl?.querySelector<HTMLElement>(`[data-message-id="${eventId}"]`) ?? null;
  }

  /** Swap in a resolved data URL for a media message inside the inline thread. */
  updateInlineThreadMedia(eventId: string, dataUrl: string): void {
    if (!this._inlineThreadEl) return;
    const el = this._inlineThreadEl.querySelector<HTMLElement>(`[data-message-id="${eventId}"]`);
    const img = el?.querySelector<HTMLImageElement>(".thread-inline__message-image, .thread-inline__message-sticker");
    if (img) img.src = dataUrl;
  }

  private _setThreadSelected(index: number): void {
    // Remove highlight from previous
    if (this._threadSelectedIndex >= 0 && this._inlineThreadEl) {
      const prevId = this._inlineThreadMessages[this._threadSelectedIndex]?.id;
      if (prevId) {
        const el = this._inlineThreadEl.querySelector<HTMLElement>(`[data-message-id="${prevId}"]`);
        el?.classList.remove("thread-inline__message--selected");
      }
    }

    this._threadSelectedIndex = index;

    if (index >= 0 && this._inlineThreadEl) {
      const msgId = this._inlineThreadMessages[index]?.id;
      if (msgId) {
        const el = this._inlineThreadEl.querySelector<HTMLElement>(`[data-message-id="${msgId}"]`);
        if (el) {
          el.classList.add("thread-inline__message--selected");
          el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      }
    }
  }

  private _removeInlineThread(animate: boolean): void {
    const panel = this._inlineThreadEl;
    if (!panel) return;
    this._inlineThreadEl = null;
    this._inlineThreadRootId = null;
    this._inlineThreadMessages = [];
    this._setThreadSelected(-1);

    if (!animate) {
      panel.remove();
      return;
    }
    panel.classList.remove("thread-inline--open");
    const onDone = () => panel.remove();
    panel.addEventListener("transitionend", onDone, { once: true });
    // Fallback: if transition somehow doesn't fire (e.g., tab hidden), clean up.
    setTimeout(onDone, 350);
  }

  private _buildInlinePanel(rootEventId: string, replies: ThreadMessageData[]): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "thread-inline";
    panel.dataset.threadRoot = rootEventId;

    const inner = document.createElement("div");
    inner.className = "thread-inline__inner";

    // ── Header ──────────────────────────────────────────────────────────────
    const header = document.createElement("div");
    header.className = "thread-inline__header";

    const title = document.createElement("span");
    title.className = "thread-inline__title";
    title.textContent = "⌥ Thread";
    header.appendChild(title);

    const countEl = document.createElement("span");
    countEl.className = "thread-inline__count";
    const n = replies.length;
    countEl.textContent = n > 0 ? `${n} repl${n === 1 ? "y" : "ies"}` : "no replies yet";
    header.appendChild(countEl);

    const closeBtn = document.createElement("button");
    closeBtn.className = "thread-inline__close";
    closeBtn.type = "button";
    closeBtn.textContent = "[x]";
    closeBtn.setAttribute("aria-label", "Close thread");
    closeBtn.addEventListener("click", () => this._inlineThreadCloseCallback?.());
    header.appendChild(closeBtn);

    inner.appendChild(header);

    // ── Reply timeline ───────────────────────────────────────────────────────
    const timelineEl = document.createElement("div");
    timelineEl.className = "thread-inline__timeline";
    timelineEl.setAttribute("role", "list");
    timelineEl.setAttribute("aria-label", "Thread replies");

    for (const msg of replies) {
      timelineEl.appendChild(this._buildInlineMsgEl(msg));
    }

    inner.appendChild(timelineEl);
    panel.appendChild(inner);
    return panel;
  }

  private _buildInlineMsgEl(msg: ThreadMessageData): HTMLElement {
    const row = document.createElement("div");
    row.className = "thread-inline__message" + (msg.isOwn ? " thread-inline__message--own" : "");
    row.setAttribute("role", "listitem");
    row.dataset.messageId = msg.id;

    const hdr = document.createElement("div");
    hdr.className = "thread-inline__message-header";

    const senderEl = document.createElement("span");
    senderEl.className =
      "thread-inline__message-sender" + (msg.isOwn ? " thread-inline__message-sender--own" : "");
    senderEl.textContent = msg.senderName;
    hdr.appendChild(senderEl);

    const tsEl = document.createElement("span");
    tsEl.className = "thread-inline__message-timestamp";
    try {
      const d = new Date(msg.timestamp);
      tsEl.textContent = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
    } catch { /* leave empty */ }
    tsEl.setAttribute("title", msg.timestamp);
    hdr.appendChild(tsEl);

    row.appendChild(hdr);

    const type = msg.type ?? "text";
    if (type === "image" || type === "sticker") {
      const img = document.createElement("img");
      img.className = `thread-inline__message-${type}`;
      img.src = msg.mediaUrl ?? "";
      img.alt = msg.mediaAlt ?? type;
      img.loading = "lazy";
      row.appendChild(img);
    } else if (type === "video") {
      const aff = buildVideoAffordance(msg.mediaUrl, msg.mediaAlt, msg.mediaMimeType, msg.mediaEncryptionInfo, msg.mediaThumbnailUrl, msg.mediaThumbnailEncryptionInfo);
      row.appendChild(aff);
    } else {
      const body = document.createElement("div");
      body.className = "thread-inline__message-body";
      if (msg.htmlBody) {
        body.innerHTML = msg.htmlBody;
        setupSpoilers(body);
      } else {
        body.textContent = msg.body;
      }
      row.appendChild(body);
    }

    if (msg.reactions && msg.reactions.length > 0) {
      row.appendChild(createReactionBar(msg.reactions));
    }

    return row;
  }

  /**
   * The event ID of the currently selected message (or thread reply when a
   * thread is open and a reply is highlighted), or null.
   */
  get selectedMessageId(): string | null {
    if (this._inlineThreadRootId !== null && this._threadSelectedIndex >= 0) {
      return this.threadSelectedMessageId;
    }
    if (this._selectedIndex < 0 || this._selectedIndex >= this._messages.length) return null;
    return this._messages[this._selectedIndex].id;
  }

  /** Always returns the main-timeline selection, ignoring any thread navigation. */
  get timelineSelectedMessageId(): string | null {
    if (this._selectedIndex < 0 || this._selectedIndex >= this._messages.length) return null;
    return this._messages[this._selectedIndex].id;
  }

  /** Returns the full MessageData of the currently selected timeline message, or null. */
  get selectedMessage(): MessageData | null {
    if (this._selectedIndex < 0 || this._selectedIndex >= this._messages.length) return null;
    return this._messages[this._selectedIndex];
  }

  /**
   * Body text of a message by event ID, reflecting any edits already applied
   * (reads from MessageData rather than the raw timeline event). Null if the
   * message isn't currently loaded.
   */
  getMessageBodyById(eventId: string): string | null {
    return this._messages.find((m) => m.id === eventId)?.body ?? null;
  }

  /**
   * Move selection down. Navigates thread replies when a thread is open.
   * Returns true if the selection moved, false when it was already on the
   * bottom-most message — a boundary the caller uses to hand focus to the
   * compose box, which sits just below the timeline (#15).
   */
  selectNext(): boolean {
    if (this._inlineThreadRootId !== null) { this.threadSelectNext(); return true; }
    if (this._messages.length === 0) return false;
    if (this._selectedIndex < 0 || this._selectedIndex >= this._messages.length) {
      this._setSelected(this._messages.length - 1);
      return true;
    } else if (this._selectedIndex < this._messages.length - 1) {
      this._setSelected(this._selectedIndex + 1);
      return true;
    }
    return false;
  }

  /**
   * Move selection up. Navigates thread replies when a thread is open.
   * Returns true if the selection moved, false at the first message.
   */
  selectPrev(): boolean {
    if (this._inlineThreadRootId !== null) { this.threadSelectPrev(); return true; }
    if (this._messages.length === 0) return false;
    if (this._selectedIndex < 0 || this._selectedIndex >= this._messages.length) {
      this._setSelected(this._messages.length - 1);
      return true;
    } else if (this._selectedIndex > 0) {
      this._setSelected(this._selectedIndex - 1);
      return true;
    }
    return false;
  }

  /** Jump to first. Goes to first thread reply when a thread is open. */
  selectFirst(): void {
    if (this._inlineThreadRootId !== null) { this.threadSelectFirst(); return; }
    if (this._messages.length === 0) return;
    this._setSelected(0);
  }

  /**
   * Jump to last. Goes to last thread reply when a thread is open.
   * Returns true if a message was selected, false when the timeline is empty.
   */
  selectLast(): boolean {
    if (this._inlineThreadRootId !== null) { this.threadSelectLast(); return true; }
    if (this._messages.length === 0) return false;
    this._setSelected(this._messages.length - 1);
    this._scrollToBottom();
    return true;
  }

  /** Clear selection (clears thread selection when a thread is open). */
  clearSelection(): void {
    if (this._inlineThreadRootId !== null) { this.threadClearSelection(); return; }
    this._setSelected(-1);
  }

  /**
   * Append a message to the timeline but keep it invisible (opacity: 0).
   * Call showLastHiddenMessage() to reveal it with an animation.
   * Used for the send animation: message lands silently, then the flying
   * clone arrives and this method reveals it at that moment.
   */
  appendMessageHidden(msg: MessageData): void {
    this._messages.push(msg);
    // Send-time append always extends the rendered window to include the new
    // message — the user is presumably looking at the compose box, which is
    // anchored to the live tail.
    this._renderEnd = this._messages.length;
    const oldScrollHeight = this._el.scrollHeight;

    // Check 30-minute time gap from the previous message
    const prevMsg = this._messages[this._messages.length - 2];
    const prevTs = prevMsg?.timestamp ? new Date(prevMsg.timestamp).getTime() : 0;
    const newTs = msg.timestamp ? new Date(msg.timestamp).getTime() : 0;
    const bigGap = prevTs > 0 && newTs - prevTs > TIME_SEPARATOR_GAP_MS;

    if (bigGap) {
      this._listEl.appendChild(buildTimeSeparator(msg.timestamp));
    }

    if (!bigGap) {
      const lastWrapper = this._listEl.lastElementChild;
      if (
        lastWrapper &&
        lastWrapper.classList.contains("message-group-wrapper") &&
        isGroupable(msg)
      ) {
        const innerGroup = lastWrapper.querySelector<HTMLElement>(".message-group");
        const groupSender = innerGroup?.querySelector(".message-group__sender");
        if (groupSender && groupSender.textContent === msg.senderName && !msg.replyTo) {
          const el = buildMessageElement(msg);
          const msgHeader = el.querySelector(".message__header");
          if (msgHeader) (msgHeader as HTMLElement).style.display = "none";
          el.style.opacity = "0";
          innerGroup!.appendChild(el);
          this._lastHiddenEl = el;
          this._settleTailAppend(oldScrollHeight, true);
          return;
        }
      }
    }

    if (isGroupable(msg)) {
      const wrapper = buildMessageGroup([msg]);
      wrapper.style.opacity = "0";
      this._listEl.appendChild(wrapper);
      this._lastHiddenEl = wrapper;
      this._settleTailAppend(oldScrollHeight, true);
    } else {
      const el = buildMessageElement(msg);
      el.classList.add("message--ungrouped");
      el.style.opacity = "0";
      this._listEl.appendChild(el);
      this._lastHiddenEl = el;
      this._settleTailAppend(oldScrollHeight, true);
    }
  }

  /**
   * Reveal a hidden message element (appended via appendMessageHidden).
   * Pass the specific element captured at send time to avoid a race where
   * rapid successive sends overwrite the shared _lastHiddenEl slot.
   * For a new group: the box appears instantly and only the header fades in.
   * For a merged message: fades it in.
   */
  showLastHiddenMessage(target?: HTMLElement): void {
    const el = target ?? this._lastHiddenEl;
    if (!el) return;
    if (el === this._lastHiddenEl) this._lastHiddenEl = null;

    if (el.classList.contains("message-group-wrapper")) {
      const header = el.querySelector<HTMLElement>(".message-group__header");
      const avatar = el.querySelector<HTMLElement>(".message-group__avatar, .message-group__avatar-fallback");

      if (header) header.style.opacity = "0";
      if (avatar) avatar.style.opacity = "0";
      el.style.opacity = "";

      requestAnimationFrame(() => {
        if (header) {
          header.style.opacity = "";
          header.classList.add("msg-header--reveal");
        }
        if (avatar) {
          avatar.style.opacity = "";
          avatar.classList.add("msg-header--reveal");
        }
      });
    } else {
      el.style.opacity = "";
    }
  }

  /**
   * Replace fallback avatars for a sender with a real image.
   * Called after an avatar thumbnail has been downloaded.
   */
  /** Update display name text for all message groups from a given sender ID in place. */
  updateSenderName(senderId: string, displayName: string): void {
    const wrappers = this._listEl.querySelectorAll<HTMLElement>(`[data-sender="${CSS.escape(senderId)}"]`);
    for (const wrapper of wrappers) {
      const nameEl = wrapper.querySelector<HTMLElement>(".message-group__sender");
      if (nameEl) nameEl.textContent = displayName;
    }
    // Also update reply preview sender labels that reference this user
    const localPart = senderId.startsWith("@") ? senderId.slice(1).split(":")[0] : senderId;
    const displayLocalPart = displayName.startsWith("@") ? displayName.slice(1).split(":")[0] : displayName;
    for (const el of this._listEl.querySelectorAll<HTMLElement>(".reply-preview__sender")) {
      if (el.textContent === localPart) el.textContent = displayLocalPart;
    }
  }

  /**
   * Update the body text of an existing message in place.
   * Used to apply incoming edit events without re-rendering the whole timeline.
   */
  updateMessageBody(eventId: string, newBody: string, newHtmlBody?: string): void {
    const idx = this._messages.findIndex((m) => m.id === eventId);
    if (idx >= 0) {
      this._messages[idx].body = newBody;
      if (newHtmlBody !== undefined) this._messages[idx].htmlBody = newHtmlBody;
    }
    const el = this.getMessageElementById(eventId);
    if (!el) return;
    const bodyEl = el.querySelector<HTMLElement>(".message__body");
    if (!bodyEl) return;
    if (newHtmlBody) {
      bodyEl.innerHTML = newHtmlBody;
      setupSpoilers(bodyEl);
    } else {
      bodyEl.textContent = newBody;
    }
    // Mark as edited if not already marked
    if (!el.querySelector(".message__edited-marker")) {
      const marker = document.createElement("span");
      marker.className = "message__edited-marker";
      marker.textContent = " (edited)";
      marker.title = "Click to view edit history";
      bodyEl.appendChild(marker);
    }
  }

  updateSenderAvatar(sender: string, dataUrl: string): void {
    const wrappers = this._listEl.querySelectorAll<HTMLElement>(`[data-sender="${CSS.escape(sender)}"]`);
    for (const wrapper of wrappers) {
      const fallback = wrapper.querySelector<HTMLElement>(".message-group__avatar-fallback");
      if (!fallback) continue;
      const img = document.createElement("img");
      img.className = "message-group__avatar";
      img.src = dataUrl;
      img.alt = "";
      img.setAttribute("aria-hidden", "true");
      if (isAnimatedUrl(dataUrl)) img.dataset.gif = "1";
      img.onerror = () => img.replaceWith(buildFallbackAvatar(sender));
      fallback.replaceWith(img);
    }
  }

  /** Returns the DOM element for the given message event ID, or null. */
  getMessageElementById(eventId: string): HTMLElement | null {
    return this._listEl.querySelector<HTMLElement>(`[data-message-id="${eventId}"]`);
  }

  // ── Read receipts ──────────────────────────────────────────────────────────

  /** Inject resolvers for receipt avatar URLs and display names so decoration
   *  can render real avatars/names without importing the app layer. */
  setReceiptResolvers(resolvers: {
    avatarUrl: (userId: string) => string | undefined;
    displayName: (userId: string) => string;
  }): void {
    this._receiptAvatarResolver = resolvers.avatarUrl;
    this._receiptNameResolver = resolvers.displayName;
  }

  /** Replace the whole receipt state (initial seed on room open) and redecorate.
   *  Pass an empty list to clear (e.g. when the display setting is off). */
  setReadReceipts(list: { userId: string; eventId: string; ts: number | null }[]): void {
    this._receiptByUser.clear();
    for (const { userId, eventId, ts } of list) this._receiptByUser.set(userId, { eventId, ts });
    this._renderReceipts();
  }

  /** Apply one live receipt delta, moving the user's avatar if it advanced. */
  setReadReceipt(userId: string, eventId: string, ts: number | null): void {
    const prev = this._receiptByUser.get(userId);
    if (prev && prev.eventId === eventId) return;
    this._receiptByUser.set(userId, { eventId, ts });
    this._renderReceipts();
  }

  /** Swap in a freshly-downloaded avatar for a user's receipt chips. Mirrors
   *  `updateSenderAvatar`; called when a member's avatar finishes downloading. */
  updateReceiptAvatar(userId: string, dataUrl: string): void {
    const spans = this._listEl.querySelectorAll<HTMLElement>(
      `.read-receipt[data-receipt-user="${CSS.escape(userId)}"]`,
    );
    for (const span of spans) {
      const img = document.createElement("img");
      img.className = "read-receipt__avatar";
      img.src = dataUrl;
      img.alt = "";
      img.setAttribute("aria-hidden", "true");
      if (isAnimatedUrl(dataUrl)) img.dataset.gif = "1";
      img.onerror = () => img.replaceWith(this._buildReceiptFallback(userId));
      const first = span.firstElementChild;
      if (first) first.replaceWith(img);
      else span.appendChild(img);
    }
  }

  /** Rebuild every read-receipt container from scratch. Cheap (bounded by member
   *  count) and the only place receipts touch the DOM, so it's safe to call after
   *  any render path. Each user is placed on the nearest rendered message at or
   *  before their receipt timestamp — receipts frequently point at non-message
   *  events (reactions, edits, redactions) that aren't in the timeline. */
  private _renderReceipts(): void {
    // Tear down all existing containers first (and any open hover card, whose
    // anchor may be about to be removed).
    this._hideReceiptTooltip();
    for (const c of Array.from(this._listEl.querySelectorAll(".read-receipts"))) c.remove();
    if (this._receiptByUser.size === 0) return;

    // Each user's latest own message + its time. Sending a message implies the
    // sender has read up to it, so their receipt is advanced to it when it's
    // newer than their explicit receipt — this matches Element, where a user who
    // posted after their last read receipt shows at their own message.
    const lastOwn = new Map<string, { id: string; ts: number }>();
    for (const m of this._messages) {
      if (!m.senderId) continue;
      lastOwn.set(m.senderId, { id: m.id, ts: Date.parse(m.timestamp) }); // ascending → last wins
    }

    // Group users onto their resolved display message.
    const byMessage = new Map<string, { userId: string; ts: number | null }[]>();
    for (const [userId, pos] of this._receiptByUser) {
      const msgId = this._resolveReceiptMessageId(userId, pos, lastOwn);
      if (!msgId || !this.getMessageElementById(msgId)) continue;
      const list = byMessage.get(msgId);
      if (list) list.push({ userId, ts: pos.ts });
      else byMessage.set(msgId, [{ userId, ts: pos.ts }]);
    }

    for (const [msgId, entries] of byMessage) {
      const el = this.getMessageElementById(msgId);
      if (!el) continue;
      // Most-recently-read first, so the visible two are the latest readers.
      entries.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
      el.appendChild(this._buildReceiptContainer(msgId, entries));
    }
  }

  /** Resolve a receipt position to the message its avatar should sit on:
   *  the later of (a) the nearest rendered message at or before the explicit
   *  receipt's timestamp and (b) the user's own most recent message (sending
   *  implies reading). Falls back to the receipted event itself. */
  private _resolveReceiptMessageId(
    userId: string,
    pos: { eventId: string; ts: number | null },
    lastOwn: Map<string, { id: string; ts: number }>,
  ): string | null {
    let bestId: string | null = null;
    let bestTs = -Infinity;
    if (pos.ts != null) {
      const id = this._messageIdAtOrBeforeTs(pos.ts);
      if (id) {
        bestId = id;
        bestTs = pos.ts;
      }
    }
    if (bestId == null) bestId = pos.eventId; // exact event (renders only if displayed)

    // Advance to the user's own latest message when it's newer.
    const own = lastOwn.get(userId);
    if (own && own.ts > bestTs) bestId = own.id;

    return bestId;
  }

  /** Binary-search the (chronological) buffer for the newest message whose
   *  timestamp is ≤ `ts`. Returns its event ID, or null if all are newer. */
  private _messageIdAtOrBeforeTs(ts: number): string | null {
    let lo = 0;
    let hi = this._messages.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (Date.parse(this._messages[mid].timestamp) <= ts) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans >= 0 ? this._messages[ans].id : null;
  }

  /** Build the bottom-right stack: up to MAX_RECEIPTS_SHOWN avatars, then a "…"
   *  chip when more readers exist. Hovering the group lists every reader + time. */
  private _buildReceiptContainer(
    eventId: string,
    entries: { userId: string; ts: number | null }[],
  ): HTMLElement {
    const container = document.createElement("div");
    container.className = "read-receipts";
    container.dataset.receiptEvent = eventId;
    // Themed hover card (not the native `title` tooltip) listing every reader.
    container.addEventListener("mouseenter", () => this._showReceiptTooltip(container, entries));
    container.addEventListener("mouseleave", () => this._hideReceiptTooltip());

    const shown = entries.slice(0, Timeline.MAX_RECEIPTS_SHOWN);
    for (const { userId } of shown) {
      const span = document.createElement("span");
      span.className = "read-receipt";
      span.dataset.receiptUser = userId;
      span.appendChild(this._buildReceiptAvatar(userId, this._receiptAvatarResolver?.(userId)));
      container.appendChild(span);
    }

    if (entries.length > shown.length) {
      const chip = document.createElement("span");
      chip.className = "read-receipts__overflow";
      chip.textContent = "…";
      container.appendChild(chip);
    }

    return container;
  }

  /** Lazily create the shared receipt hover card on `<body>`. */
  private _ensureReceiptTooltip(): HTMLElement {
    if (this._receiptTooltipEl) return this._receiptTooltipEl;
    const el = document.createElement("div");
    el.className = "read-receipts-tooltip";
    el.style.display = "none";
    document.body.appendChild(el);
    this._receiptTooltipEl = el;
    return el;
  }

  /** Populate and position the themed reader list above (or below) the cluster. */
  private _showReceiptTooltip(
    anchor: HTMLElement,
    entries: { userId: string; ts: number | null }[],
  ): void {
    const tip = this._ensureReceiptTooltip();
    tip.replaceChildren();

    const title = document.createElement("div");
    title.className = "read-receipts-tooltip__title";
    title.textContent = entries.length === 1 ? "Read by" : `Read by ${entries.length}`;
    tip.appendChild(title);

    for (const entry of entries) {
      const row = document.createElement("div");
      row.className = "read-receipts-tooltip__row";

      const avatar = document.createElement("span");
      avatar.className = "read-receipt";
      avatar.appendChild(this._buildReceiptAvatar(entry.userId, this._receiptAvatarResolver?.(entry.userId)));
      row.appendChild(avatar);

      const name = document.createElement("span");
      name.className = "read-receipts-tooltip__name";
      name.textContent = this._receiptNameResolver?.(entry.userId) ?? entry.userId;
      row.appendChild(name);

      if (entry.ts != null) {
        const time = document.createElement("span");
        time.className = "read-receipts-tooltip__time";
        time.textContent = new Date(entry.ts).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        row.appendChild(time);
      }

      tip.appendChild(row);
    }

    // Measure, then position above the cluster (flip below if it would clip),
    // right-aligned to the anchor and clamped to the viewport.
    tip.style.display = "block";
    const a = anchor.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    let top = a.top - t.height - 6;
    if (top < 8) top = a.bottom + 6;
    const left = Math.max(8, Math.min(a.right - t.width, window.innerWidth - t.width - 8));
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  private _hideReceiptTooltip(): void {
    if (this._receiptTooltipEl) this._receiptTooltipEl.style.display = "none";
  }

  /** A receipt avatar: an <img> when a blob URL is known, else a colored initial. */
  private _buildReceiptAvatar(userId: string, avatarUrl?: string): HTMLElement {
    if (avatarUrl) {
      const img = document.createElement("img");
      img.className = "read-receipt__avatar";
      img.src = avatarUrl;
      img.alt = "";
      img.setAttribute("aria-hidden", "true");
      if (isAnimatedUrl(avatarUrl)) img.dataset.gif = "1";
      img.onerror = () => img.replaceWith(this._buildReceiptFallback(userId));
      return img;
    }
    return this._buildReceiptFallback(userId);
  }

  private _buildReceiptFallback(userId: string): HTMLElement {
    const color = hashColor(userId);
    const initial = (userId.startsWith("@") ? userId[1] : userId[0] ?? "?").toUpperCase();
    const el = document.createElement("span");
    el.className = "read-receipt__fallback";
    el.textContent = initial;
    // A solid colored disc with a bg-colored initial reads clearly at 14px,
    // where a nested colored border (as the group avatars use) would not.
    el.style.background = color;
    el.setAttribute("aria-hidden", "true");
    return el;
  }

  /** Returns the `.message__body` element for the currently selected message, or null. */
  getSelectedMessageBodyElement(): HTMLElement | null {
    if (this._selectedIndex < 0 || this._selectedIndex >= this._messages.length) return null;
    const msgEl = this._getMessageElement(this._selectedIndex);
    return msgEl?.querySelector<HTMLElement>(".message__body") ?? null;
  }

  /**
   * Swap out the src of an image/sticker message once the mxc:// content
   * has been downloaded and converted to a data URL.
   */
  /** Return all unique mxc:// URLs needed for unresolved inline custom emoji. */
  getPendingInlineEmojiUrls(): string[] {
    const imgs = this._listEl.querySelectorAll<HTMLImageElement>("img[data-mx-emoticon][data-mxc]");
    return [...new Set(Array.from(imgs).map((img) => img.dataset.mxc!))];
  }

  /** Swap in a data: URL for all inline custom emoji with the given mxc URL. */
  resolveInlineEmoji(mxcUrl: string, dataUrl: string): void {
    for (const img of this._listEl.querySelectorAll<HTMLImageElement>(`img[data-mxc]`)) {
      if (img.dataset.mxc === mxcUrl) img.src = dataUrl;
    }
  }

  updateMessageMedia(eventId: string, dataUrl: string): void {
    const idx = this._messages.findIndex((m) => m.id === eventId);
    if (idx >= 0) this._messages[idx].mediaUrl = dataUrl;
    const el = this.getMessageElementById(eventId);
    if (!el) return;
    const img = el.querySelector<HTMLImageElement>(".message__image, .message__sticker");
    if (!img) return;

    // Whether the box already reserves space (width/height attributes set at
    // render time from info.w/h). Captured before swapping src.
    const hasReserved = img.getAttribute("width") && img.getAttribute("height");

    // `settle` locks an unsized image to its decoded natural size and backfills
    // the buffer so windowed re-renders reserve the right height. It no longer
    // touches scrollTop: under `flex-direction: column-reverse` the browser
    // anchors the bottom, so media decoding/growing *above* the fold keeps the
    // read position stable for free (this is what previously caused a one-frame
    // shift each time an image settled — the residual "flicker"). Media is
    // delivered as Blob URLs that decode asynchronously, so settle runs both
    // synchronously (cached blobs) and on the `load` event.
    const settle = (): void => {
      if (!hasReserved && img.naturalWidth && img.naturalHeight) {
        img.width = img.naturalWidth;
        img.height = img.naturalHeight;
        // The explicit dimensions now reserve the box; drop the placeholder
        // min-height so it can't fight the real (often smaller) decoded size.
        img.classList.remove("message__image--unsized", "message__sticker--unsized");
        if (idx >= 0) {
          this._messages[idx].mediaWidth = img.naturalWidth;
          this._messages[idx].mediaHeight = img.naturalHeight;
        }
      }
    };

    img.src = dataUrl;
    settle(); // cached/decoded blobs change size now
    if (!img.complete) img.addEventListener("load", settle, { once: true });
  }

  /**
   * Replace the video affordance for `eventId` with an inline `<video>` player
   * that streams from `src` — a loopback media-server URL backed by a decrypted
   * temp file. WebKit streams it with HTTP Range support, so playback is
   * seekable and never loads the whole file into memory.
   *
   * If the media can't be loaded/decoded, the affordance is restored and
   * `onError` is invoked so the caller can fall back to the external player.
   */
  showInlineVideo(eventId: string, src: string, onError?: (detail?: string) => void): void {
    const msgEl = this.getMessageElementById(eventId);
    // Not in this timeline's DOM (e.g. a thread reply, which renders in its own
    // panel) — fall back to the external player rather than dead-ending.
    if (!msgEl) { onError?.(); return; }
    const aff = msgEl.querySelector<HTMLElement>(".message__video-affordance");
    if (!aff) { onError?.(); return; }

    const video = document.createElement("video");
    video.className = "message__video";
    video.controls = true;
    video.autoplay = true;
    video.preload = "metadata";
    // Reuse the affordance's already-loaded thumbnail as the poster so there's
    // no black flash while metadata loads.
    const thumb = aff.querySelector<HTMLImageElement>(".message__video-affordance-thumb-img");
    if (thumb?.src) video.poster = thumb.src;
    video.src = src;

    // A decode/codec failure restores the affordance and lets the caller open
    // the file externally. (A rejected autoplay promise is NOT an error — the
    // controls stay and the user can press play — so we don't fall back on it.)
    video.addEventListener("error", () => {
      const e = video.error;
      const detail = `code=${e?.code ?? "?"} msg="${e?.message ?? ""}" net=${video.networkState} ready=${video.readyState}`;
      video.replaceWith(aff);
      onError?.(detail);
    }, { once: true });

    aff.replaceWith(video);
    video.play?.().catch(() => { /* autoplay blocked by platform policy; user can press play */ });
  }

  /**
   * Remove a message from the timeline by event ID.
   * Used for optimistic redaction — removes from both the DOM and _messages array.
   * If the message was the only one in its group, the whole group wrapper is removed.
   * Adjusts _selectedIndex if needed.
   */
  removeMessage(eventId: string): void {
    const idx = this._messages.findIndex((m) => m.id === eventId);
    if (idx < 0) return;

    const wasSelected = this._selectedIndex === idx;
    const wasInWindow = idx >= this._renderStart && idx < this._renderEnd;

    // Adjust selection index accounting for the removal
    if (this._selectedIndex > idx) {
      this._selectedIndex--;
    } else if (this._selectedIndex === idx) {
      this._selectedIndex = -1;
    }

    // Adjust render window indices for the removal so they keep pointing at
    // the same content.
    if (idx < this._renderStart) {
      this._renderStart--;
      this._renderEnd--;
    } else if (idx < this._renderEnd) {
      this._renderEnd--;
    }

    this._messages.splice(idx, 1);

    if (!wasInWindow) {
      // Nothing to update in the DOM.
      if (wasSelected && this._messages.length > 0) {
        this._setSelected(Math.min(idx, this._messages.length - 1));
      }
      return;
    }

    const el = this.getMessageElementById(eventId);
    if (!el) return;

    const group = el.closest<HTMLElement>(".message-group");
    const wrapper = el.closest<HTMLElement>(".message-group-wrapper");

    if (wrapper && group) {
      const remaining = group.querySelectorAll<HTMLElement>("[data-message-id]");
      if (remaining.length <= 1) {
        // Last message in group — remove the whole wrapper
        wrapper.remove();
      } else {
        el.remove();
      }
    } else {
      // Ungrouped (system) message
      el.remove();
    }

    // Remove any time separators that now have no messages following them
    for (const sep of Array.from(this._listEl.querySelectorAll<HTMLElement>(".time-separator"))) {
      const next = sep.nextElementSibling;
      if (!next || next.classList.contains("time-separator")) {
        sep.remove();
      }
    }

    // If the deleted message was selected, move cursor to the next valid message
    if (wasSelected && this._messages.length > 0) {
      this._setSelected(Math.min(idx, this._messages.length - 1));
    }
  }

  /**
   * Promote an optimistic message to its real server-assigned event ID.
   * Call this when the send IPC resolves: updates both the DOM element's
   * data-message-id attribute and the internal _messages array so that
   * reactions, edits, and selection all target the real event ID.
   */
  confirmMessage(optimisticId: string, realEventId: string): void {
    // Race guard: if the homeserver's sync echo for this event arrived before
    // the send IPC resolved, a message keyed by the real event ID is already
    // rendered (the sync dedup checks all miss while the node still carries its
    // optimistic ID). Renaming the optimistic node would then leave two nodes
    // sharing one event ID — a permanent duplicate. Instead, drop the optimistic
    // node and keep the echo (it is the canonical copy, already in state).
    if (this._messages.some((m) => m.id === realEventId)) {
      this.removeMessage(optimisticId);
      return;
    }
    const idx = this._messages.findIndex((m) => m.id === optimisticId);
    if (idx >= 0) {
      this._messages[idx] = { ...this._messages[idx], id: realEventId };
    }
    const el = this.getMessageElementById(optimisticId);
    if (el) {
      el.dataset.messageId = realEventId;
    }
  }

  /**
   * Update the reaction bar for a message in-place.
   * If the message has no reaction bar yet, one is created and appended.
   * Passing an empty array removes the bar.
   */
  updateMessageReactions(eventId: string, reactions: ReactionGroup[]): void {
    // Keep internal cache in sync
    const idx = this._messages.findIndex((m) => m.id === eventId);
    if (idx >= 0) {
      this._messages[idx] = { ...this._messages[idx], reactions };
    }

    const el = this.getMessageElementById(eventId);
    if (!el) return;

    const bar = el.querySelector<HTMLElement>(".reaction-bar");
    if (reactions.length === 0) {
      bar?.remove();
      return;
    }
    if (bar) {
      updateReactionBar(bar, reactions);
    } else {
      el.appendChild(createReactionBar(reactions));
    }
  }

  /**
  /**
   * Scroll to a message by event ID and briefly highlight it.
   * No-ops silently if the event ID is not in the rendered timeline.
   */
  scrollToMessage(eventId: string): boolean {
    // Look up first in the buffer — extend the rendered window if the message
    // is in `_messages` but outside `[_renderStart, _renderEnd)`.
    const idx = this._messages.findIndex((m) => m.id === eventId);
    if (idx < 0) return false;
    this._ensureInWindow(idx);

    const el = this.getMessageElementById(eventId);
    if (!el) return false;
    el.scrollIntoView({ block: "center" });
    // Synchronously update scroll state from the new scrollTop. WebKit fires the
    // scroll event asynchronously, so if we leave it stale, appendMessage or the
    // stick observer could see the old value and call _scrollToBottom(),
    // overriding the position we just set. A jump targets a specific message,
    // not the tail — disengage stick.
    this._scrolledUp = this._distanceFromBottom > 40;
    this._stickToBottom = false;
    this._prevScrollTop = this._el.scrollTop;
    this._updateJumpToLatestVisibility();
    // Select the message so keyboard navigation (j/k, r, e, etc.) targets it.
    this._setSelected(idx);
    el.classList.remove("message--highlight"); // reset if re-triggered
    // Force reflow so re-adding the class actually restarts the animation
    void el.offsetWidth;
    el.classList.add("message--highlight");
    el.addEventListener("animationend", () => el.classList.remove("message--highlight"), { once: true });
    return true;
  }

  /**
   * Increment (or create) the thread reply count indicator on a thread root
   * message. Called when a thread reply arrives via sync or optimistic send.
   */
  incrementThreadReplyCount(threadRootEventId: string): void {
    const el = this.getMessageElementById(threadRootEventId);
    if (!el) return;

    let indicator = el.querySelector<HTMLButtonElement>(".message__thread-indicator");
    if (indicator) {
      const match = indicator.textContent?.match(/(\d+)/);
      const count = match ? parseInt(match[1], 10) + 1 : 1;
      indicator.textContent = `⌥ ${count} repl${count === 1 ? "y" : "ies"}`;
    } else {
      // First reply to this message — create the indicator
      indicator = document.createElement("button");
      indicator.className = "message__thread-indicator";
      indicator.setAttribute("tabindex", "0");
      indicator.title = "Open thread (t)";
      indicator.textContent = "⌥ 1 reply";
      indicator.addEventListener("click", (e) => {
        e.stopPropagation();
        el.dispatchEvent(
          new CustomEvent("quark:open-thread", {
            bubbles: true,
            detail: { eventId: threadRootEventId },
          })
        );
      });
      const actionsDiv = el.querySelector<HTMLElement>(".message__actions");
      if (actionsDiv) {
        el.insertBefore(indicator, actionsDiv);
      } else {
        el.appendChild(indicator);
      }
    }
  }

  /** Returns the last message-group-wrapper element, or null. */
  getLastGroupWrapper(): HTMLElement | null {
    const last = this._listEl.lastElementChild;
    return last?.classList.contains("message-group-wrapper") ? (last as HTMLElement) : null;
  }

  /**
   * Returns the element that was most recently appended via appendMessageHidden.
   * For a new group this is the .message-group-wrapper; for a merge it's the
   * .message inside the existing group. Used by the send animation to aim the
   * flying clone at the correct target.
   */
  getLastHiddenEl(): HTMLElement | null {
    return this._lastHiddenEl;
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private _updateJumpToLatestVisibility(): void {
    const visible = this._inContextView || this._scrolledUp;
    this._jumpToLatestBtn.style.display = visible ? "block" : "none";
  }

  private _setSelected(index: number): void {
    // Remove previous highlight
    if (this._selectedIndex >= 0) {
      const prev = this._getMessageElement(this._selectedIndex);
      if (prev) {
        prev.classList.remove("message--selected");
        const prevGroup = prev.closest<HTMLElement>(".message-group");
        if (prevGroup) prevGroup.classList.remove("message-group--selected");
      }
    }

    this._selectedIndex = index;

    if (index < 0) return;

    // Ensure the target index is in the rendered window — extend if needed.
    // This lets keyboard navigation (j/k) cross window boundaries naturally.
    this._ensureInWindow(index);

    const el = this._getMessageElement(index);
    if (el) {
      el.classList.add("message--selected");
      const group = el.closest<HTMLElement>(".message-group");
      if (group) group.classList.add("message-group--selected");
      this._scrollIntoViewWithScrolloff(el);
    }
  }

  /**
   * Scroll the selected message element into view with a "scrolloff" margin,
   * similar to vim's scrolloff option. Ensures the target element has at least
   * SCROLLOFF_PX of padding on the near edge within the scrollable container,
   * so the selected message is never flush against the viewport edge.
   * If the element is already fully within the scrolloff zone, no scroll occurs.
   */
  private _scrollIntoViewWithScrolloff(el: HTMLElement): void {
    const SCROLLOFF_PX = 80; // ~2-3 message rows of padding
    const containerRect = this._el.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();

    const topEdge = elRect.top - containerRect.top;
    const bottomEdge = elRect.bottom - containerRect.top;
    const containerHeight = containerRect.height;

    if (topEdge < SCROLLOFF_PX) {
      // Element is too close to (or above) the top — scroll up
      this._el.scrollTop -= SCROLLOFF_PX - topEdge;
    } else if (bottomEdge > containerHeight - SCROLLOFF_PX) {
      // Element is too close to (or below) the bottom — scroll down
      this._el.scrollTop += bottomEdge - (containerHeight - SCROLLOFF_PX);
    }
    // If already within the scrolloff zone, no adjustment needed
  }

  /** Find the DOM element for a message by its index in _messages. */
  private _getMessageElement(index: number): HTMLElement | null {
    if (index < 0 || index >= this._messages.length) return null;
    const id = this._messages[index].id;
    return this._listEl.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
  }

  /**
   * Insert a `── NEW ──` separator in the DOM before the first unread message.
   * Relies on `_unreadCount` and the rendered `[data-message-id]` elements.
   */
  private _insertUnreadSeparator(): void {
    if (this._unreadCount <= 0 || this._messages.length === 0) return;
    // Remove any stale separator from a previous load
    this._listEl.querySelector(".unread-separator")?.remove();

    const firstUnreadIndex = Math.max(0, this._messages.length - this._unreadCount);
    // If the unread region falls entirely outside the rendered window, extend
    // the window backward so the separator can be anchored to a real DOM node.
    if (firstUnreadIndex < this._renderStart) {
      this._renderStart = Math.max(0, firstUnreadIndex - Timeline.RENDER_CHUNK);
      this._renderAll();
    }
    const firstUnreadMsg = this._messages[firstUnreadIndex];
    if (!firstUnreadMsg) return;

    const msgEl = this._listEl.querySelector<HTMLElement>(
      `[data-message-id="${firstUnreadMsg.id}"]`
    );
    if (!msgEl) return;

    // The message element lives inside a .message-group or .message--ungrouped.
    // Insert the separator before whichever top-level node contains the message.
    let insertBefore: HTMLElement = msgEl;
    while (insertBefore.parentElement && insertBefore.parentElement !== this._listEl) {
      insertBefore = insertBefore.parentElement;
    }

    const sep = document.createElement("div");
    sep.className = "unread-separator";
    sep.setAttribute("role", "separator");
    sep.setAttribute("aria-label", "New messages");
    sep.textContent = "── new messages ──";
    this._listEl.insertBefore(sep, insertBefore);
  }

  private _renderAll(): void {
    revokeActiveBlobUrls();
    // Detach the inline thread panel before rebuilding so it can survive the
    // re-render and be re-anchored if its root is still in the rendered window.
    const savedThread = this._inlineThreadEl;
    if (savedThread && savedThread.parentElement === this._listEl) {
      savedThread.remove();
    }
    this._listEl.innerHTML = "";
    const slice = this._messages.slice(this._renderStart, this._renderEnd);
    const groups = groupMessages(slice);
    const fragment = document.createDocumentFragment();
    for (const entry of groups) {
      if (Array.isArray(entry)) {
        fragment.appendChild(buildMessageGroup(entry));
      } else if ("type" in entry && entry.type === "time-separator") {
        fragment.appendChild(buildTimeSeparator(entry.timestamp));
      } else {
        // Ungrouped (system) message
        const el = buildMessageElement(entry as MessageData);
        el.classList.add("message--ungrouped");
        fragment.appendChild(el);
      }
    }
    this._listEl.appendChild(fragment);

    // Re-anchor the inline thread panel if its root is still in the window.
    if (savedThread && this._inlineThreadRootId) {
      const rootEl = this.getMessageElementById(this._inlineThreadRootId);
      const anchor =
        rootEl?.closest<HTMLElement>(".message-group-wrapper") ??
        rootEl?.closest<HTMLElement>(".message--ungrouped");
      if (anchor) {
        anchor.insertAdjacentElement("afterend", savedThread);
      }
      // If the root is no longer in the rendered window, leave the panel
      // detached — it stays in memory and reattaches when the window is
      // extended back over the root.
    }

    // Restore selected highlight on the rendered element if still in window.
    if (this._selectedIndex >= this._renderStart && this._selectedIndex < this._renderEnd) {
      const el = this._getMessageElement(this._selectedIndex);
      if (el) {
        el.classList.add("message--selected");
        const group = el.closest<HTMLElement>(".message-group");
        if (group) group.classList.add("message-group--selected");
      }
    }

    // Re-decorate read-receipt avatars — the rebuild above wiped any from the
    // previous render. State lives outside the DOM so this is the only re-attach
    // point for the full-render paths (setMessages, cull, ensureInWindow).
    this._renderReceipts();
  }

  private _scrollToBottom(): void {
    // column-reverse: the live tail is scrollTop 0.
    this._el.scrollTop = 0;
    this._scrolledUp = false;
    this._stickToBottom = true;
    this._prevScrollTop = 0;
    this._updateJumpToLatestVisibility();
  }

  /** Distance in px from the live tail (bottom). 0 = pinned to the newest message.
   *  Under `flex-direction: column-reverse` scrollTop is 0 at the bottom and goes
   *  negative scrolling up, so distance-from-bottom is simply -scrollTop. */
  private get _distanceFromBottom(): number {
    return -this._el.scrollTop;
  }

  /** Distance in px from the oldest rendered message (top). 0 = at the very top. */
  private get _distanceFromTop(): number {
    return this._el.scrollHeight - this._el.clientHeight + this._el.scrollTop;
  }

  /** Build a DocumentFragment of grouped message DOM for `msgs`. Shared by
   *  prepend/append/extend; grouping is computed over the given slice only, so a
   *  group split across a chunk boundary may show an extra sender header at the
   *  seam (same long-standing behaviour as prependMessages). */
  private _buildGroupedFragment(msgs: MessageData[]): DocumentFragment {
    const groups = groupMessages(msgs);
    const fragment = document.createDocumentFragment();
    for (const entry of groups) {
      if (Array.isArray(entry)) {
        fragment.appendChild(buildMessageGroup(entry));
      } else if ("type" in entry && entry.type === "time-separator") {
        fragment.appendChild(buildTimeSeparator(entry.timestamp));
      } else {
        const el = buildMessageElement(entry as MessageData);
        el.classList.add("message--ungrouped");
        fragment.appendChild(el);
      }
    }
    return fragment;
  }

  /** First message element visible from the top of the viewport, with its offset
   *  relative to the scroll container's top edge. Used for cull re-anchoring. */
  private _firstVisibleMessage(): { id: string; top: number } | null {
    const containerTop = this._el.getBoundingClientRect().top;
    const els = this._listEl.querySelectorAll<HTMLElement>("[data-message-id]");
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.bottom > containerTop) {
        return { id: el.dataset.messageId!, top: r.top - containerTop };
      }
    }
    return null;
  }

  /** Current viewport-relative top of a message by id, or null if not rendered. */
  private _viewportTopOf(id: string): number | null {
    const el = this.getMessageElementById(id);
    if (!el) return null;
    return el.getBoundingClientRect().top - this._el.getBoundingClientRect().top;
  }

  // ── Windowed rendering ───────────────────────────────────────────────────

  private _handleScrollNearTop(): void {
    if (this._renderStart > 0) {
      // More buffered (already-fetched) history to render. Inserting a chunk at
      // the top is anchored by `column-reverse` with no scrollTop write, so it
      // stays smooth under a fast fling — no momentum to fight.
      this._extendWindowUp();
    } else {
      // Reached the oldest rendered message: a real server fetch starts. The
      // prepend that follows inserts at the top and is anchored by `column-reverse`
      // with no scrollTop write — nothing for WebKit's momentum engine to clobber.
      this._onScrollTopCallback?.();
    }
  }

  private _handleScrollNearBottom(): void {
    if (this._renderEnd < this._messages.length) {
      this._extendWindowDown();
    } else if (this._inContextView) {
      this._onScrollBottomCallback?.();
    }
  }

  /** Render an additional chunk of older messages from the buffer at the top of
   *  the DOM. Incremental (insertBefore, no teardown) so `column-reverse` anchors
   *  the bottom and the viewport stays put with no scrollTop write — the up
   *  direction is clobber-free. The over-cap trim is deferred to settle. */
  private _extendWindowUp(): void {
    const newStart = Math.max(0, this._renderStart - Timeline.RENDER_CHUNK);
    if (newStart === this._renderStart) return;
    const added = this._messages.slice(newStart, this._renderStart);
    this._renderStart = newStart;
    this._listEl.insertBefore(this._buildGroupedFragment(added), this._listEl.firstChild);
    // Newly-rendered older messages may be a receipt target — re-decorate.
    this._renderReceipts();
    this._scheduleCull();
  }

  /** Render an additional chunk of newer messages at the bottom of the DOM. This
   *  is the DOWN direction: under `column-reverse` appending at the bottom would
   *  make the viewport follow the new tail, so we compensate scrollTop by the
   *  added height to keep the reading position fixed (the rare, agreed-upon write
   *  — only happens in context-view forward scrolling). The over-cap trim is
   *  deferred to settle. */
  private _extendWindowDown(): void {
    const newEnd = Math.min(this._messages.length, this._renderEnd + Timeline.RENDER_CHUNK);
    if (newEnd === this._renderEnd) return;
    const added = this._messages.slice(this._renderEnd, newEnd);
    this._renderEnd = newEnd;
    const oldH = this._el.scrollHeight;
    this._listEl.appendChild(this._buildGroupedFragment(added));
    this._el.scrollTop -= this._el.scrollHeight - oldH;
    this._prevScrollTop = this._el.scrollTop;
    // Receipt containers are position:absolute (out of flow), so decorating here
    // can't perturb the scrollTop compensation above.
    this._renderReceipts();
    this._scheduleCull();
  }

  /** Trim the rendered window back to MAX_RENDERED once the scroll has settled.
   *
   *  Culling removes DOM nodes; trimming the *bottom* (newest rendered, the side
   *  that grows when paging history up) needs a scrollTop write to stay anchored
   *  under `column-reverse`, which WebKit momentum would clobber mid-fling. So we
   *  never cull during an active fling — the window may briefly exceed the cap,
   *  which is pure DOM-size housekeeping, not correctness. A debounced timer runs
   *  the trim only after scrolling goes quiet (no scroll event for ~120ms). */
  private _scheduleCull(): void {
    if (typeof setTimeout === "undefined") return;
    if (this._cullTimer !== null) clearTimeout(this._cullTimer);
    this._cullTimer = setTimeout(() => {
      this._cullTimer = null;
      this._cullWindow();
    }, 120);
  }

  /** Trim the window to MAX_RENDERED, centered on the message at the top of the
   *  viewport, re-rendering once and re-anchoring on that pivot. Runs only at
   *  settle (see _scheduleCull), so the scrollTop restore is safe from momentum. */
  private _cullWindow(): void {
    if (this._renderEnd - this._renderStart <= Timeline.MAX_RENDERED) return;
    // Anchor on the message currently at the top of the viewport so its on-screen
    // position is preserved across the rebuild.
    const pivot = this._firstVisibleMessage();
    const pivotIdx = pivot ? this._messages.findIndex((m) => m.id === pivot.id) : -1;

    const half = Math.floor(Timeline.MAX_RENDERED / 2);
    const center = pivotIdx >= 0 ? pivotIdx : this._renderStart;
    let newStart = Math.max(0, center - half);
    let newEnd = Math.min(this._messages.length, newStart + Timeline.MAX_RENDERED);
    newStart = Math.max(0, newEnd - Timeline.MAX_RENDERED);
    if (newStart === this._renderStart && newEnd === this._renderEnd) return;

    this._renderStart = newStart;
    this._renderEnd = newEnd;
    this._renderAll();

    // Re-anchor: nudge scrollTop so the pivot returns to its previous on-screen
    // offset. Safe to write — we're idle (this only runs at settle).
    if (pivot) {
      const after = this._viewportTopOf(pivot.id);
      if (after !== null) {
        this._el.scrollTop += after - pivot.top;
        this._prevScrollTop = this._el.scrollTop;
      }
    }
  }

  /** Ensure `idx` (a position in the full buffer) is within the rendered window.
   *  If not, set the window to include it (plus a margin), capped at MAX_RENDERED,
   *  and re-render. The caller positions the viewport afterward (scrollIntoView),
   *  so no scroll compensation is done here. Returns true if the window changed. */
  private _ensureInWindow(idx: number): boolean {
    if (idx < 0 || idx >= this._messages.length) return false;
    if (idx >= this._renderStart && idx < this._renderEnd) return false;

    const margin = Timeline.RENDER_CHUNK;
    if (idx < this._renderStart) {
      this._renderStart = Math.max(0, idx - margin);
      this._renderEnd = Math.min(this._messages.length, this._renderStart + Timeline.MAX_RENDERED);
    } else {
      this._renderEnd = Math.min(this._messages.length, idx + 1 + margin);
      this._renderStart = Math.max(0, this._renderEnd - Timeline.MAX_RENDERED);
    }
    this._renderAll();
    return true;
  }

  /**
   * Instant scroll to bottom (so layout is accurate for measurements) with a
   * visual counter-animation that hides the jump. The transform is deferred to
   * the next rAF so that callers can still call getBoundingClientRect() on
   * newly appended elements in the same synchronous execution context and get
   * accurate positions.
   */
  private _scrollAnimated(): void {
    const prevScrollTop = this._el.scrollTop;
    // column-reverse: the live tail is scrollTop 0. `delta` is how far we jumped
    // (prevScrollTop is negative when scrolled up, so 0 - prev > 0).
    this._el.scrollTop = 0;
    this._scrolledUp = false;
    this._stickToBottom = true;
    this._prevScrollTop = 0;
    const delta = -prevScrollTop;
    if (delta <= 0) return;

    // Defer the visual counter-offset so measurements in the current frame are clean
    requestAnimationFrame(() => {
      this._listEl.style.transition = "none";
      this._listEl.style.transform = `translateY(${delta}px)`;
      requestAnimationFrame(() => {
        this._listEl.style.transition = "transform 260ms cubic-bezier(0.25, 0.46, 0.45, 0.94)";
        this._listEl.style.transform = "translateY(0)";
      });
      if (this._scrollAnimCleanupTimer !== null) clearTimeout(this._scrollAnimCleanupTimer);
      this._scrollAnimCleanupTimer = setTimeout(() => {
        this._scrollAnimCleanupTimer = null;
        this._listEl.style.transition = "";
        this._listEl.style.transform = "";
      }, 300);
    });
  }
}
