// Notification toast system — stacks temporary messages on screen

import { mountOverlay } from "./overlay.js";

export type ToastType = "info" | "error" | "success";

interface ToastOptions {
  message: string;
  type?: ToastType;
  /** Duration in milliseconds before auto-dismiss. Default: 3000. */
  duration?: number;
}

interface ToastEntry {
  el: HTMLElement;
  timerId: ReturnType<typeof setTimeout>;
}

// ── Container (singleton, lazily mounted) ──────────────────────────────────────

let _container: HTMLElement | null = null;
const _active: Set<ToastEntry> = new Set();

function _getContainer(): HTMLElement {
  if (_container) return _container;

  _container = document.createElement("div");
  _container.className = "toast-container";
  _container.setAttribute("role", "log");
  _container.setAttribute("aria-live", "polite");
  _container.setAttribute("aria-label", "Notifications");
  mountOverlay(_container);

  return _container;
}

// ── Core dismiss logic ────────────────────────────────────────────────────────

function _dismiss(entry: ToastEntry): void {
  if (!_active.has(entry)) return;

  clearTimeout(entry.timerId);
  _active.delete(entry);

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

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Display a toast notification.
 *
 * @param message  Text to display.
 * @param type     Visual style: "info" (default), "error", or "success".
 * @param duration Milliseconds before auto-dismiss. Default: 3000.
 */
export function showToast(
  message: string,
  type: ToastType = "info",
  duration: number = 3000
): void {
  const container = _getContainer();

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

  // ── Dismiss button ─────────────────────────────────────────────────────────
  const closeBtn = document.createElement("button");
  closeBtn.className = "toast__close";
  closeBtn.setAttribute("aria-label", "Dismiss notification");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", () => _dismiss(entry));
  el.appendChild(closeBtn);

  container.appendChild(el);

  const timerId = setTimeout(() => _dismiss(entry), duration);
  const entry: ToastEntry = { el, timerId };
  _active.add(entry);

  // Allow click anywhere on the toast to dismiss it early
  el.addEventListener("click", () => _dismiss(entry));
}

/** Convenience wrappers */
export function showError(message: string, duration?: number): void {
  showToast(message, "error", duration);
}

export function showSuccess(message: string, duration?: number): void {
  showToast(message, "success", duration);
}

/** Dismiss all currently visible toasts immediately. */
export function clearToasts(): void {
  for (const entry of Array.from(_active)) {
    _dismiss(entry);
  }
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
