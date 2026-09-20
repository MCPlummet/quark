import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { attachLongPress } from "./long_press";
import * as mobile from "./mobile";

const LONG_PRESS_MS = 500;

/** Build a TouchEvent jsdom will carry clientX/clientY through. */
const touchEvent = (type: string, x: number, y: number, count = 1): Event => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  const touches = Array.from({ length: count }, () => ({ clientX: x, clientY: y }));
  Object.defineProperty(e, "touches", { value: touches });
  Object.defineProperty(e, "changedTouches", { value: touches });
  return e;
};

let el: HTMLElement;
let row: HTMLElement;
let fired: Array<[string, number, number]>;
let detach: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(mobile, "isMobile").mockReturnValue(true);

  el = document.createElement("div");
  row = document.createElement("div");
  row.dataset.rowId = "abc";
  const link = document.createElement("a");
  row.appendChild(link);
  el.appendChild(row);
  document.body.appendChild(el);

  fired = [];
  detach = attachLongPress(el, {
    ignoreSelector: "a, button",
    resolve: (t) => t.closest<HTMLElement>("[data-row-id]")?.dataset.rowId ?? null,
    onLongPress: (id, x, y) => fired.push([id, x, y]),
  });
});

afterEach(() => {
  detach();
  el.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("attachLongPress", () => {
  it("fires after the hold, with the resolved id and coordinates", () => {
    row.dispatchEvent(touchEvent("touchstart", 10, 20));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(fired).toEqual([["abc", 10, 20]]);
  });

  it("does not fire before the hold completes", () => {
    row.dispatchEvent(touchEvent("touchstart", 10, 20));
    vi.advanceTimersByTime(LONG_PRESS_MS - 50);
    expect(fired).toEqual([]);
  });

  // The gesture used to be unconditional, so a touchscreen laptop got the
  // desktop floating menu anchored under the finger (#100).
  it("does nothing outside mobile mode", () => {
    vi.spyOn(mobile, "isMobile").mockReturnValue(false);
    row.dispatchEvent(touchEvent("touchstart", 10, 20));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(fired).toEqual([]);
  });

  it("cancels when the finger moves past tolerance", () => {
    row.dispatchEvent(touchEvent("touchstart", 10, 20));
    row.dispatchEvent(touchEvent("touchmove", 10, 60));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(fired).toEqual([]);
  });

  it("tolerates a small drift", () => {
    row.dispatchEvent(touchEvent("touchstart", 10, 20));
    row.dispatchEvent(touchEvent("touchmove", 13, 22));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(fired).toEqual([["abc", 10, 20]]);
  });

  it("cancels when the finger lifts early", () => {
    row.dispatchEvent(touchEvent("touchstart", 10, 20));
    row.dispatchEvent(touchEvent("touchend", 10, 20));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(fired).toEqual([]);
  });

  it("ignores a second finger", () => {
    row.dispatchEvent(touchEvent("touchstart", 10, 20, 2));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(fired).toEqual([]);
  });

  it("ignores presses on interactive children", () => {
    row.querySelector("a")!.dispatchEvent(touchEvent("touchstart", 10, 20));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(fired).toEqual([]);
  });

  it("ignores a press that resolves to nothing", () => {
    el.dispatchEvent(touchEvent("touchstart", 10, 20));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(fired).toEqual([]);
  });

  // Otherwise the press both opens the sheet and activates whatever it was on.
  it("swallows the click that follows a completed press", () => {
    let clicked = false;
    row.addEventListener("click", () => { clicked = true; });
    row.dispatchEvent(touchEvent("touchstart", 10, 20));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(clicked).toBe(false);
  });

  it("lets an ordinary click through when no press completed", () => {
    let clicked = false;
    row.addEventListener("click", () => { clicked = true; });
    row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(clicked).toBe(true);
  });

  it("stops firing once detached", () => {
    detach();
    row.dispatchEvent(touchEvent("touchstart", 10, 20));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(fired).toEqual([]);
  });
});
