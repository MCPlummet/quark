import { describe, it, expect } from "vitest";
import { ComposeHistory, caretForRestore } from "./compose_history.js";

/** Type `text` one character at a time at the end of the field, as a keyboard would. */
function typeAtEnd(h: ComposeHistory, text: string): void {
  for (const ch of text) {
    const before = h.current;
    h.record(before + ch, { kind: "insert", caretBefore: before.length, boundary: /\s/.test(ch) });
  }
}

describe("ComposeHistory", () => {
  it("groups typing into words: undo removes the last word, then the one before", () => {
    const h = new ComposeHistory("");
    typeAtEnd(h, "hello world");
    expect(h.undo()).toBe("hello ");
    expect(h.undo()).toBe("");
    expect(h.undo()).toBeNull();
  });

  it("redo walks back up the steps undo walked down", () => {
    const h = new ComposeHistory("");
    typeAtEnd(h, "hello world");
    h.undo();
    h.undo();
    expect(h.redo()).toBe("hello ");
    expect(h.redo()).toBe("hello world");
    expect(h.redo()).toBeNull();
  });

  it("keeps typing and deleting as separate steps", () => {
    const h = new ComposeHistory("");
    typeAtEnd(h, "abc");
    h.record("ab", { kind: "delete", caretBefore: 3 });
    expect(h.undo()).toBe("abc");
    expect(h.undo()).toBe("");
  });

  it("merges consecutive backspaces into one step", () => {
    const h = new ComposeHistory("abcd");
    h.record("abc", { kind: "delete", caretBefore: 4 });
    h.record("ab", { kind: "delete", caretBefore: 3 });
    expect(h.undo()).toBe("abcd");
  });

  it("starts a new step when typing resumes somewhere else", () => {
    const h = new ComposeHistory("");
    typeAtEnd(h, "abc");
    // The caret moved to the start before the next keystroke.
    h.record("Xabc", { kind: "insert", caretBefore: 0 });
    expect(h.undo()).toBe("abc");
    expect(h.undo()).toBe("");
  });

  it("makes a programmatic edit its own step, sealed against following typing", () => {
    const h = new ComposeHistory("");
    typeAtEnd(h, "hi");
    h.record("**hi**", { kind: "edit" });
    h.record("**hi**!", { kind: "insert", caretBefore: 6 });
    expect(h.undo()).toBe("**hi**");
    expect(h.undo()).toBe("hi");
    expect(h.undo()).toBe("");
  });

  it("restores a select-all delete in one undo", () => {
    const h = new ComposeHistory("");
    typeAtEnd(h, "a long message");
    h.record("", { kind: "edit" });
    expect(h.undo()).toBe("a long message");
  });

  it("drops the redo tail when something new is recorded after an undo", () => {
    const h = new ComposeHistory("");
    typeAtEnd(h, "one two");
    h.undo();
    h.record("one X", { kind: "edit" });
    expect(h.redo()).toBeNull();
    expect(h.undo()).toBe("one ");
  });

  it("ignores a record that changes nothing", () => {
    const h = new ComposeHistory("same");
    h.record("same", { kind: "edit" });
    expect(h.undo()).toBeNull();
  });

  it("keeps only the newest `limit` steps", () => {
    const h = new ComposeHistory("", 3);
    for (const v of ["a", "ab", "abc", "abcd", "abcde"]) h.record(v, { kind: "edit" });
    expect(h.undo()).toBe("abcd");
    expect(h.undo()).toBe("abc");
    expect(h.undo()).toBe("ab");
    expect(h.undo()).toBeNull();
  });

  it("amend replaces the current value without adding a step", () => {
    const h = new ComposeHistory("");
    h.record("draft", { kind: "edit" });
    h.record("draft + stand-in", { kind: "edit" });
    h.amend("draft (fixed)");
    expect(h.current).toBe("draft (fixed)");
    expect(h.undo()).toBe("draft");
  });

  it("amend back to the previous value removes the step entirely", () => {
    const h = new ComposeHistory("");
    h.record("draft", { kind: "edit" });
    h.record("draft + stand-in", { kind: "edit" });
    h.amend("draft");
    expect(h.current).toBe("draft");
    expect(h.undo()).toBe("");
  });

  it("an undo seals the step it leaves, so typing after redo starts fresh", () => {
    const h = new ComposeHistory("");
    typeAtEnd(h, "ab");
    h.undo();
    h.redo();
    h.record("abc", { kind: "insert", caretBefore: 2 });
    expect(h.undo()).toBe("ab");
  });
});

describe("caretForRestore", () => {
  it("lands where removed text was", () => {
    expect(caretForRestore("hello world", "hello ")).toBe(6);
  });

  it("lands after re-inserted text", () => {
    expect(caretForRestore("hello ", "hello world")).toBe(11);
  });

  it("lands at the start of an emptied field", () => {
    expect(caretForRestore("abc", "")).toBe(0);
  });

  it("lands after a change in the middle", () => {
    expect(caretForRestore("say hi now", "say hello now")).toBe(9);
  });
});
