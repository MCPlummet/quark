// Notification toast system — one temporary message on screen at a time

import { mountOverlay } from "./overlay.js";
import { viewportPan } from "../app/mobile.js";

export type ToastType = "info" | "error" | "success";

/**
 * How a toast interacts with the one already on screen.
 *
 * Only one toast is ever visible (#126): a stack of them covered the compose
 * bar on mobile and, given enough incoming messages, the whole window. So each
 * new toast has to decide what happens to the current one.
 */
export interface ToastOptions {
  /**
   * Ambient toasts sharing a group — incoming-message notifications — replace
   * one another in place and keep a running "(+N more)" count rather than
   * queueing. An ambient toast never displaces a status toast (an error, a
   * "saved"): those answer something the user just did, while a message
   * notification is already carried by the room list's unread badge.
   *
   * Among status toasts, an `info` never displaces a visible `error` either:
   * an incidental notice ("Checking for updates…") must not wipe a failure the
   * user has not had time to read. Errors and successes replace anything.
   */
  group?: string;
}

interface ToastEntry {
  el: HTMLElement;
  type: ToastType;
  timerId: ReturnType<typeof setTimeout>;
  group?: string;
  /** How many toasts this one stands for (grouped toasts only). */
  count: number;
}

// ── Container (singleton, lazily mounted) ──────────────────────────────────────

let _container: HTMLElement | null = null;
/** The one visible toast, if any. A leaving toast is no longer current. */
let _current: ToastEntry | null = null;

function _getContainer(): HTMLElement {
  if (_container) return _container;

  _container = document.createElement("div");
  _container.className = "toast-container";
  _container.setAttribute("role", "log");
  _container.setAttribute("aria-live", "polite");
  _container.setAttribute("aria-label", "Notifications");
  mountOverlay(_container);

  // The compose bar moves when the keyboard opens or the window is resized;
  // keep a visible toast parked above it rather than wherever it was when shown.
  const reposition = (): void => { if (_current) _placeAboveBottomBar(); };
  window.addEventListener("resize", reposition);
  window.visualViewport?.addEventListener("resize", reposition);

  return _container;
}

/**
 * The bottom-anchored strips a toast parks above: the compose bar, and the
 * image viewer's toolbar while the viewer is open — it covers the compose bar,
 * and its save buttons are what raise the "Saving…" toast in the first place.
 */
const BOTTOM_BARS = ".input-bar-wrap, .image-lightbox--open .image-lightbox__toolbar";

/**
 * Park the container just above the compose bar (or the image viewer's
 * toolbar), so a toast never covers the field the user is typing in or the
 * buttons they just pressed (#126). The top edge is no better — it holds the
 * mobile top bar and the room header — but the timeline between the two is
 * reading space, and a few seconds of it is the cheapest thing to cover.
 *
 * Where no such bar is showing (the mobile room list, the login screen) the
 * stylesheet's own bottom inset applies.
 */
function _placeAboveBottomBar(): void {
  if (!_container) return;
  let top = Infinity;
  for (const bar of document.querySelectorAll<HTMLElement>(BOTTOM_BARS)) {
    const rect = bar.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue; // hidden
    if (_isCovered(bar, rect)) continue;
    top = Math.min(top, rect.top);
  }
  if (!Number.isFinite(top)) {
    _container.style.removeProperty("--toast-bottom");
    return;
  }
  // Client rects are layout-viewport space with the iOS keyboard pan included,
  // while the overlay layer is translated by that same pan (ui/overlay.ts) —
  // subtract it or the toast lands a pan too high.
  const layoutHeight = document.documentElement.clientHeight || window.innerHeight;
  const bottom = Math.max(0, layoutHeight - (top - viewportPan())) + 8;
  _container.style.setProperty("--toast-bottom", `${bottom}px`);
}

/**
 * Whether something else is drawn over the bar — the mobile room-list drawer
 * slides over a room whose compose bar keeps its full rect, and the image viewer
 * covers it outright. Parking above a bar the user cannot see would float the
 * toast mid-drawer for no reason.
 */
function _isCovered(bar: HTMLElement, rect: DOMRect): boolean {
  if (typeof document.elementFromPoint !== "function") return false;
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  // The toast container itself lets pointer events through, so it is never the hit.
  return hit !== null && !bar.contains(hit);
}

// ── Core dismiss logic ────────────────────────────────────────────────────────

function _dismiss(entry: ToastEntry): void {
  if (_current !== entry) return;

  clearTimeout(entry.timerId);
  _current = null;

  entry.el.classList.add("toast--leaving");

  // Wait for CSS transition to finish before removing from DOM
  entry.el.addEventListener(
    "animationend",
    () => {
      entry.el.remove();
    },
    { once: true }
  );

  // Fallback removal in case animationend never fires (no CSS animations)
  setTimeout(() => entry.el.remove(), 400);
}

/** Drop the current toast at once, with no exit animation, to make way. */
function _replaceCurrent(): void {
  if (!_current) return;
  clearTimeout(_current.timerId);
  _current.el.remove();
  _current = null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Display a toast notification, replacing whatever toast is showing (see
 * {@link ToastOptions} for the one case where the new toast yields instead).
 *
 * @param message  Text to display.
 * @param type     Visual style: "info" (default), "error", or "success".
 * @param duration Milliseconds before auto-dismiss. Default: 3000.
 * @returns Dismisses this toast, and only this one — a no-op once another has
 *          replaced it.
 */
export function showToast(
  message: string,
  type: ToastType = "info",
  duration: number = 3000,
  options: ToastOptions = {}
): () => void {
  const { group } = options;
  let count = 1;
  if (_current) {
    if (group !== undefined && _current.group === group) {
      count = _current.count + 1;
    } else if (group !== undefined && _current.group === undefined) {
      return () => {}; // ambient toasts never displace a status toast
    } else if (type === "info" && _current.group === undefined && _current.type === "error") {
      return () => {}; // nor does a passing notice displace an unread error
    }
    _replaceCurrent();
  }

  const container = _getContainer();
  _placeAboveBottomBar();

  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.setAttribute("role", "alert");
  el.setAttribute("aria-atomic", "true");

  // ── Icon prefix ────────────────────────────────────────────────────────────
  const icon = document.createElement("span");
  icon.className = "toast__icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = _iconFor(type);
  el.appendChild(icon);

  // ── Message text ───────────────────────────────────────────────────────────
  const text = document.createElement("span");
  text.className = "toast__message";
  text.textContent = message;
  el.appendChild(text);

  if (count > 1) {
    const more = document.createElement("span");
    more.className = "toast__more";
    more.textContent = ` (+${count - 1} more)`;
    text.appendChild(more);
  }

  // ── Dismiss button ─────────────────────────────────────────────────────────
  const closeBtn = document.createElement("button");
  closeBtn.className = "toast__close";
  closeBtn.setAttribute("aria-label", "Dismiss notification");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", () => _dismiss(entry));
  el.appendChild(closeBtn);

  container.appendChild(el);

  const timerId = setTimeout(() => _dismiss(entry), duration);
  const entry: ToastEntry = { el, type, timerId, group, count };
  _current = entry;

  // Allow click anywhere on the toast to dismiss it early
  el.addEventListener("click", () => _dismiss(entry));

  return () => _dismiss(entry);
}

/** Convenience wrappers */
export function showError(message: string, duration?: number): void {
  showToast(message, "error", duration);
}

export function showSuccess(message: string, duration?: number): void {
  showToast(message, "success", duration);
}

/** Dismiss the visible toast, if any. */
export function clearToasts(): void {
  if (_current) _dismiss(_current);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _iconFor(type: ToastType): string {
  switch (type) {
    case "error":   return "[!]";
    case "success": return "[✓]";
    case "info":
    default:        return "[i]";
  }
}
