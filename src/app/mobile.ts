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

/**
 * Split the visual-viewport geometry into the two independent quantities the
 * layout needs. Conflating them is what made the composer misbehave when the
 * user scrolled on it with the keyboard open (#33):
 *
 *   keyboardInset  how much of the *layout* viewport the on-screen keyboard
 *                  covers. Only changes when the keyboard opens or closes, so
 *                  it is safe to drive layout with (content-area padding).
 *   pan            how far the engine has panned the visual viewport within the
 *                  layout viewport. iOS keeps the layout viewport at full height
 *                  while the keyboard is up, so any drag the page doesn't
 *                  consume pans it — streaming an update every frame. Folding
 *                  that into the inset re-laid-out the whole content column on
 *                  each frame, which is what dragged the compose bar around
 *                  under the finger; it is compensated with a transform instead.
 *
 * Panning is only meaningful while the keyboard is up: with no inset there is
 * nothing to pan within, and a non-zero offsetTop then means a deliberate
 * pinch-zoom pan, which must not be cancelled out.
 */
export function viewportMetrics(
  layoutHeight: number,
  visualHeight: number,
  visualOffsetTop: number,
): { keyboardInset: number; pan: number } {
  const keyboardInset = Math.max(0, layoutHeight - visualHeight);
  const pan = keyboardInset > 0
    ? Math.max(0, Math.min(visualOffsetTop, keyboardInset))
    : 0;
  return { keyboardInset, pan };
}

/** Track the visual viewport so the compose box stays above the iOS keyboard. */
function trackVisualViewport(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const update = (): void => {
    const { keyboardInset, pan } = viewportMetrics(window.innerHeight, vv.height, vv.offsetTop);
    root.style.setProperty("--keyboard-offset", `${keyboardInset}px`);
    root.style.setProperty("--viewport-pan", `${pan}px`);
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
