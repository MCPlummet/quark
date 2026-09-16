// Rendering a message body: the `formatted_body` HTML path and the MSC2530
// media caption that sits beneath an image.
//
// Neither belongs to Timeline or ThreadView — both surfaces render both, and
// while these lived in Timeline the thread panels imported one of them across a
// circular edge and reimplemented the other. Keeping them here is what lets a
// change to escaping, spoilers or emoji resolution land on every surface at once
// rather than on whichever one the author had open.

import { decorateMessageLinks } from "../app/links.js";

/**
 * Activate Matrix spoilers (MSC2010 / `data-mx-spoiler`) inside a freshly
 * rendered message body. The server-supplied HTML already contains
 * `<span data-mx-spoiler[="reason"]>…</span>`; on its own that renders as plain
 * text. Here we obscure each spoiler (the CSS `.message__spoiler` rule blurs it)
 * and reveal it on click/tap. An optional reason is exposed as a tooltip.
 */
export function setupSpoilers(container: HTMLElement): void {
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

/**
 * Render a message's `formatted_body` HTML into `el`.
 *
 * Three places did this inline and each did a little less than the last — the
 * inline thread panel skipped the mxc:// stash entirely, so a custom emoji there
 * kept an unloadable `mxc://` src and drew a broken-image icon. Captions are a
 * fourth caller (#84), which is what made a fourth copy worth not writing.
 *
 * The stash is the point: a custom-emoji `<img>` arrives with an `mxc://` src no
 * browser can load, so the URL moves to `data-mxc` and the src goes away until
 * `_downloadInlineEmoji` swaps in a `data:` URL. `getPendingInlineEmojiUrls`
 * queries the whole list element, so anything rendered *into it* is covered —
 * but only once something runs the resolver. Every path that renders bodies has
 * to call it: the thread panel renders into the list and still went without,
 * which left its custom emoji blank until an unrelated sync event in the room
 * happened to resolve them.
 */
export function renderFormattedBody(el: HTMLElement, html: string): void {
  // In production this must be sanitized server-side or with DOMPurify; for the
  // UI shell we accept pre-trusted HTML.
  el.innerHTML = html;
  for (const img of el.querySelectorAll<HTMLImageElement>("img[data-mx-emoticon]")) {
    const src = img.getAttribute("src") ?? img.src;
    if (src.startsWith("mxc://")) {
      img.dataset.mxc = src;
      img.removeAttribute("src");
    }
  }
  // Give anchors from formatted_body the same class, rel and tooltip the
  // linkifier gives bare URLs (#51), and strip non-http hrefs so nothing can
  // navigate the WebView. Activation goes through the global link guard in
  // app/links.ts, so no per-anchor listener is attached here.
  decorateMessageLinks(el);
  setupSpoilers(el);
}

/**
 * Render a media caption (MSC2530) beneath the media it belongs to.
 *
 * No-op when the event carried no caption — a bare-filename body is not one.
 * `bodyClass` is the caller's own message-body class; the shared
 * `message__image-caption` rides alongside it so every surface matches.
 *
 * A caption with a `formatted_body` renders as HTML, which is where an inline
 * custom emoji actually lives. Before that this set `textContent`, so a caption
 * using a custom emoji showed the literal `:shortcode:` — including captions
 * Quark itself had just sent.
 */
export function appendCaption(
  row: HTMLElement,
  bodyClass: string,
  caption?: string,
  captionHtml?: string,
): void {
  if (!caption) return;
  const el = document.createElement("div");
  el.className = `${bodyClass} message__image-caption`;
  if (captionHtml) {
    renderFormattedBody(el, captionHtml);
  } else {
    el.textContent = caption;
  }
  row.appendChild(el);
}

/**
 * Build the click-to-open affordance for an `m.file` message.
 *
 * Lives here for the same reason the caption does: every surface that renders a
 * message renders files too. It stayed in Timeline while only the main timeline
 * could receive one, and when #78 let a file be sent into a thread both thread
 * renderers fell through to their text branch and drew the filename as an inert
 * line — no icon, no way to open it, before and after a reload.
 *
 * Opening is left to whoever handles the `quark:open-file` event it bubbles
 * (`media.ts` listens on `document`), so this stays free of IPC.
 */
export function buildFileAffordance(
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
