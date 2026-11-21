import { describe, it, expect } from "vitest";
import { changedRange } from "./text_change.js";

describe("changedRange", () => {
  it("finds an insertion", () => {
    expect(changedRange("hello ", "hello world")).toEqual({ start: 6, beforeEnd: 6, afterEnd: 11 });
  });

  it("finds a deletion", () => {
    expect(changedRange("hello world", "hello ")).toEqual({ start: 6, beforeEnd: 11, afterEnd: 6 });
  });

  it("finds a replacement in the middle", () => {
    expect(changedRange("say hi now", "say hello now")).toEqual({ start: 5, beforeEnd: 6, afterEnd: 9 });
  });

  it("reports nothing for equal strings", () => {
    expect(changedRange("same", "same")).toEqual({ start: 4, beforeEnd: 4, afterEnd: 4 });
  });

  // Review fix: 😂 is D83D DE02 and 😀 is D83D DE00. Matched unit by unit, the
  // shared D83D counted as common, and the boundary fell inside the emoji.
  it("does not split a surrogate pair whose high half is shared", () => {
    expect(changedRange("😂😀", "😀")).toEqual({ start: 0, beforeEnd: 2, afterEnd: 0 });
    expect(changedRange("a😀", "a😂")).toEqual({ start: 1, beforeEnd: 3, afterEnd: 3 });
  });

  // 😀 is D83D DE00 and 🨀 (U+1FA00) is D83E DE00: the low half is shared.
  it("does not split a surrogate pair whose low half is shared", () => {
    expect(changedRange("😀", "🨀")).toEqual({ start: 0, beforeEnd: 2, afterEnd: 2 });
    expect(changedRange("x😀y", "x🨀y")).toEqual({ start: 1, beforeEnd: 3, afterEnd: 3 });
  });

  it("keeps whole emoji either side of the change as common", () => {
    expect(changedRange("😀a😀", "😀bc😀")).toEqual({ start: 2, beforeEnd: 3, afterEnd: 4 });
  });
});
