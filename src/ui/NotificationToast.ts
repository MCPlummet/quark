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

/** Handle to a long-lived progress toast (e.g. an in-flight upload). */
export interface ProgressToast {
  /** Update the in-progress message text. */
  update(message: string): void;
  /** Swap to a success toast that then auto-dismisses. */
  succeed(message?: string): void;
  /** Swap to an error toast that then auto-dismisses. */
  fail(message: string): void;
  /** Remove immediately with no terminal state. */
  dismiss(): void;
}

// Braille spinner frames — fits the terminal aesthetic and stays monospace.
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Show a toast that spins indefinitely until resolved via the returned handle.
 * Used for operations with no progress signal (e.g. uploads — matrix-sdk 0.9
 * exposes no byte-level progress), so we show liveness rather than a fake %.
 */
export function showProgressToast(message: string): ProgressToast {
  const container = _getContainer();

  const el = document.createElement("div");
  el.className = "toast toast--info toast--progress";
  el.setAttribute("role", "status");
  el.setAttribute("aria-atomic", "true");

  const icon = document.createElement("span");
  icon.className = "toast__icon toast__spinner";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = SPINNER_FRAMES[0];
  el.appendChild(icon);

  const text = document.createElement("span");
  text.className = "toast__message";
  text.textContent = message;
  el.appendChild(text);

  container.appendChild(el);

  let frame = 0;
  const spinId = setInterval(() => {
    frame = (frame + 1) % SPINNER_FRAMES.length;
    icon.textContent = SPINNER_FRAMES[frame];
  }, 80);

  // No auto-dismiss while in progress; the dummy timer satisfies ToastEntry and
  // lets clearToasts() reap us if the app tears down mid-upload.
  const entry: ToastEntry = { el, timerId: setTimeout(() => {}, 0) };
  _active.add(entry);

  let done = false;
  const finishWith = (type: ToastType, finalMsg: string): void => {
    if (done) return;
    done = true;
    clearInterval(spinId);
    icon.classList.remove("toast__spinner");
    icon.textContent = _iconFor(type);
    el.classList.remove("toast--info", "toast--progress");
    el.classList.add(`toast--${type}`);
    text.textContent = finalMsg;
    clearTimeout(entry.timerId);
    entry.timerId = setTimeout(() => _dismiss(entry), 3000);
    el.addEventListener("click", () => _dismiss(entry));
  };

  return {
    update(msg) {
      if (!done) text.textContent = msg;
    },
    succeed(msg) {
      finishWith("success", msg ?? "Done");
    },
    fail(msg) {
      finishWith("error", msg);
    },
    dismiss() {
      if (done) return;
      done = true;
      clearInterval(spinId);
      _dismiss(entry);
    },
  };
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
