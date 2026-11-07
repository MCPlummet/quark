// Directional movement in a grid made of sections, each starting on a fresh row
// under its own header — the emoji picker's browse view. Pure, so the row
// arithmetic is tested without a layout engine.
//
// A flat `index ± columns` lands in the wrong place as soon as a section ends
// part-way along a row: the next section's first cell is on a new row, not in
// the gap. The reaction picker used to work around that by measuring
// offsetTop/offsetLeft at every keypress; this computes the same answer from the
// section sizes and the column count the grid is laid out with.

import type { DirectionalAction } from "./PickerBase.js";

/**
 * Where `move` from cell `from` lands, in a grid whose sections hold `sizes`
 * cells each and wrap at `columns`.
 *
 * Left and right step through cells in reading order, across row and section
 * boundaries. Up and down keep the column, clamped to a shorter row. Down from
 * the last row stays put; up from the first row returns null — the caller
 * decides what lies above the grid (the emoji picker's search field).
 */
export function sectionedGridMove(
  sizes: readonly number[],
  columns: number,
  from: number,
  move: DirectionalAction,
): number | null {
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const cols = Math.max(1, Math.floor(columns));
  const i = Math.max(0, Math.min(from, total - 1));

  if (move === "nav-left") return Math.max(0, i - 1);
  if (move === "nav-right") return Math.min(total - 1, i + 1);

  // Locate the section holding `i` (empty sections occupy no rows).
  let s = 0;
  let start = 0;
  while (i >= start + sizes[s]) {
    start += sizes[s];
    s++;
  }
  const local = i - start;
  const row = Math.floor(local / cols);
  const col = local % cols;
  const rows = (n: number): number => Math.ceil(n / cols);

  if (move === "nav-down") {
    if (row + 1 < rows(sizes[s])) return start + Math.min((row + 1) * cols + col, sizes[s] - 1);
    let next = s + 1;
    while (next < sizes.length && sizes[next] === 0) next++;
    if (next >= sizes.length) return i;
    return start + sizes[s] + Math.min(col, sizes[next] - 1);
  }

  // nav-up
  if (row > 0) return start + (row - 1) * cols + col;
  let prev = s - 1;
  while (prev >= 0 && sizes[prev] === 0) prev--;
  if (prev < 0) return null;
  const prevStart = start - sizes[prev];
  const lastRow = rows(sizes[prev]) - 1;
  return prevStart + Math.min(lastRow * cols + col, sizes[prev] - 1);
}
