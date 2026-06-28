import { describe, it, expect, afterEach } from "vitest";
import { PasswordPromptDialog } from "./PasswordPromptDialog.js";

describe("PasswordPromptDialog", () => {
  let d: PasswordPromptDialog;

  afterEach(() => {
    d.getElement().remove();
  });

  it("resolves the typed value when submit clicked", async () => {
    d = new PasswordPromptDialog();
    document.body.appendChild(d.getElement());
    const p = d.prompt({ title: "Enter password" });
    const input = d.getElement().querySelector("input[type=password]") as HTMLInputElement;
    input.value = "s3cr3t";
    (d.getElement().querySelector("[data-act='submit']") as HTMLButtonElement).click();
    expect(await p).toBe("s3cr3t");
  });

  it("resolves null when cancel clicked", async () => {
    d = new PasswordPromptDialog();
    document.body.appendChild(d.getElement());
    const p = d.prompt({ title: "Enter password" });
    (d.getElement().querySelector("[data-act='cancel']") as HTMLButtonElement).click();
    expect(await p).toBeNull();
  });

  it("resolves null when hidden without explicit choice (Esc / backdrop path)", async () => {
    d = new PasswordPromptDialog();
    document.body.appendChild(d.getElement());
    const p = d.prompt({ title: "Enter password" });
    d.hide();
    expect(await p).toBeNull();
  });

  it("clears the input between calls", async () => {
    d = new PasswordPromptDialog();
    document.body.appendChild(d.getElement());

    const p1 = d.prompt({ title: "First" });
    const input = d.getElement().querySelector("input[type=password]") as HTMLInputElement;
    input.value = "firstpass";
    (d.getElement().querySelector("[data-act='submit']") as HTMLButtonElement).click();
    await p1;

    const p2 = d.prompt({ title: "Second" });
    const input2 = d.getElement().querySelector("input[type=password]") as HTMLInputElement;
    expect(input2.value).toBe("");
    (d.getElement().querySelector("[data-act='cancel']") as HTMLButtonElement).click();
    await p2;
  });

  it("settles a pending promise when called again", async () => {
    d = new PasswordPromptDialog();
    document.body.appendChild(d.getElement());
    const a = d.prompt({ title: "A" });
    const b = d.prompt({ title: "B" });
    const input = d.getElement().querySelector("input[type=password]") as HTMLInputElement;
    input.value = "typed";
    (d.getElement().querySelector("[data-act='submit']") as HTMLButtonElement).click();
    expect(await a).toBeNull();
    expect(await b).toBe("typed");
  });

  it("resolves the typed value when Enter pressed in the input", async () => {
    d = new PasswordPromptDialog();
    document.body.appendChild(d.getElement());
    const p = d.prompt({ title: "Enter password" });
    const input = d.getElement().querySelector("input[type=password]") as HTMLInputElement;
    input.value = "enterkey";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(await p).toBe("enterkey");
  });
});
