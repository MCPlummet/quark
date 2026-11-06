import { describe, it, expect, beforeEach, vi } from "vitest";
import { dispatchAction, resolveModeRoute, escapeRunsPanelClose } from "./keyboard.js";
import { Mode } from "../vim/mode.js";
import { confirmAndLeaveRoom, redactMessage, startEdit } from "./actions.js";
import { AppState } from "./state.js";
import type { AppComponents } from "../ui/App.js";

// dispatchAction routes resolved action names to handlers. Two invariants from
// #22: an unknown action must be dropped (the old default case re-dispatched
// the same quark:action event, and since the quark:action listener feeds back
// into dispatchAction, any unhandled name recursed without bound and hung the
// app), and "leave-room-confirm" (Room Info's [leave room] button) must be
// wired to the confirm-and-leave flow rather than falling through to default.

vi.mock("./actions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./actions.js")>();
  return { ...actual, confirmAndLeaveRoom: vi.fn(), redactMessage: vi.fn(), startEdit: vi.fn() };
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

describe("resolveModeRoute", () => {
  it("gives Insert mode to the compose handler", () => {
    expect(resolveModeRoute(Mode.Insert, true)).toBe("insert");
    expect(resolveModeRoute(Mode.Insert, false)).toBe("insert");
  });

  it("routes Normal and Visual to the vim keymap when vim mode is on", () => {
    expect(resolveModeRoute(Mode.Normal, true)).toBe("vim");
    expect(resolveModeRoute(Mode.Visual, true)).toBe("vim");
  });

  it("falls back to the compose handler for Normal/Visual with vim off", () => {
    expect(resolveModeRoute(Mode.Normal, false)).toBe("insert");
    expect(resolveModeRoute(Mode.Visual, false)).toBe("insert");
  });

  // The regression this function exists to pin (#98): the vim-off fallback used
  // to be tested first, so with vim disabled every keystroke meant for the
  // command bar was typed into the compose box. Harmless while the bar needed
  // vim to open at all — but the palette opens it to finish a command that
  // takes arguments, and on mobile vim is always off.
  it("gives the command bar its keys regardless of vim mode", () => {
    expect(resolveModeRoute(Mode.Command, true)).toBe("command");
    expect(resolveModeRoute(Mode.Command, false)).toBe("command");
  });
});

describe("dispatchAction — command palette", () => {
  it("opens the palette", () => {
    const show = vi.fn();
    dispatchAction("open-command-palette", { commandPalette: { show } } as unknown as AppComponents);
    expect(show).toHaveBeenCalledOnce();
  });
});

describe("dispatchAction — chord-bound actions", () => {
  it("wraps the compose selection for each formatting action", () => {
    const wrapSelection = vi.fn();
    const components = { input: { wrapSelection } } as unknown as AppComponents;
    for (const [action, marker] of [
      ["format-bold", "**"],
      ["format-italic", "*"],
      ["format-underline", "__"],
      ["format-strikethrough", "~~"],
    ] as const) {
      dispatchAction(action, components);
      expect(wrapSelection).toHaveBeenLastCalledWith(marker);
    }
  });
});

describe("escapeRunsPanelClose", () => {
  it("leaving Insert or Visual in a close-from-Normal panel only changes mode", () => {
    // The thread panel: opening a thread lands in Insert; if that first Esc
    // closed it, a vim user could never reach the thread's rows and a
    // reflexive Esc mid-reply would retarget the draft at the room (#131).
    expect(escapeRunsPanelClose(Mode.Insert, true, true)).toBe(false);
    expect(escapeRunsPanelClose(Mode.Visual, true, true)).toBe(false);
  });

  it("an Esc in Normal there still closes", () => {
    expect(escapeRunsPanelClose(Mode.Normal, true, true)).toBe(true);
  });

  it("leaves every other panel, and vim-off, closing on the first Esc", () => {
    expect(escapeRunsPanelClose(Mode.Insert, false, true)).toBe(true);
    expect(escapeRunsPanelClose(Mode.Insert, true, false)).toBe(true);
  });
});

// Message actions act on what the panels declare, not on panel names: the
// active panel's selection when it holds messages, else the timeline's, and
// only the actions that panel supports.
describe("dispatchAction — message actions", () => {
  const components = {} as AppComponents;
  const own = { id: "$mine", body: "mine", isOwn: true };

  beforeEach(() => {
    AppState.registerPanelNav("timeline", {
      navDown: vi.fn(), navUp: vi.fn(),
      selectedMessageId: () => "$mine",
      selectedMessage: () => own,
    });
    AppState.registerPanelNav("thread", { navDown: vi.fn(), navUp: vi.fn(), selectedMessageId: () => "$reply" });
    AppState.registerPanelNav("roomlist", { navDown: vi.fn(), navUp: vi.fn() });
  });

  it("act on the active panel's selection when it holds messages", () => {
    AppState.set("activePanel", "thread");
    dispatchAction("redact", components);
    expect(redactMessage).toHaveBeenCalledExactlyOnceWith("$reply");
  });

  it("act on the timeline's selection from a panel without messages", () => {
    AppState.set("activePanel", "roomlist");
    dispatchAction("redact", components);
    expect(redactMessage).toHaveBeenCalledExactlyOnceWith("$mine");
  });

  it("do nothing where the panel has nothing selected that can be acted on", () => {
    AppState.registerPanelNav("thread", { navDown: vi.fn(), navUp: vi.fn(), selectedMessageId: () => null });
    AppState.set("activePanel", "thread");
    dispatchAction("redact", components);
    expect(redactMessage).not.toHaveBeenCalled();
  });

  // The thread's messages aren't editable, and the room's own message sits
  // dimmed behind the open thread: editing it would close the thread.
  it("edit nothing in a panel that registers no selectedMessage", () => {
    AppState.set("activePanel", "thread");
    dispatchAction("edit", { input: { focus: vi.fn() } } as unknown as AppComponents);
    expect(startEdit).not.toHaveBeenCalled();
  });
});
