import { describe, it, expect, afterEach } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog.js";

describe("ConfirmDialog", () => {
  let d: ConfirmDialog;

  afterEach(() => {
    d.getElement().remove();
  });

  it("resolves true when confirm clicked", async () => {
    d = new ConfirmDialog();
    document.body.appendChild(d.getElement());
    const p = d.confirm({ title: "Remove?", message: "Sure?", confirmLabel: "Remove" });
    (d.getElement().querySelector("[data-act='confirm']") as HTMLButtonElement).click();
    expect(await p).toBe(true);
  });

  it("resolves false when cancel clicked", async () => {
    d = new ConfirmDialog();
    document.body.appendChild(d.getElement());
    const p = d.confirm({ title: "Remove?", message: "Sure?" });
    (d.getElement().querySelector("[data-act='cancel']") as HTMLButtonElement).click();
    expect(await p).toBe(false);
  });

  it("resolves false when hidden without explicit choice (Esc / backdrop path)", async () => {
    d = new ConfirmDialog();
    document.body.appendChild(d.getElement());
    const p = d.confirm({ title: "Delete?", message: "No going back." });
    d.hide();
    expect(await p).toBe(false);
  });

  it("is reusable across multiple confirm() calls", async () => {
    d = new ConfirmDialog();
    document.body.appendChild(d.getElement());

    const p1 = d.confirm({ title: "First?", message: "msg1" });
    (d.getElement().querySelector("[data-act='confirm']") as HTMLButtonElement).click();
    expect(await p1).toBe(true);

    const p2 = d.confirm({ title: "Second?", message: "msg2" });
    (d.getElement().querySelector("[data-act='cancel']") as HTMLButtonElement).click();
    expect(await p2).toBe(false);
  });

  it("settles a pending promise when called again", async () => {
    d = new ConfirmDialog();
    document.body.appendChild(d.getElement());
    const a = d.confirm({ title: "A", message: "first" });
    const b = d.confirm({ title: "B", message: "second" });
    (d.getElement().querySelector("[data-act='confirm']") as HTMLButtonElement).click();
    expect(await a).toBe(false);
    expect(await b).toBe(true);
  });

  it("confirm button has danger class when opts.danger is true", async () => {
    d = new ConfirmDialog();
    document.body.appendChild(d.getElement());
    const p = d.confirm({ title: "Delete?", message: "Careful!", danger: true });
    const btn = d.getElement().querySelector("[data-act='confirm']") as HTMLButtonElement;
    expect(btn.classList.contains("danger")).toBe(true);
    btn.click();
    await p;
  });
});
