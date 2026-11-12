// User colors (#45): whose color is what, and painting it onto the page.
//
// A sender's color resolves as: this device's local override, else the color
// they published (`tel.quark.usercolor`), else none — and none means the
// theme, exactly as before. Painting only sets a `--user-color` custom
// property and a `data-user-color` attribute on an element that already
// exists; which of the three treatments shows (name, avatar outline, box
// border) is decided in CSS by root classes, so flipping a setting is a class
// change, not a re-render.
//
// Lookups are lazy and frugal: a sender is asked about once per session, the
// first time they're painted while a treatment is on, in one batched request
// per tick. The backend owns the cache, TTL and rate limit.

import type { UserColorsConfig } from "../ipc/app_config.js";
import { listenUserColors } from "../ipc/user_colors.js";
import { isLowContrast, normalizeHex } from "./user_color_math.js";

export interface UserColorToggles {
  name: boolean;
  avatar: boolean;
  border: boolean;
}

type RequestColors = (userIds: string[]) => Promise<Record<string, string | null>>;

/** Painted elements carry their user here, so repaints find them. */
const PAINTED_ATTR = "data-user-color-for";
const LOW_CONTRAST = "user-color--low-contrast";
const ROOT_CLASSES = ["uc-name", "uc-avatar", "uc-border", "uc-any"];
const DEFAULT_BG = "#0a0a0a";

let _initialized = false;
let _request: RequestColors | null = null;
let _toggles: UserColorToggles = { name: false, avatar: false, border: false };
/** Published colors; `null` = asked, has none. Absent = not known yet. */
const _published = new Map<string, string | null>();
const _overrides = new Map<string, string>();
const _requested = new Set<string>();
const _pending = new Set<string>();
let _flushTimer: ReturnType<typeof setTimeout> | null = null;
/** Bumped on reset, so answers for a previous session are dropped. */
let _generation = 0;
let _unlisten: (() => void) | null = null;

const anyOn = (t: UserColorToggles) => t.name || t.avatar || t.border;

function themeBackground(): string {
  const root = document.documentElement;
  return (
    root.style.getPropertyValue("--bg").trim() ||
    getComputedStyle(root).getPropertyValue("--bg").trim() ||
    DEFAULT_BG
  );
}

function onThemeApplied(): void {
  refreshUserColorContrast();
}

/**
 * Start (or reconfigure) the store for this session: toggles and overrides
 * from `config`, `request` for lookups. Idempotent — listeners attach once.
 */
export function initUserColors(opts: { config: UserColorsConfig; request: RequestColors }): void {
  _request = opts.request;
  _overrides.clear();
  for (const [userId, raw] of Object.entries(opts.config.overrides ?? {})) {
    const color = normalizeHex(raw);
    if (color) _overrides.set(userId, color);
  }
  if (!_initialized) {
    _initialized = true;
    document.documentElement.addEventListener("quark:theme-applied", onThemeApplied);
    const generation = _generation;
    void listenUserColors((u) => receiveUserColor(u.user_id, u.color)).then((unlisten) => {
      if (generation === _generation) _unlisten = unlisten;
      else unlisten();
    });
  }
  setUserColorToggles(opts.config);
  repaintAll();
}

/** Forget everything — logout, or a test starting fresh. */
export function resetUserColors(): void {
  _generation++;
  _initialized = false;
  _request = null;
  _toggles = { name: false, avatar: false, border: false };
  _published.clear();
  _overrides.clear();
  _requested.clear();
  _pending.clear();
  if (_flushTimer) clearTimeout(_flushTimer);
  _flushTimer = null;
  _unlisten?.();
  _unlisten = null;
  const root = document.documentElement;
  root.removeEventListener("quark:theme-applied", onThemeApplied);
  root.classList.remove(...ROOT_CLASSES);
  for (const el of document.querySelectorAll<HTMLElement>(`[${PAINTED_ATTR}]`)) unpaint(el);
}

/** Which treatments show. Turning any on from all-off fetches who's on screen. */
export function setUserColorToggles(t: UserColorToggles): void {
  const wasOn = anyOn(_toggles);
  _toggles = { name: t.name, avatar: t.avatar, border: t.border };
  const root = document.documentElement;
  root.classList.toggle("uc-name", t.name);
  root.classList.toggle("uc-avatar", t.avatar);
  root.classList.toggle("uc-border", t.border);
  root.classList.toggle("uc-any", anyOn(t));
  if (!wasOn && anyOn(t)) repaintAll();
}

/** The color a sender's messages show, or `null` for the theme's. */
export function resolveUserColor(userId: string): string | null {
  return _overrides.get(userId) ?? _published.get(userId) ?? null;
}

/** What `userId` published: a color, `null` for none, `undefined` if unknown. */
export function publishedUserColor(userId: string): string | null | undefined {
  return _published.get(userId);
}

/** This device's override for `userId`, if any. */
export function localUserColor(userId: string): string | null {
  return _overrides.get(userId) ?? null;
}

/** Set (or, with `null`, clear) the local override, repainting at once. */
export function setLocalUserColor(userId: string, color: string | null): void {
  const normalized = normalizeHex(color);
  if (normalized) _overrides.set(userId, normalized);
  else _overrides.delete(userId);
  repaintUser(userId);
}

/** A published color learned from the backend; invalid values mean none. */
export function receiveUserColor(userId: string, color: string | null): void {
  _published.set(userId, normalizeHex(color));
  repaintUser(userId);
}

/**
 * Paint `userId`'s color onto `el` (or clear it), and queue a lookup if their
 * published color isn't known yet and a treatment is on.
 */
export function paintUserColor(el: HTMLElement, userId: string): void {
  el.setAttribute(PAINTED_ATTR, userId);
  const color = resolveUserColor(userId);
  if (color) {
    el.style.setProperty("--user-color", color);
    el.setAttribute("data-user-color", "");
    el.classList.toggle(LOW_CONTRAST, isLowContrast(color, themeBackground()));
  } else {
    el.style.removeProperty("--user-color");
    el.removeAttribute("data-user-color");
    el.classList.remove(LOW_CONTRAST);
  }
  if (_initialized && anyOn(_toggles) && !_published.has(userId) && !_requested.has(userId)) {
    queue(userId);
  }
}

/** Re-check the low-contrast outline on everything painted (theme change). */
export function refreshUserColorContrast(): void {
  repaintAll();
}

// ── Internals ────────────────────────────────────────────────────────────────

function unpaint(el: HTMLElement): void {
  el.removeAttribute(PAINTED_ATTR);
  el.removeAttribute("data-user-color");
  el.style.removeProperty("--user-color");
  el.classList.remove(LOW_CONTRAST);
}

function repaintUser(userId: string): void {
  for (const el of document.querySelectorAll<HTMLElement>(`[${PAINTED_ATTR}="${CSS.escape(userId)}"]`)) {
    paintUserColor(el, userId);
  }
}

function repaintAll(): void {
  for (const el of document.querySelectorAll<HTMLElement>(`[${PAINTED_ATTR}]`)) {
    const userId = el.getAttribute(PAINTED_ATTR);
    if (userId) paintUserColor(el, userId);
  }
}

function queue(userId: string): void {
  _requested.add(userId);
  _pending.add(userId);
  _flushTimer ??= setTimeout(flush, 0);
}

function flush(): void {
  _flushTimer = null;
  const ids = [..._pending];
  _pending.clear();
  if (!ids.length || !_request) return;
  const generation = _generation;
  // A failed ask isn't retried this session: the backend only refuses when
  // logged out, and retrying on every paint is the storm this avoids.
  _request(ids)
    .then((known) => {
      if (generation !== _generation) return;
      for (const [userId, color] of Object.entries(known)) receiveUserColor(userId, color);
    })
    .catch(() => {});
}
