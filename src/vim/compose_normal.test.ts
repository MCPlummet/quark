import { describe, it, expect, beforeEach } from "vitest";
import {
  wordForward,
  wordEnd,
  wordBackward,
  lineStart,
  lineEndExclusive,
  firstNonBlank,
  motionCursor,
  operatorSpan,
  lineSpan,
  ComposeNormalEditor,
} from "./compose_normal.js";

describe("compose_normal motions (pure)", () => {
  const s = "hello world foo";

  it("wordForward stops at the start of the next word", () => {
    expect(wordForward(s, 0)).toBe(6);
    expect(wordForward(s, 6)).toBe(12);
  });

  it("wordEnd lands on the last char of the word", () => {
    expect(wordEnd(s, 0)).toBe(4); // 'o' of hello
    expect(wordEnd(s, 4)).toBe(10); // 'd' of world
  });

  it("wordBackward goes to the start of the previous word", () => {
    expect(wordBackward(s, 6)).toBe(0);
    expect(wordBackward(s, 12)).toBe(6);
  });

  it("treats punctuation as its own word", () => {
    expect(wordForward("a.b c", 0)).toBe(1); // 'a' -> '.'
    expect(wordForward("a.b c", 1)).toBe(2); // '.' -> 'b'
  });

  it("computes line bounds and first non-blank", () => {
    const m = "ab\n  cd\nef";
    expect(lineStart(m, 5)).toBe(3);
    expect(lineEndExclusive(m, 5)).toBe(7);
    expect(firstNonBlank(m, 3)).toBe(5); // skips the two spaces
  });

  it("clamps the cursor to the last char of the line ($ / l)", () => {
    expect(motionCursor("hello", 0, "$")).toBe(4);
    expect(motionCursor("hello", 4, "l")).toBe(4); // can't go past last char
    expect(motionCursor("hello", 0, "w")).toBe(4); // single word: clamp to last char
  });

  it("applies a count to motions", () => {
    expect(motionCursor(s, 0, "w", 2)).toBe(12);
  });
});

describe("compose_normal operator spans (pure)", () => {
  const s = "hello world foo";

  it("dw is exclusive, de is inclusive", () => {
    expect(operatorSpan(s, 0, "w")).toEqual({ start: 0, end: 6, linewise: false });
    expect(operatorSpan(s, 0, "e")).toEqual({ start: 0, end: 5, linewise: false });
  });

  it("d$ deletes to end of line; d0 deletes to line start", () => {
    expect(operatorSpan("hello", 2, "$")).toEqual({ start: 2, end: 5, linewise: false });
    expect(operatorSpan("hello", 2, "0")).toEqual({ start: 0, end: 2, linewise: false });
  });

  it("lineSpan covers the line and its trailing newline", () => {
    expect(lineSpan("a\nb\nc", 0)).toEqual({ start: 0, end: 2, linewise: true });
    expect(lineSpan("a\nb", 2)).toEqual({ start: 1, end: 3, linewise: true }); // last line
  });
});

describe("ComposeNormalEditor", () => {
  let field: HTMLTextAreaElement;
  let ed: ComposeNormalEditor;

  beforeEach(() => {
    field = document.createElement("textarea");
    document.body.appendChild(field);
    ed = new ComposeNormalEditor();
  });

  const place = (value: string, cursor: number) => {
    field.value = value;
    field.setSelectionRange(cursor, cursor);
  };
  const cursor = () => field.selectionStart;

  it("dw deletes a word", () => {
    place("hello world", 0);
    expect(ed.handleKey("d", field).consumed).toBe(true);
    ed.handleKey("w", field);
    expect(field.value).toBe("world");
    expect(cursor()).toBe(0);
  });

  it("x deletes the char under the cursor", () => {
    place("abc", 1);
    ed.handleKey("x", field);
    expect(field.value).toBe("ac");
    expect(cursor()).toBe(1);
  });

  it("dd deletes the whole line", () => {
    place("one\ntwo\nthree", 0);
    ed.handleKey("d", field);
    ed.handleKey("d", field);
    expect(field.value).toBe("two\nthree");
  });

  it("cc clears the line and asks to enter insert", () => {
    place("hello", 2);
    ed.handleKey("c", field);
    const res = ed.handleKey("c", field);
    expect(field.value).toBe("");
    expect(res.enterInsert).toBe(true);
  });

  it("A moves to end of line and enters insert", () => {
    place("hi", 0);
    const res = ed.handleKey("A", field);
    expect(cursor()).toBe(2);
    expect(res.enterInsert).toBe(true);
  });

  it("o opens a line below and enters insert", () => {
    place("a\nb", 0);
    const res = ed.handleKey("o", field);
    expect(field.value).toBe("a\n\nb");
    expect(cursor()).toBe(2);
    expect(res.enterInsert).toBe(true);
  });

  it("supports counts for operators (d2w)", () => {
    place("a b c d", 0);
    ed.handleKey("d", field);
    ed.handleKey("2", field);
    ed.handleKey("w", field);
    expect(field.value).toBe("c d");
  });

  it("yanks a line and pastes it below with p", () => {
    place("one\ntwo", 0);
    ed.handleKey("y", field);
    ed.handleKey("y", field);
    ed.handleKey("p", field);
    expect(field.value).toBe("one\none\ntwo");
  });

  it("r replaces a single char", () => {
    place("cat", 0);
    ed.handleKey("r", field);
    ed.handleKey("b", field);
    expect(field.value).toBe("bat");
  });

  it("does not consume keys it doesn't handle (e.g. v)", () => {
    place("hi", 0);
    expect(ed.handleKey("v", field).consumed).toBe(false);
  });

  // #15 — the compose box behaves like the bottom-most message: pressing k on
  // the first line leaves the box upward (into the timeline) rather than being
  // silently swallowed.
  it("k on the first line signals exit-up and leaves the caret put (#15)", () => {
    place("hello", 2);
    const res = ed.handleKey("k", field);
    expect(res.consumed).toBe(true);
    expect(res.exitUp).toBe(true);
    expect(cursor()).toBe(2);
  });

  it("k on a lower line moves up instead of exiting (#15)", () => {
    place("one\ntwo", 5); // caret on the second line
    const res = ed.handleKey("k", field);
    expect(res.consumed).toBe(true);
    expect(res.exitUp).toBeFalsy();
    expect(cursor()).toBe(1); // moved up to the first line, same column
  });

  it("dk on the first line still deletes the line (no exit-up) (#15)", () => {
    place("hello", 2);
    ed.handleKey("d", field);
    const res = ed.handleKey("k", field);
    expect(res.exitUp).toBeFalsy();
    expect(field.value).toBe("");
  });
});
