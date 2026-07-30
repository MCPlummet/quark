// Central registry of open modal overlays (dialogs, pickers, context menu,
// lightbox, …).
//
// Replaces the hand-maintained `isVisible()` switchyards that previously lived
// in `app/keyboard.ts` (global keydown guard) and `app/back.ts` (Android
// back-button precedence). Every modal pushes itself when shown and removes
// itself when hidden, so callers can ask `modalManager.isAnyOpen` instead of
// OR-ing every instance, and `closeTopMost()` drives Escape / back dismissal
// against the most-recently-opened overlay.
//
// A "modal" here is any overlay that should swallow global navigation keys
// while open. Inline autocomplete popups (shortcode / mention preview) are NOT
// modals — they are handled inside Insert-mode key routing and must not be
// registered here.

export interface Modal {
  /** The overlay's root element (the thing appended to document.body). */
  getElement(): HTMLElement;
  /** Whether the overlay is currently displayed. */
  isVisible(): boolean;
  /** Dismiss the overlay. */
  hide(): void;
}

class ModalManager {
  /** Open modals in the order they were shown; last entry is topmost. */
  private _stack: Modal[] = [];

  /**
   * Record a modal as open. Idempotent — re-pushing an already-tracked modal
   * moves it to the top of the stack (it became the active overlay again).
   */
  push(modal: Modal): void {
    this.remove(modal);
    this._stack.push(modal);
    this.syncBodyClass();
  }

  /** Record a modal as closed. No-op if it wasn't tracked. */
  remove(modal: Modal): void {
    const i = this._stack.indexOf(modal);
    if (i >= 0) this._stack.splice(i, 1);
    this.syncBodyClass();
  }

  /**
   * Mirror the open-state onto <body> so pure CSS can react to "some overlay
   * is covering the layout" — used to blank the layout tier's scrollbars,
   * which WebKitGTK otherwise composites above dialogs (#32).
   */
  private syncBodyClass(): void {
    document.body.classList.toggle("quark-modal-open", this.isAnyOpen);
  }

  /** True when at least one tracked modal is currently visible. */
  get isAnyOpen(): boolean {
    return this._stack.some((m) => m.isVisible());
  }

  /** The most-recently-opened modal that is still visible, or null. */
  get topMost(): Modal | null {
    for (let i = this._stack.length - 1; i >= 0; i--) {
      const m = this._stack[i];
      if (m.isVisible()) return m;
    }
    return null;
  }

  /**
   * Hide the topmost visible modal. Returns true if one was closed, false if
   * nothing was open. Used by the Escape handler and the Android back button.
   */
  closeTopMost(): boolean {
    const top = this.topMost;
    if (top) {
      top.hide();
      return true;
    }
    return false;
  }
}

/** Process-wide singleton. */
export const modalManager = new ModalManager();

/**
 * Wire the standard "click / tap outside the panel closes the overlay"
 * behaviour onto a modal.
 *
 * `panel` is the element that should NOT trigger a close when clicked (the
 * dialog box itself). Pass the overlay root if the whole element is the panel.
 * A pointer event whose target is outside `panel` closes the modal.
 *
 * `touchstart` is bound (passive) alongside `mousedown` for reliable dismissal
 * inside the iOS/Android WebView, matching the pre-refactor behaviour.
 *
 * Returns a disposer that detaches both listeners.
 */
export function attachOutsideClose(
  panel: HTMLElement,
  opts: { isVisible: () => boolean; close: () => void },
): () => void {
  const handler = (e: Event): void => {
    if (opts.isVisible() && !panel.contains(e.target as Node)) {
      opts.close();
    }
  };
  document.addEventListener("mousedown", handler);
  document.addEventListener("touchstart", handler, { passive: true });
  return () => {
    document.removeEventListener("mousedown", handler);
    document.removeEventListener("touchstart", handler);
  };
}
