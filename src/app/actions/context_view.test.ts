import { describe, it, expect, beforeEach, vi } from "vitest";
import { setComponents, isInContextView, setContextView } from "./context.js";
import type { AppComponents } from "../../ui/App.js";

// The jump-to-latest button and the forward-pagination trigger both read the
// timeline's own copy of this flag, so the two must move together. They were
// independent fields, and selectRoom reset only one — see the note in
// context.ts. These pin the invariant rather than the symptom.

const makeTimeline = () => ({
  setContextView: vi.fn(),
  setReceiptResolvers: vi.fn(),
});

let timeline: ReturnType<typeof makeTimeline>;

beforeEach(() => {
  timeline = makeTimeline();
  setComponents({ timeline } as unknown as AppComponents);
  setContextView(false);
  timeline.setContextView.mockClear();
});

describe("setContextView", () => {
  it("drives the timeline and the module flag together", () => {
    setContextView(true);
    expect(isInContextView()).toBe(true);
    expect(timeline.setContextView).toHaveBeenLastCalledWith(true);

    setContextView(false);
    expect(isInContextView()).toBe(false);
    expect(timeline.setContextView).toHaveBeenLastCalledWith(false);
  });

  it("keeps the two in step across repeated transitions", () => {
    for (const v of [true, false, true, true, false]) {
      setContextView(v);
      expect(isInContextView()).toBe(v);
      expect(timeline.setContextView).toHaveBeenLastCalledWith(v);
    }
  });

  // A partial component mock (or a call before mount) must not lose the flag
  // just because there is no timeline to tell.
  it("still records the flag with no timeline present", () => {
    setComponents({} as unknown as AppComponents);
    setContextView(true);
    expect(isInContextView()).toBe(true);
  });
});
