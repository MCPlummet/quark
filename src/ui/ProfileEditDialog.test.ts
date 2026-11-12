import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { ProfileEditDialog, type ProfileEditInitial, type ProfileEditSubmit } from "./ProfileEditDialog.js";
import { USER_COLOR_SWATCHES } from "./ColorField.js";

const UNSUPPORTED = "Your homeserver doesn't support custom profile fields.";

describe("ProfileEditDialog — color", () => {
  let d: ProfileEditDialog;
  let onSubmit: ReturnType<typeof vi.fn>;
  const q = <T extends HTMLElement>(sel: string) => d.getElement().querySelector<T>(sel)!;

  const initial = (over: Partial<ProfileEditInitial> = {}): ProfileEditInitial => ({
    userId: "@me:x",
    displayName: "Me",
    statusMessage: null,
    userColor: "#00aaff",
    userColorSettable: true,
    ...over,
  });

  function open(over: Partial<ProfileEditInitial> = {}): void {
    d.show(initial(over), onSubmit);
  }

  const save = async () => {
    q<HTMLButtonElement>(".profile-edit-dialog__btn--primary").click();
    await Promise.resolve();
    await Promise.resolve();
  };
  const submitted = (): ProfileEditSubmit => onSubmit.mock.calls[0][0];

  beforeEach(() => {
    document.documentElement.style.setProperty("--bg", "#0a0a0a");
    d = new ProfileEditDialog();
    document.body.appendChild(d.getElement());
    onSubmit = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    d.getElement().remove();
  });

  it("shows the current color", () => {
    open();
    expect(q<HTMLInputElement>(".color-field__hex").value).toBe("#00aaff");
  });

  it("color change alone is a change", async () => {
    open();
    d.getElement().querySelectorAll<HTMLButtonElement>(".color-field__swatch")[3].click();
    await save();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(submitted().userColorChanged).toBe(true);
    expect(submitted().userColor).toBe(USER_COLOR_SWATCHES[3]);
    expect(submitted().displayNameChanged).toBe(false);
  });

  it("clearing submits null", async () => {
    open();
    q<HTMLButtonElement>(".color-field__clear").click();
    await save();
    expect(submitted().userColor).toBeNull();
    expect(submitted().userColorChanged).toBe(true);
  });

  it("nothing changed still short-circuits", async () => {
    open();
    await save();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(q(".profile-edit-dialog__status").textContent).toBe("Nothing changed.");
  });

  it("preview follows the display name input", () => {
    open();
    expect(q(".color-field__preview").textContent).toBe("Me");
    const name = q<HTMLInputElement>(".profile-edit-dialog__input");
    name.value = "Myself";
    name.dispatchEvent(new Event("input"));
    expect(q(".color-field__preview").textContent).toBe("Myself");
  });

  it("disables the row when the server can't store it", () => {
    open({ userColorSettable: false });
    expect(q<HTMLInputElement>(".color-field__hex").disabled).toBe(true);
    expect(q(".color-field__reason").textContent).toBe(UNSUPPORTED);
    expect(q(".color-field__reason").hidden).toBe(false);
  });

  it("unknown support leaves the row enabled", () => {
    open({ userColorSettable: null });
    expect(q<HTMLInputElement>(".color-field__hex").disabled).toBe(false);
  });

  it("re-enables the row for the next opening", () => {
    open({ userColorSettable: false });
    d.hide();
    open({ userColorSettable: true });
    expect(q<HTMLInputElement>(".color-field__hex").disabled).toBe(false);
  });

  const renameTo = (name: string) => {
    const input = q<HTMLInputElement>(".profile-edit-dialog__input");
    input.value = name;
    input.dispatchEvent(new Event("input"));
  };
  const enterOn = (el: HTMLElement): KeyboardEvent => {
    const e = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    return e;
  };

  it("Enter on a swatch or [ clear ] presses that button, not save", async () => {
    open();
    renameTo("Myself");
    for (const button of [
      d.getElement().querySelectorAll<HTMLButtonElement>(".color-field__swatch")[1],
      q<HTMLButtonElement>(".color-field__clear"),
    ]) {
      const e = enterOn(button);
      await Promise.resolve();
      expect(e.defaultPrevented).toBe(false);
    }
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("won't save over a color typed wrong", async () => {
    open();
    renameTo("Myself");
    const hex = q<HTMLInputElement>(".color-field__hex");
    hex.value = "#12";
    enterOn(hex);
    await Promise.resolve();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(q(".profile-edit-dialog__status").textContent).toBe("That isn't a color — use #rrggbb.");
    hex.value = "#00ff41";
    enterOn(hex);
    await Promise.resolve();
    expect(submitted().userColor).toBe("#00ff41");
  });

  it("surfaces a save failure", async () => {
    onSubmit.mockRejectedValue(new Error(UNSUPPORTED));
    open();
    d.getElement().querySelectorAll<HTMLButtonElement>(".color-field__swatch")[0].click();
    await save();
    await Promise.resolve();
    expect(q(".profile-edit-dialog__status").textContent).toBe(`Failed: ${UNSUPPORTED}`);
  });
});
