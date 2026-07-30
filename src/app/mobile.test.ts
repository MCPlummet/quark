// #37 — opening the drawer on mobile must dismiss the OS keyboard. The keyboard
// only closes when the focused input blurs; jsdom models that as
// document.activeElement falling back to <body>.
import { describe, it, expect, beforeEach, vi } from "vitest";

function setViewportWidth(px: number): void {
  Object.defineProperty(window, "innerWidth", { value: px, configurable: true, writable: true });
}

// mobile.ts keeps module-level state (_mobile/_drawerOpen), so load a fresh
// copy per test with the viewport width already in place for detectMobile().
async function loadMobile(widthPx: number): Promise<typeof import("./mobile.js")> {
  vi.resetModules();
  setViewportWidth(widthPx);
  const mod = await import("./mobile.js");
  mod.initMobile();
  return mod;
}

function focusedTextarea(): HTMLTextAreaElement {
  const input = document.createElement("textarea");
  document.body.appendChild(input);
  input.focus();
  expect(document.activeElement).toBe(input);
  return input;
}

beforeEach(() => {
  document.body.innerHTML = "";
  document.body.className = "";
});

describe("mobile keyboard dismissal (#37)", () => {
  it("openDrawer blurs the focused compose input", async () => {
    const { openDrawer, isDrawerOpen } = await loadMobile(500);
    const input = focusedTextarea();
    openDrawer();
    expect(isDrawerOpen()).toBe(true);
    expect(document.activeElement).not.toBe(input);
  });

  it("dismissKeyboard blurs whatever element is focused", async () => {
    const { dismissKeyboard } = await loadMobile(500);
    const input = focusedTextarea();
    dismissKeyboard();
    expect(document.activeElement).not.toBe(input);
  });

  it("openDrawer on desktop is a no-op and leaves focus alone", async () => {
    const { openDrawer, isDrawerOpen } = await loadMobile(1200);
    const input = focusedTextarea();
    openDrawer();
    expect(isDrawerOpen()).toBe(false);
    expect(document.activeElement).toBe(input);
  });
});
