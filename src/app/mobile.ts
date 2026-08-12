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

// Engines report scale as an exact 1 at rest, but leave room for float drift
// rather than reading a rounding error as a zoom.
const ZOOM_EPSILON = 0.02;

/** Whether the user has pinched the page in. Scale is 1 (or below) at rest. */
export function isZoomed(): boolean {
  return (window.visualViewport?.scale ?? 1) > 1 + ZOOM_EPSILON;
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
 *
 * Zoom is the third thing the geometry can mean, and from a height diff alone it
 * is indistinguishable from the first: pinching to `scale` shrinks the visual
 * viewport to roughly layoutHeight / scale, which reads as a keyboard that tall —
 * phantom padding under the timeline, a compose bar stranded mid-screen, and the
 * shell translated by the user's own pan. So take the scale and, while zoomed,
 * claim neither quantity: the user is moving the viewport deliberately and the
 * engine keeps the focused field in view on its own.
 */
export function viewportMetrics(
  layoutHeight: number,
  visualHeight: number,
  visualOffsetTop: number,
  scale: number = 1,
): { keyboardInset: number; pan: number } {
  if (scale > 1 + ZOOM_EPSILON) return { keyboardInset: 0, pan: 0 };
  const keyboardInset = Math.max(0, layoutHeight - visualHeight);
  const pan = keyboardInset > 0
    ? Math.max(0, Math.min(visualOffsetTop, keyboardInset))
    : 0;
  return { keyboardInset, pan };
}

let _pan = 0;

/**
 * How far the shell is currently offset from the layout viewport, in CSS px.
 *
 * The shell and the body-mounted overlay layer both carry this offset (see the
 * `#app` rule in base.css), so they share a coordinate space the layout viewport
 * doesn't. A client rect measures in layout space — the pan is already in it —
 * so anything positioning an overlay off one has to take it back out.
 */
export function viewportPan(): number {
  return _pan;
}

/** Track the visual viewport so the compose box stays above the iOS keyboard. */
function trackVisualViewport(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const update = (): void => {
    const { keyboardInset, pan } = viewportMetrics(
      window.innerHeight,
      vv.height,
      vv.offsetTop,
      vv.scale,
    );
    _pan = pan;
    root.style.setProperty("--keyboard-offset", `${keyboardInset}px`);
    root.style.setProperty("--viewport-pan", `${pan}px`);
  };
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
}

/** Decides whether a touch is allowed through the guard; see guardViewportPan. */
type PanExempt = (target: Element | null) => boolean;

// Guards are wired from component constructors, and every one of those runs
// before initMobile() (see App.ts) — so initMobile syncs them as well, or on a
// phone, where the breakpoint is never crossed, they would never attach.
const _panGuardSyncs = new Set<Listener>();

/**
 * Keep drags inside `el` out of the visual-viewport pan (#33).
 *
 * `touch-action` alone cannot state this rule for a region: it intersects down
 * the tree, so `none` on a container takes any `pan-y` its scrollable child needs
 * with it. That confines the CSS guards to the leaves and leaves every bare
 * surface between them — a bar's padding, a box's margins and padding ring, a
 * wrap's safe-area strip — handing drags to the pan, one gap at a time. State it
 * once instead: swallow every drag in the region except the one element that has
 * something of its own to scroll (`exempt`; it must stop its own chaining with
 * overscroll-behavior: contain).
 *
 * The listener is on `el`, not the document, so the rest of the page keeps its
 * passive fast path, and `passive: false` is what lets preventDefault bind at
 * all — which is why it is only attached in mobile mode, the only place the pan
 * exists: desktop should not pay the blocking touch path for a no-op. While the
 * page is pinch-zoomed the guard stands down, since panning is then the user's
 * only way to reach the rest of the shell. preventDefault only cancels the
 * browser's default action — other listeners still run, so the drawer swipe in
 * touch.ts, which drives its own transform, is unaffected.
 */
export function guardViewportPan(el: HTMLElement, exempt?: PanExempt): void {
  const swallow = (e: TouchEvent): void => {
    if (isZoomed()) return;
    const target = e.target instanceof Element ? e.target : null;
    if (exempt?.(target)) return;
    if (e.cancelable) e.preventDefault();
  };

  let attached = false;
  const sync = (mobile: boolean): void => {
    if (mobile === attached) return;
    attached = mobile;
    if (mobile) el.addEventListener("touchmove", swallow, { passive: false });
    else el.removeEventListener("touchmove", swallow);
  };

  sync(_mobile);
  _panGuardSyncs.add(sync);
  onMobileChange(sync);
}

export function initMobile(): void {
  _mobile = detectMobile();
  applyMobileClass();
  for (const sync of _panGuardSyncs) sync(_mobile);
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
