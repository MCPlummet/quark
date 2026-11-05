// The settings form: one control per THEME_SCHEMA field, grouped by section.
//
// Controls only ever report values that pass `checkField`, so the theme the
// page holds is always one quark accepts. Text a user is still typing that
// isn't valid yet is marked invalid in place and reverted on blur.

import {
  THEME_SCHEMA,
  checkField,
  getField,
  type CompleteTheme,
  type ThemeField,
} from "../theme/share.js";

export type FieldChange = (path: string, value: unknown) => void;

interface Control {
  /** Show `value` without reporting a change. */
  show(value: unknown): void;
}

/** Corner + edge glyphs shown beside each border style option. */
const BORDER_SAMPLES: Record<string, string> = {
  single: "┌─┐",
  double: "╔═╗",
  rounded: "╭─╮",
  ascii: "+-+",
  none: "   ",
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: cls, ...rest } = props;
  if (cls) node.className = cls;
  Object.assign(node, rest);
  node.append(...children);
  return node;
}

function fieldId(path: string): string {
  return `f-${path.replace(/\./g, "-")}`;
}

/** `#rgb` / `#rrggbbaa` → the `#rrggbb` an `<input type=color>` accepts. */
function pickerValue(hex: string): string {
  const h = hex.slice(1).toLowerCase();
  if (h.length === 3) return `#${[...h].map((c) => c + c).join("")}`;
  return `#${h.slice(0, 6)}`;
}

export class ThemeForm {
  private readonly controls = new Map<string, Control>();

  constructor(
    private readonly root: HTMLElement,
    private readonly onChange: FieldChange,
  ) {
    for (const section of THEME_SCHEMA) {
      const body = el("div", { class: "tf-fields" });
      for (const field of section.fields) {
        const path = `${section.path}.${field.key}`;
        body.append(this.buildField(path, field));
      }
      root.append(
        el(
          "details",
          { class: "tf-sec", open: true },
          el(
            "summary",
            {},
            el("span", { class: "tf-sec-title" }, section.title),
            el("span", { class: "tf-sec-path" }, `[${section.path}]`),
          ),
          body,
        ),
      );
    }
  }

  /** Reflect a whole theme into the controls (after a preset, import or link). */
  load(theme: CompleteTheme): void {
    for (const [path, control] of this.controls) control.show(getField(theme, path));
  }

  // ── Field rows ─────────────────────────────────────────────────────────────

  private buildField(path: string, field: ThemeField): HTMLElement {
    const id = fieldId(path);
    const label = el(
      "label",
      { class: "tf-label", htmlFor: id },
      el("span", { class: "tf-key" }, field.key),
      el("span", { class: "tf-hint" }, field.hint),
    );
    const error = el("span", { class: "tf-err", id: `${id}-err`, hidden: true });
    const row = el("div", { class: `tf tf-${field.kind.type}` }, label);

    const fail = (message: string | null): void => {
      error.hidden = !message;
      error.textContent = message ?? "";
      row.classList.toggle("tf-invalid", !!message);
    };

    let control: Control;
    switch (field.kind.type) {
      case "color":
        control = this.colorControl(row, id, path, field, fail);
        break;
      case "int":
      case "float":
        control = this.numberControl(row, id, path, field, fail);
        break;
      case "enum":
        control = this.enumControl(row, path, field, label);
        break;
      default:
        control = this.textControl(row, id, path, field, fail);
    }
    this.controls.set(path, control);
    row.append(error);
    return row;
  }

  /**
   * Wire a text-ish input that commits only valid values: invalid input is
   * flagged while typing and reverted to the last good value on blur.
   */
  private committing(
    input: HTMLInputElement,
    path: string,
    field: ThemeField,
    parse: (raw: string) => unknown,
    fail: (message: string | null) => void,
    onCommit: (value: unknown) => void = () => {},
  ): { committed: () => unknown; setCommitted: (v: unknown) => void } {
    let committed: unknown;
    input.setAttribute("aria-describedby", `${input.id}-err`);
    input.addEventListener("input", () => {
      const value = parse(input.value);
      const problem = checkField(field, value);
      fail(problem);
      input.setAttribute("aria-invalid", String(!!problem));
      if (!problem && value !== committed) {
        committed = value;
        onCommit(value);
        this.onChange(path, value);
      }
    });
    input.addEventListener("blur", () => {
      if (checkField(field, parse(input.value))) {
        input.value = String(committed);
        input.setAttribute("aria-invalid", "false");
        fail(null);
      }
    });
    return { committed: () => committed, setCommitted: (v) => (committed = v) };
  }

  private colorControl(
    row: HTMLElement,
    id: string,
    path: string,
    field: ThemeField,
    fail: (message: string | null) => void,
  ): Control {
    const chip = el("span", { class: "tf-chip" });
    const picker = el("input", { type: "color", tabIndex: -1 });
    picker.setAttribute("aria-label", `${field.key} colour picker`);
    const swatch = el("span", { class: "tf-swatch" }, chip, picker);
    const hex = el("input", { type: "text", id, class: "tf-hex", spellcheck: false, maxLength: 9 });
    row.append(el("div", { class: "tf-input" }, swatch, hex));

    const paint = (value: string): void => {
      chip.style.background = value;
      picker.value = pickerValue(value);
    };
    // Accept "ff8800" as well as "#ff8800" — people paste both.
    const parse = (raw: string): string => {
      const s = raw.trim();
      return (s.startsWith("#") ? s : `#${s}`).toLowerCase();
    };
    const state = this.committing(hex, path, field, parse, fail, (v) => paint(v as string));

    picker.addEventListener("input", () => {
      // The native picker has no alpha channel; keep an existing one.
      const prev = String(state.committed());
      const alpha = prev.length === 9 ? prev.slice(7) : "";
      const value = picker.value.toLowerCase() + alpha;
      hex.value = value;
      fail(null);
      chip.style.background = value;
      state.setCommitted(value);
      this.onChange(path, value);
    });

    return {
      show(value) {
        const v = String(value);
        state.setCommitted(v);
        hex.value = v;
        paint(v);
        fail(null);
      },
    };
  }

  private textControl(
    row: HTMLElement,
    id: string,
    path: string,
    field: ThemeField,
    fail: (message: string | null) => void,
  ): Control {
    const input = el("input", { type: "text", id, class: "tf-text", spellcheck: false });
    if (field.optional) input.placeholder = "(optional)";
    row.append(el("div", { class: "tf-input" }, input));
    const state = this.committing(input, path, field, (raw) => raw, fail);
    return {
      show(value) {
        state.setCommitted(value);
        input.value = String(value ?? "");
        fail(null);
      },
    };
  }

  private numberControl(
    row: HTMLElement,
    id: string,
    path: string,
    field: ThemeField,
    fail: (message: string | null) => void,
  ): Control {
    const kind = field.kind as Extract<ThemeField["kind"], { type: "int" | "float" }>;
    const step = kind.type === "float" ? String(kind.step) : "1";
    const range = el("input", { type: "range", min: String(kind.min), max: String(kind.max), step, tabIndex: -1 });
    range.setAttribute("aria-hidden", "true");
    const num = el("input", { type: "number", id, class: "tf-num", step });
    if (kind.type === "int") {
      num.min = String(kind.enforce ? kind.min : 0);
      if (kind.enforce) num.max = String(kind.max);
    }
    row.append(el("div", { class: "tf-input" }, range, num));

    const parse = (raw: string): unknown => (raw.trim() === "" ? NaN : Number(raw));
    const state = this.committing(num, path, field, parse, fail, (v) => (range.value = String(v)));

    range.addEventListener("input", () => {
      const value = Number(range.value);
      num.value = range.value;
      fail(null);
      state.setCommitted(value);
      this.onChange(path, value);
    });

    return {
      show(value) {
        state.setCommitted(value);
        num.value = String(value);
        range.value = String(value);
        fail(null);
      },
    };
  }

  private enumControl(row: HTMLElement, path: string, field: ThemeField, label: HTMLElement): Control {
    const kind = field.kind as Extract<ThemeField["kind"], { type: "enum" }>;
    const group = el("div", { class: "tf-seg", role: "radiogroup" });
    const labelId = `${fieldId(path)}-label`;
    label.id = labelId;
    group.setAttribute("aria-labelledby", labelId);

    const radios = kind.options.map((option) => {
      const radio = el("input", { type: "radio", name: path, value: option });
      radio.addEventListener("change", () => {
        if (radio.checked) this.onChange(path, option);
      });
      const sample = BORDER_SAMPLES[option];
      group.append(
        el(
          "label",
          { class: "tf-seg-opt" },
          radio,
          ...(sample !== undefined ? [el("span", { class: "tf-seg-glyph" }, sample)] : []),
          el("span", {}, option),
        ),
      );
      return radio;
    });
    row.append(group);

    return {
      show(value) {
        for (const r of radios) r.checked = r.value === value;
      },
    };
  }
}
