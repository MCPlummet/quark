// src/ui/settings/controls.test.ts
import { describe, it, expect } from "vitest";
import { makeControls } from "./controls.js";

describe("SettingsControls", () => {
  it("checkbox reflects initial state and fires onChange", () => {
    const c = makeControls();
    let v = false;
    const row = c.checkbox("Enable", true, (next) => { v = next; });
    const input = row.querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(input.checked).toBe(true);
    input.checked = false;
    input.dispatchEvent(new Event("change"));
    expect(v).toBe(false);
  });

  it("selectRow renders options and reports selection", () => {
    const c = makeControls();
    let picked = "a";
    const row = c.selectRow("Mode", "a", [["a", "Alpha"], ["b", "Beta"]], (next) => { picked = next; });
    const sel = row.querySelector("select") as HTMLSelectElement;
    expect(sel.value).toBe("a");
    sel.value = "b";
    sel.dispatchEvent(new Event("change"));
    expect(picked).toBe("b");
  });

  it("sectionTitle uses the settings class", () => {
    const c = makeControls();
    expect(c.sectionTitle("X").className).toContain("settings-dialog__section-title");
  });
});
