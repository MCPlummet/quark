// Shared machinery for keyboard-navigable picker / selection-list overlays.
//
// Before this file existed, every picker (emoji, gif, device, reaction,
// quick-nav) re-implemented the same scaffolding: an overlay element that
// implements the `Modal` contract, outside-click dismissal, show/hide/isVisible,
// a focus-index, grid/list rendering with active-item highlighting, and
// arrow-key navigation. The navigation in particular was handled five different
// ways — and two pickers (DevicePicker and the old reaction picker) HARDCODED
// j/k/arrows instead of routing through the keymap, so user `quarkrc`
// rebindings silently didn't work there.
//
// `PickerBase` owns the overlay + Modal registration. `SelectionList` owns the
// focus model and keymap-driven navigation, so EVERY picker honours rebindings:
// keys are resolved through `keymapManager.resolveKey(key, "picker")`, which
// falls back to the global ("nmap") map where j→nav-down, k→nav-up,
// h/l→nav-left/right, the arrows, gg→jump-top, G→jump-bottom, Enter/o→select and
// Escape→close are registered (see app/keyboard.ts).

import { keymapManager } from "../vim/keybindings.js";
import { modalManager, attachOutsideClose, type Modal } from "./ModalManager.js";

// ── PickerBase ───────────────────────────────────────────────────────────────

export interface PickerBaseOptions {
  /** Root overlay class name (e.g. "emoji-picker", "gif-picker"). */
  className: string;
  /** aria-label for the overlay's `role="dialog"`. */
  ariaLabel: string;
  /** Add `aria-modal="true"`. Default true. */
  ariaModal?: boolean;
  /** Add `tabindex="-1"` so the root can hold focus. Default false. */
  focusable?: boolean;
  /** `display` value to use when shown (e.g. "" or "flex"). Default "". */
  displayValue?: string;
}

/**
 * Base class for picker overlays. Provides the `Modal` contract, show/hide that
 * register with `modalManager`, and a hook (`registerOutsideClose`) for the
 * standard click/tap-outside dismissal.
 *
 * Subclasses build their own DOM into `this._el` and call the lifecycle helpers.
 */
export abstract class PickerBase implements Modal {
  protected _el: HTMLElement;
  private _displayValue: string;

  constructor(opts: PickerBaseOptions) {
    this._displayValue = opts.displayValue ?? "";

    this._el = document.createElement("div");
    this._el.className = opts.className;
    this._el.setAttribute("role", "dialog");
    this._el.setAttribute("aria-label", opts.ariaLabel);
    if (opts.ariaModal ?? true) this._el.setAttribute("aria-modal", "true");
    if (opts.focusable) this._el.setAttribute("tabindex", "-1");
    this._el.style.display = "none";
  }

  getElement(): HTMLElement {
    return this._el;
  }

  isVisible(): boolean {
    return this._el.style.display !== "none";
  }

  /**
   * Make the overlay visible and register it as the active modal. Subclasses
   * that need to seed state / focus should override `show(...)`, do their own
   * work, then call `this.reveal()` (or call this directly).
   */
  protected reveal(): void {
    this._el.style.display = this._displayValue;
    modalManager.push(this);
  }

  /**
   * Hide the overlay, deregister it, and reset any pending key sequence so a
   * half-typed `g` (from `gg`) doesn't leak into the next context.
   *
   * Subclasses override `hide()` to add their own teardown but should call
   * `super.hide()` (or `this.conceal()`) to run this.
   */
  hide(): void {
    this.conceal();
  }

  protected conceal(): void {
    this._el.style.display = "none";
    modalManager.remove(this);
    keymapManager.resetSequence();
  }

  /**
   * Wire the standard "click / tap outside closes" behaviour. `panel` is the
   * element that should NOT trigger a close (defaults to the overlay root).
   * Returns the disposer from `attachOutsideClose`.
   */
  protected registerOutsideClose(panel: HTMLElement = this._el): () => void {
    return attachOutsideClose(panel, {
      isVisible: () => this.isVisible(),
      close: () => this.hide(),
    });
  }
}

// ── SelectionList ──────────────────────────────────────────────────────────────

/** Logical navigation directions a resolved keymap action maps to. */
export type NavAction =
  | "nav-up"
  | "nav-down"
  | "nav-left"
  | "nav-right"
  | "jump-top"
  | "jump-bottom"
  | "select"
  | "close";

/** The directional subset of {@link NavAction}. */
export type DirectionalAction = "nav-up" | "nav-down" | "nav-left" | "nav-right";

/** How the active item is visually marked. */
export type HighlightStrategy =
  | { kind: "tabindex" } // roving tabindex + .focus() (grids: emoji, gif, sticker)
  | { kind: "class"; activeClass: string }; // toggle a CSS class (lists)

export interface SelectionListOptions {
  /** Column count. 1 ⇒ vertical list; >1 ⇒ grid (up/down jump by this many). */
  columns: number;
  /** How to mark the active item. */
  highlight: HighlightStrategy;
  /** Live cell/item elements at navigation time. */
  getItems: () => readonly HTMLElement[];
  /** Invoked when the active item should be activated (Enter / select). */
  onSelect: (index: number) => void;
  /**
   * Optional: called whenever the focused index changes, after highlighting.
   * Use e.g. to `scrollIntoView`. (For tabindex strategy, focusing already
   * scrolls; this still fires so callers can do extra work.)
   */
  onFocusChange?: (index: number) => void;
  /**
   * Optional: where a directional move from `from` lands, for a layout the
   * fixed `columns` arithmetic cannot describe (the emoji picker's sectioned
   * grid). Return null when the move leaves the list; `onEdge` is then called.
   */
  move?: (from: number, action: DirectionalAction, total: number) => number | null;
  /** Optional: a directional move ran off the list (see `move`). */
  onEdge?: (action: DirectionalAction) => void;
  /**
   * Optional: any other resolved action — `close`, or a picker's own actions
   * such as `picker-search`. Return true if it was handled. Lets a picker take
   * every key through the one keymap resolution instead of matching literals
   * ahead of it.
   */
  onAction?: (action: string) => boolean;
  /**
   * Optional override of how nav keys are resolved. Defaults to
   * `keymapManager.resolveKey(key, "picker")`. Exposed for testing.
   */
  resolve?: (key: string) => ReturnType<typeof keymapManager.resolveKey>;
}

/**
 * Shared focus-index + keymap-driven navigation for a one- or multi-column list
 * of items. Holds no DOM of its own — it asks `getItems()` for the current
 * elements and applies the configured highlight strategy.
 *
 * All navigation goes through the keymap so user rebindings are honoured
 * uniformly across every picker. `handleKey` returns true when it consumed the
 * event (the caller should then `preventDefault`), false otherwise.
 */
export class SelectionList {
  private _focusIndex = 0;
  /** The item last marked active, and where it was, for incremental highlighting. */
  private _highlighted: { el: HTMLElement; index: number } | null = null;
  private readonly _opts: SelectionListOptions;
  private readonly _resolve: (key: string) => ReturnType<typeof keymapManager.resolveKey>;

  constructor(opts: SelectionListOptions) {
    this._opts = opts;
    this._resolve = opts.resolve ?? ((key) => keymapManager.resolveKey(key, "picker"));
  }

  get focusIndex(): number {
    return this._focusIndex;
  }

  /** Reset focus to a given index (clamped) and re-apply highlighting. */
  setFocus(index: number): void {
    const items = this._opts.getItems();
    if (items.length === 0) {
      this._focusIndex = 0;
      return;
    }
    this._focusIndex = Math.max(0, Math.min(index, items.length - 1));
    this._applyHighlight(items, this._focusIndex);
    this._opts.onFocusChange?.(this._focusIndex);
  }

  /**
   * Reset the stored focus index to 0 WITHOUT moving DOM focus or re-applying
   * highlight. Use after a re-render where the caller will (or already did)
   * paint the initial active marker itself — mirrors the old `_focusIndex = 0`
   * post-render reset some pickers relied on.
   */
  resetIndex(): void {
    this._focusIndex = 0;
  }

  /** Re-apply highlight without moving (e.g. after a re-render). */
  refresh(): void {
    const items = this._opts.getItems();
    if (items.length === 0) return;
    this._focusIndex = Math.max(0, Math.min(this._focusIndex, items.length - 1));
    this._applyHighlight(items, this._focusIndex);
  }

  /**
   * Resolve a keydown through the keymap and move/select accordingly.
   * Returns true if the event was a navigation/select action (consumed).
   */
  handleKey(key: string): { consumed: boolean; partial: boolean } {
    const result = this._resolve(key);
    if (result.kind === "partial") {
      return { consumed: true, partial: true };
    }
    if (result.kind !== "action") {
      return { consumed: false, partial: false };
    }
    return { consumed: this.dispatch(result.action), partial: false };
  }

  /**
   * Apply a resolved action by name. Returns true if it was handled — a known
   * nav action, or one the picker's `onAction` accepted.
   */
  dispatch(action: NavAction | (string & {})): boolean {
    const items = this._opts.getItems();
    const total = items.length;
    const cols = Math.max(1, this._opts.columns);

    if (this._opts.move && isDirectional(action)) {
      if (total === 0) return true;
      const to = this._opts.move(this._focusIndex, action, total);
      if (to === null) this._opts.onEdge?.(action);
      else this.setFocus(to);
      return true;
    }

    switch (action) {
      case "nav-down":
        if (total > 0) this.setFocus(Math.min(this._focusIndex + cols, total - 1));
        return true;
      case "nav-up":
        if (total > 0) this.setFocus(Math.max(this._focusIndex - cols, 0));
        return true;
      case "nav-right":
        if (total > 0) this.setFocus(Math.min(this._focusIndex + 1, total - 1));
        return true;
      case "nav-left":
        if (total > 0) this.setFocus(Math.max(this._focusIndex - 1, 0));
        return true;
      case "jump-top":
        if (total > 0) this.setFocus(0);
        return true;
      case "jump-bottom":
        if (total > 0) this.setFocus(total - 1);
        return true;
      case "select":
        this._opts.onSelect(this._focusIndex);
        return true;
      default:
        // Close is the picker's to handle (it knows its teardown), as is any
        // action of its own. Without an `onAction` it is reported unhandled so
        // the caller can route it.
        return this._opts.onAction?.(action) ?? false;
    }
  }

  /**
   * Mark `index` active. Moving within the same items rewrites only the cell
   * left and the cell reached — the emoji grid holds ~1,900 cells, and
   * sweeping all of them on every j/k was a style invalidation per cell per
   * keypress. After a re-render (the item last marked is no longer where it
   * was) every item is swept, so a fresh render needs no care.
   */
  private _applyHighlight(items: readonly HTMLElement[], index: number): void {
    const strat = this._opts.highlight;
    const mark = (el: HTMLElement, on: boolean): void => {
      if (strat.kind === "tabindex") el.setAttribute("tabindex", on ? "0" : "-1");
      else el.classList.toggle(strat.activeClass, on);
    };
    const prev = this._highlighted;
    if (prev !== null && items[prev.index] === prev.el) {
      if (prev.index !== index) mark(prev.el, false);
    } else {
      for (let i = 0; i < items.length; i++) mark(items[i], i === index);
    }
    const next = items[index];
    if (next) mark(next, true);
    this._highlighted = next ? { el: next, index } : null;
    if (strat.kind === "tabindex") next?.focus();
  }
}

function isDirectional(action: string): action is DirectionalAction {
  return action === "nav-up" || action === "nav-down" || action === "nav-left" || action === "nav-right";
}
