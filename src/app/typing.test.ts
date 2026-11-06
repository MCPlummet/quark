import { describe, it, expect, beforeEach, vi } from "vitest";
import { AppState } from "./state.js";
import { modeManager, Mode } from "../vim/mode.js";
import {
  typingLabel,
  recordTyping,
  clearTypingState,
  renderTypingIndicator,
  TypingNotifier,
  setupTypingNotices,
} from "./typing.js";

// Typing notices, both ways.
//
// Sending: Quark never sent `m.typing` at all, so two Quark clients in a DM
// never saw each other's dots — the dots that did appear in group chats came
// from other clients.
//
// Receiving had two holes of its own. The server lists *everyone* typing,
// the reader included, so once Quark sends, a client that shows the list
// verbatim shows "you are typing" to yourself. And the server only pushes the
// list when it changes, while the handler dropped every update for a room
// that was not open — so opening a room mid-typing showed nothing until the
// other person stopped and started again.

const names: Record<string, string> = {
  "@alice:x": "Alice",
  "@bob:x": "Bob",
  "@carol:x": "Carol",
  "@dave:x": "Dave",
};
const nameOf = (id: string): string => names[id] ?? id;

describe("typingLabel", () => {
  it("leaves the reader out of the list", () => {
    expect(typingLabel(["@me:x"], "@me:x", nameOf)).toBeNull();
    expect(typingLabel(["@me:x", "@alice:x"], "@me:x", nameOf)).toBe("Alice is typing…");
  });

  it("is null when nobody is typing", () => {
    expect(typingLabel([], "@me:x", nameOf)).toBeNull();
  });

  it("names people by display name", () => {
    expect(typingLabel(["@alice:x"], null, nameOf)).toBe("Alice is typing…");
    expect(typingLabel(["@zed:x"], null, nameOf)).toBe("@zed:x is typing…");
  });

  it("joins two or three names with 'and'", () => {
    expect(typingLabel(["@alice:x", "@bob:x"], null, nameOf)).toBe("Alice and Bob are typing…");
    expect(typingLabel(["@alice:x", "@bob:x", "@carol:x"], null, nameOf)).toBe(
      "Alice, Bob and Carol are typing…",
    );
  });

  it("counts the rest past three", () => {
    expect(typingLabel(["@alice:x", "@bob:x", "@carol:x", "@dave:x"], null, nameOf)).toBe(
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

describe("renderTypingIndicator", () => {
  beforeEach(() => {
    clearTypingState();
    AppState.patch({ currentRoomId: null, ownUserId: "@me:x" });
  });

  it("shows typing that arrived while another room was open", () => {
    AppState.set("currentRoomId", "!other:x");
    recordTyping("!dm:x", ["@alice:x"]);

    const { el, text } = buildIndicator();
    AppState.set("currentRoomId", "!dm:x");
    renderTypingIndicator(el, nameOf);

    expect(el.classList.contains("typing-indicator--active")).toBe(true);
    expect(text.textContent).toBe("Alice is typing…");
  });

  it("hides once the room's list empties", () => {
    AppState.set("currentRoomId", "!dm:x");
    recordTyping("!dm:x", ["@alice:x"]);
    const { el, text } = buildIndicator();
    renderTypingIndicator(el, nameOf);

    recordTyping("!dm:x", []);
    renderTypingIndicator(el, nameOf);

    expect(el.classList.contains("typing-indicator--active")).toBe(false);
    expect(text.textContent).toBe("");
  });

  it("stays hidden when only the reader is typing", () => {
    AppState.set("currentRoomId", "!dm:x");
    recordTyping("!dm:x", ["@me:x"]);
    const { el } = buildIndicator();
    renderTypingIndicator(el, nameOf);
    expect(el.classList.contains("typing-indicator--active")).toBe(false);
  });

  it("does not show one room's typing in another", () => {
    recordTyping("!dm:x", ["@alice:x"]);
    AppState.set("currentRoomId", "!other:x");
    const { el } = buildIndicator();
    renderTypingIndicator(el, nameOf);
    expect(el.classList.contains("typing-indicator--active")).toBe(false);
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

describe("TypingNotifier", () => {
  it("announces typing when text is entered", async () => {
    const send = vi.fn(async () => {});
    const n = new TypingNotifier(send);
    n.input("!dm:x", "h");
    await n.idle();
    expect(sent(send)).toEqual([["!dm:x", true]]);
  });

  it("stops when the box is emptied", async () => {
    const send = vi.fn(async () => {});
    const n = new TypingNotifier(send);
    n.input("!dm:x", "h");
    await n.idle();
    n.input("!dm:x", "");
    await n.idle();
    expect(sent(send)).toEqual([["!dm:x", true], ["!dm:x", false]]);
  });

  it("does not announce whitespace alone", async () => {
    const send = vi.fn(async () => {});
    const n = new TypingNotifier(send);
    n.input("!dm:x", "  \n");
    await n.idle();
    expect(send).not.toHaveBeenCalled();
  });

  it("stop() is a no-op when nothing was announced", async () => {
    const send = vi.fn(async () => {});
    const n = new TypingNotifier(send);
    n.stop();
    await n.idle();
    expect(send).not.toHaveBeenCalled();
  });

  it("stop() withdraws the announced room", async () => {
    const send = vi.fn(async () => {});
    const n = new TypingNotifier(send);
    n.input("!dm:x", "hi");
    n.stop();
    n.stop();
    await n.idle();
    expect(sent(send)).toEqual([["!dm:x", true], ["!dm:x", false]]);
  });

  it("withdraws the old room when typing moves to another", async () => {
    const send = vi.fn(async () => {});
    const n = new TypingNotifier(send);
    n.input("!a:x", "hi");
    await n.idle();
    n.input("!b:x", "yo");
    await n.idle();
    expect(sent(send)).toEqual([["!a:x", true], ["!a:x", false], ["!b:x", true]]);
  });

  it("sends one request at a time, in order", async () => {
    const { send, calls } = deferredSender();
    const n = new TypingNotifier(send);
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

  it("collapses keystrokes made while a request is in flight", async () => {
    const { send, calls } = deferredSender();
    const n = new TypingNotifier(send);
    n.input("!dm:x", "h");
    n.input("!dm:x", "he");
    n.input("!dm:x", "hel");
    n.input("!dm:x", "hell");
    calls[0].settle(true);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    calls[1].settle(true);
    await n.idle();
    expect(calls.map((c) => [c.roomId, c.typing])).toEqual([["!dm:x", true], ["!dm:x", true]]);
  });

  it("keeps a pending stop for one room when another room starts", async () => {
    const { send, calls } = deferredSender();
    const n = new TypingNotifier(send);
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
    const n = new TypingNotifier(send);
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
    teardown?.();
    modeManager.reset(Mode.Normal);
    AppState.patch({ currentRoomId: "!dm:x" });
    send = vi.fn(async () => {});
    n = new TypingNotifier(send);
    teardown = setupTypingNotices({ onInput: (h) => (fire = h) }, n);
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
});
