import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// This lives in its own file because it mocks ../app/mobile.js, which is
// module-wide — same reason as Timeline.links.test.ts.
vi.mock("../app/mobile.js", async (importActual) => {
  const actual = await importActual<typeof import("../app/mobile.js")>();
  return { ...actual, isMobile: vi.fn(() => true) };
});

import { Input } from "./Input.js";
import { isMobile } from "../app/mobile.js";

const mockIsMobile = vi.mocked(isMobile);

describe("compose region viewport-pan guard (#33)", () => {
  let input: Input;

  beforeEach(() => {
    mockIsMobile.mockReturnValue(true);
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

  function drag(el: Element): Event {
    const e = new Event("touchmove", { bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    return e;
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
    mockIsMobile.mockReturnValue(false);
    expect(drag(surface(".input-bar")).defaultPrevented).toBe(false);
  });
});
