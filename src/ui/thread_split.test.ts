import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { computeSplit, SPLIT_CLASS } from "./thread_split.js";
import { ThreadView, type ThreadMessageData } from "./ThreadView.js";
import { Timeline } from "./Timeline.js";

describe("computeSplit", () => {
  const base = { viewport: 600, panelHeight: 200, rootOffset: 30 };

  it("lines the panel's root row up with the timeline's and parts the room around it", () => {
    const l = computeSplit({ ...base, seamTop: 200, seamBottom: 240, anchor: 200 });
    expect(l.panelTop).toBe(170);
    // The upper half ends a gap above the panel; the lower half starts a gap below.
    expect(200 + l.before).toBe(170 - 8);
    expect(240 + l.after).toBe(370 + 8);
    // It unfolds from the root's own band.
    expect(l.clipTop).toBe(30);
    expect(l.clipBottom).toBe(130);
  });

  it("keeps the panel inside the region near the bottom, lifting the room above further", () => {
    const l = computeSplit({ ...base, seamTop: 540, seamBottom: 580, anchor: 540 });
    expect(l.panelTop).toBe(600 - 12 - 200);
    expect(540 + l.before).toBe(l.panelTop - 8);
  });

  it("pushes the panel down off the top edge rather than past it", () => {
    expect(computeSplit({ ...base, seamTop: 0, seamBottom: 30, anchor: 5 }).panelTop).toBe(12);
  });

  it("pins a panel taller than the region to its top", () => {
    expect(computeSplit({ ...base, panelHeight: 900, seamTop: 300, seamBottom: 340, anchor: 300 }).panelTop).toBe(12);
  });

  it("keeps a placed panel where it is when the root moves, the halves following it", () => {
    // A message landed at the tail and pushed the root up 60px.
    const l = computeSplit({ ...base, seamTop: 140, seamBottom: 180, anchor: 140, pinnedTop: 170 });
    expect(l.panelTop).toBe(170);
    expect(140 + l.before).toBe(170 - 8);
    expect(180 + l.after).toBe(370 + 8);
  });

  it("still keeps a pinned panel inside the region as it grows", () => {
    expect(computeSplit({ ...base, panelHeight: 500, seamTop: 200, seamBottom: 240, anchor: 200, pinnedTop: 170 }).panelTop)
      .toBe(600 - 12 - 500);
  });

  it("folds into the nearest edge when the root is off-screen", () => {
    const l = computeSplit({ ...base, seamTop: -500, seamBottom: -460, anchor: -500 });
    expect(l.panelTop).toBe(12);
    // A zero-height band at the panel's top: it drops in from above.
    expect(l.clipTop).toBe(0);
    expect(l.clipBottom).toBe(200);
  });
});

function nextFrame(): Promise<void> {
  return new Promise((r) => (typeof requestAnimationFrame === "undefined" ? setTimeout(r, 0) : requestAnimationFrame(() => r())));
}

const STYLE = "style[data-thread-split]";

describe("a thread opened in the timeline", () => {
  let timeline: Timeline;
  let view: ThreadView;
  const root: ThreadMessageData = { id: "$root", senderName: "Alice", timestamp: "2024-01-01T12:00:00Z", body: "root" };

  beforeEach(() => {
    timeline = new Timeline();
    view = new ThreadView();
    view.embedIn(timeline);
    document.body.appendChild(timeline.getElement());
    timeline.setMessages([
      { id: "$m0", senderName: "Bob", timestamp: "2024-01-01T11:59:00Z", body: "before" },
      { id: "$root", senderName: "Alice", timestamp: "2024-01-01T12:00:00Z", body: "root" },
      { id: "$m2", senderName: "Bob", timestamp: "2024-01-01T12:01:00Z", body: "after" },
    ]);
  });

  afterEach(() => {
    view.close();
    view.getElement().querySelector<HTMLElement>(".thread-view__sheet")
      ?.dispatchEvent(Object.assign(new Event("transitionend"), { propertyName: "clip-path" }));
    timeline.getElement().remove();
  });

  async function openRoot(): Promise<CSSStyleSheet | null> {
    view.open(root);
    await nextFrame();
    return document.querySelector<HTMLStyleElement>(STYLE)?.sheet ?? null;
  }

  it("mounts beside the scroller, never in it (#132)", async () => {
    await openRoot();
    view.setReplies([{ ...root, id: "$a", body: "reply" }]);
    expect(timeline.getElement().contains(view.getElement())).toBe(true);
    expect(timeline.getScrollElement().contains(view.getMessageEl("$a"))).toBe(false);
  });

  it("parts the room with rules that never reach the panel's own root row", async () => {
    const sheet = await openRoot();
    expect(timeline.getElement().classList.contains(SPLIT_CLASS)).toBe(true);
    const selectors = Array.from(sheet!.cssRules)
      .flatMap((r) => (r as CSSStyleRule).selectorText.split(","))
      .map((s) => s.trim())
      .filter((s) => s.includes("data-message-id"));
    expect(selectors.length).toBeGreaterThan(0);
    // The panel's root row carries the root's data-message-id too; hiding the
    // timeline's copy once blanked the panel's.
    for (const s of selectors) expect(s).toContain(".timeline__list");
    expect(view.getMessageEl("$root")!.closest(".timeline__list")).toBeNull();
  });

  it("folds away on close, then hides the panel and lifts the split", async () => {
    await openRoot();
    view.close();
    // Closed at once — only the animation is left.
    expect(view.isOpen).toBe(false);
    expect(view.selectNext()).toBe(false);
    expect(view.getElement().classList.contains("thread-view--closing")).toBe(true);
    expect(view.getElement().style.display).toBe("");

    view.getElement().querySelector(".thread-view__sheet")!
      .dispatchEvent(Object.assign(new Event("transitionend"), { propertyName: "clip-path" }));
    expect(view.getElement().style.display).toBe("none");
    expect(view.getElement().classList.contains("thread-view--closing")).toBe(false);
    expect(document.querySelector(STYLE)).toBeNull();
    expect(timeline.getElement().classList.contains(SPLIT_CLASS)).toBe(false);
  });

  it("finishes the fold at once when the room is re-rendered under it", async () => {
    await openRoot();
    view.close();
    // Switching rooms re-renders the list: the new room must not slide.
    timeline.setMessages([{ id: "$other", senderName: "Carol", timestamp: "2024-01-01T13:00:00Z", body: "elsewhere" }]);
    await Promise.resolve();
    expect(view.getElement().style.display).toBe("none");
    expect(document.querySelector(STYLE)).toBeNull();
  });

  it("opens the next thread straight over a fold still running", async () => {
    await openRoot();
    view.close();
    view.open({ ...root, id: "$m2", body: "after" });
    expect(view.rootId).toBe("$m2");
    expect(view.getElement().style.display).toBe("");
    expect(view.getElement().classList.contains("thread-view--closing")).toBe(false);
    expect(view.getMessageEl("$m2")).not.toBeNull();
    await nextFrame();
    expect(document.querySelector(STYLE)!.textContent).toContain("$m2");
  });
});
