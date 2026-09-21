// Shared dialog/modal scaffolding.
//
// Every modal dialog in the app used to hand-roll the same chrome: a root
// overlay element (role="dialog", aria-modal, tabindex=-1, display:none), a
// copy-pasted "click outside closes" handler, an Escape / Ctrl+[ keydown
// handler that also routed unmatched keys through
// `keymapManager.resolveKey(key, "picker")`, a header with a title and a close
// button, and identical show/hide/isVisible plumbing. This module centralises
// all of that.
//
// Two structural shapes are supported via the `panel` option:
//   - panel: true  — the root is a full-screen flex backdrop and the visible
//     "box" is a separate `.{prefix}__panel` element. Clicking the backdrop
//     (outside the panel) closes. This is the SettingsDialog family.
//   - panel: false — the root element IS the box (no separate backdrop). A
//     document-level outside-click handler closes it. This is RoomInfoDialog /
//     ProfileDialog.
//
// Subclasses own their CONTENT: they append into `this.content` (the panel for
// panelled dialogs, or the root for box dialogs). The base owns the chrome.
//
// The CSS class prefix is parameterised so existing stylesheets keep matching
// — DialogBase does not introduce or restyle anything. The only intentional
// visual change is unifying the header close button to read "[× Esc]" with the
// shared `dialog-close-btn` class.

import { keymapManager } from "../vim/keybindings.js";
import { modalManager, attachOutsideClose, type Modal } from "./ModalManager.js";

export interface DialogBaseOptions {
  /** BEM-style class prefix, e.g. "settings-dialog" or "room-info-dialog". */
  prefix: string;
  /** aria-label for the root dialog element. */
  ariaLabel: string;
  /**
   * When true the root is a full-screen backdrop containing a `__panel` box.
   * When false the root element itself is the box. Default: true.
   */
  panel?: boolean;
  /**
   * `display` value used when showing the root. Backdrop dialogs use "flex";
   * box dialogs historically also used "flex". Default: "flex".
   */
  showDisplay?: string;
  /** Whether `hide()` should call `keymapManager.resetSequence()`. Default: true. */
  resetSequenceOnHide?: boolean;
}

/**
 * Outcome of the default key handler so subclasses can compose extra keys
 * before/after delegating to the base routing.
 */
export type DialogKeyOutcome = "handled" | "ignored";

export abstract class DialogBase implements Modal {
  /** Root overlay element appended to document.body by App. */
  protected readonly root: HTMLElement;
  /**
   * Element subclasses build their content into. For panelled dialogs this is
   * the `__panel` box; for box dialogs it is the root itself.
   */
  protected readonly content: HTMLElement;
  /** The header element (present unless `buildHeader` was skipped). */
  protected header: HTMLElement | null = null;
  /** The title span inside the header, for subclasses that retitle at runtime. */
  protected titleEl: HTMLElement | null = null;

  protected readonly prefix: string;
  private readonly _showDisplay: string;
  private readonly _resetSequenceOnHide: boolean;

  constructor(opts: DialogBaseOptions) {
    this.prefix = opts.prefix;
    this._showDisplay = opts.showDisplay ?? "flex";
    this._resetSequenceOnHide = opts.resetSequenceOnHide ?? true;
    const panelled = opts.panel ?? true;

    this.root = document.createElement("div");
    this.root.className = opts.prefix;
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-label", opts.ariaLabel);
    this.root.setAttribute("aria-modal", "true");
    this.root.setAttribute("tabindex", "-1");
    this.root.style.display = "none";

    if (panelled) {
      const panel = document.createElement("div");
      panel.className = `${opts.prefix}__panel`;
      panel.tabIndex = -1;
      this.root.appendChild(panel);
      this.content = panel;

      // Backdrop click (outside the panel) closes.
      this.root.addEventListener("click", (e) => {
        if (e.target === this.root) this.onBackdropClick();
      });
    } else {
      // Root is the box; close on any document click that lands outside it.
      this.content = this.root;
      attachOutsideClose(this.root, {
        isVisible: () => this.isVisible(),
        close: () => this.hide(),
      });
    }

    // Default keydown routing. Subclasses that need extra keys override
    // `handleKeydown` and may call `routeKey` for the shared tail behaviour.
    this.root.addEventListener("keydown", (e) => this.handleKeydown(e));
  }

  // ── Chrome builders ──────────────────────────────────────────────────────

  /**
   * Build the standard header (title span + close button) and append it to the
   * content box. Returns the header element. `closeAriaLabel` defaults to
   * "Close".
   */
  protected buildHeader(titleText: string, closeAriaLabel = "Close"): HTMLElement {
    const header = document.createElement("div");
    header.className = `${this.prefix}__header`;

    const title = document.createElement("span");
    title.className = `${this.prefix}__title`;
    title.textContent = titleText;
    header.appendChild(title);

    const closeBtn = this.makeCloseButton(closeAriaLabel);
    header.appendChild(closeBtn);

    this.content.appendChild(header);
    this.header = header;
    this.titleEl = title;
    return header;
  }

  /**
   * Create the standardised close button: text "[× Esc]", class
   * `{prefix}__close-hint dialog-close-btn`, tabindex -1, wired to `onClose`
   * (defaults to `hide`). Exposed so dialogs that build a bespoke header can
   * still drop in the canonical button.
   */
  protected makeCloseButton(ariaLabel = "Close", onClose?: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `${this.prefix}__close-hint dialog-close-btn`;
    btn.textContent = "[× Esc]";
    btn.setAttribute("aria-label", ariaLabel);
    btn.tabIndex = -1;
    btn.addEventListener("click", () => (onClose ? onClose() : this.hide()));
    return btn;
  }

  /**
   * Swap `pane` for a fresh, empty element with the same class and position, and
   * return the replacement.
   *
   * For a dialog whose tab builders are async — they await IPC before appending
   * their rows — emptying one shared content element is not enough. A build
   * suspended at an `await` when the user switches tabs resumes afterwards and
   * appends into whatever element it captured, which by then is the element
   * showing a different tab: opening the room dialog on Info before the
   * notification config had cached and pressing Tab put Info's rows inside
   * Settings. Replacing the element instead leaves the stale build writing into a
   * detached node, where nothing can see it, and the replacement keeps the same
   * class and parent so the styling is untouched.
   *
   * Lives here because both tabbed dialogs need it and the reasoning is the same
   * for each; they are otherwise deliberately parallel (same chrome, controls and
   * stylesheet).
   */
  protected replaceContentPane(pane: HTMLElement): HTMLElement {
    const fresh = document.createElement("div");
    fresh.className = pane.className;
    pane.replaceWith(fresh);
    return fresh;
  }

  // ── Modal interface ────────────────────────────────────────────────────────

  getElement(): HTMLElement {
    return this.root;
  }

  isVisible(): boolean {
    return this.root.style.display !== "none";
  }

  /**
   * Reveal the dialog. Registers with the modal manager and focuses the
   * configured target (the content box by default). Subclasses typically wrap
   * this with their own `show(...)` that populates content first, then calls
   * `super.show()` (or `reveal()`).
   */
  protected reveal(): void {
    this.root.style.display = this._showDisplay;
    modalManager.push(this);
    this.focusTarget().focus();
  }

  hide(): void {
    this.root.style.display = "none";
    modalManager.remove(this);
    if (this._resetSequenceOnHide) keymapManager.resetSequence();
    this.onHide();
  }

  /**
   * Hook for subclasses to run extra teardown on hide (clear lists, drop
   * callbacks, cancel timers). Default no-op. Called after the root is hidden
   * and the modal manager + key sequence are cleaned up.
   */
  protected onHide(): void {}

  /**
   * Called when a panelled dialog's backdrop (outside the panel) is clicked.
   * Defaults to dismissing the dialog. Override when a backdrop click needs to
   * run extra logic first (e.g. Verification denies the request).
   */
  protected onBackdropClick(): void {
    this.hide();
  }

  /**
   * Element focused when the dialog is revealed. Defaults to the content box.
   * Override to focus an input or a list row instead.
   */
  protected focusTarget(): HTMLElement {
    return this.content;
  }

  // ── Keyboard ───────────────────────────────────────────────────────────────

  /**
   * Default keydown handler: stops propagation, closes on Escape / Ctrl+[, and
   * otherwise routes through the shared picker keymap (close action closes;
   * partial sequences are swallowed). Subclasses with extra keys (Tab, arrows,
   * Enter, j/k) override this and call `routeKey` for the tail behaviour.
   */
  protected handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();
    if (this.isEscape(e)) {
      e.preventDefault();
      this.hide();
      return;
    }
    this.routeKey(e);
  }

  /** True for Escape or the vim Ctrl+[ equivalent. */
  protected isEscape(e: KeyboardEvent): boolean {
    return e.key === "Escape" || (e.ctrlKey && e.key === "[");
  }

  /**
   * Route an unmatched key through `keymapManager.resolveKey(key, "picker")`:
   * a resolved "close" action hides the dialog; a partial sequence is consumed
   * (preventDefault). Returns whether the key was handled, so subclasses can
   * decide whether to fall through to other behaviour.
   */
  protected routeKey(e: KeyboardEvent): DialogKeyOutcome {
    const result = keymapManager.resolveKey(e.key, "picker");
    if (result.kind === "action" && result.action === "close") {
      e.preventDefault();
      this.hide();
      return "handled";
    }
    if (result.kind === "partial") {
      e.preventDefault();
      return "handled";
    }
    return "ignored";
  }

  // ── Shared form-row builders ─────────────────────────────────────────────────
  //
  // These were duplicated near-verbatim across SettingsDialog,
  // RoomSettingsDialog and SpaceSettingsDialog. They emit the same
  // `settings-dialog__*` classes the existing CSS targets, so callers using a
  // different prefix should pass `rowPrefix: "settings-dialog"` (the default).

  /** Class prefix used by the form-row builders. The settings-family dialogs
   * share the `settings-dialog` row styling regardless of their own prefix. */
  protected rowPrefix = "settings-dialog";

  /** Labelled single-line text input row. Returns the input for callers that
   * need to read it later. `extraInputClass` appends to the input className
   * (e.g. the wide-input variant used by room/space settings). */
  protected makeTextRow(
    label: string,
    value: string,
    placeholder: string,
    onChange: (v: string) => void,
    extraInputClass = "",
  ): { row: HTMLElement; input: HTMLInputElement } {
    const row = document.createElement("div");
    row.className = `${this.rowPrefix}__row`;
    const lbl = document.createElement("span");
    lbl.className = `${this.rowPrefix}__label`;
    lbl.textContent = label;
    const input = document.createElement("input");
    input.type = "text";
    input.className = `${this.rowPrefix}__text-input${extraInputClass ? " " + extraInputClass : ""}`;
    input.value = value;
    input.placeholder = placeholder;
    input.addEventListener("input", () => onChange(input.value));
    row.appendChild(lbl);
    row.appendChild(input);
    return { row, input };
  }

  /** Labelled <select> row. */
  protected makeSelectRow(
    label: string,
    value: string,
    options: [string, string][],
    onChange: (v: string) => void,
  ): HTMLElement {
    const row = document.createElement("div");
    row.className = `${this.rowPrefix}__row`;
    const lbl = document.createElement("span");
    lbl.className = `${this.rowPrefix}__label`;
    lbl.textContent = label;
    const sel = document.createElement("select");
    sel.className = `${this.rowPrefix}__select`;
    for (const [val, display] of options) {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = display;
      if (val === value) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => onChange(sel.value));
    row.appendChild(lbl);
    row.appendChild(sel);
    return row;
  }

  /** Labelled number input row with optional min/max/step. */
  protected makeNumberRow(
    label: string,
    value: number,
    onChange: (v: number) => void,
    bounds?: { min?: number; max?: number; step?: number },
  ): HTMLElement {
    const row = document.createElement("div");
    row.className = `${this.rowPrefix}__row`;
    const lbl = document.createElement("span");
    lbl.className = `${this.rowPrefix}__label`;
    lbl.textContent = label;
    const input = document.createElement("input");
    input.type = "number";
    input.className = `${this.rowPrefix}__number-input`;
    input.value = String(value);
    if (bounds?.min !== undefined) input.min = String(bounds.min);
    if (bounds?.max !== undefined) input.max = String(bounds.max);
    if (bounds?.step !== undefined) input.step = String(bounds.step);
    input.addEventListener("change", () => {
      const v = parseInt(input.value, 10);
      if (!isNaN(v)) onChange(v);
    });
    row.appendChild(lbl);
    row.appendChild(input);
    return row;
  }

  /** Checkbox row (label wraps the input). */
  protected makeCheckbox(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
    const row = document.createElement("div");
    row.className = `${this.rowPrefix}__row`;
    const lbl = document.createElement("label");
    lbl.className = `${this.rowPrefix}__checkbox-label`;
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = checked;
    cb.addEventListener("change", () => onChange(cb.checked));
    lbl.appendChild(cb);
    lbl.append(" " + label);
    row.appendChild(lbl);
    return row;
  }
}
