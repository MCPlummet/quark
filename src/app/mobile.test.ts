// #37 — opening the drawer on mobile must dismiss the OS keyboard. The keyboard
// only closes when the focused input blurs; jsdom models that as
// document.activeElement falling back to <body>.
//
// #33 — the visual-viewport split that keeps the compose bar still while the
// user scrolls with the keyboard open.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { viewportMetrics } from "./mobile.js";

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

// ── Visual viewport (#33) ────────────────────────────────────────────────────

const LAYOUT_HEIGHT_PX = 800;
const KEYBOARD_PX = 340;

/** Minimal stand-in for window.visualViewport — jsdom doesn't implement one. */
class FakeVisualViewport extends EventTarget {
  height = LAYOUT_HEIGHT_PX;
  offsetTop = 0;
  scale = 1;

  /** Move the visual viewport and fire the event the engine would fire. */
  moveTo(height: number, offsetTop: number, type: "resize" | "scroll"): void {
    this.height = height;
    this.offsetTop = offsetTop;
    this.dispatchEvent(new Event(type));
  }
}

function stubVisualViewport(): FakeVisualViewport {
  const vv = new FakeVisualViewport();
  Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
  Object.defineProperty(window, "innerHeight", {
    value: LAYOUT_HEIGHT_PX,
    configurable: true,
    writable: true,
  });
  return vv;
}

function cssVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

describe("visual viewport metrics (#33)", () => {
  it("reads the keyboard inset off the height the visual viewport lost", () => {
    expect(viewportMetrics(800, 460, 0)).toEqual({ keyboardInset: 340, pan: 0 });
  });

  it("holds the inset steady while the viewport is panned under the keyboard", () => {
    // The pan streams an update every frame; if it moved the inset the whole
    // content column would re-lay-out on each one.
    expect(viewportMetrics(800, 460, 120)).toEqual({ keyboardInset: 340, pan: 120 });
  });

  it("clamps the pan to the inset so an overscroll can't push past it", () => {
    expect(viewportMetrics(800, 460, 900).pan).toBe(340);
  });

  it("leaves a deliberate pinch-zoom pan alone when no keyboard is up", () => {
    expect(viewportMetrics(800, 800, 60)).toEqual({ keyboardInset: 0, pan: 0 });
  });

  it("reports no inset where the OS resized the window instead (Android)", () => {
    // adjustResize shrinks the layout viewport too, so there is nothing to compensate.
    expect(viewportMetrics(460, 460, 0)).toEqual({ keyboardInset: 0, pan: 0 });
  });

  // A pinch shrinks the visual viewport to roughly layoutHeight / scale, which is
  // exactly what an open keyboard looks like from a height diff alone. Reachable
  // even with pinch-zoom off in the viewport meta: Android's "force enable zoom"
  // overrides it, and mobile mode is width-driven, so a trackpad pinch in a narrow
  // desktop window gets there too.
  it("does not read a pinch-zoom as a keyboard", () => {
    expect(viewportMetrics(800, 400, 0, 2)).toEqual({ keyboardInset: 0, pan: 0 });
  });

  it("leaves the user's own pan alone while zoomed", () => {
    expect(viewportMetrics(800, 400, 220, 2)).toEqual({ keyboardInset: 0, pan: 0 });
  });

  it("stands down for the keyboard too once zoomed — neither quantity is knowable", () => {
    expect(viewportMetrics(800, 260, 120, 1.8)).toEqual({ keyboardInset: 0, pan: 0 });
  });

  it("still reads the keyboard at rest, and tolerates float drift in the scale", () => {
    expect(viewportMetrics(800, 460, 120, 1)).toEqual({ keyboardInset: 340, pan: 120 });
    expect(viewportMetrics(800, 460, 120, 1.005)).toEqual({ keyboardInset: 340, pan: 120 });
  });

  it("treats a zoomed-out viewport as no keyboard, not a negative one", () => {
    expect(viewportMetrics(800, 1000, 0, 0.8)).toEqual({ keyboardInset: 0, pan: 0 });
  });
});

describe("visual viewport tracking (#33)", () => {
  afterEach(() => {
    document.documentElement.style.removeProperty("--keyboard-offset");
    document.documentElement.style.removeProperty("--viewport-pan");
  });

  it("publishes the inset when the keyboard opens", async () => {
    const vv = stubVisualViewport();
    await loadMobile(500);
    vv.moveTo(LAYOUT_HEIGHT_PX - KEYBOARD_PX, 0, "resize");
    expect(cssVar("--keyboard-offset")).toBe(`${KEYBOARD_PX}px`);
    expect(cssVar("--viewport-pan")).toBe("0px");
  });

  it("answers a scroll with the pan only, leaving the inset untouched", async () => {
    const vv = stubVisualViewport();
    await loadMobile(500);
    vv.moveTo(LAYOUT_HEIGHT_PX - KEYBOARD_PX, 0, "resize");
    vv.moveTo(LAYOUT_HEIGHT_PX - KEYBOARD_PX, 90, "scroll");
    expect(cssVar("--keyboard-offset")).toBe(`${KEYBOARD_PX}px`);
    expect(cssVar("--viewport-pan")).toBe("90px");
  });

  it("clears both when the keyboard closes", async () => {
    const vv = stubVisualViewport();
    await loadMobile(500);
    vv.moveTo(LAYOUT_HEIGHT_PX - KEYBOARD_PX, 90, "scroll");
    vv.moveTo(LAYOUT_HEIGHT_PX, 0, "resize");
    expect(cssVar("--keyboard-offset")).toBe("0px");
    expect(cssVar("--viewport-pan")).toBe("0px");
  });

  it("reports the pan to overlays that place themselves off a client rect", async () => {
    const vv = stubVisualViewport();
    const mod = await loadMobile(500);
    expect(mod.viewportPan()).toBe(0);
    vv.moveTo(LAYOUT_HEIGHT_PX - KEYBOARD_PX, 90, "scroll");
    expect(mod.viewportPan()).toBe(90);
  });

  it("publishes nothing while the user is pinch-zoomed", async () => {
    const vv = stubVisualViewport();
    vv.scale = 2;
    await loadMobile(500);
    // A zoom looks exactly like a keyboard from the height alone, and the pan
    // that follows is the user moving around the page.
    vv.moveTo(LAYOUT_HEIGHT_PX / 2, 200, "resize");
    expect(cssVar("--keyboard-offset")).toBe("0px");
    expect(cssVar("--viewport-pan")).toBe("0px");
    vv.scale = 1;
  });
});

// ── Pan guard (#33) ──────────────────────────────────────────────────────────

describe("viewport pan guard (#33)", () => {
  function drag(el: Element): Event {
    const e = new Event("touchmove", { bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    return e;
  }

  /** Cross the breakpoint the way a rotation or a resized dev window would. */
  function crossTo(px: number): void {
    setViewportWidth(px);
    window.dispatchEvent(new Event("resize"));
  }

  it("swallows drags on the guarded element in mobile mode", async () => {
    const { guardViewportPan } = await loadMobile(500);
    const el = document.createElement("div");
    guardViewportPan(el);
    expect(drag(el).defaultPrevented).toBe(true);
  });

  it("lets the exempt element through so it can scroll itself", async () => {
    const { guardViewportPan } = await loadMobile(500);
    const el = document.createElement("div");
    const scroller = document.createElement("div");
    scroller.className = "scrolls";
    el.appendChild(scroller);
    guardViewportPan(el, (t) => !!t?.closest(".scrolls"));
    expect(drag(scroller).defaultPrevented).toBe(false);
    expect(drag(el).defaultPrevented).toBe(true);
  });

  // Components are all constructed before initMobile() runs (see App.ts), and a
  // phone never crosses the breakpoint — so init is the only chance to attach.
  it("attaches to elements guarded before initMobile ran", async () => {
    vi.resetModules();
    setViewportWidth(500);
    const mod = await import("./mobile.js");
    const el = document.createElement("div");
    mod.guardViewportPan(el);
    mod.initMobile();
    expect(drag(el).defaultPrevented).toBe(true);
  });

  // Desktop should not pay the blocking (non-passive) touch path for a listener
  // that could only ever no-op there.
  it("detaches on the way out to desktop and re-attaches on the way back", async () => {
    const { guardViewportPan } = await loadMobile(500);
    const el = document.createElement("div");
    guardViewportPan(el);

    crossTo(1200);
    expect(drag(el).defaultPrevented).toBe(false);

    crossTo(500);
    expect(drag(el).defaultPrevented).toBe(true);
  });

  it("never attaches when the app starts on desktop", async () => {
    const { guardViewportPan } = await loadMobile(1200);
    const el = document.createElement("div");
    guardViewportPan(el);
    expect(drag(el).defaultPrevented).toBe(false);
  });

  it("stands down while zoomed — panning is then the user's only way around", async () => {
    const vv = stubVisualViewport();
    const { guardViewportPan } = await loadMobile(500);
    const el = document.createElement("div");
    guardViewportPan(el);
    expect(drag(el).defaultPrevented).toBe(true);

    vv.scale = 2;
    expect(drag(el).defaultPrevented).toBe(false);
    vv.scale = 1;
  });
});
