// src/ui/settings/controls.ts
//
// Standalone DOM builders for settings tab content. These emit the same
// `settings-dialog__*` CSS classes as SettingsDialog / DialogBase so the
// existing stylesheet in base.css applies without modification.
//
// Intentionally decoupled from DialogBase — tab modules must not depend on
// any class instance to stay independently testable and lazy-loadable.

export interface SettingsControls {
  checkbox(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement;
  numberRow(label: string, value: number, min: number, max: number, onChange: (v: number) => void): HTMLElement;
  selectRow(label: string, value: string, options: [string, string][], onChange: (v: string) => void): HTMLElement;
  textRow(label: string, value: string, placeholder: string, onChange: (v: string) => void): HTMLElement;
  readRow(label: string, value: string): HTMLElement;
  saveButton(onClick: () => Promise<void>): HTMLButtonElement;
  dispatchButton(label: string, ariaLabel: string, onClick: () => void): HTMLElement;
  sectionTitle(text: string): HTMLElement;
  loadingSection(content: HTMLElement): { section: HTMLElement; loading: HTMLElement };
}

export function makeControls(): SettingsControls {
  return {
    /** Checkbox row — label wraps the input (matches DialogBase.makeCheckbox). */
    checkbox(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
      const row = document.createElement("div");
      row.className = "settings-dialog__row";
      const lbl = document.createElement("label");
      lbl.className = "settings-dialog__checkbox-label";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = checked;
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
  };
}
