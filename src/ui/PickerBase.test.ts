import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  SelectionList,
  type HighlightStrategy,
  type NavAction,
} from "./PickerBase.js";
import type { ResolveResult } from "../vim/keybindings.js";

// SelectionList is the single nav engine shared by every picker (emoji — in
// both its compose and reaction contexts — gif, sticker, quick-nav). A regression in
// its column/clamping math breaks all of them at once — and the grid arithmetic
// here is exactly what the "grid-accurate quick-react nav" fix (d263814)
// corrected. These tests lock that math down.

/** Build `n` detached <div> items and return them as a live array. */
function makeItems(n: number): HTMLElement[] {
  return Array.from({ length: n }, (_, i) => {
    const el = document.createElement("div");
    el.dataset.idx = String(i);
    return el;
  });
}

const CLASS_HL: HighlightStrategy = { kind: "class", activeClass: "active" };

interface Harness {
  list: SelectionList;
  items: HTMLElement[];
  onSelect: ReturnType<typeof vi.fn>;
  onFocusChange: ReturnType<typeof vi.fn>;
}

function harness(opts: {
  count: number;
  columns: number;
  highlight?: HighlightStrategy;
  resolve?: (key: string) => ResolveResult;
}): Harness {
  const items = makeItems(opts.count);
  const onSelect = vi.fn();
  const onFocusChange = vi.fn();
  const list = new SelectionList({
    columns: opts.columns,
    highlight: opts.highlight ?? CLASS_HL,
    getItems: () => items,
    onSelect,
    onFocusChange,
    resolve: opts.resolve,
  });
  return { list, items, onSelect, onFocusChange };
}

describe("SelectionList", () => {
  describe("grid navigation (columns > 1)", () => {
    // A 3-column grid over 8 items:
    //   0 1 2
    //   3 4 5
    //   6 7
    it("nav-down moves by exactly `columns`", () => {
      const { list } = harness({ count: 8, columns: 3 });
      expect(list.focusIndex).toBe(0);
      list.dispatch("nav-down");
      expect(list.focusIndex).toBe(3);
      list.dispatch("nav-down");
      expect(list.focusIndex).toBe(6);
    });

    it("nav-up moves by exactly `columns`", () => {
      const { list } = harness({ count: 8, columns: 3 });
      list.setFocus(7);
      list.dispatch("nav-up");
      expect(list.focusIndex).toBe(4);
      list.dispatch("nav-up");
      expect(list.focusIndex).toBe(1);
    });

    it("nav-right / nav-left move by one within the grid", () => {
      const { list } = harness({ count: 8, columns: 3 });
      list.dispatch("nav-right");
      expect(list.focusIndex).toBe(1);
      list.dispatch("nav-right");
      expect(list.focusIndex).toBe(2);
      list.dispatch("nav-left");
      expect(list.focusIndex).toBe(1);
    });

    it("nav-down from a full row into a SHORT last row clamps to the last item, never past it", () => {
      // This is the crux of the grid-accurate fix: from index 5 (row 1, col 2)
      // a naive +columns lands on 8, which doesn't exist. It must clamp to 7.
      const { list } = harness({ count: 8, columns: 3 });
      list.setFocus(5);
      list.dispatch("nav-down");
      expect(list.focusIndex).toBe(7);
    });

    it("right/left are linear index moves (cross row boundaries) and clamp at item 0", () => {
      const { list } = harness({ count: 8, columns: 3 });
      list.setFocus(2); // end of first visual row
      list.dispatch("nav-right"); // linear +1 → flows into the next row
      expect(list.focusIndex).toBe(3);
      list.setFocus(0);
      list.dispatch("nav-left"); // already at the first item
      expect(list.focusIndex).toBe(0);
    });

    it("nav-up at the top row stays put (clamps at 0)", () => {
      const { list } = harness({ count: 8, columns: 3 });
      list.setFocus(2);
      list.dispatch("nav-up");
      expect(list.focusIndex).toBe(0);
    });
  });

  describe("list navigation (columns = 1)", () => {
    it("nav-down / nav-up step by one and clamp at the ends", () => {
      const { list } = harness({ count: 3, columns: 1 });
      list.dispatch("nav-down");
      expect(list.focusIndex).toBe(1);
      list.dispatch("nav-down");
      expect(list.focusIndex).toBe(2);
      list.dispatch("nav-down"); // clamp at bottom
      expect(list.focusIndex).toBe(2);
      list.dispatch("nav-up");
      expect(list.focusIndex).toBe(1);
    });
  });

  describe("jump + select", () => {
    it("jump-top and jump-bottom go to the ends", () => {
      const { list } = harness({ count: 5, columns: 2 });
      list.dispatch("jump-bottom");
      expect(list.focusIndex).toBe(4);
      list.dispatch("jump-top");
      expect(list.focusIndex).toBe(0);
    });

    it("select invokes onSelect with the focused index", () => {
      const { list, onSelect } = harness({ count: 5, columns: 2 });
      list.setFocus(3);
      const handled = list.dispatch("select");
      expect(handled).toBe(true);
      expect(onSelect).toHaveBeenCalledExactlyOnceWith(3);
    });

    it("close reports unhandled so the picker can route it to hide()", () => {
      const { list } = harness({ count: 5, columns: 2 });
      expect(list.dispatch("close")).toBe(false);
    });

    it("unknown actions report unhandled", () => {
      const { list } = harness({ count: 5, columns: 2 });
      expect(list.dispatch("bogus" as NavAction)).toBe(false);
    });
  });

  describe("setFocus / clamping / empty list", () => {
    it("clamps an out-of-range setFocus into bounds", () => {
      const { list } = harness({ count: 4, columns: 2 });
      list.setFocus(99);
      expect(list.focusIndex).toBe(3);
      list.setFocus(-5);
      expect(list.focusIndex).toBe(0);
    });

    it("an empty list pins focus at 0 and dispatch is a no-op", () => {
      const { list, onSelect } = harness({ count: 0, columns: 3 });
      list.setFocus(2);
      expect(list.focusIndex).toBe(0);
      list.dispatch("nav-down");
      expect(list.focusIndex).toBe(0);
      list.dispatch("select");
      // select still fires against index 0 even when empty — callers guard this,
      // but we assert the documented behaviour so it can't change silently.
      expect(onSelect).toHaveBeenCalledExactlyOnceWith(0);
    });

    it("fires onFocusChange whenever the index is (re)applied", () => {
      const { list, onFocusChange } = harness({ count: 4, columns: 2 });
      list.dispatch("nav-down");
      list.dispatch("nav-right");
      expect(onFocusChange).toHaveBeenCalledTimes(2);
      expect(onFocusChange).toHaveBeenLastCalledWith(3);
    });
  });

  describe("highlight strategies", () => {
    it("class strategy toggles activeClass onto the focused item only", () => {
      const { list, items } = harness({ count: 4, columns: 2, highlight: CLASS_HL });
      list.setFocus(2);
      expect(items.map((el) => el.classList.contains("active"))).toEqual([
        false,
        false,
        true,
        false,
      ]);
      list.setFocus(0);
      expect(items.map((el) => el.classList.contains("active"))).toEqual([
        true,
        false,
        false,
        false,
      ]);
    });

    it("tabindex strategy sets a roving tabindex and focuses the active cell", () => {
      const items = makeItems(3);
      for (const el of items) document.body.appendChild(el);
      const list = new SelectionList({
        columns: 3,
        highlight: { kind: "tabindex" },
        getItems: () => items,
        onSelect: vi.fn(),
      });
      list.setFocus(1);
      expect(items.map((el) => el.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);
      expect(document.activeElement).toBe(items[1]);
      for (const el of items) el.remove();
    });

    // The emoji grid has ~1,900 cells; a move rewrote every one of them.
    it("a move rewrites only the cell left and the cell reached", () => {
      const items = makeItems(50);
      const list = new SelectionList({
        columns: 5,
        highlight: { kind: "tabindex" },
        getItems: () => items,
        onSelect: vi.fn(),
      });
      list.setFocus(0);
      const writes = items.map((el) => vi.spyOn(el, "setAttribute"));
      list.dispatch("nav-down");
      expect(writes.filter((w) => w.mock.calls.length > 0)).toHaveLength(2);
      expect(items.map((el) => el.getAttribute("tabindex")).filter((t) => t === "0")).toHaveLength(1);
      expect(items[5].getAttribute("tabindex")).toBe("0");
    });

    it("sweeps every item again after a re-render", () => {
      let items = makeItems(4);
      const list = new SelectionList({
        columns: 2,
        highlight: CLASS_HL,
        getItems: () => items,
        onSelect: vi.fn(),
      });
      list.setFocus(1);
      // A re-render that (wrongly or not) starts an item marked: the sweep fixes it.
      items = makeItems(4);
      items[3].classList.add("active");
      list.setFocus(0);
      expect(items.map((el) => el.classList.contains("active"))).toEqual([true, false, false, false]);
    });
  });

  describe("handleKey (keymap-driven)", () => {
    function resolverFor(map: Record<string, ResolveResult>): (key: string) => ResolveResult {
      return (key) => map[key] ?? { kind: "none" };
    }

    it("resolves an action key, dispatches it, and reports consumed", () => {
      const { list } = harness({
        count: 6,
        columns: 3,
        resolve: resolverFor({
          j: { kind: "action", action: "nav-down", noremap: false },
        }),
      });
      const r = list.handleKey("j");
      expect(r).toEqual({ consumed: true, partial: false });
      expect(list.focusIndex).toBe(3);
    });

    it("reports a partial (multi-key prefix) as consumed-but-pending without moving", () => {
      const { list } = harness({
        count: 6,
        columns: 3,
        resolve: resolverFor({ g: { kind: "partial" } }),
      });
      const r = list.handleKey("g");
      expect(r).toEqual({ consumed: true, partial: true });
      expect(list.focusIndex).toBe(0);
    });

    it("reports an unmapped key as not consumed (so the picker can handle it)", () => {
      const { list } = harness({
        count: 6,
        columns: 3,
        resolve: resolverFor({}),
      });
      expect(list.handleKey("x")).toEqual({ consumed: false, partial: false });
    });

    it("a resolved `close` action is reported NOT consumed (routes to hide)", () => {
      const { list } = harness({
        count: 6,
        columns: 3,
        resolve: resolverFor({
          Escape: { kind: "action", action: "close", noremap: false },
        }),
      });
      expect(list.handleKey("Escape")).toEqual({ consumed: false, partial: false });
    });
  });

  // The emoji picker's sectioned grid and its picker-specific keys go through
  // these hooks, so its every key still takes the one keymap resolution.
  describe("move / onEdge / onAction hooks", () => {
    it("a `move` override decides where directional actions land", () => {
      const items = makeItems(6);
      const move = vi.fn((from: number) => (from === 0 ? 4 : null));
      const onEdge = vi.fn();
      const list = new SelectionList({
        columns: 3, highlight: CLASS_HL, getItems: () => items, onSelect: vi.fn(), move, onEdge,
      });
      expect(list.dispatch("nav-down")).toBe(true);
      expect(move).toHaveBeenCalledWith(0, "nav-down", 6);
      expect(list.focusIndex).toBe(4);
      expect(onEdge).not.toHaveBeenCalled();
    });

    it("a null move reports the edge and leaves focus where it was", () => {
      const items = makeItems(6);
      const onEdge = vi.fn();
      const list = new SelectionList({
        columns: 3, highlight: CLASS_HL, getItems: () => items, onSelect: vi.fn(),
        move: () => null, onEdge,
      });
      list.setFocus(2);
      list.dispatch("nav-up");
      expect(onEdge).toHaveBeenCalledExactlyOnceWith("nav-up");
      expect(list.focusIndex).toBe(2);
    });

    it("jumps, select and the fixed-column arithmetic are untouched by `move`", () => {
      const items = makeItems(6);
      const list = new SelectionList({
        columns: 3, highlight: CLASS_HL, getItems: () => items, onSelect: vi.fn(), move: () => 0,
      });
      list.dispatch("jump-bottom");
      expect(list.focusIndex).toBe(5);
    });

    it("hands close and unknown actions to onAction, consumed when it accepts", () => {
      const onAction = vi.fn((a: string) => a === "picker-search" || a === "close");
      const withHook = new SelectionList({
        columns: 1, highlight: CLASS_HL, getItems: () => makeItems(3), onSelect: vi.fn(), onAction,
        resolve: (key) =>
          key === "/" ? { kind: "action", action: "picker-search", noremap: false }
          : key === "Escape" ? { kind: "action", action: "close", noremap: false }
          : { kind: "action", action: "toggle-member-list", noremap: false },
      });
      expect(withHook.handleKey("/").consumed).toBe(true);
      expect(withHook.handleKey("Escape").consumed).toBe(true);
      expect(withHook.handleKey("m").consumed).toBe(false);
      expect(onAction.mock.calls.map((c) => c[0])).toEqual(["picker-search", "close", "toggle-member-list"]);
    });
  });
});
