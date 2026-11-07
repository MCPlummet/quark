import { describe, it, expect } from "vitest";
import { sectionedGridMove } from "./grid_nav.js";

// Two sections, 3 columns:
//   [A]  0  1  2
//        3  4
//   [B]  5  6  7
//        8  9 10
//       11
const SIZES = [5, 7];

describe("sectionedGridMove", () => {
  it("moves down a row within a section, keeping the column", () => {
    expect(sectionedGridMove(SIZES, 3, 1, "nav-down")).toBe(4);
    expect(sectionedGridMove(SIZES, 3, 6, "nav-down")).toBe(9);
  });

  it("clamps to a short row's last cell", () => {
    expect(sectionedGridMove(SIZES, 3, 2, "nav-down")).toBe(4);
    expect(sectionedGridMove(SIZES, 3, 10, "nav-down")).toBe(11);
  });

  // The case a flat `index + columns` gets wrong: 4 + 3 = 7, but the cell
  // below 4 (column 1) is 6, the next section's second cell.
  it("moves down from a section's short last row into the next section's first row", () => {
    expect(sectionedGridMove(SIZES, 3, 4, "nav-down")).toBe(6);
    expect(sectionedGridMove(SIZES, 3, 3, "nav-down")).toBe(5);
  });

  it("moves up from a section's first row into the previous section's last row", () => {
    expect(sectionedGridMove(SIZES, 3, 6, "nav-up")).toBe(4);
    // Column 2 has nothing in A's last row: clamp to its last cell.
    expect(sectionedGridMove(SIZES, 3, 7, "nav-up")).toBe(4);
    expect(sectionedGridMove(SIZES, 3, 5, "nav-up")).toBe(3);
  });

  it("returns null moving up off the first row, so the caller can leave the grid", () => {
    expect(sectionedGridMove(SIZES, 3, 0, "nav-up")).toBeNull();
    expect(sectionedGridMove(SIZES, 3, 2, "nav-up")).toBeNull();
  });

  it("stays put moving down off the last row", () => {
    expect(sectionedGridMove(SIZES, 3, 11, "nav-down")).toBe(11);
    expect(sectionedGridMove(SIZES, 3, 9, "nav-down")).toBe(11);
  });

  it("steps left and right in reading order across sections, clamped at the ends", () => {
    expect(sectionedGridMove(SIZES, 3, 4, "nav-right")).toBe(5);
    expect(sectionedGridMove(SIZES, 3, 5, "nav-left")).toBe(4);
    expect(sectionedGridMove(SIZES, 3, 0, "nav-left")).toBe(0);
    expect(sectionedGridMove(SIZES, 3, 11, "nav-right")).toBe(11);
  });

  it("skips empty sections", () => {
    expect(sectionedGridMove([2, 0, 2], 3, 1, "nav-down")).toBe(3);
    expect(sectionedGridMove([2, 0, 2], 3, 2, "nav-up")).toBe(0);
  });

  it("is a plain grid with one section", () => {
    expect(sectionedGridMove([8], 3, 5, "nav-down")).toBe(7);
    expect(sectionedGridMove([8], 3, 4, "nav-up")).toBe(1);
  });

  it("handles an empty grid", () => {
    expect(sectionedGridMove([], 3, 0, "nav-down")).toBeNull();
    expect(sectionedGridMove([0], 3, 0, "nav-right")).toBeNull();
  });
});
