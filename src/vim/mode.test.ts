import { describe, it, expect, beforeEach, vi } from "vitest";
import { Mode, ModeManager } from "./mode";

describe("ModeManager", () => {
  let manager: ModeManager;

  beforeEach(() => {
    manager = new ModeManager();
  });

  // ── Initial state ─────────────────────────────────────────────────────

  it("starts in Normal mode", () => {
    expect(manager.current).toBe(Mode.Normal);
  });

  // ── Valid transitions ─────────────────────────────────────────────────

  it("transitions Normal -> Insert", () => {
    expect(manager.transition(Mode.Insert)).toBe(true);
    expect(manager.current).toBe(Mode.Insert);
  });

  it("transitions Normal -> Command", () => {
    expect(manager.transition(Mode.Command)).toBe(true);
    expect(manager.current).toBe(Mode.Command);
  });

  it("transitions Normal -> Visual", () => {
    expect(manager.transition(Mode.Visual)).toBe(true);
    expect(manager.current).toBe(Mode.Visual);
  });

  it("transitions Insert -> Normal", () => {
    manager.transition(Mode.Insert);
    expect(manager.transition(Mode.Normal)).toBe(true);
    expect(manager.current).toBe(Mode.Normal);
  });

  it("transitions Command -> Normal", () => {
    manager.transition(Mode.Command);
    expect(manager.transition(Mode.Normal)).toBe(true);
    expect(manager.current).toBe(Mode.Normal);
  });

  it("transitions Visual -> Normal", () => {
    manager.transition(Mode.Visual);
    expect(manager.transition(Mode.Normal)).toBe(true);
    expect(manager.current).toBe(Mode.Normal);
  });

  // Not vim transitions. With vim mode off the app lives in Insert and Normal is
  // unreachable, so the command bar the palette prefills has to open from Insert
  // and return to it — see the note on VALID_TRANSITIONS.
  it("transitions Insert -> Command, for the vim-off command bar", () => {
    manager.transition(Mode.Insert);
    expect(manager.transition(Mode.Command)).toBe(true);
    expect(manager.current).toBe(Mode.Command);
  });

  it("transitions Command -> Insert, for the vim-off command bar", () => {
    manager.transition(Mode.Insert);
    manager.transition(Mode.Command);
    expect(manager.transition(Mode.Insert)).toBe(true);
    expect(manager.current).toBe(Mode.Insert);
  });

  // ── Invalid transitions ───────────────────────────────────────────────

  it("rejects Command -> Visual", () => {
    manager.transition(Mode.Command);
    expect(manager.transition(Mode.Visual)).toBe(false);
    expect(manager.current).toBe(Mode.Command);
  });

  it("rejects Insert -> Visual", () => {
    manager.transition(Mode.Insert);
    expect(manager.transition(Mode.Visual)).toBe(false);
    expect(manager.current).toBe(Mode.Insert);
  });

  it("rejects Visual -> Command", () => {
    manager.transition(Mode.Visual);
    expect(manager.transition(Mode.Command)).toBe(false);
    expect(manager.current).toBe(Mode.Visual);
  });

  it("rejects Visual -> Insert", () => {
    manager.transition(Mode.Visual);
    expect(manager.transition(Mode.Insert)).toBe(false);
    expect(manager.current).toBe(Mode.Visual);
  });

  // ── Same-mode no-op ───────────────────────────────────────────────────

  it("treats transition to the current mode as a successful no-op", () => {
    expect(manager.transition(Mode.Normal)).toBe(true);
    expect(manager.current).toBe(Mode.Normal);
  });

  // ── Event emission ────────────────────────────────────────────────────

  it("emits mode change event on valid transition", () => {
    const listener = vi.fn();
    manager.on(listener);
    manager.transition(Mode.Insert);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(Mode.Normal, Mode.Insert);
  });

  it("does not emit event on failed transition", () => {
    manager.transition(Mode.Command);
    const listener = vi.fn();
    manager.on(listener);
    manager.transition(Mode.Visual); // invalid
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not emit event on same-mode no-op", () => {
    const listener = vi.fn();
    manager.on(listener);
    manager.transition(Mode.Normal);
    expect(listener).not.toHaveBeenCalled();
  });

  it("notifies multiple listeners", () => {
    const a = vi.fn();
    const b = vi.fn();
    manager.on(a);
    manager.on(b);
    manager.transition(Mode.Insert);
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it("off() removes a listener", () => {
    const listener = vi.fn();
    manager.on(listener);
    manager.off(listener);
    manager.transition(Mode.Insert);
    expect(listener).not.toHaveBeenCalled();
  });

  it("on() returns an unsubscribe function", () => {
    const listener = vi.fn();
    const unsubscribe = manager.on(listener);
    unsubscribe();
    manager.transition(Mode.Insert);
    expect(listener).not.toHaveBeenCalled();
  });

  // ── reset() ───────────────────────────────────────────────────────────

  it("reset() forces mode without guard checks", () => {
    manager.transition(Mode.Command);
    manager.reset(Mode.Visual); // Command -> Visual is normally invalid
    expect(manager.current).toBe(Mode.Visual);
  });

  it("reset() emits an event", () => {
    const listener = vi.fn();
    manager.on(listener);
    manager.reset(Mode.Insert);
    expect(listener).toHaveBeenCalledWith(Mode.Normal, Mode.Insert);
  });

  it("reset() with no argument defaults to Normal", () => {
    manager.transition(Mode.Insert);
    manager.reset();
    expect(manager.current).toBe(Mode.Normal);
  });
});
