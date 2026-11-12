import { describe, it, expect, beforeEach, vi } from "vitest";
import { ColorField, USER_COLOR_SWATCHES } from "./ColorField.js";

const WARNING = "Low contrast with this theme — Quark will outline it.";

describe("ColorField", () => {
  let onCommit: ReturnType<typeof vi.fn>;
  let field: ColorField;
  const q = <T extends HTMLElement>(sel: string) => field.getElement().querySelector<T>(sel)!;
  const hex = () => q<HTMLInputElement>(".color-field__hex");

  function type(text: string, how: "enter" | "change" = "enter"): void {
    hex().value = text;
    if (how === "enter") hex().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    else hex().dispatchEvent(new Event("change"));
  }

  beforeEach(() => {
    document.body.innerHTML = "";
    document.documentElement.style.setProperty("--bg", "#0a0a0a");
    onCommit = vi.fn();
    field = new ColorField({ previewText: "Alice", onCommit });
    document.body.appendChild(field.getElement());
  });

  it("commits a valid hex on Enter, normalized", () => {
    type("#ABC");
    expect(onCommit).toHaveBeenCalledWith("#aabbcc");
    expect(field.value).toBe("#aabbcc");
    expect(hex().value).toBe("#aabbcc");
  });

  it("commits on blur (change)", () => {
    type("#00ff41", "change");
    expect(onCommit).toHaveBeenCalledWith("#00ff41");
  });

  it("rejects invalid hex without committing", () => {
    field.value = "#ff4466";
    type("#12");
    expect(onCommit).not.toHaveBeenCalled();
    expect(hex().classList.contains("color-field__hex--invalid")).toBe(true);
    expect(field.value).toBe("#ff4466");
    type("#00aaff");
    expect(hex().classList.contains("color-field__hex--invalid")).toBe(false);
  });

  it("empty input clears", () => {
    field.value = "#ff4466";
    type("");
    expect(onCommit).toHaveBeenCalledWith(null);
    expect(field.value).toBeNull();
  });

  it("swatch click commits that color", () => {
    const swatches = field.getElement().querySelectorAll<HTMLButtonElement>(".color-field__swatch");
    expect(swatches).toHaveLength(USER_COLOR_SWATCHES.length);
    swatches[2].click();
    expect(onCommit).toHaveBeenCalledWith(USER_COLOR_SWATCHES[2]);
    expect(swatches[2].getAttribute("aria-label")).toBe(USER_COLOR_SWATCHES[2]);
  });

  it("native picker change commits", () => {
    const native = q<HTMLInputElement>(".color-field__native");
    native.value = "#ff6600";
    native.dispatchEvent(new Event("change"));
    expect(onCommit).toHaveBeenCalledWith("#ff6600");
  });

  it("clear commits null and empties the field", () => {
    field.value = "#ff4466";
    q<HTMLButtonElement>(".color-field__clear").click();
    expect(onCommit).toHaveBeenCalledWith(null);
    expect(hex().value).toBe("");
    expect(field.value).toBeNull();
  });

  it("setting value does not fire onCommit", () => {
    field.value = "#ff4466";
    field.value = null;
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("refuses an invalid value set from code", () => {
    field.value = "url(x)";
    expect(field.value).toBeNull();
    expect(q(".color-field__preview").style.getPropertyValue("--user-color")).toBe("");
  });

  it("preview shows the text in the color with a low-contrast warning", () => {
    const preview = q(".color-field__preview");
    const warning = q(".color-field__warning");
    expect(preview.textContent).toBe("Alice");
    field.value = "#0b0b0b";
    expect(preview.style.getPropertyValue("--user-color")).toBe("#0b0b0b");
    expect(preview.classList.contains("user-color--low-contrast")).toBe(true);
    expect(warning.hidden).toBe(false);
    expect(warning.textContent).toBe(WARNING);
    field.value = "#00ff41";
    expect(preview.classList.contains("user-color--low-contrast")).toBe(false);
    expect(warning.hidden).toBe(true);
    field.setPreviewText("Alicia");
    expect(preview.textContent).toBe("Alicia");
  });

  it("re-judges contrast against a new theme on refreshPreview", () => {
    field.value = "#ffff00";
    expect(q(".color-field__warning").hidden).toBe(true);
    document.documentElement.style.setProperty("--bg", "#ffffff");
    field.refreshPreview();
    expect(q(".color-field__warning").hidden).toBe(false);
  });

  it("disabled state blocks every control and shows the reason", () => {
    field.setDisabled(true, "Your homeserver doesn't support custom profile fields.");
    for (const el of field.getElement().querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")) {
      expect(el.disabled).toBe(true);
    }
    const reason = q(".color-field__reason");
    expect(reason.hidden).toBe(false);
    expect(reason.textContent).toBe("Your homeserver doesn't support custom profile fields.");
    field.setDisabled(false);
    expect(hex().disabled).toBe(false);
    expect(reason.hidden).toBe(true);
  });
});
