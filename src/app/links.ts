import { invoke } from "../ipc/invoke.js";
import { isMobile } from "./mobile.js";

/**
 * Open an external URL in the system browser.
 *
 * We route through our own `open_external_url` backend command rather than
 * `plugin:shell|open` directly because the shell plugin's mobile JS surface
 * is broken on iOS and Android — the Swift/Kotlin handlers call
 * `parseArgs(String)` expecting a raw JSON string, but the standard JS
 * invocation sends `{ path, with }`, which fails to decode and silently
 * no-ops every tap. The Rust-side `Shell::open` API serializes the URL
 * correctly, so we wrap it.
 *
 * Falls back to `window.open` only when not running under Tauri (browser
 * dev mode).
 */
export function openExternalUrl(url: string): void {
  if (!isExternalHref(url)) return;
  void invoke("open_external_url", { url }).catch((err) => {
    console.warn("open_external_url failed, falling back to window.open:", err);
    window.open(url, "_blank", "noopener,noreferrer");
  });
}

// ── Message links ─────────────────────────────────────────────────────────────

/**
 * Class applied to every anchor we render inside message content. It carries
 * the underline / accent colour from `base.css`. Both the plain-text
 * linkifier and the `formatted_body` HTML path go through here so that
 * `[text](url)` markdown links look identical to bare URLs (#51 — hyperlinked
 * text was unstyled because only the linkifier set the class).
 */
export const MESSAGE_LINK_CLASS = "message__link";

/** http/https only — everything else is neutralised rather than opened. */
export function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

/**
 * Apply Quark's link presentation to an anchor: styling class, safe `rel`,
 * a tooltip showing the destination, and (mobile only) `target="_blank"`.
 *
 * No click handler is attached — activation is handled once, globally, by
 * `installLinkGuard()` below. Attaching per-anchor handlers as well would
 * open every link twice.
 *
 * `target="_blank"` is set on mobile only: the mobile WebView needs it to
 * register taps as a real link, but on desktop wry opens `_blank` URLs in the
 * system browser by itself, which — alongside our own `openExternalUrl()` —
 * opened every link twice (see Timeline.links.test.ts).
 */
export function styleMessageLink(a: HTMLAnchorElement, url: string): void {
  a.classList.add(MESSAGE_LINK_CLASS);
  if (isMobile()) a.target = "_blank";
  a.rel = "noopener noreferrer";
  if (!a.title) a.title = url;
}

/** Build a styled anchor for `url` (label defaults to the URL itself). */
export function createMessageLink(url: string, label?: string): HTMLAnchorElement {
  const a = document.createElement("a");
  a.href = url;
  a.textContent = label ?? url;
  styleMessageLink(a, url);
  return a;
}

/**
 * Walk `container` for anchors produced by rendered `formatted_body` HTML and
 * bring them in line with the linkifier's output: external ones get the link
 * styling, everything else (`javascript:`, relative, `mailto:` …) is stripped
 * of its href so it cannot navigate the WebView.
 *
 * Idempotent — safe to call again on a subtree that has already been wired.
 */
export function decorateMessageLinks(container: ParentNode): void {
  for (const a of Array.from(container.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const href = a.getAttribute("href") ?? "";
    if (isExternalHref(href)) {
      styleMessageLink(a, href);
    } else {
      a.removeAttribute("href");
      a.setAttribute("role", "link");
      a.style.cursor = "pointer";
    }
  }
}

const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/g;

/**
 * Render plain text with http/https URLs as clickable anchor elements.
 * Splits the text on URL boundaries and appends text nodes + <a> tags.
 */
export function appendLinkifiedText(container: HTMLElement, text: string): void {
  let last = 0;
  let match: RegExpExecArray | null;
  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > last) {
      container.appendChild(document.createTextNode(text.slice(last, match.index)));
    }
    const url = match[0].replace(/[.,;:!?]+$/, ""); // strip trailing punctuation
    container.appendChild(createMessageLink(url));
    last = match.index + url.length;
  }
  if (last < text.length) {
    container.appendChild(document.createTextNode(text.slice(last)));
  }
}

// ── Global activation guard ───────────────────────────────────────────────────

/**
 * One document-level guard handles *every* anchor activation in the app, no
 * matter which component created it — timeline bodies, thread views, edited
 * messages, URL preview cards. Anchors are minted in half a dozen places, so
 * per-anchor listeners kept missing cases: middle-clicking a link navigated
 * the WebView away from the chat UI, leaving Quark showing a web page with no
 * way back (#46).
 *
 * Handled events:
 *  - `mousedown` (button 1): cancels the engine's default middle-click
 *    behaviour (autoscroll / begin-navigation) before it starts.
 *  - `auxclick` (button 1): middle click — same treatment as a left click.
 *  - `click` (button 0): primary activation, including touch taps.
 *
 * Listeners are registered in the capture phase so we win before any
 * component handler, and modifier keys are deliberately ignored: ctrl/cmd
 * "open in new tab" has no meaning in a single-window WebView, so every
 * variation of "activate this link" ends up in the system browser.
 */
function findExternalAnchor(e: Event): { anchor: HTMLAnchorElement; href: string } | null {
  const target = e.target as Element | null;
  if (!target || typeof target.closest !== "function") return null;
  const anchor = target.closest<HTMLAnchorElement>("a[href]");
  if (!anchor) return null;
  // Download affordances (e.g. the image lightbox's save button) must keep
  // their native behaviour.
  if (anchor.hasAttribute("download")) return null;
  const href = anchor.getAttribute("href") ?? "";
  if (!isExternalHref(href)) return null;
  return { anchor, href };
}

function onLinkMouseDown(e: MouseEvent): void {
  if (e.button !== 1) return; // middle button only
  if (!findExternalAnchor(e)) return;
  // Stops autoscroll and, in engines that start the navigation here, the
  // navigation itself. The actual open happens on auxclick.
  e.preventDefault();
}

function onLinkActivate(e: MouseEvent): void {
  if (e.defaultPrevented) return;
  // `click` fires with button 0 for both mouse and touch; `auxclick` carries
  // the non-primary button. Anything else (right click → context menu) is
  // left alone.
  const wanted = e.type === "auxclick" ? 1 : 0;
  if (typeof e.button === "number" && e.button !== wanted) return;
  const hit = findExternalAnchor(e);
  if (!hit) return;
  e.preventDefault();
  openExternalUrl(hit.href);
}

const GUARD_FLAG = "__quarkLinkGuardInstalled";

/**
 * Install the global link guard. Idempotent; safe to call from anywhere.
 *
 * Called at module load below rather than from `main.ts` so that *any* entry
 * point which can render a link (the app, a test, a future secondary window)
 * gets the guard simply by depending on this module.
 */
export function installLinkGuard(): void {
  if (typeof document === "undefined") return;
  const flagged = document as unknown as Record<string, unknown>;
  if (flagged[GUARD_FLAG]) return;
  flagged[GUARD_FLAG] = true;
  document.addEventListener("mousedown", onLinkMouseDown, true);
  document.addEventListener("auxclick", onLinkActivate, true);
  document.addEventListener("click", onLinkActivate, true);
}

installLinkGuard();
