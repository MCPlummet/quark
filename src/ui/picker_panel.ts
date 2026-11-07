// One tab of the emoji picker: a search field over a keyboard-navigable grid.
//
// The emoji and sticker tabs are both this shape, and used to route their keys
// through two hand-kept copies of one handler — Escape, the search field owning
// its typing, Tab, the chord guard, keymap resolution — with small differences.
// A fix to one (an IME's Enter, AltGr, Space) did not reach the other, the
// same drift that two emoji pickers had. The routing lives here once; a panel
// supplies only what differs between them, and EmojiPicker hosts panels
// through PickerPanel without knowing which tab is which.

import type { SelectionList } from "./PickerBase.js";
import { isCommandChord, isEscapeKey } from "../vim/keybindings.js";

/** What the picker needs from a tab. */
export interface PickerPanel {
  getElement(): HTMLElement;
  /** Back to a fresh state for an open: no query, scrolled to the top. */
  reset(): void;
  /** Focus what the tab opens on. False when it has nothing to focus. */
  focusInitial(): boolean;
  focusSearch(): void;
  /**
   * Handle a keydown that reached the picker while this tab shows. Returns
   * false only for a plain Tab from the grid, which the host owns (it moves to
   * the next tab, or back to the search field when there is none).
   */
  handleKeydown(e: KeyboardEvent): boolean;
}

/** The parts of a panel that {@link routePanelKey} drives. */
export interface PanelKeys {
  searchEl: HTMLInputElement;
  list: SelectionList;
  /** The visible grid's cells, index-aligned with what `pick` picks. */
  cells(): readonly HTMLElement[];
  pick(index: number): void;
  close(): void;
  focusSearch(): void;
  focusGrid(index: number): boolean;
  /** Enter in the search field, Shift held or not: the panel knows what it picks. */
  searchEnter(e: KeyboardEvent): void;
}

/**
 * Route a keydown inside a panel. Returns false only for a plain Tab from the
 * grid (see {@link PickerPanel.handleKeydown}).
 */
export function routePanelKey(e: KeyboardEvent, p: PanelKeys): boolean {
  // An input method owns its keys while composing: the Enter that commits a
  // conversion (草 from kusa) and the Escape that cancels one are not the
  // picker's. WebKit reports the committing Enter as keyCode 229 instead.
  if (e.isComposing || e.keyCode === 229) return true;

  if (isEscapeKey(e)) {
    e.preventDefault();
    p.close();
    return true;
  }

  if (e.target === p.searchEl) {
    // The search field owns its typing: only its structural keys act, so a
    // query can contain j, k, l, o, g or a bracket — letters the grid binds.
    if (e.key === "Enter") {
      e.preventDefault();
      p.searchEnter(e);
    } else if (e.key === "Tab" || e.key === "ArrowDown") {
      // Shift-Tab has nowhere to go inside the panel; keep focus from leaving.
      e.preventDefault();
      if (!e.shiftKey) p.focusGrid(0);
    }
    return true;
  }

  if (e.key === "Tab") {
    if (!e.shiftKey) return false;
    e.preventDefault();
    p.focusSearch();
    return true;
  }

  // Ctrl/Cmd chords never resolve as picker keys (the keymap keeps them out
  // of its sequence grammar); without this Ctrl-k would arrive as a bare `k`.
  // A key typed with AltGr or Option is a character, not a chord.
  if (isCommandChord(e)) return true;

  // Space picks the focused cell, as a literal. Left to the button's own
  // activation it was cancelled whenever a `<leader>` mapping (the leader is
  // Space by default) made it the start of a key sequence.
  if (e.key === " ") {
    const index = p.cells().indexOf(e.target as HTMLElement);
    if (index >= 0) {
      e.preventDefault();
      p.pick(index);
      return true;
    }
  }

  const { consumed, partial } = p.list.handleKey(e.key);
  if (consumed || partial) e.preventDefault();
  return true;
}
