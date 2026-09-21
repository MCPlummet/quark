import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  selectMessageTextForTouch,
  clearTouchTextSelection,
  touchSelectableElement,
} from "./text_select";

let body: HTMLElement;
let other: HTMLElement;

beforeEach(() => {
  body = document.createElement("div");
  body.className = "message__body";
  body.textContent = "hello world";
  other = document.createElement("div");
  document.body.append(body, other);
});

afterEach(() => {
  clearTouchTextSelection();
  body.remove();
  other.remove();
});

describe("selectMessageTextForTouch", () => {
  // Mobile message bodies carry `user-select: none` so a long press opens the
  // sheet cleanly; this class is what opts one body back in (#100).
  it("opts the body into native selection", () => {
    selectMessageTextForTouch(body);
    expect(body.classList.contains("message__body--selectable")).toBe(true);
    expect(touchSelectableElement()).toBe(body);
  });

  it("selects the body's contents", () => {
    selectMessageTextForTouch(body);
    expect(window.getSelection()?.toString()).toBe("hello world");
  });

  // Unlike the vim text-select path, which would raise the soft keyboard over
  // the message the user is trying to read.
  it("does not make the body contenteditable", () => {
    selectMessageTextForTouch(body);
    expect(body.hasAttribute("contenteditable")).toBe(false);
  });

  it("revokes the opt-in when the user presses elsewhere", () => {
    selectMessageTextForTouch(body);
    // The outside listener is registered on the next tick, so the touch that
    // opened the sheet does not immediately cancel the selection.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        other.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        expect(body.classList.contains("message__body--selectable")).toBe(false);
        expect(touchSelectableElement()).toBeNull();
        resolve();
      }, 0);
    });
  });

  it("keeps the opt-in while the press lands inside the body", () => {
    selectMessageTextForTouch(body);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        expect(body.classList.contains("message__body--selectable")).toBe(true);
        resolve();
      }, 0);
    });
  });

  it("keeps exactly one body selectable at a time", () => {
    const second = document.createElement("div");
    second.className = "message__body";
    second.textContent = "another";
    document.body.appendChild(second);

    selectMessageTextForTouch(body);
    selectMessageTextForTouch(second);

    expect(body.classList.contains("message__body--selectable")).toBe(false);
    expect(second.classList.contains("message__body--selectable")).toBe(true);
    second.remove();
  });

  it("is a no-op to clear when nothing is selected", () => {
    expect(() => clearTouchTextSelection()).not.toThrow();
    expect(touchSelectableElement()).toBeNull();
  });
});
