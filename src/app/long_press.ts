// Long-press → context menu, for touch input.
//
// Lived inside Timeline as a private method, which meant the room list, the
// space strip and the subspace section labels — all of which bind `contextmenu`
// and nothing else — had no touch path to their menus at all. `contextmenu` is
// not a substitute: `-webkit-touch-callout: none` is set globally in base.css,
// so iOS never synthesises the event from a press, and those menus were
// desktop-only in practice (#99).
//
// Two behaviours the Timeline version got wrong, fixed here because they are
// the same bug wherever the gesture is attached:
//
//   • It never checked isMobile(). On a touchscreen laptop the press fired and
//     ContextMenu rendered its *desktop* floating variant anchored under the
//     finger — the exact placement its own comment calls "the worst possible
//     spot". The gesture is now mobile-mode only, where the menu docks to the
//     bottom of the viewport as a sheet.
//   • Nothing suppressed the native text selection the engine starts on the
//     same press, so the sheet opened over a blue highlight the user never
//     asked for (#100). Suppressing it is a CSS concern (`user-select: none`
//     on the pressed region in mobile mode) — this module's part is to fire
//     cleanly and let the caller offer an explicit "Select text" instead.

import { isMobile } from "./mobile.js";

export interface LongPressOptions {
  /**
   * Resolve the press target to an identifier, or null to ignore the press.
   * Runs on touchstart, so a press that lands on nothing costs only this call.
   */
  resolve: (target: HTMLElement) => string | null;
  /** Fired once the press completes, with the resolved id and its coordinates. */
  onLongPress: (id: string, x: number, y: number) => void;
  /**
   * Selector for interactive descendants that own their own taps (links,
   * buttons, images). A press starting inside one is ignored.
   */
  ignoreSelector?: string;
}

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 10;

/**
 * Attach a long-press gesture to `el`.
 *
 * Returns a teardown function. The click that follows a completed press is
 * swallowed in the capture phase, so the press does not also select-and-act on
 * whatever was underneath.
 */
export function attachLongPress(el: HTMLElement, opts: LongPressOptions): () => void {
  let timer: number | null = null;
  let startX = 0;
  let startY = 0;
  let startId: string | null = null;
  let fired = false;

  const cancel = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    startId = null;
  };

  const onTouchStart = (e: TouchEvent): void => {
    // Desktop pointers get `contextmenu`; only mobile mode gets the sheet.
    if (!isMobile()) return;
    // Single-finger only — a second finger means a pinch or a two-finger scroll.
    if (e.touches.length !== 1) {
      cancel();
      return;
    }
    const target = e.target as HTMLElement;
    if (opts.ignoreSelector && target.closest(opts.ignoreSelector)) return;

    const id = opts.resolve(target);
    if (id === null) return;

    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    startId = id;
    fired = false;
    timer = window.setTimeout(() => {
      if (startId === null) return;
      const resolved = startId;
      fired = true;
      // Haptic confirmation that the press registered, where supported.
      if (typeof navigator.vibrate === "function") navigator.vibrate(10);
      opts.onLongPress(resolved, startX, startY);
      startId = null;
    }, LONG_PRESS_MS);
  };

  const onTouchMove = (e: TouchEvent): void => {
    const touch = e.touches[0];
    if (!touch) return cancel();
    if (
      Math.abs(touch.clientX - startX) > MOVE_TOLERANCE_PX ||
      Math.abs(touch.clientY - startY) > MOVE_TOLERANCE_PX
    ) {
      cancel();
    }
  };

  const onClickCapture = (e: MouseEvent): void => {
    if (!fired) return;
    fired = false;
    e.stopPropagation();
    e.preventDefault();
  };

  el.addEventListener("touchstart", onTouchStart, { passive: true });
  el.addEventListener("touchmove", onTouchMove, { passive: true });
  el.addEventListener("touchend", cancel, { passive: true });
  el.addEventListener("touchcancel", cancel, { passive: true });
  el.addEventListener("click", onClickCapture, true);

  return () => {
    cancel();
    el.removeEventListener("touchstart", onTouchStart);
    el.removeEventListener("touchmove", onTouchMove);
    el.removeEventListener("touchend", cancel);
    el.removeEventListener("touchcancel", cancel);
    el.removeEventListener("click", onClickCapture, true);
  };
}
