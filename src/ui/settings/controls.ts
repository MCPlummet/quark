// src/ui/settings/controls.ts
//
// Standalone DOM builders for settings tab content. These emit the same
// `settings-dialog__*` CSS classes as SettingsDialog / DialogBase so the
// existing stylesheet in base.css applies without modification.
//
// Intentionally decoupled from DialogBase — tab modules must not depend on
// any class instance to stay independently testable and lazy-loadable.

import { showError } from "../NotificationToast.js";

/**
 * A backend-owned switch: something with a live state the backend reports, that
 * applies the moment it is flipped rather than on [save].
 *
 * Push and background sync are both this shape — a supported/enabled snapshot,
 * a toggle with an immediate side effect (registering a pusher, starting a
 * foreground service), and a status line describing what the backend actually
 * did. Any further mobile switch would be a third copy of the same forty lines.
 */
export interface ToggleState {
  /** This platform/build can do it at all. False hides the whole section. */
  supported: boolean;
  /** The user's persisted preference. */
  enabled: boolean;
}

export interface ToggleSectionSpec<S extends ToggleState> {
  title: string;
  label: string;
  /** Fetch the current state. Called once to build, and after every flip. */
  get: () => Promise<S>;
  /** Apply the new preference. */
  set: (enabled: boolean) => Promise<void>;
  /** The live status line under the toggle. */
  status: (state: S) => string;
  /** Explanatory text under the section. */
  hint: (state: S) => string;
  /**
   * Anything bespoke this section needs (Android's battery-exemption button).
   * `refresh` re-reads the backend and repaints the status, returning the new
   * state so the caller can react to it.
   */
  extra?: (state: S, refresh: () => Promise<S>) => HTMLElement | null;
  /**
   * Show the toggle, but don't let it be flipped. For a switch this section
   * reports rather than owns — iOS push follows the master notification
   * setting — where hiding it would leave the status line with nothing to
   * belong to, and leaving it live would let the user set a value the next
   * save overwrites.
   */
  readOnly?: (state: S) => boolean;
  /** Prefix for the toast shown when a flip fails. */
  failureLabel: string;
}

export interface SettingsControls {
  checkbox(
    label: string,
    checked: boolean,
    onChange: (v: boolean) => void,
    opts?: { disabled?: boolean }
  ): HTMLElement;
  numberRow(label: string, value: number, min: number, max: number, onChange: (v: number) => void): HTMLElement;
  selectRow(label: string, value: string, options: [string, string][], onChange: (v: string) => void): HTMLElement;
  textRow(label: string, value: string, placeholder: string, onChange: (v: string) => void): HTMLElement;
  readRow(label: string, value: string): HTMLElement;
  saveButton(onClick: () => Promise<void>): HTMLButtonElement;
  dispatchButton(label: string, ariaLabel: string, onClick: () => void): HTMLElement;
  sectionTitle(text: string): HTMLElement;
  loadingSection(content: HTMLElement): { section: HTMLElement; loading: HTMLElement };
  toggleSection<S extends ToggleState>(spec: ToggleSectionSpec<S>): Promise<HTMLElement | null>;
}

export function makeControls(): SettingsControls {
  return {
    /** Checkbox row — label wraps the input (matches DialogBase.makeCheckbox). */
    checkbox(
      label: string,
      checked: boolean,
      onChange: (v: boolean) => void,
      opts?: { disabled?: boolean }
    ): HTMLElement {
      const row = document.createElement("div");
      row.className = "settings-dialog__row";
      const lbl = document.createElement("label");
      lbl.className = "settings-dialog__checkbox-label";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = checked;
      cb.disabled = opts?.disabled ?? false;
      cb.addEventListener("change", () => onChange(cb.checked));
      lbl.appendChild(cb);
      lbl.append(" " + label);
      row.appendChild(lbl);
      return row;
    },

    /** Labelled number input row with min/max (matches DialogBase.makeNumberRow). */
    numberRow(label: string, value: number, min: number, max: number, onChange: (v: number) => void): HTMLElement {
      const row = document.createElement("div");
      row.className = "settings-dialog__row";
      const lbl = document.createElement("span");
      lbl.className = "settings-dialog__label";
      lbl.textContent = label;
      const input = document.createElement("input");
      input.type = "number";
      input.className = "settings-dialog__number-input";
      input.value = String(value);
      input.min = String(min);
      input.max = String(max);
      input.addEventListener("change", () => {
        const v = parseInt(input.value, 10);
        if (!isNaN(v)) onChange(v);
      });
      row.appendChild(lbl);
      row.appendChild(input);
      return row;
    },

    /** Labelled <select> row (matches DialogBase.makeSelectRow). */
    selectRow(label: string, value: string, options: [string, string][], onChange: (v: string) => void): HTMLElement {
      const row = document.createElement("div");
      row.className = "settings-dialog__row";
      const lbl = document.createElement("span");
      lbl.className = "settings-dialog__label";
      lbl.textContent = label;
      const sel = document.createElement("select");
      sel.className = "settings-dialog__select";
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
    },

    /** Labelled single-line text input row (matches DialogBase.makeTextRow). */
    textRow(label: string, value: string, placeholder: string, onChange: (v: string) => void): HTMLElement {
      const row = document.createElement("div");
      row.className = "settings-dialog__row";
      const lbl = document.createElement("span");
      lbl.className = "settings-dialog__label";
      lbl.textContent = label;
      const input = document.createElement("input");
      input.type = "text";
      input.className = "settings-dialog__text-input";
      input.value = value;
      input.placeholder = placeholder;
      input.addEventListener("input", () => onChange(input.value));
      row.appendChild(lbl);
      row.appendChild(input);
      return row;
    },

    /** Read-only label/value row (ported from SettingsDialog makeReadRow). */
    readRow(label: string, value: string): HTMLElement {
      const row = document.createElement("div");
      row.className = "settings-dialog__row";
      const lbl = document.createElement("span");
      lbl.className = "settings-dialog__label";
      lbl.textContent = label;
      const val = document.createElement("span");
      val.className = "settings-dialog__value";
      val.textContent = value;
      row.appendChild(lbl);
      row.appendChild(val);
      return row;
    },

    /** Save button with transient feedback (ported from SettingsDialog._makeSaveButton). */
    saveButton(onClick: () => Promise<void>): HTMLButtonElement {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "settings-dialog__btn";
      btn.textContent = "[save]";
      btn.addEventListener("click", async () => {
        try {
          await onClick();
          btn.textContent = "[saved!]";
        } catch {
          btn.textContent = "[error]";
        }
        setTimeout(() => { btn.textContent = "[save]"; }, 1500);
      });
      return btn;
    },

    /**
     * Button row that calls an arbitrary onClick handler when clicked
     * (generalised from SettingsDialog's inline makeDispatchBtn which dispatched
     * a quark:action event — callers pass their own handler instead).
     */
    dispatchButton(label: string, ariaLabel: string, onClick: () => void): HTMLElement {
      const row = document.createElement("div");
      row.className = "settings-dialog__row";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "settings-dialog__btn";
      btn.textContent = label;
      btn.setAttribute("aria-label", ariaLabel);
      btn.addEventListener("click", onClick);
      row.appendChild(btn);
      return row;
    },

    /** Section heading (ported from SettingsDialog._makeSectionTitle). */
    sectionTitle(text: string): HTMLElement {
      const el = document.createElement("div");
      el.className = "settings-dialog__section-title";
      el.textContent = text;
      return el;
    },

    /**
     * Creates a `settings-dialog__section` div with a "Loading..." placeholder
     * row appended to `content`, then returns both elements so the caller can
     * replace the placeholder once async data arrives
     * (ported from SettingsDialog._makeLoadingSection, but takes the content
     * element as a parameter rather than accessing `this._contentEl`).
     */
    loadingSection(content: HTMLElement): { section: HTMLElement; loading: HTMLElement } {
      const section = document.createElement("div");
      section.className = "settings-dialog__section";
      const loading = document.createElement("div");
      loading.className = "settings-dialog__row";
      loading.textContent = "Loading...";
      section.appendChild(loading);
      content.appendChild(section);
      return { section, loading };
    },

    /**
     * Build a section for a backend-owned switch, or return null when this
     * platform doesn't support it (or the backend can't be reached).
     *
     * The toggle applies immediately: these switches have homeserver- or
     * OS-side effects, so deferring them to [save] would let a stale draft
     * contradict what already happened.
     */
    async toggleSection<S extends ToggleState>(spec: ToggleSectionSpec<S>): Promise<HTMLElement | null> {
      let state: S;
      try {
        state = await spec.get();
      } catch (err) {
        // The rest of the tab still works, but stay noisy about it: an
        // unsupported platform reports `supported: false`, it does not throw,
        // so a rejection here is a real IPC failure and not a normal absence.
        showError(`${spec.failureLabel} unavailable: ${errorText(err)}`);
        return null;
      }
      if (!state.supported) return null;

      const section = document.createElement("div");
      section.className = "settings-dialog__section";
      section.appendChild(this.sectionTitle(spec.title));

      const status = document.createElement("div");
      status.className = "settings-dialog__hint";

      const hint = document.createElement("div");
      hint.className = "settings-dialog__hint";

      // Both lines are derived from the same state, so both have to be
      // repainted together. Repainting only the status leaves the two
      // contradicting each other — a status reading "waiting for org.ntfy"
      // under a hint still telling the user to choose a distributor.
      const paint = (s: S) => {
        status.textContent = spec.status(s);
        hint.textContent = spec.hint(s);
      };
      paint(state);

      const refresh = async (): Promise<S> => {
        const next = await spec.get();
        paint(next);
        return next;
      };

      section.appendChild(this.checkbox(
        spec.label,
        state.enabled,
        (v) => {
          void spec.set(v)
            .then(refresh)
            .catch((err) => showError(`${spec.failureLabel} failed: ${errorText(err)}`));
        },
        { disabled: spec.readOnly?.(state) ?? false }
      ));
      section.appendChild(status);

      const extra = spec.extra?.(state, refresh);
      if (extra) section.appendChild(extra);

      section.appendChild(hint);

      return section;
    },
  };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
