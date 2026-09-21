// Keymap resolution engine for Quark's vim-mode system

export type KeyContext =
  | "global"    // nmap
  | "timeline"  // tmap
  | "roomlist"  // rmap
  | "picker"    // pmap
  | "insert"    // imap
  | "command"   // cmap
  | "visual";   // vmap

export interface KeymapEntry {
  /** The key sequence string, e.g. "gg", "Ctrl-e", "<leader>f" */
  sequence: string;
  /** The action identifier this sequence maps to */
  action: string;
  /** When true, the mapping is non-recursive (noremap) */
  noremap: boolean;
  context: KeyContext;
}

export interface KeymapOptions {
  /** Leader key character (default: " " / space) */
  leaderKey?: string;
  /** Timeout in ms before a partial sequence is abandoned (default: 500) */
  sequenceTimeoutMs?: number;
}

/** Result returned by resolveKey */
export type ResolveResult =
  | { kind: "action"; action: string; noremap: boolean }
  | { kind: "partial" }   // sequence is a valid prefix – wait for more keys
  | { kind: "none" };     // no match

/**
 * Whether a sequence is a modifier chord ("Ctrl-e") rather than a plain key
 * run ("gg").
 *
 * Chords are atomic: they never participate in the pending-sequence grammar.
 * Mixing them in would be actively wrong — every registered sequence is a
 * prefix candidate, so a registered "Ctrl-k" would make a bare "C" resolve as
 * `partial` and hang for the sequence timeout.
 */
export function isChordSequence(sequence: string): boolean {
  return /^(Ctrl|Alt|Meta|Cmd|Shift)-/i.test(sequence);
}

/**
 * A chord reduced to its meaning, for comparing two spellings of it.
 *
 * Chords are the one part of the keymap where the written form and the form
 * {@link eventChord} reports are produced by different hands — the defaults and
 * a user's quarkrc on one side, a live KeyboardEvent on the other — so they have
 * to be compared on something other than the exact string. `imap ctrl-e …` used
 * to be a binding that could never fire: {@link isChordSequence} matched it
 * case-insensitively and so kept it out of the sequence grammar, while
 * actionForKey compared it against "Ctrl-e" with `===` and never matched it
 * there either. It was accepted, registered, and wholly inert.
 *
 * Folded here: modifier case, modifier order, the Cmd/Meta spellings of Ctrl
 * (which eventChord already folds, for the macOS reason given there), and the
 * key's own case — Quark's chords are case-insensitive in the key because Shift
 * is spelled as a modifier, so "Ctrl-Shift-x" and "Ctrl-Shift-X" are one binding
 * rather than two, only one of which a keyboard can produce.
 *
 * The accepted modifier spellings are exactly the ones {@link isChordSequence}
 * recognises — a spelling this folded but that one rejected would be a binding
 * parsed as a nine-key sequence, which is the bug again in a new place.
 *
 * Plain sequences are deliberately *not* run through this: "G" and "g" are two
 * different bindings there, and lowercasing them would collapse jump-bottom onto
 * a motion.
 */
export function canonicalChord(sequence: string): string {
  const parts = sequence.split("-");
  const key = parts.pop() ?? "";
  const mods = new Set<string>();
  for (const part of parts) {
    switch (part.toLowerCase()) {
      case "ctrl": case "cmd": case "meta":
        mods.add("ctrl"); break;
      case "alt":
        mods.add("alt"); break;
      case "shift":
        mods.add("shift"); break;
      default:
        // Not a modifier we know. Kept verbatim so an unrecognised spelling
        // fails to match rather than quietly matching something else.
        mods.add(part.toLowerCase()); break;
    }
  }
  const KNOWN = ["ctrl", "alt", "shift"];
  const known = KNOWN.filter((m) => mods.has(m));
  const unknown = [...mods].filter((m) => !KNOWN.includes(m)).sort();
  return [...known, ...unknown, key.toLowerCase()].join("-");
}

/** Whether two registered/reported sequences denote the same keystroke. */
function sameSequence(a: string, b: string): boolean {
  return isChordSequence(a) && isChordSequence(b)
    ? canonicalChord(a) === canonicalChord(b)
    : a === b;
}

/**
 * Canonical chord string for a keyboard event, or null when no modifier is
 * held (a bare key, which belongs to the sequence grammar instead).
 *
 * Modifier order is fixed so "Ctrl-Shift-x" is the only spelling of itself, and
 * the key is lowercased because a chord's identity does not depend on whether
 * Shift happened to change the character — Ctrl+Shift+X arrives as key "X".
 */
export function eventChord(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): string | null {
  if (!e.ctrlKey && !e.metaKey && !e.altKey) return null;
  if (e.key === "Control" || e.key === "Alt" || e.key === "Meta" || e.key === "Shift") return null;
  const parts: string[] = [];
  // Ctrl and Meta are folded together: a macOS user presses Cmd where everyone
  // else presses Ctrl, and a keymap that distinguished them would need every
  // binding written twice.
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
  return parts.join("-");
}

function normaliseKey(raw: string, leaderKey: string): string {
  // Replace <leader> placeholder with actual leader key
  return raw.replace(/<leader>/gi, leaderKey);
}

export class KeymapManager {
  private _entries: KeymapEntry[] = [];
  private _leaderKey: string;
  private _timeoutMs: number;
  private _pendingSequence: string = "";
  private _timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(options: KeymapOptions = {}) {
    this._leaderKey = options.leaderKey ?? " ";
    this._timeoutMs = options.sequenceTimeoutMs ?? 500;
  }

  get leaderKey(): string {
    return this._leaderKey;
  }

  setLeaderKey(key: string): void {
    this._leaderKey = key;
  }

  /** Return a copy of all registered keymap entries. */
  getEntries(): KeymapEntry[] {
    return [...this._entries];
  }

  // ── Registration helpers ────────────────────────────────────────────────

  map(context: KeyContext, sequence: string, action: string, noremap = false): void {
    const normalised = normaliseKey(sequence, this._leaderKey);
    // Remove any existing mapping for the same context+keystroke. Compared by
    // meaning so `imap ctrl-e …` *replaces* the default Ctrl-e rather than
    // sitting beside it as a second entry for the same physical chord.
    this._entries = this._entries.filter(
      (e) => !(e.context === context && sameSequence(e.sequence, normalised))
    );
    this._entries.push({ sequence: normalised, action, noremap, context });
  }

  nmap(sequence: string, action: string): void { this.map("global", sequence, action, false); }
  nnoremap(sequence: string, action: string): void { this.map("global", sequence, action, true); }

  tmap(sequence: string, action: string): void { this.map("timeline", sequence, action, false); }
  tnoremap(sequence: string, action: string): void { this.map("timeline", sequence, action, true); }

  rmap(sequence: string, action: string): void { this.map("roomlist", sequence, action, false); }
  rnoremap(sequence: string, action: string): void { this.map("roomlist", sequence, action, true); }

  pmap(sequence: string, action: string): void { this.map("picker", sequence, action, false); }
  pnoremap(sequence: string, action: string): void { this.map("picker", sequence, action, true); }

  imap(sequence: string, action: string): void { this.map("insert", sequence, action, false); }
  inoremap(sequence: string, action: string): void { this.map("insert", sequence, action, true); }

  cmap(sequence: string, action: string): void { this.map("command", sequence, action, false); }
  cnoremap(sequence: string, action: string): void { this.map("command", sequence, action, true); }

  vmap(sequence: string, action: string): void { this.map("visual", sequence, action, false); }
  vnoremap(sequence: string, action: string): void { this.map("visual", sequence, action, true); }

  unmap(context: KeyContext, sequence: string): void {
    const normalised = normaliseKey(sequence, this._leaderKey);
    this._entries = this._entries.filter(
      (e) => !(e.context === context && sameSequence(e.sequence, normalised))
    );
  }

  // ── Resolution ──────────────────────────────────────────────────────────

  /**
   * Feed a single key (or chord like "Ctrl-e") into the engine.
   * activeContext: the current UI context (scoped maps beat global).
   * onTimeout: called if a pending partial sequence times out without completing.
   */
  resolveKey(
    key: string,
    activeContext: KeyContext,
    onTimeout?: (partial: string) => void
  ): ResolveResult {
    this._clearTimeout();

    this._pendingSequence += key;
    const seq = this._pendingSequence;

    // Build ordered candidate list: scoped entries first, then global. Chords
    // are excluded — they are resolved atomically by {@link actionForKey}, and
    // letting one into the prefix scan would strand the bare key it starts with.
    const plain = this._entries.filter((e) => !isChordSequence(e.sequence));
    const scopedEntries = plain.filter((e) => e.context === activeContext);
    const globalEntries = plain.filter((e) => e.context === "global");
    const ordered = [...scopedEntries, ...globalEntries];

    // Check for exact match (scoped takes priority over global for same sequence)
    const exact = this._findExact(ordered, seq);
    if (exact) {
      this._pendingSequence = "";
      return { kind: "action", action: exact.action, noremap: exact.noremap };
    }

    // Check if sequence is a prefix of any mapping
    const isPrefix = ordered.some((e) => e.sequence.startsWith(seq) && e.sequence !== seq);
    if (isPrefix) {
      this._scheduleTimeout(onTimeout);
      return { kind: "partial" };
    }

    // No match and not a prefix – abandon sequence
    this._pendingSequence = "";
    return { kind: "none" };
  }

  /**
   * Single-key exact lookup (scoped beats global) that does NOT touch the
   * pending-sequence buffer. Submodes that run their own multi-key grammar —
   * e.g. the compose-box vim editor, which composes counts + operators +
   * motions itself — can't feed keys through {@link resolveKey} without
   * fighting its sequence buffering, but still need to know what a single
   * physical key is bound to so user remaps apply. Returns the action, or null.
   *
   * Also the resolution path for modifier chords, which are atomic for the same
   * reason: "Ctrl-e" is one keystroke, not a sequence to accumulate.
   */
  actionForKey(key: string, activeContext: KeyContext): string | null {
    const scoped = this._entries.find(
      (e) => e.context === activeContext && sameSequence(e.sequence, key)
    );
    if (scoped) return scoped.action;
    const global = this._entries.find(
      (e) => e.context === "global" && sameSequence(e.sequence, key)
    );
    return global ? global.action : null;
  }

  /** Reset any pending sequence (e.g. on Escape) */
  resetSequence(): void {
    this._clearTimeout();
    this._pendingSequence = "";
  }

  get pendingSequence(): string {
    return this._pendingSequence;
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private _findExact(ordered: KeymapEntry[], seq: string): KeymapEntry | undefined {
    // First scoped exact match wins
    return ordered.find((e) => e.sequence === seq);
  }

  private _scheduleTimeout(onTimeout?: (partial: string) => void): void {
    const captured = this._pendingSequence;
    this._timeoutHandle = setTimeout(() => {
      this._pendingSequence = "";
      this._timeoutHandle = null;
      onTimeout?.(captured);
    }, this._timeoutMs);
  }

  private _clearTimeout(): void {
    if (this._timeoutHandle !== null) {
      clearTimeout(this._timeoutHandle);
      this._timeoutHandle = null;
    }
  }
}

// Singleton export
export const keymapManager = new KeymapManager();
