import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AppState } from "./state.js";
import { modeManager, Mode } from "../vim/mode.js";
import type { RoomInfo } from "../ipc/types.js";
import {
  typingLabel,
  recordTyping,
  clearTypingState,
  renderTypingIndicator,
  refreshTypingIndicator,
  setupTypingIndicator,
  TypingNotifier,
  setupTypingNotices,
  RESEND_MS,
  LIFETIME_MS,
} from "./typing.js";

// Typing notices, both ways.
//
// Sending: Quark never sent `m.typing` at all, so two Quark clients in a DM
// never saw each other's dots — the dots that did appear in group chats came
// from other clients.
//
// Receiving had holes of its own. The server only pushes a room's list when it
// changes, while the handler dropped every update for a room that was not open
// — so opening a room mid-typing showed nothing until the other person stopped
// and started again. (The server also lists the reader; the backend drops them,
// see `others_typing` in src-tauri/src/events.rs.)

const names: Record<string, string> = {
  "@alice:x": "Alice",
  "@bob:x": "Bob",
  "@carol:x": "Carol",
  "@dave:x": "Dave",
};
const nameOf = (id: string): string => names[id] ?? id;

describe("typingLabel", () => {
  it("is null when nobody is typing", () => {
    expect(typingLabel([], nameOf)).toBeNull();
  });

  it("names people by display name", () => {
    expect(typingLabel(["@alice:x"], nameOf)).toBe("Alice is typing…");
    expect(typingLabel(["@zed:x"], nameOf)).toBe("@zed:x is typing…");
  });

  it("joins two or three names with 'and'", () => {
    expect(typingLabel(["@alice:x", "@bob:x"], nameOf)).toBe("Alice and Bob are typing…");
    expect(typingLabel(["@alice:x", "@bob:x", "@carol:x"], nameOf)).toBe(
      "Alice, Bob and Carol are typing…",
    );
  });

  it("counts the rest past three", () => {
    expect(typingLabel(["@alice:x", "@bob:x", "@carol:x", "@dave:x"], nameOf)).toBe(
      "Alice, Bob and 2 others are typing…",
    );
  });
});

/** The markup App.ts builds for the indicator. */
function buildIndicator(): { el: HTMLElement; text: HTMLElement } {
  const el = document.createElement("div");
  el.className = "typing-indicator";
  const text = document.createElement("span");
  text.className = "typing-indicator__text";
  el.appendChild(text);
  return { el, text };
}

const active = (el: HTMLElement) => el.classList.contains("typing-indicator--active");
const room = (room_id: string) => ({ room_id }) as RoomInfo;

describe("renderTypingIndicator", () => {
  beforeEach(() => {
    clearTypingState();
    AppState.patch({ currentRoomId: null });
  });

  it("shows typing that arrived while another room was open", () => {
    AppState.set("currentRoomId", "!other:x");
    recordTyping("!dm:x", ["@alice:x"]);

    const { el, text } = buildIndicator();
    AppState.set("currentRoomId", "!dm:x");
    renderTypingIndicator(el, nameOf);

    expect(active(el)).toBe(true);
    expect(text.textContent).toBe("Alice is typing…");
  });

  it("hides once the room's list empties", () => {
    AppState.set("currentRoomId", "!dm:x");
    recordTyping("!dm:x", ["@alice:x"]);
    const { el, text } = buildIndicator();
    renderTypingIndicator(el, nameOf);

    recordTyping("!dm:x", []);
    renderTypingIndicator(el, nameOf);

    expect(active(el)).toBe(false);
    expect(text.textContent).toBe("");
  });

  it("does not show one room's typing in another", () => {
    recordTyping("!dm:x", ["@alice:x"]);
    AppState.set("currentRoomId", "!other:x");
    const { el } = buildIndicator();
    renderTypingIndicator(el, nameOf);
    expect(active(el)).toBe(false);
  });
});

describe("setupTypingIndicator", () => {
  let el: HTMLElement;
  let text: HTMLElement;
  let teardown: () => void;

  beforeEach(() => {
    clearTypingState();
    AppState.patch({ currentRoomId: null, roomListCache: [room("!dm:x"), room("!other:x")] });
    ({ el, text } = buildIndicator());
    teardown = setupTypingIndicator(el);
  });

  afterEach(() => {
    teardown();
    AppState.patch({ currentRoomId: null, roomListCache: [] });
  });

  it("paints the open room's list as it arrives", () => {
    AppState.set("currentRoomId", "!dm:x");
    recordTyping("!dm:x", ["@alice:x"]);
    expect(active(el)).toBe(true);
    expect(text.textContent).toBe("@alice:x is typing…"); // members not loaded
  });

  it("follows the open room", () => {
    recordTyping("!dm:x", ["@alice:x"]);
    expect(active(el)).toBe(false);
    AppState.set("currentRoomId", "!dm:x");
    expect(active(el)).toBe(true);
    AppState.set("currentRoomId", "!other:x");
    expect(active(el)).toBe(false);
  });

  it("clears when no room is open any more", () => {
    // An empty space, or :leave — the room goes, and its dots with it.
    AppState.set("currentRoomId", "!dm:x");
    recordTyping("!dm:x", ["@alice:x"]);
    AppState.set("currentRoomId", null);
    expect(active(el)).toBe(false);
    expect(text.textContent).toBe("");
  });

  it("forgets a room's list once the room leaves the room list", () => {
    // No more updates arrive for a room left, so its last list would show again
    // on rejoining, however long ago it was.
    recordTyping("!dm:x", ["@alice:x"]);
    AppState.set("roomListCache", [room("!other:x")]);
    AppState.set("roomListCache", [room("!other:x"), room("!dm:x")]);
    AppState.set("currentRoomId", "!dm:x");
    expect(active(el)).toBe(false);
  });

  it("clears the open room's dots when it leaves the room list", () => {
    AppState.set("currentRoomId", "!dm:x");
    recordTyping("!dm:x", ["@alice:x"]);
    AppState.set("roomListCache", [room("!other:x")]);
    expect(active(el)).toBe(false);
  });

  it("keeps a room's list from before the room first appears in the list", () => {
    // A fresh join, or startup: typing can arrive ahead of the room list.
    recordTyping("!new:x", ["@alice:x"]);
    AppState.set("roomListCache", [room("!dm:x")]);
    AppState.set("currentRoomId", "!new:x");
    expect(active(el)).toBe(true);
  });

  it("repaints on request once names are known", () => {
    AppState.set("currentRoomId", "!dm:x");
    recordTyping("!dm:x", ["@alice:x"]);
    renderTypingIndicator(el, nameOf);
    expect(text.textContent).toBe("Alice is typing…");
    refreshTypingIndicator(); // falls back to the (empty) member names
    expect(text.textContent).toBe("@alice:x is typing…");
  });

  it("stops painting once torn down", () => {
    teardown();
    AppState.set("currentRoomId", "!dm:x");
    recordTyping("!dm:x", ["@alice:x"]);
    expect(active(el)).toBe(false);
    teardown = () => {};
  });
});

/** A sender whose calls stay pending until the test settles them. */
function deferredSender() {
  const calls: Array<{ roomId: string; typing: boolean; settle: (ok: boolean) => void }> = [];
  const send = vi.fn(
    (roomId: string, typing: boolean) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ roomId, typing, settle: (ok) => (ok ? resolve() : reject(new Error("nope"))) });
      }),
  );
  return { send, calls };
}

const sent = (send: ReturnType<typeof vi.fn>) =>
  send.mock.calls.map(([roomId, typing]) => [roomId, typing]);

/** A clock the test moves by hand. */
function manualClock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

describe("TypingNotifier", () => {
  let clock: ReturnType<typeof manualClock>;
  beforeEach(() => {
    clock = manualClock();
  });

  it("announces typing when text is entered", async () => {
    const send = vi.fn(async () => {});
    const n = new TypingNotifier(send, clock.now);
    n.input("!dm:x", "h");
    await n.idle();
    expect(sent(send)).toEqual([["!dm:x", true]]);
  });

  it("does not repeat an announcement that is still live", async () => {
    const send = vi.fn(async () => {});
    const n = new TypingNotifier(send, clock.now);
    for (const text of ["h", "he", "hel", "hell", "hello"]) {
      n.input("!dm:x", text);
      clock.advance(200);
      await n.idle();
    }
    expect(sent(send)).toEqual([["!dm:x", true]]);
  });

  it("renews the announcement before it lapses", async () => {
    // Each lasts LIFETIME_MS on the server; renewing every RESEND_MS keeps a
    // steady typist announced without a gap.
    expect(RESEND_MS).toBeLessThan(LIFETIME_MS);
    const send = vi.fn(async () => {});
    const n = new TypingNotifier(send, clock.now);
    n.input("!dm:x", "h");
    clock.advance(RESEND_MS - 1);
    n.input("!dm:x", "he");
    clock.advance(1);
    n.input("!dm:x", "hel");
    await n.idle();
    expect(sent(send)).toEqual([["!dm:x", true], ["!dm:x", true]]);
  });

  it("stops when the box is emptied", async () => {
    const send = vi.fn(async () => {});
    const n = new TypingNotifier(send, clock.now);
    n.input("!dm:x", "h");
    await n.idle();
    n.input("!dm:x", "");
    await n.idle();
    expect(sent(send)).toEqual([["!dm:x", true], ["!dm:x", false]]);
  });

  it("announces again at once after a stop", async () => {
    const send = vi.fn(async () => {});
    const n = new TypingNotifier(send, clock.now);
    n.input("!dm:x", "h");
    n.stop();
    await n.idle();
    clock.advance(100);
    n.input("!dm:x", "n");
    await n.idle();
    expect(sent(send)).toEqual([["!dm:x", true], ["!dm:x", false], ["!dm:x", true]]);
  });

  it("does not announce whitespace alone", async () => {
    const send = vi.fn(async () => {});
    const n = new TypingNotifier(send, clock.now);
    n.input("!dm:x", "  \n");
    await n.idle();
    expect(send).not.toHaveBeenCalled();
  });

  it("stop() is a no-op when nothing was announced", async () => {
    const send = vi.fn(async () => {});
    const n = new TypingNotifier(send, clock.now);
    n.stop();
    await n.idle();
    expect(send).not.toHaveBeenCalled();
  });

  it("stop() withdraws the announced room", async () => {
    const send = vi.fn(async () => {});
    const n = new TypingNotifier(send, clock.now);
    n.input("!dm:x", "hi");
    n.stop();
    n.stop();
    await n.idle();
    expect(sent(send)).toEqual([["!dm:x", true], ["!dm:x", false]]);
  });

  it("does not withdraw an announcement that has already lapsed", async () => {
    const send = vi.fn(async () => {});
    const n = new TypingNotifier(send, clock.now);
    n.input("!dm:x", "hi");
    clock.advance(LIFETIME_MS);
    n.stop();
    await n.idle();
    expect(sent(send)).toEqual([["!dm:x", true]]);
  });

  it("withdraws the old room when typing moves to another", async () => {
    const send = vi.fn(async () => {});
    const n = new TypingNotifier(send, clock.now);
    n.input("!a:x", "hi");
    await n.idle();
    n.input("!b:x", "yo");
    await n.idle();
    expect(sent(send)).toEqual([["!a:x", true], ["!a:x", false], ["!b:x", true]]);
  });

  it("sends one request at a time, in order", async () => {
    const { send, calls } = deferredSender();
    const n = new TypingNotifier(send, clock.now);
    n.input("!dm:x", "h");
    n.stop();
    // The stop must not race ahead of the start it withdraws: if it reached
    // the server first, the start would leave the user "typing" after sending.
    expect(calls.map((c) => [c.roomId, c.typing])).toEqual([["!dm:x", true]]);
    calls[0].settle(true);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect([calls[1].roomId, calls[1].typing]).toEqual(["!dm:x", false]);
    calls[1].settle(true);
    await n.idle();
  });

  it("collapses changes made while a request is in flight", async () => {
    const { send, calls } = deferredSender();
    const n = new TypingNotifier(send, clock.now);
    n.input("!dm:x", "h");
    n.stop();
    n.input("!dm:x", "h");
    n.stop();
    n.input("!dm:x", "hi");
    calls[0].settle(true);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    calls[1].settle(true);
    await n.idle();
    // Only the latest wanted state follows the request in flight.
    expect(calls.map((c) => [c.roomId, c.typing])).toEqual([["!dm:x", true], ["!dm:x", true]]);
  });

  it("keeps a pending stop for one room when another room starts", async () => {
    const { send, calls } = deferredSender();
    const n = new TypingNotifier(send, clock.now);
    n.input("!a:x", "hi");
    n.input("!b:x", "yo"); // queues stop(!a) then start(!b) behind the start of !a
    calls[0].settle(true);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    calls[1].settle(true);
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    calls[2].settle(true);
    await n.idle();
    expect(calls.map((c) => [c.roomId, c.typing])).toEqual([
      ["!a:x", true],
      ["!a:x", false],
      ["!b:x", true],
    ]);
  });

  it("keeps going after a failed request", async () => {
    const { send, calls } = deferredSender();
    const n = new TypingNotifier(send, clock.now);
    n.input("!dm:x", "h");
    n.stop();
    calls[0].settle(false);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    calls[1].settle(true);
    await n.idle();
    expect(calls[1].typing).toBe(false);
  });
});

describe("setupTypingNotices", () => {
  let fire: (value: string) => void;
  let send: ReturnType<typeof vi.fn>;
  let n: TypingNotifier;
  let teardown: () => void;

  beforeEach(() => {
    modeManager.reset(Mode.Normal);
    AppState.patch({ currentRoomId: "!dm:x", editingEventId: null, sendTypingNotices: true });
    send = vi.fn(async () => {});
    n = new TypingNotifier(send);
    teardown = setupTypingNotices({ onInput: (h) => (fire = h) }, n);
  });

  afterEach(() => {
    teardown();
    modeManager.reset(Mode.Normal);
    AppState.patch({ currentRoomId: null, editingEventId: null, sendTypingNotices: true });
  });

  it("announces only what is typed in Insert mode", async () => {
    modeManager.reset(Mode.Command);
    fire("set");
    await n.idle();
    expect(send).not.toHaveBeenCalled();

    modeManager.reset(Mode.Insert);
    fire("hi");
    await n.idle();
    expect(sent(send)).toEqual([["!dm:x", true]]);
  });

  it("stops on leaving Insert mode", async () => {
    modeManager.reset(Mode.Insert);
    fire("hi");
    modeManager.transition(Mode.Normal);
    await n.idle();
    expect(sent(send)).toEqual([["!dm:x", true], ["!dm:x", false]]);
  });

  it("stops in the room being left", async () => {
    modeManager.reset(Mode.Insert);
    fire("hi");
    AppState.set("currentRoomId", "!other:x");
    await n.idle();
    expect(sent(send)).toEqual([["!dm:x", true], ["!dm:x", false]]);
  });

  it("does nothing with no room open", async () => {
    AppState.set("currentRoomId", null);
    modeManager.reset(Mode.Insert);
    fire("hi");
    await n.idle();
    expect(send).not.toHaveBeenCalled();
  });

  it("does not announce while editing a sent message", async () => {
    // An edit replaces a message already sent; no new one is on its way.
    AppState.set("editingEventId", "$old:x");
    modeManager.reset(Mode.Insert);
    fire("fixed typo");
    await n.idle();
    expect(send).not.toHaveBeenCalled();
  });

  it("withdraws the announcement when an edit starts", async () => {
    modeManager.reset(Mode.Insert);
    fire("hi");
    AppState.set("editingEventId", "$old:x");
    await n.idle();
    expect(sent(send)).toEqual([["!dm:x", true], ["!dm:x", false]]);
  });

  it("announces nothing once opted out", async () => {
    AppState.set("sendTypingNotices", false);
    modeManager.reset(Mode.Insert);
    fire("hi");
    await n.idle();
    expect(send).not.toHaveBeenCalled();
  });

  it("withdraws the announcement on opting out mid-sentence", async () => {
    modeManager.reset(Mode.Insert);
    fire("hi");
    AppState.set("sendTypingNotices", false);
    await n.idle();
    expect(sent(send)).toEqual([["!dm:x", true], ["!dm:x", false]]);
  });
});
