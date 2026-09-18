// Builds context-menu contents from the action registry.
//
// The menus used to be ContextMenuEntry literals inline in keyboard.ts, each
// carrying a hardcoded `hint:` string — "r", "e", "dd". Those hints were wrong
// for anyone with a quarkrc: remap redact and the menu still advertised `dd`.
// A menu that prints a stale default is worse than one that prints nothing,
// because it answers the question the user actually had.
//
// So labels, ordering and grouping come from the registry, hints come from the
// live keymap, and the caller supplies only behaviour: a handler per action id.
// An action with no handler is dropped, which is also how a row earns
// conditional visibility that `requires` cannot express — the room menu offers
// "Mark as read" by passing a handler only when the room is actually unread.

import type { ContextMenuEntry } from "../ui/ContextMenu.js";
import {
  isAvailable,
  menuEntries,
  menuHint,
  type AvailabilityContext,
  type MenuSurface,
} from "./registry.js";

/** Behaviour for the rows a caller wants to offer, keyed by action id. */
export type MenuHandlers = Record<string, (() => void) | undefined>;

/**
 * Assemble the entries for a context menu.
 *
 * Rows are the registry's, in its (group, order); a separator is emitted
 * between groups, and never leading, trailing or doubled — so dropping the
 * last row of a group cannot leave a stray rule behind, which is the failure
 * mode of interleaving separators by hand.
 */
export function buildMenu(
  surface: MenuSurface,
  ctx: AvailabilityContext,
  handlers: MenuHandlers,
): ContextMenuEntry[] {
  const entries: ContextMenuEntry[] = [];
  let lastGroup: number | null = null;

  for (const row of menuEntries(surface)) {
    const action = handlers[row.id];
    if (!action) continue;
    if (!isAvailable(row, ctx)) continue;

    if (lastGroup !== null && row.menu.group !== lastGroup) {
      entries.push({ separator: true });
    }
    lastGroup = row.menu.group;

    const hint = menuHint(row.id);
    entries.push(hint ? { label: row.menu.label, hint, action } : { label: row.menu.label, action });
  }

  return entries;
}
