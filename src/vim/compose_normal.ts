// Vim Normal-mode editing for the compose textarea (#45).
//
// When the user leaves Insert with content in the compose box, the app drops
// into a compose-focused Normal mode (see text_select.ts / keyboard.ts). This
// module turns that from a read-only navigation layer into a real vim editor:
// motions (h l w b e 0 ^ $ j k), operators (d c y, doubled dd/cc/yy, and the
// to-end D C Y), x to delete a char, insert-entry (i a A I o O), an internal
// yank register with p/P, and r to replace a char — all with optional counts.
//
// The pure core (motions + spans) is unit-tested; the editor class is the thin
// stateful adapter that reads/writes a textarea.

type CharClass = "space" | "word" | "punct";

function classOf(ch: string | undefined): CharClass {
  if (ch === undefined || /\s/.test(ch)) return "space";
  if (/[A-Za-z0-9_]/.test(ch)) return "word";
  return "punct";
}

/** Start of the line containing `pos` (index just after the previous newline). */
export function lineStart(text: string, pos: number): number {
  const nl = text.lastIndexOf("\n", pos - 1);
  return nl + 1;
}

/** Index of the newline ending this line, or text length if it's the last line. */
export function lineEndExclusive(text: string, pos: number): number {
  const nl = text.indexOf("\n", pos);
  return nl === -1 ? text.length : nl;
}

/** First non-blank column of the line (the `^` motion), or lineStart if blank. */
export function firstNonBlank(text: string, pos: number): number {
  const start = lineStart(text, pos);
  const end = lineEndExclusive(text, pos);
  let i = start;
  while (i < end && /[ \t]/.test(text[i])) i++;
  return i;
}

/** `w` — start of the next word (word = run of word-chars or run of punctuation). */
export function wordForward(text: string, pos: number): number {
  const len = text.length;
  let i = pos;
  const cls = classOf(text[i]);
  if (cls !== "space") {
    while (i < len && classOf(text[i]) === cls) i++;
  }
  while (i < len && classOf(text[i]) === "space") i++;
  return Math.min(i, len);
}

/** `e` — end of the next word (inclusive target). */
export function wordEnd(text: string, pos: number): number {
  const len = text.length;
  let i = pos + 1;
  while (i < len && classOf(text[i]) === "space") i++;
  if (i >= len) return Math.max(0, len - 1);
  const cls = classOf(text[i]);
  while (i + 1 < len && classOf(text[i + 1]) === cls) i++;
  return i;
}

/** `b` — start of the previous word. */
export function wordBackward(text: string, pos: number): number {
  let i = pos - 1;
  while (i > 0 && classOf(text[i]) === "space") i--;
  if (i <= 0) return 0;
  const cls = classOf(text[i]);
  while (i - 1 >= 0 && classOf(text[i - 1]) === cls) i--;
  return Math.max(i, 0);
}

/** Move up/down one line, preserving the column where possible. */
function lineVertical(text: string, pos: number, dir: -1 | 1): number {
  const start = lineStart(text, pos);
  const col = pos - start;
  if (dir < 0) {
    if (start === 0) return pos; // already on the first line
    const prevStart = lineStart(text, start - 1);
    const prevEnd = start - 1; // the newline
    return Math.min(prevStart + col, prevEnd);
  }
  const end = lineEndExclusive(text, pos);
  if (end >= text.length) return pos; // already on the last line
  const nextStart = end + 1;
  const nextEnd = lineEndExclusive(text, nextStart);
  return Math.min(nextStart + col, nextEnd);
}

export type MotionKey = "h" | "l" | "w" | "b" | "e" | "0" | "^" | "$" | "j" | "k";

export function isMotionKey(key: string): key is MotionKey {
  return ["h", "l", "w", "b", "e", "0", "^", "$", "j", "k"].includes(key);
}

interface Motion {
  target: number;
  inclusive: boolean;
  /** Vertical motions (j/k) operate linewise when used with an operator. */
  vertical?: boolean;
}

function motionOnce(text: string, pos: number, key: MotionKey): Motion {
  switch (key) {
    case "h": return { target: Math.max(lineStart(text, pos), pos - 1), inclusive: false };
    case "l": return { target: Math.min(lineEndExclusive(text, pos), pos + 1), inclusive: false };
    case "w": return { target: wordForward(text, pos), inclusive: false };
    case "b": return { target: wordBackward(text, pos), inclusive: false };
    case "e": return { target: wordEnd(text, pos), inclusive: true };
    case "0": return { target: lineStart(text, pos), inclusive: false };
    case "^": return { target: firstNonBlank(text, pos), inclusive: false };
    case "$": return { target: Math.max(lineStart(text, pos), lineEndExclusive(text, pos) - 1), inclusive: true };
    case "j": return { target: lineVertical(text, pos, 1), inclusive: false, vertical: true };
    case "k": return { target: lineVertical(text, pos, -1), inclusive: false, vertical: true };
  }
}

/** Resolve a motion (applied `count` times) to a final cursor position. */
export function motionCursor(text: string, pos: number, key: MotionKey, count = 1): number {
  let cur = pos;
  for (let n = 0; n < Math.max(1, count); n++) {
    cur = motionOnce(text, cur, key).target;
  }
  // Normal-mode cursor rests on a character, never past the line's last one.
  const start = lineStart(text, cur);
  const end = lineEndExclusive(text, cur);
  return Math.min(Math.max(cur, start), Math.max(start, end - (end > start ? 1 : 0)));
}

export interface Span {
  start: number;
  end: number;
  linewise: boolean;
}

/** Resolve an operator + motion (applied `count` times) to a deletable span. */
export function operatorSpan(text: string, pos: number, key: MotionKey, count = 1): Span {
  // Vertical motions are linewise: operate on whole lines from `pos` to target.
  if (key === "j" || key === "k") {
    let cur = pos;
    for (let n = 0; n < Math.max(1, count); n++) cur = motionOnce(text, cur, key).target;
    const a = Math.min(pos, cur);
    const b = Math.max(pos, cur);
    return { start: lineStart(text, a), end: lineEndExclusive(text, b), linewise: true };
  }

  let cur = pos;
  let last = motionOnce(text, cur, key);
  for (let n = 0; n < Math.max(1, count); n++) {
    last = motionOnce(text, cur, key);
    cur = last.target;
  }

  const forward = cur >= pos;
  if (forward) {
    return { start: pos, end: last.inclusive ? cur + 1 : cur, linewise: false };
  }
  return { start: cur, end: pos, linewise: false };
}

/** The whole current line plus its trailing newline (or the preceding one if
 *  it's the last line) — the `dd`/`yy` linewise range. */
export function lineSpan(text: string, pos: number, count = 1): Span {
  const start = lineStart(text, pos);
  let end = lineEndExclusive(text, pos);
  for (let n = 1; n < Math.max(1, count); n++) {
    if (end >= text.length) break;
    end = lineEndExclusive(text, end + 1);
  }
  if (end < text.length) {
    end += 1; // include trailing newline
  } else if (start > 0) {
    return { start: start - 1, end, linewise: true }; // last line: take the preceding newline
  }
  return { start, end, linewise: true };
}

// ── Stateful editor ─────────────────────────────────────────────────────────

export interface ComposeKeyResult {
  /** True if the key was handled here (caller should not fall through). */
  consumed: boolean;
  /** Caller should transition to Insert mode (operators like c, and i/a/o/…). */
  enterInsert?: boolean;
  /** Caller should leave the compose box upward — `k` pressed on the first
   *  line, where the caret can't rise any further. The compose box reads as the
   *  bottom-most "message", so this hands focus up to the timeline (#15). */
  exitUp?: boolean;
}

const NOT_CONSUMED: ComposeKeyResult = { consumed: false };
const CONSUMED: ComposeKeyResult = { consumed: true };
const INSERT: ComposeKeyResult = { consumed: true, enterInsert: true };
const EXIT_UP: ComposeKeyResult = { consumed: true, exitUp: true };

/**
 * Drives vim Normal-mode editing of a compose textarea. Holds the pending
 * count / operator / r-target between keystrokes. `handleKey` mutates the
 * field and reports whether it consumed the key and whether the caller should
 * switch to Insert. The caller is responsible for re-priming the block cursor.
 */
export class ComposeNormalEditor {
  private count = "";
  private operator: "d" | "c" | "y" | null = null;
  private opCount = 1;
  private pendingReplace = false;
  private register = "";
  private registerLinewise = false;

  /**
   * Show the block cursor as a forward 1-char selection at the caret. Unlike
   * the shared primeBlockSelection (which extends backward at end-of-line for
   * visibility), this never moves the selection's lower bound, so the editor's
   * `pos = min(start, end)` reads the true caret on the next keystroke.
   */
  primeBlock(field: HTMLTextAreaElement): void {
    const pos = field.selectionStart ?? 0;
    const end = lineEndExclusive(field.value, pos);
    if (pos < end) field.setSelectionRange(pos, pos + 1, "forward");
    else field.setSelectionRange(pos, pos);
  }

  /** Clear any pending operator/count state (e.g. on leaving the field). */
  reset(): void {
    this.count = "";
    this.operator = null;
    this.opCount = 1;
    this.pendingReplace = false;
  }

  /** True while a multi-key sequence (count, operator, or r) is in progress. */
  get hasPending(): boolean {
    return this.count !== "" || this.operator !== null || this.pendingReplace;
  }

  handleKey(key: string, field: HTMLTextAreaElement): ComposeKeyResult {
    const text = field.value;
    const pos = Math.min(field.selectionStart ?? 0, field.selectionEnd ?? 0);

    // r{char}: replace the char under the cursor.
    if (this.pendingReplace) {
      this.pendingReplace = false;
      if (key.length === 1 && pos < lineEndExclusive(text, pos)) {
        this.replaceRange(field, pos, pos + 1, key);
        this.setCursor(field, pos);
      }
      this.count = "";
      return CONSUMED;
    }

    // Count digits ('0' is the line-start motion when no count is pending).
    if (/[0-9]/.test(key) && !(key === "0" && this.count === "")) {
      this.count += key;
      return CONSUMED;
    }

    const count = this.count === "" ? 1 : Math.max(1, parseInt(this.count, 10));

    // Operators. A repeated operator (dd/cc/yy) acts on whole lines.
    if (key === "d" || key === "c" || key === "y") {
      if (this.operator === key) {
        if (key === "c") {
          const s = lineStart(text, pos);
          const e = lineEndExclusive(text, pos);
          this.register = text.slice(s, e);
          this.registerLinewise = false;
          this.replaceRange(field, s, e, "");
          this.setCursor(field, s);
          this.reset();
          return INSERT;
        }
        this.applyOperator(field, key, lineSpan(text, pos, this.opCount * count), pos);
        this.reset();
        return CONSUMED;
      }
      this.operator = key;
      this.opCount = count;
      this.count = "";
      return CONSUMED;
    }

    // Motions, possibly as the target of a pending operator.
    if (isMotionKey(key)) {
      const total = (this.operator ? this.opCount : 1) * count;
      if (this.operator) {
        const op = this.operator;
        this.applyOperator(field, op, operatorSpan(text, pos, key, total), pos);
        this.reset();
        return op === "c" ? INSERT : CONSUMED;
      }
      // Bare `k` on the first line can't move the caret up any further, so it
      // leaves the compose box upward into the timeline rather than being
      // silently swallowed (#15). Any pending count is discarded.
      if (key === "k" && lineStart(text, pos) === 0) {
        this.reset();
        return EXIT_UP;
      }
      this.setCursor(field, motionCursor(text, pos, key, total));
      this.count = "";
      return CONSUMED;
    }

    // Past this point a dangling operator is abandoned (vim cancels d<x>).
    this.reset();

    switch (key) {
      case "x": {
        const end = lineEndExclusive(text, pos);
        if (pos < end) {
          this.register = text.slice(pos, pos + 1);
          this.registerLinewise = false;
          this.replaceRange(field, pos, pos + 1, "");
          this.setCursor(field, this.clampToLine(field.value, pos));
        }
        return CONSUMED;
      }
      case "D": {
        const end = lineEndExclusive(text, pos);
        this.register = text.slice(pos, end);
        this.registerLinewise = false;
        this.replaceRange(field, pos, end, "");
        this.setCursor(field, this.clampToLine(field.value, pos));
        return CONSUMED;
      }
      case "C": {
        const end = lineEndExclusive(text, pos);
        this.register = text.slice(pos, end);
        this.registerLinewise = false;
        this.replaceRange(field, pos, end, "");
        this.setCursor(field, pos);
        return INSERT;
      }
      case "Y": {
        const span = lineSpan(text, pos, count);
        this.register = text.slice(span.start, span.end);
        this.registerLinewise = true;
        return CONSUMED;
      }
      case "i": this.setCursor(field, pos); return INSERT;
      case "a": this.setCursor(field, Math.min(pos + 1, lineEndExclusive(text, pos))); return INSERT;
      case "I": this.setCursor(field, firstNonBlank(text, pos)); return INSERT;
      case "A": this.setCursor(field, lineEndExclusive(text, pos)); return INSERT;
      case "o": {
        const end = lineEndExclusive(text, pos);
        this.replaceRange(field, end, end, "\n");
        this.setCursor(field, end + 1);
        return INSERT;
      }
      case "O": {
        const start = lineStart(text, pos);
        this.replaceRange(field, start, start, "\n");
        this.setCursor(field, start);
        return INSERT;
      }
      case "p": this.paste(field, pos, true); return CONSUMED;
      case "P": this.paste(field, pos, false); return CONSUMED;
      case "r": this.pendingReplace = true; return CONSUMED;
      default:
        // Leave v / : / clipboard etc. to the existing text-select handler.
        return NOT_CONSUMED;
    }
  }

  private applyOperator(
    field: HTMLTextAreaElement,
    op: "d" | "c" | "y",
    span: Span,
    pos: number,
  ): void {
    const removed = field.value.slice(span.start, span.end);
    this.register = removed;
    this.registerLinewise = span.linewise;
    if (op === "y") {
      this.setCursor(field, this.clampToLine(field.value, Math.min(pos, span.start)));
      return;
    }
    this.replaceRange(field, span.start, span.end, "");
    this.setCursor(field, this.clampToLine(field.value, span.start));
  }

  private paste(field: HTMLTextAreaElement, pos: number, after: boolean): void {
    if (!this.register) return;
    const text = field.value;

    if (this.registerLinewise) {
      const block = this.register.endsWith("\n") ? this.register : this.register + "\n";
      if (after) {
        const end = lineEndExclusive(text, pos);
        if (end >= text.length) {
          this.replaceRange(field, end, end, "\n" + block.replace(/\n$/, ""));
          this.setCursor(field, this.clampToLine(field.value, end + 1));
        } else {
          this.replaceRange(field, end + 1, end + 1, block);
          this.setCursor(field, this.clampToLine(field.value, end + 1));
        }
      } else {
        const start = lineStart(text, pos);
        this.replaceRange(field, start, start, block);
        this.setCursor(field, this.clampToLine(field.value, start));
      }
      return;
    }

    const at = after ? Math.min(pos + 1, lineEndExclusive(text, pos) + 1) : pos;
    this.replaceRange(field, at, at, this.register);
    this.setCursor(field, this.clampToLine(field.value, at + this.register.length - 1));
  }

  private replaceRange(field: HTMLTextAreaElement, start: number, end: number, insert: string): void {
    field.value = field.value.slice(0, start) + insert + field.value.slice(end);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }

  private setCursor(field: HTMLTextAreaElement, pos: number): void {
    const clamped = Math.max(0, Math.min(pos, field.value.length));
    field.setSelectionRange(clamped, clamped);
  }

  private clampToLine(text: string, pos: number): number {
    const start = lineStart(text, pos);
    const end = lineEndExclusive(text, pos);
    const lastChar = Math.max(start, end - (end > start ? 1 : 0));
    return Math.min(Math.max(pos, start), lastChar);
  }
}
