import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { ProfileDialog, type ProfileData } from "./ProfileDialog.js";
import { USER_COLOR_SWATCHES } from "./ColorField.js";

describe("ProfileDialog — local color", () => {
  let d: ProfileDialog;
  let onSetLocal: ReturnType<typeof vi.fn>;
  const q = <T extends HTMLElement>(sel: string) => d.getElement().querySelector<T>(sel);

  const data = (over: Partial<ProfileData> = {}): ProfileData => ({
    userId: "@alice:x",
    displayName: "Alice",
    avatarUrl: null,
    color: { published: "#ff4466", local: null, onSetLocal },
    ...over,
  });

  beforeEach(() => {
    document.documentElement.style.setProperty("--bg", "#0a0a0a");
    onSetLocal = vi.fn().mockResolvedValue(undefined);
    d = new ProfileDialog();
    document.body.appendChild(d.getElement());
  });

  afterEach(() => {
    d.hide();
    d.getElement().remove();
  });

  it("shows the local color row for another user", () => {
    d.show(data({ color: { published: "#ff4466", local: "#00aaff", onSetLocal } }));
    const row = q(".profile-dialog__color-row")!;
    expect(row.style.display).toBe("");
    expect(row.textContent).toContain("local color");
    expect(q<HTMLInputElement>(".color-field__hex")!.value).toBe("#00aaff");
    expect(q(".profile-dialog__published-color")!.textContent).toBe("their color: #ff4466");
  });

  it("says when they have none, or it isn't known", () => {
    d.show(data({ color: { published: null, local: null, onSetLocal } }));
    expect(q(".profile-dialog__published-color")!.textContent).toBe("their color: none");
    d.show(data({ color: { published: undefined, local: null, onSetLocal } }));
    expect(q(".profile-dialog__published-color")!.textContent).toBe("their color: unknown");
  });

  it("hides the row when no color data is passed", () => {
    d.show(data({ color: undefined }));
    expect(q(".profile-dialog__color-row")!.style.display).toBe("none");
  });

  it("commits an override through onSetLocal", () => {
    d.show(data());
    d.getElement().querySelectorAll<HTMLButtonElement>(".color-field__swatch")[2].click();
    expect(onSetLocal).toHaveBeenCalledWith(USER_COLOR_SWATCHES[2]);
  });

  it("clear removes the override", () => {
    d.show(data({ color: { published: "#ff4466", local: "#00aaff", onSetLocal } }));
    q<HTMLButtonElement>(".color-field__clear")!.click();
    expect(onSetLocal).toHaveBeenCalledWith(null);
  });

  it("commits to the user shown now, not an earlier one", () => {
    const first = vi.fn().mockResolvedValue(undefined);
    d.show(data({ color: { published: null, local: null, onSetLocal: first } }));
    d.show(data({ userId: "@bob:x" }));
    q<HTMLButtonElement>(".color-field__clear")!.click();
    expect(first).not.toHaveBeenCalled();
    expect(onSetLocal).toHaveBeenCalledWith(null);
  });

  it("typing in the hex field doesn't trigger dialog shortcuts", () => {
    d.show(data());
    const hex = q<HTMLInputElement>(".color-field__hex")!;
    hex.dispatchEvent(new KeyboardEvent("keydown", { key: "q", bubbles: true }));
    expect(d.isVisible()).toBe(true);
  });

  it("Escape in the hex field still closes", () => {
    d.show(data());
    const hex = q<HTMLInputElement>(".color-field__hex")!;
    hex.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(d.isVisible()).toBe(false);
  });
});
