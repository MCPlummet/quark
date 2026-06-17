import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { attachResizeHandle } from "./ResizeHandle.js";

// Helper: give an element a stable layout width (jsdom reports 0 otherwise).
function setOffsetWidth(el: HTMLElement, px: number): void {
  Object.defineProperty(el, "offsetWidth", { configurable: true, value: px });
}

function drag(handle: HTMLElement, fromX: number, toX: number): void {
  handle.dispatchEvent(new MouseEvent("mousedown", { clientX: fromX, bubbles: true }));
  document.dispatchEvent(new MouseEvent("mousemove", { clientX: toX, bubbles: true }));
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
}

describe("attachResizeHandle", () => {
  let panel: HTMLElement;

  beforeEach(() => {
    panel = document.createElement("div");
    document.body.appendChild(panel);
  });

  afterEach(() => {
    panel.remove();
    document.documentElement.style.removeProperty("--w");
  });

  it("uses the panel's rendered width as the drag baseline, not a stale CSS variable", () => {
    // Regression for #5: a stale/garbage CSS-variable read used to set the drag
    // baseline, which on the first drag snapped the panel to its minimum width.
    // Seed the variable with a value that does NOT match the rendered width.
    document.documentElement.style.setProperty("--w", "999px");
    setOffsetWidth(panel, 220);
    attachResizeHandle(panel, "--w", "right", 120, 500);
    const handle = panel.querySelector(".resize-handle") as HTMLElement;

    drag(handle, 500, 550); // +50px to the right

    // 220 (offsetWidth) + 50, NOT 999 + 50 (would clamp to the 500 max) and NOT
    // the 120 minimum.
    expect(document.documentElement.style.getPropertyValue("--w")).toBe("270px");
  });

  it("resizes from the correct baseline on the very first drag", () => {
    setOffsetWidth(panel, 200);
    attachResizeHandle(panel, "--w", "right", 120, 500);
    const handle = panel.querySelector(".resize-handle") as HTMLElement;

    drag(handle, 300, 260); // -40px

    expect(document.documentElement.style.getPropertyValue("--w")).toBe("160px");
  });

  it("inverts the delta for a left-side handle", () => {
    setOffsetWidth(panel, 200);
    attachResizeHandle(panel, "--w", "left", 120, 500);
    const handle = panel.querySelector(".resize-handle") as HTMLElement;

    drag(handle, 300, 260); // moving left grows a left-side panel

    expect(document.documentElement.style.getPropertyValue("--w")).toBe("240px");
  });

  it("clamps to the min and max bounds", () => {
    setOffsetWidth(panel, 200);
    attachResizeHandle(panel, "--w", "right", 120, 500);
    const handle = panel.querySelector(".resize-handle") as HTMLElement;

    drag(handle, 300, 0); // far past the minimum

    expect(document.documentElement.style.getPropertyValue("--w")).toBe("120px");
  });
});
