// The region of a string that an edit changed — shared by the compose box's
// undo (where the caret lands) and its paste handling (what a paste inserted).

/**
 * Where two versions of a text differ: `before.slice(start, beforeEnd)` was
 * replaced by `after.slice(start, afterEnd)`, and everything either side is
 * common to both.
 */
export interface ChangedRange {
  start: number;
  /** End of the replaced text in `before`. */
  beforeEnd: number;
  /** End of the replacing text in `after`. */
  afterEnd: number;
}

const isHighSurrogate = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff;
const isLowSurrogate = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff;

/**
 * The changed region between `before` and `after`: the longest common prefix
 * and suffix are taken off, and what is left is the change.
 *
 * Indices are UTF-16 offsets, as a textarea's selection is, but never fall
 * between the two halves of a surrogate pair. Two emoji can share a leading
 * (or trailing) code unit — 😂 and 😀 are both D83D-something — and a plain
 * unit-by-unit match counts that half as common, putting a boundary inside the
 * character. A caret placed there splits the emoji, and the next edit at it
 * leaves a lone surrogate in the draft.
 */
export function changedRange(before: string, after: string): ChangedRange {
  const max = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < max && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++;
  // A common high surrogate whose partner differs belongs to the change.
  if (prefix > 0 && isHighSurrogate(before.charCodeAt(prefix - 1))) prefix--;

  let suffix = 0;
  while (
    suffix < max - prefix &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) suffix++;
  // Likewise a common low surrogate whose partner differs.
  if (suffix > 0 && isLowSurrogate(after.charCodeAt(after.length - suffix))) suffix--;

  return { start: prefix, beforeEnd: before.length - suffix, afterEnd: after.length - suffix };
}
