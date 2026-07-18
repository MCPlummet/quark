// Mobile-mode controller — viewport detection, drawer state, virtual-keyboard tracking.
//
// Mobile mode is purely viewport-driven so the same build works on desktop
// (resize the window) and iOS/Android. When active, base.css applies the
// `body.quark-mobile` rules: the space strip + room list collapse into a
// left drawer over a single-column timeline.

import { AppState } from "./state.js";

const MOBILE_BREAKPOINT_PX = 768;

type Listener = (mobile: boolean) => void;
type DrawerListener = (open: boolean) => void;

let _mobile = false;
let _drawerOpen = false;
let _vimRestoreOnExit = true;
const _modeListeners = new Set<Listener>();
const _drawerListeners = new Set<DrawerListener>();

function detectMobile(): boolean {
  return window.innerWidth <= MOBILE_BREAKPOINT_PX;
}

function applyMobileClass(): void {
  document.body.classList.toggle("quark-mobile", _mobile);
}

function applyDrawerClass(): void {
  document.body.classList.toggle("quark-mobile-drawer-open", _mobile && _drawerOpen);
}

/** Track the visual viewport so the compose box stays above the iOS keyboard. */
function trackVisualViewport(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = (ev?: Event): void => {
    // Height removed from the layout viewport when the keyboard is up.
    const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    // Scroll-driven updates stream every frame while the user drags with the
    // keyboard open; easing them through the padding transition makes the
    // compose bar lag and judder (#33). Apply those instantly and keep the
    // ease for the open/close resize.
    document.documentElement.classList.toggle("quark-kb-immediate", ev?.type === "scroll");
    document.documentElement.style.setProperty("--keyboard-offset", `${offset}px`);
  };
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
}

export function initMobile(): void {
  _mobile = detectMobile();
  applyMobileClass();
  trackVisualViewport();

  // When entering mobile mode for the first time, remember the user's vim setting
  // so we can restore it when they go back to desktop.
  _vimRestoreOnExit = AppState.get("vimMode");
  if (_mobile) AppState.set("vimMode", false);

  window.addEventListener("resize", () => {
    const next = detectMobile();
    if (next === _mobile) return;
    _mobile = next;

    if (_mobile) {
      _vimRestoreOnExit = AppState.get("vimMode");
      AppState.set("vimMode", false);
    } else {
      AppState.set("vimMode", _vimRestoreOnExit);
      // Drawer is meaningless on desktop.
      if (_drawerOpen) closeDrawer();
    }

    applyMobileClass();
    applyDrawerClass();
    for (const cb of _modeListeners) cb(_mobile);
  });
}

export function isMobile(): boolean {
  return _mobile;
}

export function onMobileChange(cb: Listener): () => void {
  _modeListeners.add(cb);
  return () => _modeListeners.delete(cb);
}

// ── Drawer ───────────────────────────────────────────────────────────────────

export function isDrawerOpen(): boolean {
  return _drawerOpen;
}

/**
 * Blur the focused element so the mobile OS keyboard dismisses. The keyboard
 * only closes when its input loses focus — a slide-over panel covering the
 * compose box otherwise leaves the keyboard up (squashing the panel) and
 * keeps routing keystrokes into the hidden room (#37).
 */
export function dismissKeyboard(): void {
  const el = document.activeElement;
  if (el instanceof HTMLElement) el.blur();
}

export function openDrawer(): void {
  if (!_mobile || _drawerOpen) return;
  dismissKeyboard();
  _drawerOpen = true;
  applyDrawerClass();
  for (const cb of _drawerListeners) cb(true);
}

export function closeDrawer(): void {
  if (!_drawerOpen) return;
  _drawerOpen = false;
  applyDrawerClass();
  for (const cb of _drawerListeners) cb(false);
}

export function toggleDrawer(): void {
  if (_drawerOpen) closeDrawer(); else openDrawer();
}

export function onDrawerChange(cb: DrawerListener): () => void {
  _drawerListeners.add(cb);
  return () => _drawerListeners.delete(cb);
}
