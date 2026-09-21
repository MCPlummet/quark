import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { KeymapManager, eventChord, isChordSequence } from "./keybindings";

describe("KeymapManager", () => {
  let km: KeymapManager;

  beforeEach(() => {
    vi.useFakeTimers();
    km = new KeymapManager({ leaderKey: " ", sequenceTimeoutMs: 500 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Single key resolution ─────────────────────────────────────────────

  it("resolves a single key to an action", () => {
    km.nmap("j", "cursor.down");
    const result = km.resolveKey("j", "global");
    expect(result).toEqual({ kind: "action", action: "cursor.down", noremap: false });
  });

  it("returns none for an unmapped key", () => {
    const result = km.resolveKey("z", "global");
    expect(result).toEqual({ kind: "none" });
  });

  // ── Single-key lookup (actionForKey, no sequence buffering) ───────────

  it("actionForKey returns the bound action without touching the sequence buffer", () => {
    km.nmap("h", "nav-left");
    km.nmap("gg", "jump-top");
    km.resolveKey("g", "global"); // valid prefix of "gg" -> stays pending
    expect(km.actionForKey("h", "global")).toBe("nav-left");
    expect(km.pendingSequence).toBe("g"); // lookup must not clear it
  });

  it("actionForKey returns null for an unbound key", () => {
    expect(km.actionForKey("w", "global")).toBeNull();
  });

  it("actionForKey honours quarkrc nav remaps (ijkl scheme)", () => {
    // The documented ijkl remap: j/k/l/; drive left/down/up/right.
    km.nmap("j", "nav-left");
    km.nmap("k", "nav-down");
    km.nmap("l", "nav-up");
    km.nmap(";", "nav-right");
    expect(km.actionForKey("j", "global")).toBe("nav-left");
    expect(km.actionForKey(";", "global")).toBe("nav-right");
  });

  it("actionForKey prefers a scoped binding over global", () => {
    km.nmap("k", "nav-up");
    km.tmap("k", "scroll-down");
    expect(km.actionForKey("k", "timeline")).toBe("scroll-down");
    expect(km.actionForKey("k", "global")).toBe("nav-up");
  });

  // ── Multi-key sequences ───────────────────────────────────────────────

  it("returns partial on first key of a multi-key sequence", () => {
    km.nmap("gg", "cursor.top");
    const result = km.resolveKey("g", "global");
    expect(result).toEqual({ kind: "partial" });
  });

  it("resolves gg sequence", () => {
    km.nmap("gg", "cursor.top");
    km.resolveKey("g", "global"); // first g -> partial
    const result = km.resolveKey("g", "global"); // second g -> action
    expect(result).toEqual({ kind: "action", action: "cursor.top", noremap: false });
  });

  it("resolves dd sequence", () => {
    km.nmap("dd", "message.delete");
    km.resolveKey("d", "global");
    const result = km.resolveKey("d", "global");
    expect(result).toEqual({ kind: "action", action: "message.delete", noremap: false });
  });

  it("abandons partial sequence on unmatched second key", () => {
    km.nmap("gg", "cursor.top");
    km.resolveKey("g", "global");
    const result = km.resolveKey("x", "global"); // gx is not mapped
    expect(result).toEqual({ kind: "none" });
    expect(km.pendingSequence).toBe("");
  });

  // ── Modifier keys ─────────────────────────────────────────────────────

  // Chords resolve atomically through actionForKey, never through resolveKey:
  // the real handler feeds resolveKey a bare `e.key`, and letting a chord into
  // the prefix scan would strand the bare key it starts with (see below).
  it("resolves a modifier chord through actionForKey", () => {
    km.nmap("Ctrl-e", "scroll.down");
    expect(km.actionForKey("Ctrl-e", "global")).toBe("scroll.down");
  });

  it("keeps chords out of the sequence grammar", () => {
    km.nmap("Ctrl-k", "open-command-palette");
    // Without the exclusion, "C" is a prefix of "Ctrl-k" and would come back
    // `partial`, swallowing the key and hanging for the sequence timeout.
    expect(km.resolveKey("C", "global")).toEqual({ kind: "none" });
    expect(km.resolveKey("Ctrl-k", "global")).toEqual({ kind: "none" });
  });

  it("scopes chords like any other binding", () => {
    km.imap("Ctrl-e", "open-emoji-picker");
    expect(km.actionForKey("Ctrl-e", "insert")).toBe("open-emoji-picker");
    expect(km.actionForKey("Ctrl-e", "timeline")).toBeNull();
  });

  // A lowercase chord in a quarkrc used to be wholly inert: isChordSequence
  // matched it case-insensitively and so kept it out of the sequence grammar,
  // while actionForKey compared it against the "Ctrl-e" eventChord reports using
  // `===` and never matched it there either.
  it("matches a chord however the binding spelled it", () => {
    km.imap("ctrl-e", "open-emoji-picker");
    expect(km.actionForKey("Ctrl-e", "insert")).toBe("open-emoji-picker");
  });

  it("matches a chord whose modifiers were written in another order", () => {
    km.nmap("shift-ctrl-x", "strikethrough");
    expect(km.actionForKey("Ctrl-Shift-x", "global")).toBe("strikethrough");
  });

  it("accepts the Cmd and Meta spellings of Ctrl", () => {
    km.nmap("Cmd-k", "open-command-palette");
    expect(km.actionForKey("Ctrl-k", "global")).toBe("open-command-palette");
  });

  it("matches a named key in a chord case-insensitively", () => {
    km.imap("ctrl-enter", "send-message");
    expect(km.actionForKey("Ctrl-Enter", "insert")).toBe("send-message");
  });

  // Otherwise a user's remap sits beside the default as a second entry for the
  // same physical chord, and whichever was registered first keeps winning.
  it("replaces a differently-spelled binding for the same chord", () => {
    km.imap("Ctrl-e", "open-emoji-picker");
    km.imap("ctrl-e", "open-gif-picker");
    expect(km.actionForKey("Ctrl-e", "insert")).toBe("open-gif-picker");
    expect(km.getEntries().filter((entry) => entry.context === "insert")).toHaveLength(1);
  });

  it("unmaps a chord however the directive spelled it", () => {
    km.imap("Ctrl-e", "open-emoji-picker");
    km.unmap("insert", "ctrl-e");
    expect(km.actionForKey("Ctrl-e", "insert")).toBeNull();
  });

  // Plain sequences are case-sensitive and must stay so: G is jump-bottom and g
  // starts the `gg` sequence.
  it("keeps plain sequences case-sensitive", () => {
    km.nmap("G", "jump-bottom");
    expect(km.actionForKey("g", "global")).toBeNull();
    expect(km.actionForKey("G", "global")).toBe("jump-bottom");
  });

  // ── Scoped map precedence ─────────────────────────────────────────────

  it("scoped map takes precedence over global map for the same sequence", () => {
    km.nmap("j", "cursor.down");
    km.tmap("j", "timeline.next");
    const result = km.resolveKey("j", "timeline");
    expect(result).toEqual({ kind: "action", action: "timeline.next", noremap: false });
  });

  it("falls back to global map when no scoped entry matches", () => {
    km.nmap("j", "cursor.down");
    const result = km.resolveKey("j", "timeline");
    expect(result).toEqual({ kind: "action", action: "cursor.down", noremap: false });
  });

  it("scoped map does not affect a different context", () => {
    km.tmap("j", "timeline.next");
    // roomlist context should not see the timeline binding
    const result = km.resolveKey("j", "roomlist");
    expect(result).toEqual({ kind: "none" });
  });

  // ── Leader key expansion ──────────────────────────────────────────────

  it("expands <leader> to the configured leader key (space)", () => {
    km.nmap("<leader>f", "file.find");
    // Pressing space then f should resolve to file.find
    km.resolveKey(" ", "global"); // leader -> partial
    const result = km.resolveKey("f", "global");
    expect(result).toEqual({ kind: "action", action: "file.find", noremap: false });
  });

  it("honours a custom leader key", () => {
    const customKm = new KeymapManager({ leaderKey: "," });
    customKm.nmap("<leader>w", "window.next");
    customKm.resolveKey(",", "global");
    const result = customKm.resolveKey("w", "global");
    expect(result).toEqual({ kind: "action", action: "window.next", noremap: false });
  });

  // ── Timeout behaviour ─────────────────────────────────────────────────

  it("calls onTimeout callback after sequence timeout", () => {
    km.nmap("gg", "cursor.top");
    const onTimeout = vi.fn();
    km.resolveKey("g", "global", onTimeout); // partial
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(onTimeout).toHaveBeenCalledOnce();
    expect(onTimeout).toHaveBeenCalledWith("g");
  });

  it("clears pending sequence after timeout", () => {
    km.nmap("gg", "cursor.top");
    km.resolveKey("g", "global");
    vi.advanceTimersByTime(500);
    expect(km.pendingSequence).toBe("");
  });

  it("resets timeout timer when another key arrives before timeout", () => {
    km.nmap("gg", "cursor.top");
    km.nmap("gj", "cursor.down.jump");
    const onTimeout = vi.fn();
    km.resolveKey("g", "global", onTimeout);
    vi.advanceTimersByTime(300); // not expired yet
    // Feed another key that keeps a partial match
    km.resolveKey("g", "global", onTimeout); // gg is an exact match -> resolves
    vi.advanceTimersByTime(500); // timeout should NOT fire again
    // onTimeout should not have been called (gg resolved exactly)
    expect(onTimeout).not.toHaveBeenCalled();
  });

  // ── noremap prevents recursive resolution ────────────────────────────

  it("noremap flag is set correctly for nnoremap", () => {
    km.nnoremap("k", "cursor.up");
    const result = km.resolveKey("k", "global");
    expect(result).toEqual({ kind: "action", action: "cursor.up", noremap: true });
  });

  it("nmap has noremap=false", () => {
    km.nmap("k", "cursor.up");
    const result = km.resolveKey("k", "global");
    expect(result).toEqual({ kind: "action", action: "cursor.up", noremap: false });
  });

  it("noremap variant overrides an existing recursive map for the same sequence", () => {
    km.nmap("k", "cursor.up");
    km.nnoremap("k", "cursor.up.noremap");
    const result = km.resolveKey("k", "global");
    expect(result).toEqual({ kind: "action", action: "cursor.up.noremap", noremap: true });
  });

  // ── resetSequence ────────────────────────────────────────────────────

  it("resetSequence clears pending input", () => {
    km.nmap("gg", "cursor.top");
    km.resolveKey("g", "global");
    km.resetSequence();
    expect(km.pendingSequence).toBe("");
  });

  // ── unmap ────────────────────────────────────────────────────────────

  it("unmap removes a mapping", () => {
    km.nmap("j", "cursor.down");
    km.unmap("global", "j");
    const result = km.resolveKey("j", "global");
    expect(result).toEqual({ kind: "none" });
  });

  // ── Context-specific helpers ─────────────────────────────────────────

  it("imap registers in insert context", () => {
    km.imap("Ctrl-c", "insert.cancel");
    expect(km.actionForKey("Ctrl-c", "insert")).toBe("insert.cancel");
  });

  it("cmap registers in command context", () => {
    km.cmap("Ctrl-p", "history.prev");
    expect(km.actionForKey("Ctrl-p", "command")).toBe("history.prev");
  });

  it("vmap registers in visual context", () => {
    km.vmap("y", "visual.yank");
    const result = km.resolveKey("y", "visual");
    expect(result).toEqual({ kind: "action", action: "visual.yank", noremap: false });
  });
});

describe("eventChord", () => {
  const ev = (over: Partial<Parameters<typeof eventChord>[0]> = {}) => ({
    key: "e", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over,
  });

  it("returns null for a bare key, which belongs to the sequence grammar", () => {
    expect(eventChord(ev())).toBeNull();
    expect(eventChord(ev({ shiftKey: true, key: "G" }))).toBeNull();
  });

  it("serialises a control chord", () => {
    expect(eventChord(ev({ ctrlKey: true }))).toBe("Ctrl-e");
  });

  // A macOS user presses Cmd where everyone else presses Ctrl; a keymap that
  // distinguished them would need every binding written twice.
  it("folds Meta onto Ctrl", () => {
    expect(eventChord(ev({ metaKey: true }))).toBe("Ctrl-e");
  });

  it("orders modifiers canonically", () => {
    expect(eventChord(ev({ ctrlKey: true, altKey: true, shiftKey: true, key: "X" })))
      .toBe("Ctrl-Alt-Shift-x");
  });

  // Ctrl+Shift+X arrives with key "X"; a chord's identity should not depend on
  // whether Shift happened to change the character.
  it("lowercases single characters", () => {
    expect(eventChord(ev({ ctrlKey: true, shiftKey: true, key: "X" }))).toBe("Ctrl-Shift-x");
  });

  it("leaves named keys alone", () => {
    expect(eventChord(ev({ ctrlKey: true, key: "Enter" }))).toBe("Ctrl-Enter");
  });

  it("ignores a bare modifier press", () => {
    expect(eventChord(ev({ ctrlKey: true, key: "Control" }))).toBeNull();
    expect(eventChord(ev({ altKey: true, key: "Alt" }))).toBeNull();
  });
});

describe("isChordSequence", () => {
  it("tells chords from plain key runs", () => {
    expect(isChordSequence("Ctrl-k")).toBe(true);
    expect(isChordSequence("Ctrl-Shift-x")).toBe(true);
    expect(isChordSequence("gg")).toBe(false);
    expect(isChordSequence("ArrowDown")).toBe(false);
  });
});
