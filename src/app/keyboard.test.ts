import { describe, it, expect, beforeEach, vi } from "vitest";
import { dispatchAction } from "./keyboard.js";
import { confirmAndLeaveRoom } from "./actions.js";
import type { AppComponents } from "../ui/App.js";

// dispatchAction routes resolved action names to handlers. Two invariants from
// #22: an unknown action must be dropped (the old default case re-dispatched
// the same quark:action event, and since the quark:action listener feeds back
// into dispatchAction, any unhandled name recursed without bound and hung the
// app), and "leave-room-confirm" (Room Info's [leave room] button) must be
// wired to the confirm-and-leave flow rather than falling through to default.

vi.mock("./actions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./actions.js")>();
  return { ...actual, confirmAndLeaveRoom: vi.fn() };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("dispatchAction", () => {
  it("drops unknown actions instead of re-dispatching quark:action (#22)", () => {
    const spy = vi.spyOn(document, "dispatchEvent");
    dispatchAction("no-such-action", {} as AppComponents);
    const requeued = spy.mock.calls.some(([e]) => (e as Event).type === "quark:action");
    expect(requeued).toBe(false);
    spy.mockRestore();
  });

  it("routes leave-room-confirm to the confirm-and-leave flow (#22)", () => {
    dispatchAction("leave-room-confirm", {} as AppComponents);
    expect(confirmAndLeaveRoom).toHaveBeenCalledOnce();
  });
});
