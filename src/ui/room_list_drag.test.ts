import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { attachRoomDrag, dropTarget, reorderedIds, DRAG_THRESHOLD_PX } from "./room_list_drag.js";

describe("reorderedIds", () => {
  const ids = ["a", "b", "c", "d"];

  it("moves a room before another", () => {
    expect(reorderedIds(ids, "d", "b")).toEqual(["a", "d", "b", "c"]);
    expect(reorderedIds(ids, "a", "c")).toEqual(["b", "a", "c", "d"]);
  });

  it("moves a room to the end", () => {
    expect(reorderedIds(ids, "a", null)).toEqual(["b", "c", "d", "a"]);
  });

  it("reports a drop where the room already is as no change", () => {
    expect(reorderedIds(ids, "b", "c")).toBeNull(); // b is already just before c
    expect(reorderedIds(ids, "b", "b")).toBeNull();
    expect(reorderedIds(ids, "d", null)).toBeNull();
  });

  it("refuses rooms that aren't in the section", () => {
    expect(reorderedIds(ids, "x", "a")).toBeNull();
    expect(reorderedIds(ids, "a", "x")).toBeNull();
  });
});

/** Give each row a 20px-tall box starting at y=0. */
function layOut(rows: HTMLElement[]): void {
  rows.forEach((row, i) => {
    row.getBoundingClientRect = () =>
      ({ top: i * 20, bottom: i * 20 + 20, height: 20, left: 0, right: 200, width: 200, x: 0, y: i * 20, toJSON() {} }) as DOMRect;
  });
}

describe("dropTarget", () => {
  it("picks the first row whose midpoint is below the pointer", () => {
    const rows = [0, 1, 2].map(() => document.createElement("div"));
    layOut(rows);
    expect(dropTarget(rows, 5)).toBe(rows[0]);
    expect(dropTarget(rows, 15)).toBe(rows[1]);
    expect(dropTarget(rows, 45)).toBe(rows[2]);
    expect(dropTarget(rows, 55)).toBeNull();
  });
});

function pointer(type: string, target: EventTarget, init: { clientY: number; pointerType?: string; button?: number }): void {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientY: init.clientY, button: init.button ?? 0 });
  Object.defineProperty(ev, "pointerType", { value: init.pointerType ?? "mouse" });
  Object.defineProperty(ev, "pointerId", { value: 1 });
  target.dispatchEvent(ev);
}

describe("attachRoomDrag", () => {
  let container: HTMLElement;
  let rows: HTMLElement[];
  let onDrop: ReturnType<typeof vi.fn>;
  let detach: () => void;

  beforeEach(() => {
    container = document.createElement("div");
    container.getBoundingClientRect = () =>
      ({ top: -1000, bottom: 1000, height: 2000, left: 0, right: 200, width: 200, x: 0, y: -1000, toJSON() {} }) as DOMRect;
    rows = ["!a", "!b", "!c"].map((id) => {
      const row = document.createElement("div");
      row.className = "room-list__item";
      row.dataset.roomId = id;
      row.dataset.section = "!space";
      container.appendChild(row);
      return row;
    });
    layOut(rows);
    document.body.appendChild(container);
    onDrop = vi.fn();
    detach = attachRoomDrag({ container, onDrop });
  });

  afterEach(() => {
    detach();
    container.remove();
  });

  it("drops a dragged row before the row under the pointer", () => {
    pointer("pointerdown", rows[2], { clientY: 50 });
    pointer("pointermove", document, { clientY: 25 });
    expect(rows[2].classList.contains("room-list__item--dragging")).toBe(true);
    expect(rows[1].classList.contains("room-list__item--drop-before")).toBe(true);
    pointer("pointermove", document, { clientY: 5 });
    expect(rows[1].classList.contains("room-list__item--drop-before")).toBe(false);
    expect(rows[0].classList.contains("room-list__item--drop-before")).toBe(true);
    pointer("pointerup", document, { clientY: 5 });
    expect(onDrop).toHaveBeenCalledWith("!space", "!c", "!a");
    expect(rows[2].classList.contains("room-list__item--dragging")).toBe(false);
  });

  it("treats a press that barely moves as a click, not a drag", () => {
    pointer("pointerdown", rows[0], { clientY: 10 });
    pointer("pointermove", document, { clientY: 10 + DRAG_THRESHOLD_PX - 1 });
    pointer("pointerup", document, { clientY: 10 + DRAG_THRESHOLD_PX - 1 });
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("swallows the click that ends a drag, so the room isn't opened", () => {
    const onClick = vi.fn();
    rows[0].addEventListener("click", onClick);
    pointer("pointerdown", rows[0], { clientY: 10 });
    pointer("pointermove", document, { clientY: 55 });
    pointer("pointerup", document, { clientY: 55 });
    rows[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClick).not.toHaveBeenCalled();
    expect(onDrop).toHaveBeenCalledWith("!space", "!a", null);
  });

  it("ignores touch — a vertical swipe there is a scroll", () => {
    pointer("pointerdown", rows[2], { clientY: 50, pointerType: "touch" });
    pointer("pointermove", document, { clientY: 5, pointerType: "touch" });
    pointer("pointerup", document, { clientY: 5, pointerType: "touch" });
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("only drags rows of a space section", () => {
    delete rows[2].dataset.section;
    pointer("pointerdown", rows[2], { clientY: 50 });
    pointer("pointermove", document, { clientY: 5 });
    pointer("pointerup", document, { clientY: 5 });
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("cancels on Escape, and the release that follows doesn't open the room", () => {
    const onClick = vi.fn();
    container.addEventListener("click", onClick);
    pointer("pointerdown", rows[2], { clientY: 50 });
    pointer("pointermove", document, { clientY: 5 });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(rows[0].classList.contains("room-list__item--drop-before")).toBe(false);
    // Still holding the button; moving further does not restart the drag.
    pointer("pointermove", document, { clientY: 25 });
    expect(rows[2].classList.contains("room-list__item--dragging")).toBe(false);
    pointer("pointerup", document, { clientY: 5 });
    rows[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onDrop).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("stops tracking when the browser cancels the pointer", () => {
    pointer("pointerdown", rows[2], { clientY: 50 });
    pointer("pointermove", document, { clientY: 5 });
    pointer("pointercancel", document, { clientY: 5 });
    expect(rows[2].classList.contains("room-list__item--dragging")).toBe(false);
    // A later, unrelated release is not a drop.
    pointer("pointerup", document, { clientY: 5 });
    expect(onDrop).not.toHaveBeenCalled();
  });
});
