// A terminal-style color picker (#45): a hex field (the source of truth), a
// row of preset swatches, the platform's color picker where there is one, a
// clear button, and a preview of some text in the color against the current
// theme — with a warning when Quark will outline it for low contrast.
//
// Every value is normalized before it is shown or committed, and the preview
// takes its color only through the `--user-color` custom property.

import { isLowContrast, normalizeHex } from "../app/user_color_math.js";
import { themeBackground } from "../app/user_colors.js";

export const USER_COLOR_SWATCHES = [
  "#00ff41", "#00aaff", "#ff4466", "#ffaa00", "#aa44ff", "#00ffcc",
  "#ff6600", "#44ccff", "#ff44cc", "#88ff00", "#ffffff", "#888888",
];

const WARNING = "Low contrast with this theme — Quark will outline it.";

export interface ColorFieldOptions {
  /** Text drawn in the color, e.g. the user's display name. */
  previewText: string;
  /** A color the user chose (normalized), or `null` when they cleared it. */
  onCommit?: (hex: string | null) => void;
}

export class ColorField {
  private _el: HTMLElement;
  private _hex: HTMLInputElement;
  private _native: HTMLInputElement;
  private _clear: HTMLButtonElement;
  private _swatches: HTMLButtonElement[] = [];
  private _preview: HTMLElement;
  private _warning: HTMLElement;
  private _reason: HTMLElement;
  private _value: string | null = null;
  private _onCommit: ((hex: string | null) => void) | undefined;

  constructor(opts: ColorFieldOptions) {
    this._onCommit = opts.onCommit;
    this._el = document.createElement("div");
    this._el.className = "color-field";

    const controls = document.createElement("div");
    controls.className = "color-field__controls";

    this._hex = document.createElement("input");
    this._hex.type = "text";
    this._hex.className = "color-field__hex";
    this._hex.placeholder = "#rrggbb";
    this._hex.maxLength = 7;
    this._hex.spellcheck = false;
    this._hex.autocomplete = "off";
    this._hex.setAttribute("aria-label", "Color (hex)");
    this._hex.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      this._commitTyped();
    });
    this._hex.addEventListener("change", () => this._commitTyped());
    controls.appendChild(this._hex);

    this._native = document.createElement("input");
    this._native.type = "color";
    this._native.className = "color-field__native";
    this._native.setAttribute("aria-label", "Pick a color");
    // A platform without a color picker downgrades the input to text; it
    // would only duplicate the hex field then.
    if (this._native.type !== "color") this._native.hidden = true;
    this._native.addEventListener("change", () => this._commit(normalizeHex(this._native.value)));
    controls.appendChild(this._native);

    this._clear = document.createElement("button");
    this._clear.type = "button";
    this._clear.className = "color-field__clear";
    this._clear.textContent = "[ clear ]";
    this._clear.addEventListener("click", () => this._commit(null));
    controls.appendChild(this._clear);
    this._el.appendChild(controls);

    const swatches = document.createElement("div");
    swatches.className = "color-field__swatches";
    for (const color of USER_COLOR_SWATCHES) {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "color-field__swatch";
      swatch.setAttribute("aria-label", color);
      swatch.title = color;
      swatch.style.setProperty("--swatch", color);
      swatch.addEventListener("click", () => this._commit(color));
      swatches.appendChild(swatch);
      this._swatches.push(swatch);
    }
    this._el.appendChild(swatches);

    this._preview = document.createElement("div");
    this._preview.className = "color-field__preview";
    this._preview.textContent = opts.previewText;
    this._el.appendChild(this._preview);

    this._warning = document.createElement("div");
    this._warning.className = "color-field__warning";
    this._warning.textContent = WARNING;
    this._warning.hidden = true;
    this._el.appendChild(this._warning);

    this._reason = document.createElement("div");
    this._reason.className = "color-field__reason";
    this._reason.hidden = true;
    this._el.appendChild(this._reason);
  }

  getElement(): HTMLElement {
    return this._el;
  }

  get value(): string | null {
    return this._value;
  }

  /** Show `v` (normalized; anything invalid shows as none). Never commits. */
  set value(v: string | null) {
    this._show(normalizeHex(v));
  }

  setPreviewText(text: string): void {
    this._preview.textContent = text;
  }

  setDisabled(disabled: boolean, reason?: string): void {
    for (const el of [this._hex, this._native, this._clear, ...this._swatches]) el.disabled = disabled;
    this._el.classList.toggle("color-field--disabled", disabled);
    this._reason.textContent = disabled ? reason ?? "" : "";
    this._reason.hidden = !(disabled && reason);
  }

  /** Re-judge the preview's contrast (after a theme change). */
  refreshPreview(): void {
    const low = this._value !== null && isLowContrast(this._value, themeBackground());
    this._preview.classList.toggle("user-color--low-contrast", low);
    this._warning.hidden = !low;
  }

  private _commitTyped(): void {
    const typed = this._hex.value.trim();
    if (typed === "") {
      this._commit(null);
      return;
    }
    const color = normalizeHex(typed.startsWith("#") ? typed : `#${typed}`);
    if (!color) {
      this._hex.classList.add("color-field__hex--invalid");
      return;
    }
    this._commit(color);
  }

  private _commit(color: string | null): void {
    this._show(color);
    this._onCommit?.(color);
  }

  private _show(color: string | null): void {
    this._value = color;
    this._hex.value = color ?? "";
    this._hex.classList.remove("color-field__hex--invalid");
    if (color && this._native.type === "color") this._native.value = color;
    if (color) {
      this._preview.style.setProperty("--user-color", color);
      this._preview.setAttribute("data-user-color", "");
    } else {
      this._preview.style.removeProperty("--user-color");
      this._preview.removeAttribute("data-user-color");
    }
    this.refreshPreview();
  }
}
