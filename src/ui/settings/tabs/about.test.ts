import { describe, it, expect, vi } from "vitest";
import { aboutTab } from "./about.js";
import { makeControls } from "../controls.js";

function render(isMobile: boolean): HTMLElement {
  const content = document.createElement("div");
  aboutTab.build({ content, controls: makeControls(), isMobile, close: vi.fn(), dispatch: vi.fn() });
  return content;
}

describe("aboutTab", () => {
  it("shows version and a GitHub link", () => {
    const el = render(false);
    expect(el.textContent).toMatch(/v\d+\.\d+\.\d+/);
    expect(el.querySelector("a,button[data-link='github']")).toBeTruthy();
  });
  it("shows Updates section on desktop", () => {
    expect(render(false).textContent).toMatch(/Release channel/i);
  });
  it("hides Updates section on mobile", () => {
    expect(render(true).textContent).not.toMatch(/Release channel/i);
  });
});
