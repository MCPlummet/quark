// Undo history for the compose box (#117).
//
// The compose box is a plain textarea, so the browser keeps an undo history of
// its own — but only for edits the browser made itself. Most of Quark's edits
// write `value` directly (vim Normal-mode operators, autocomplete, the markdown
// wrappers, a draft restored on room switch), and every such write either
// bypasses that history or wipes it, depending on the engine. Ctrl-Z therefore
// did nothing useful, and vim's `u` had nothing to call. This history records
// every change instead, whoever made it; `Input` feeds it and the native one is
// kept out of the way.
//
// Steps hold whole values, not diffs: a compose draft is small, and a snapshot
// cannot drift out of step with the text the way a chain of patches can. The
// caret is not stored either — `caretForRestore` puts it where the text changed,
// which is where the user is looking after an undo.

import { changedRange } from "./text_change.js";

/** How a change was made, which decides whether it joins the step before it. */
export type EditKind = "insert" | "delete" | "edit";

export interface RecordOpts {
  /**
   * `insert` / `delete`: a single typed character or a single Backspace /
   * Delete. Consecutive ones join into one step. `edit`: anything else — a
   * paste, a cut, a selection deleted, a programmatic write — always its own step.
   */
  kind: EditKind;
  /** Caret position just before the change; typing only joins a step it continues. */
  caretBefore?: number;
  /**
   * Start a step even where the change would continue the current one: typing
   * over a selection replaces text, which the typing before it did not, so it
   * must not join that typing just because the selection began where it ended.
   */
  startsStep?: boolean;
  /** Close the step after this change (whitespace was typed: a word ended). */
  boundary?: boolean;
}

interface Step {
  value: string;
  kind: EditKind;
  /** No further change may join this step. */
  sealed: boolean;
}

const DEFAULT_LIMIT = 200;

export class ComposeHistory {
  /** steps[0] is the baseline; steps[pos] is the current value. */
  private steps: Step[];
  private pos = 0;
  private readonly limit: number;

  constructor(initial: string, limit: number = DEFAULT_LIMIT) {
    this.steps = [{ value: initial, kind: "edit", sealed: true }];
    this.limit = Math.max(1, limit);
  }

  get current(): string {
    return this.steps[this.pos].value;
  }

  /** Record the field's value after a change. */
  record(after: string, opts: RecordOpts): void {
    if (after === this.current) return;
    this.steps.length = this.pos + 1; // a new change discards anything redoable
    const top = this.steps[this.pos];
    if (this.joins(top, opts)) {
      top.value = after;
    } else {
      this.steps.push({ value: after, kind: opts.kind, sealed: opts.kind === "edit" });
      this.pos++;
      while (this.steps.length - 1 > this.limit) {
        this.steps.shift();
        this.pos--;
      }
    }
    if (opts.boundary) this.steps[this.pos].sealed = true;
  }

  /**
   * Replace the current value without making a step — for a change that
   * corrects the one just recorded. If that leaves it equal to the step below,
   * the step goes, so undo never lands on a no-op.
   */
  amend(value: string): void {
    this.steps.length = this.pos + 1;
    this.steps[this.pos].value = value;
    if (this.pos > 0 && this.steps[this.pos - 1].value === value) {
      this.steps.pop();
      this.pos--;
    }
  }

  /** The value before the current step, or null when there is nothing to undo. */
  undo(): string | null {
    if (this.pos === 0) return null;
    this.steps[this.pos].sealed = true;
    this.pos--;
    // Sealed too: typing after an undo must not join the step it landed on, or
    // the next undo would take that earlier typing with it.
    this.steps[this.pos].sealed = true;
    return this.current;
  }

  /** The value an undo walked away from, or null when there is nothing to redo. */
  redo(): string | null {
    if (this.pos === this.steps.length - 1) return null;
    this.pos++;
    this.steps[this.pos].sealed = true;
    return this.current;
  }

  /** Make the next change start a step of its own. */
  seal(): void {
    this.steps[this.pos].sealed = true;
  }

  /** Whether a typed change continues the current step. */
  private joins(top: Step, opts: RecordOpts): boolean {
    if (opts.kind === "edit" || opts.startsStep || this.pos === 0) return false;
    if (top.sealed || top.kind !== opts.kind) return false;
    const below = this.steps[this.pos - 1].value;
    return opts.caretBefore === caretForRestore(below, top.value);
  }
}

/**
 * Where the caret belongs after the field changes from `from` to `to`: the end
 * of the changed region in `to` — after re-inserted text, or where removed text
 * used to be. Never inside a surrogate pair (see {@link changedRange}).
 */
export function caretForRestore(from: string, to: string): number {
  return changedRange(from, to).afterEnd;
}
