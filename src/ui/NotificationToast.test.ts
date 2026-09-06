import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
// Vite's `?raw` loader, resolved by vitest through the same transform pipeline.
// Read as text rather than via node:fs so the file needs no @types/node — the
// build's tsc pass covers test files too.
// @ts-expect-error - no ambient declaration for Vite's ?raw suffix in this project
import BASE_CSS from "../style/base.css?raw";
import { showToast, showError, showSuccess, clearToasts } from "./NotificationToast.js";

/**
 * Toast visibility is a *stylesheet* property, so these tests load the real
 * base.css rather than asserting DOM hooks the way most UI tests here do.
 *
 * The bug this guards (#80) was invisible to every existing test precisely
 * because the DOM was always correct: the toasts were constructed, timed and
 * dismissed properly, and simply painted off-screen. `.toast-container` had no
 * rules at all, so it laid out as a static block immediately after `#app` —
 * which is `100dvh` under `body { overflow: hidden }`, putting every toast
 * below the fold with no way to scroll to it.
 */
function loadStylesheet(): void {
  const style = document.createElement("style");
  style.textContent = BASE_CSS as string;
  document.head.appendChild(style);
}

describe("NotificationToast visibility (#80)", () => {
  // The container is a module-level singleton mounted once on <body>, so the
  // body is deliberately never wiped between tests — doing so orphans it and
  // every later toast appends to a detached node.
  beforeAll(loadStylesheet);

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    clearToasts();
    vi.runAllTimers();
    vi.useRealTimers();
  });

  const container = (): HTMLElement => {
    const el = document.querySelector<HTMLElement>(".toast-container");
    if (!el) throw new Error("toast container was never mounted");
    return el;
  };

  it("takes the container out of normal flow so toasts are not painted below the fold", () => {
    showToast("hello");
    const position = getComputedStyle(container()).position;
    expect(position).not.toBe("static");
    expect(position).toBe("fixed");
  });

  it("stacks the container above the dialog and context-menu layer", () => {
    showToast("hello");
    // Dialogs and context menus sit at 10000; the startup overlay owns 99999.
    const z = Number(getComputedStyle(container()).zIndex);
    expect(z).toBeGreaterThan(10000);
    expect(z).toBeLessThan(99999);
  });

  it("marks an error toast with an accent edge so the type reads at a glance", () => {
    showError("could not send");
    const toast = document.querySelector<HTMLElement>(".toast--error");
    expect(toast).not.toBeNull();
    // `not.toBe("none")` would pass on jsdom's empty default, so pin the value.
    expect(getComputedStyle(toast!).borderLeftStyle).toBe("solid");
  });

  it("lets pointer events through the container but not the toast itself", () => {
    showSuccess("sent");
    expect(getComputedStyle(container()).pointerEvents).toBe("none");
    const toast = document.querySelector<HTMLElement>(".toast");
    expect(getComputedStyle(toast!).pointerEvents).toBe("auto");
  });
});
