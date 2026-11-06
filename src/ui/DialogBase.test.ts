import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DialogBase, isEditableTarget } from "./DialogBase.js";
import { keymapManager } from "../vim/keybindings.js";
import { registerDefaultBindings } from "../app/registry.js";

/** Like the room / settings dialogs: its own handler, delegating to routeKey. */
class OverridingDialog extends DialogBase {
  input: HTMLInputElement;
  constructor() {
    super({ prefix: "settings-dialog", ariaLabel: "Overriding" });
    this.input = document.createElement("input");
    this.content.appendChild(this.input);
  }
  show(): void {
    this.reveal();
  }
  protected override handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === "Tab") return;
    this.routeKey(e);
  }
}

class TestDialog extends DialogBase {
  input: HTMLInputElement;
  constructor() {
    super({ prefix: "settings-dialog", ariaLabel: "Test" });
    this.buildHeader("test");
    this.input = document.createElement("input");
    this.input.type = "text";
    this.content.appendChild(this.input);
  }
  show(): void {
    this.reveal();
  }
}

describe("DialogBase key routing", () => {
  let dialog: TestDialog;

  beforeEach(() => {
    for (const entry of keymapManager.getEntries()) keymapManager.unmap(entry.context, entry.sequence);
    registerDefaultBindings();
    dialog = new TestDialog();
    document.body.appendChild(dialog.getElement());
    dialog.show();
  });

  afterEach(() => {
    dialog.hide();
    dialog.getElement().remove();
  });

  const press = (target: HTMLElement, key: string) => {
    const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
    return ev;
  };

  it("leaves keys typed into a text field alone — one g types one g", () => {
    expect(press(dialog.input, "g").defaultPrevented).toBe(false);
    expect(press(dialog.input, "g").defaultPrevented).toBe(false);
    expect(dialog.isVisible()).toBe(true);
  });

  it("still closes on Escape from inside a field", () => {
    press(dialog.input, "Escape");
    expect(dialog.isVisible()).toBe(false);
  });

  it("closes on Escape from a field in a dialog that overrides handleKeydown", () => {
    const d = new OverridingDialog();
    document.body.appendChild(d.getElement());
    d.show();
    press(d.input, "Escape");
    expect(d.isVisible()).toBe(false);
    d.getElement().remove();
  });

  it("still treats g as the start of a sequence outside a field", () => {
    expect(press(dialog.getElement(), "g").defaultPrevented).toBe(true);
  });

  it("knows which elements take typing", () => {
    const make = (tag: string, type?: string) => {
      const el = document.createElement(tag) as HTMLInputElement;
      if (type) el.type = type;
      return el;
    };
    expect(isEditableTarget(make("input", "text"))).toBe(true);
    expect(isEditableTarget(make("input", "password"))).toBe(true);
    expect(isEditableTarget(make("input", "number"))).toBe(true);
    expect(isEditableTarget(make("textarea"))).toBe(true);
    expect(isEditableTarget(make("select"))).toBe(true);
    expect(isEditableTarget(make("input", "checkbox"))).toBe(false);
    expect(isEditableTarget(make("button"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
