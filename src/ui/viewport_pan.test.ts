// Every surface that must not hand a drag to the iOS visual-viewport pan (#33).
// The guard itself is unit-tested in app/mobile.test.ts; this covers the wiring:
// which elements carry one, and what each of them lets through.
//
// Mobile mode is driven through the real module rather than a mock, since the
// guard attaches from inside it — a mocked `isMobile` would never be consulted.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";

import { Input } from "./Input.js";
import { ThreadView } from "./ThreadView.js";
import { ShortcodePreview } from "./ShortcodePreview.js";
import { initMobile } from "../app/mobile.js";

function setViewportWidth(px: number): void {
  Object.defineProperty(window, "innerWidth", { value: px, configurable: true, writable: true });
}

/** Cross the breakpoint the way a rotation or a resized dev window would. */
function crossTo(px: number): void {
  setViewportWidth(px);
  window.dispatchEvent(new Event("resize"));
}

function drag(el: Element): Event {
  const e = new Event("touchmove", { bubbles: true, cancelable: true });
  el.dispatchEvent(e);
  return e;
}

beforeAll(() => {
  setViewportWidth(500);
  initMobile();
});

beforeEach(() => {
  crossTo(500);
});

describe("compose region (#33)", () => {
  let input: Input;

  beforeEach(() => {
    input = new Input();
    document.body.appendChild(input.getElement());
  });

  afterEach(() => {
    input.getElement().remove();
  });

  /** The wrap is the root, so resolve it directly rather than through a query. */
  function surface(selector: string): Element {
    const root = input.getElement();
    return selector === ".input-bar-wrap" ? root : root.querySelector(selector)!;
  }

  // Each of these is a surface `touch-action` cannot guard: they are the field's
  // ancestors, and `none` on them would intersect away its own pan-y. Before the
  // guard, a drag on any of them chained out to the visual-viewport pan.
  const bare: Array<[string, string]> = [
    [".input-bar-wrap", "the wrap's safe-area strip"],
    [".input-bar", "the bar's padding, and the margins around the compose box"],
    [".input-bar__compose-box", "the box's own padding ring"],
  ];

  for (const [selector, what] of bare) {
    it(`swallows a drag on ${what}`, () => {
      expect(drag(surface(selector)).defaultPrevented).toBe(true);
    });
  }

  it("leaves the field alone, so it can still scroll its own overflow", () => {
    expect(drag(surface(".input-bar__field")).defaultPrevented).toBe(false);
  });

  it("stays out of the way on desktop, where there is no pan to guard against", () => {
    crossTo(1200);
    expect(drag(surface(".input-bar")).defaultPrevented).toBe(false);
  });
});

describe("thread overlay compose row (#33)", () => {
  let thread: ThreadView;

  beforeEach(() => {
    thread = new ThreadView();
    document.body.appendChild(thread.getElement());
  });

  afterEach(() => {
    thread.getElement().remove();
  });

  function surface(selector: string): Element {
    return thread.getElement().querySelector(selector)!;
  }

  // The overlay builds its own compose row instead of using Input, so it needs
  // its own guard — and nothing in it scrolls, not even the reply field.
  it("swallows a drag on the row itself", () => {
    expect(drag(surface(".thread-view__input-bar")).defaultPrevented).toBe(true);
  });

  it("swallows a drag on the single-line reply field", () => {
    expect(drag(surface(".thread-view__input")).defaultPrevented).toBe(true);
  });

  it("leaves the thread timeline alone — that one scrolls", () => {
    expect(drag(surface(".thread-view__timeline")).defaultPrevented).toBe(false);
  });
});

describe("autocomplete popover (#33)", () => {
  let preview: ShortcodePreview;

  beforeEach(() => {
    preview = new ShortcodePreview();
    document.body.appendChild(preview.getElement());
  });

  afterEach(() => {
    preview.getElement().remove();
  });

  /** Fake a list longer than the popover's 200px max-height. */
  function makeScrollable(el: Element, overflowing: boolean): void {
    Object.defineProperty(el, "scrollHeight", { value: overflowing ? 400 : 100, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: 100, configurable: true });
  }

  // It mounts on .content-area, outside the compose wrap, so the composer's
  // guard never sees these — and a list too short to scroll has nothing to give
  // the gesture, which is how it used to reach the pan.
  it("swallows a drag when the list is too short to scroll", () => {
    makeScrollable(preview.getElement(), false);
    expect(drag(preview.getElement()).defaultPrevented).toBe(true);
  });

  it("lets a drag through once there is list to scroll", () => {
    makeScrollable(preview.getElement(), true);
    expect(drag(preview.getElement()).defaultPrevented).toBe(false);
  });

  it("swallows drags on the rows too, not just the container", () => {
    makeScrollable(preview.getElement(), false);
    const list = preview.getElement().querySelector(".shortcode-preview__list")!;
    expect(drag(list).defaultPrevented).toBe(true);
  });
});
