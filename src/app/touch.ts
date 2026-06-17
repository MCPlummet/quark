// Touch gestures for mobile mode.
//
// Two interactive slide-over panels are dragged Discord-style: a horizontal drag
// pulls the panel along with the finger and, on release, snaps open or closed
// based on how far it travelled and how fast.
//   • Room-list drawer (left edge): drag from anywhere — right to open, left to
//     close. When closed it opens from any horizontal swipe over the timeline.
//   • Member-list panel (right edge, #8): mirrors the drawer from the opposite
//     side. To OPEN it the swipe must start near the right edge (so it doesn't
//     fight ordinary left-swipes); once open it closes from a rightward drag
//     anywhere. Only one overlay is open at a time.
// A separate gesture — pull down from the top of the open room list — opens the
// command palette, which is otherwise keyboard-only (`:`) and unreachable on a
// touch device.
//
// Tap-on-backdrop is handled by the backdrop element itself in App.ts.

import { isMobile, isDrawerOpen, openDrawer, closeDrawer } from "./mobile.js";
import { AppState } from "./state.js";
import { setMemberListVisible } from "./actions/members.js";

export interface TouchGestureOptions {
  /** Scrollable room-list element; pull-down only fires when it's at the top. */
  scrollEl?: HTMLElement;
  /** Invoked when the user pulls down from the top of the open drawer. */
  onPullDown?: () => void;
}

// Minimum dominant-axis travel before we commit to interpreting a touch as a
// horizontal drag or a vertical scroll/pull.
const AXIS_LOCK_PX = 8;
// Fraction of the panel that must be revealed (or a fling faster than this) for
// a release to settle open rather than snapping back.
const SETTLE_FRACTION = 0.5;
const FLING_VELOCITY_PX_PER_MS = 0.5;
// Pull-down (open command palette) wants a deliberate drag and tolerates drift.
const PULL_DOWN_DISTANCE_PX = 64;
const PULL_DOWN_HORIZONTAL_TOLERANCE_PX = 60;
const SWIPE_MAX_DURATION_MS = 600;
// How close to the right edge a swipe must start to open the member-list panel.
const RIGHT_EDGE_PX = 24;

type Axis = "none" | "horizontal" | "vertical";
type Target = "drawer" | "member";

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

// ── Pure gesture math (unit-tested) ───────────────────────────────────────────

/**
 * "Shut" amount (1 = fully closed, 0 = fully open) a panel would have at the
 * current finger displacement `dx`. `dir` is +1 for a panel that lives off the
 * right edge (member list — finger moves left to open, so leftward dx reduces
 * shut) and -1 for one off the left edge (drawer).
 */
export function panelShut(baseShut: number, dir: number, dx: number, width: number): number {
  return clamp01(baseShut + (dir * dx) / width);
}

/** Whether a horizontal drag drives its target toward open / closed / neither. */
export function panelGestureKind(
  startedOpen: boolean,
  dir: number,
  dx: number,
): "opening" | "closing" | "none" {
  // A drag only acts in the direction with somewhere to go: opening when the
  // finger moves the reveal way (dir*dx < 0), closing when it moves the hide way.
  if (!startedOpen && dir * dx < 0) return "opening";
  if (startedOpen && dir * dx > 0) return "closing";
  return "none";
}

/** Settle decision on release: should the panel end up open? */
export function settleOpen(startedOpen: boolean, openness: number, dir: number, vx: number): boolean {
  if (startedOpen) {
    const shouldClose = openness < SETTLE_FRACTION || dir * vx > FLING_VELOCITY_PX_PER_MS;
    return !shouldClose;
  }
  return openness > SETTLE_FRACTION || dir * vx < -FLING_VELOCITY_PX_PER_MS;
}

// ── Target wiring ──────────────────────────────────────────────────────────────

interface PanelSpec {
  dir: number;
  cssVar: string;
  draggingClass: string;
  isOpen: () => boolean;
  setOpen: (open: boolean) => void;
}

const PANELS: Record<Target, PanelSpec> = {
  drawer: {
    dir: -1,
    cssVar: "--drawer-shut",
    draggingClass: "quark-drawer-dragging",
    isOpen: isDrawerOpen,
    setOpen: (open) => (open ? openDrawer() : closeDrawer()),
  },
  member: {
    dir: 1,
    cssVar: "--member-panel-shut",
    draggingClass: "quark-member-dragging",
    isOpen: () => AppState.get("memberListVisible"),
    setOpen: (open) => setMemberListVisible(open),
  },
};

interface Tracked {
  x: number;
  y: number;
  t: number;
  target: Target;
  startedOpen: boolean;
  /** Drawer touch that began with the room list scrolled to the top. */
  pullDownEligible: boolean;
  axis: Axis;
  /** True once we've committed to driving the panel with this touch. */
  dragging: boolean;
}

let _active: Tracked | null = null;

/** Choose which panel a touch starting at `clientX` should drive. */
function pickTarget(clientX: number): Target {
  if (PANELS.member.isOpen()) return "member"; // drag to close it
  if (isDrawerOpen()) return "drawer"; // drag to close it
  // Both closed: a swipe starting at the right edge opens the member list, every
  // other swipe opens the drawer.
  return clientX >= window.innerWidth - RIGHT_EDGE_PX ? "member" : "drawer";
}

export function setupTouchGestures(
  layout: HTMLElement,
  opts: TouchGestureOptions = {},
): void {
  layout.addEventListener("touchstart", (e) => {
    if (!isMobile()) {
      _active = null;
      return;
    }
    const touch = e.touches[0];
    if (!touch) return;

    const target = pickTarget(touch.clientX);
    const startedOpen = PANELS[target].isOpen();
    // Pull-to-reveal the command palette only applies to the open drawer, and
    // only when the list can't scroll up further (else a downward drag scrolls).
    const atTop = (opts.scrollEl?.scrollTop ?? 0) <= 0;
    _active = {
      x: touch.clientX,
      y: touch.clientY,
      t: performance.now(),
      target,
      startedOpen,
      pullDownEligible: target === "drawer" && startedOpen && !!opts.onPullDown && atTop,
      axis: "none",
      dragging: false,
    };
  }, { passive: true });

  // Non-passive so we can suppress native scroll while a panel drag is in
  // flight — the drag can start over the timeline, which would otherwise scroll.
  layout.addEventListener("touchmove", (e) => {
    const tracked = _active;
    if (!tracked) return;
    const touch = e.touches[0];
    if (!touch) return;

    const dx = touch.clientX - tracked.x;
    const dy = touch.clientY - tracked.y;
    const spec = PANELS[tracked.target];

    // Lock the gesture to an axis on first decisive movement.
    if (tracked.axis === "none") {
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > AXIS_LOCK_PX) {
        if (panelGestureKind(tracked.startedOpen, spec.dir, dx) !== "none") {
          tracked.axis = "horizontal";
          tracked.dragging = true;
          document.body.classList.add(spec.draggingClass);
        } else {
          _active = null;
          return;
        }
      } else if (Math.abs(dy) > Math.abs(dx) * 1.5 && Math.abs(dy) > AXIS_LOCK_PX) {
        tracked.axis = "vertical";
        // Only the pull-down-from-top gesture keeps a vertical touch; everything
        // else is a normal scroll and must be released back to the page.
        if (!(tracked.pullDownEligible && dy > 0)) {
          _active = null;
          return;
        }
      } else {
        return; // not enough movement to decide yet
      }
    }

    if (tracked.axis === "horizontal" && tracked.dragging) {
      e.preventDefault();
      const shut = panelShut(tracked.startedOpen ? 0 : 1, spec.dir, dx, window.innerWidth);
      document.body.style.setProperty(spec.cssVar, String(shut));
    } else if (tracked.axis === "vertical" && tracked.pullDownEligible) {
      e.preventDefault(); // suppress overscroll bounce while tracking the pull
    }
  }, { passive: false });

  layout.addEventListener("touchend", (e) => {
    const tracked = _active;
    _active = null;
    if (!tracked) return;
    const spec = PANELS[tracked.target];

    const touch = e.changedTouches[0];
    if (!touch) {
      document.body.classList.remove(spec.draggingClass);
      return;
    }

    const dx = touch.clientX - tracked.x;
    const dy = touch.clientY - tracked.y;
    const dt = performance.now() - tracked.t;

    if (tracked.dragging) {
      // Settle: open if revealed past the midpoint or flung fast in the opening
      // direction; close on the converse. Releasing the dragging class lets the
      // CSS transition animate the remaining distance.
      document.body.classList.remove(spec.draggingClass);
      const openness = 1 - panelShut(tracked.startedOpen ? 0 : 1, spec.dir, dx, window.innerWidth);
      const vx = dt > 0 ? dx / dt : 0;
      spec.setOpen(settleOpen(tracked.startedOpen, openness, spec.dir, vx));
      return;
    }

    // Pull-down from the top of the room list → open the command palette.
    if (
      tracked.axis === "vertical" &&
      tracked.pullDownEligible &&
      dt <= SWIPE_MAX_DURATION_MS &&
      dy > PULL_DOWN_DISTANCE_PX &&
      Math.abs(dx) < PULL_DOWN_HORIZONTAL_TOLERANCE_PX
    ) {
      opts.onPullDown?.();
    }
  }, { passive: true });

  layout.addEventListener("touchcancel", () => {
    if (_active?.dragging) document.body.classList.remove(PANELS[_active.target].draggingClass);
    _active = null;
  }, { passive: true });
}
