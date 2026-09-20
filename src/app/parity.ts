// Modality reachability — the model the parity test asserts against (#104).
//
// The milestone's whole claim is that every feature is reachable from keyboard,
// mouse and touch. That claim decays the moment someone adds an action, so it
// is stated here as a predicate rather than as prose in DESIGN.md, and the test
// next door fails a build that breaks it.
//
// The command palette is the universal net, which is exactly why reachability
// "via the palette" is tracked separately: a test that accepted it everywhere
// would pass vacuously and prove nothing. `reachability()` reports the two
// independently so the test can require real affordances where they should
// exist and still recognise the palette as a genuine path.

import {
  ACTIONS,
  type ActionEntry,
  type ChromeSurface,
  type MenuSurface,
} from "./registry.js";

/**
 * Whether a menu surface can be opened by touch.
 *
 * All of them can, since #99 gave the room list, space strip and section labels
 * the long press the timeline already had. Stated explicitly so that adding a
 * surface without a touch path is a decision someone has to make here.
 */
const MENU_TOUCH: Readonly<Record<MenuSurface, boolean>> = {
  message: true,   // long press on the message
  room: true,      // long press in the room list
  section: true,   // long press on a subspace label
  space: true,     // long press on a space icon
  overflow: true,  // the mobile top bar's ⋮ — mobile-only by definition
};

/** Whether a menu surface can be opened with a pointer. */
const MENU_POINTER: Readonly<Record<MenuSurface, boolean>> = {
  message: true,
  room: true,
  section: true,
  space: true,
  // The mobile top bar does not exist on desktop, so this surface is touch-only
  // and cannot be what makes an action pointer-reachable.
  overflow: false,
};

/**
 * Whether a piece of chrome is visible in mobile mode.
 *
 * `room-header` and `timeline` are the two that are not, and they are the two
 * that caused the milestone: the desktop room header is `display: none` on
 * mobile, and the timeline's hover action bar has no hover to respond to.
 */
const CHROME_TOUCH: Readonly<Record<ChromeSurface, boolean>> = {
  "room-header": false,
  "timeline": false,
  "mobile-top-bar": true,
  "compose": true,
  "space-strip": true,
  "status-bar": true,
  "drawer": true,
  "settings": true,
};

/** Whether a piece of chrome is visible on desktop. */
const CHROME_POINTER: Readonly<Record<ChromeSurface, boolean>> = {
  "room-header": true,
  "timeline": true,
  // Mobile-only, so it cannot be what makes an action pointer-reachable.
  "mobile-top-bar": false,
  "compose": true,
  "space-strip": true,
  "status-bar": true,
  "drawer": true,
  "settings": true,
};

export interface Reachability {
  /** A key sequence, or a `:` command typed into the command bar. */
  keyboard: boolean;
  /** A control or menu reachable with a mouse, the palette aside. */
  pointer: boolean;
  /** A control or menu reachable by touch, the palette aside. */
  touch: boolean;
  /** Listed in the command palette, which is reachable from all three. */
  palette: boolean;
}

/** Whether the palette offers this entry (mirrors paletteEntries' rule). */
export function inPalette(entry: ActionEntry): boolean {
  return entry.palette ?? entry.command !== undefined;
}

/**
 * How an action can be reached.
 *
 * Deliberately ignores `requires`: a room action is unreachable with no room
 * open, but that is the action being inapplicable, not unreachable.
 */
export function reachability(entry: ActionEntry): Reachability {
  const menus = entry.menus ?? [];
  const chrome = entry.chrome ?? [];

  return {
    keyboard: (entry.bindings?.length ?? 0) > 0 || entry.command !== undefined,
    pointer:
      menus.some((m) => MENU_POINTER[m.surface]) ||
      chrome.some((c) => CHROME_POINTER[c]),
    touch:
      menus.some((m) => MENU_TOUCH[m.surface]) ||
      chrome.some((c) => CHROME_TOUCH[c]),
    palette: inPalette(entry),
  };
}

/** A modality an entry cannot be reached from at all. */
export interface ParityGap {
  id: string;
  missing: Array<"keyboard" | "pointer" | "touch">;
}

/**
 * Entries reachable from fewer than all three modalities, palette included.
 *
 * Exempt entries are skipped — see {@link ActionEntry.parityExempt}. So are
 * desktop-only ones, which have no touch path by definition rather than by
 * omission.
 */
export function parityGaps(entries: readonly ActionEntry[] = ACTIONS): ParityGap[] {
  const gaps: ParityGap[] = [];

  for (const entry of entries) {
    if (entry.parityExempt) continue;
    const r = reachability(entry);
    const desktopOnly = entry.requires?.includes("desktop") ?? false;

    const missing: Array<"keyboard" | "pointer" | "touch"> = [];
    if (!r.keyboard && !r.palette) missing.push("keyboard");
    if (!r.pointer && !r.palette) missing.push("pointer");
    if (!desktopOnly && !r.touch && !r.palette) missing.push("touch");

    if (missing.length > 0) gaps.push({ id: entry.id, missing });
  }

  return gaps;
}

/**
 * Entries whose only pointer or touch path is the command palette.
 *
 * Not a failure — the palette is a real affordance, and for something like
 * `:version` it is the proportionate one. Reported so that the set stays a
 * visible, deliberate list rather than quietly absorbing every new action that
 * nobody got round to giving a home.
 */
export function paletteOnly(entries: readonly ActionEntry[] = ACTIONS): string[] {
  return entries
    .filter((e) => !e.parityExempt && inPalette(e))
    .filter((e) => {
      const r = reachability(e);
      return !r.pointer || !r.touch;
    })
    .map((e) => e.id);
}
