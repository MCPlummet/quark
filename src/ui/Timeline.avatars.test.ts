import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Timeline, type MessageData } from "./Timeline.js";

// Regression cover for #55 — "Profile pictures disappear when loading older
// messages".
//
// Avatars arrive asynchronously: a group first renders with the initial-letter
// fallback and `updateSenderAvatar` swaps in the image once the download lands.
// That swap used to patch only the DOM, while every windowed re-render rebuilds
// groups from the `MessageData` buffer via `buildMessageGroup`. The buffer still
// said "no avatar", so the picture reverted to a letter. The re-render that bites
// is `_cullWindow`, debounced ~120ms after a scroll settles and scheduled by
// `prependMessages` itself — i.e. it fires exactly when the user pages back
// through history, which is what the report describes.

function makeMsg(over: Partial<MessageData> = {}): MessageData {
  return {
    id: "e1",
    senderId: "@alice:x",
    senderName: "Alice",
    timestamp: "2024-01-01T12:00:00Z",
    body: "hello",
    ...over,
  };
}

/** A buffer large enough that a prepend pushes the render window over
 *  MAX_RENDERED (250) and a real cull is required. Senders alternate so
 *  consecutive-message grouping can't collapse them into one group. */
function manyMsgs(n: number): MessageData[] {
  return Array.from({ length: n }, (_, i) =>
    makeMsg({
      id: `e${i}`,
      senderId: i % 2 === 0 ? "@alice:x" : "@bob:x",
      senderName: i % 2 === 0 ? "Alice" : "Bob",
      timestamp: new Date(Date.UTC(2024, 0, 2, 12, 0, i)).toISOString(),
    }),
  );
}

const AVATAR = "data:image/png;base64,iVBORw0KGgo=";

function avatarSrcs(t: Timeline): string[] {
  return [...t.getElement().querySelectorAll<HTMLImageElement>("img.message-group__avatar")]
    .map((i) => i.getAttribute("src") ?? "");
}
function fallbackCount(t: Timeline): number {
  return t.getElement().querySelectorAll(".message-group__avatar-fallback").length;
}

describe("Timeline sender avatars (#55)", () => {
  let timeline: Timeline;

  beforeEach(() => {
    timeline = new Timeline();
    document.body.appendChild(timeline.getElement());
  });

  afterEach(() => {
    timeline.getElement().remove();
    vi.useRealTimers();
  });

  it("swaps the fallback initial for the downloaded avatar", () => {
    timeline.setMessages([makeMsg()]);
    expect(fallbackCount(timeline)).toBe(1);

    timeline.updateSenderAvatar("@alice:x", AVATAR);

    expect(fallbackCount(timeline)).toBe(0);
    expect(avatarSrcs(timeline)).toEqual([AVATAR]);
  });

  it("keeps avatars through the cull that a history prepend schedules", () => {
    vi.useFakeTimers();
    timeline.setMessages(manyMsgs(400));
    timeline.updateSenderAvatar("@alice:x", AVATAR);
    const before = avatarSrcs(timeline).length;
    expect(before).toBeGreaterThan(0);

    // Paging back one page pushes the window over MAX_RENDERED and arms the
    // debounced cull, which re-renders the whole window from the buffer.
    timeline.prependMessages([
      makeMsg({ id: "older", timestamp: "2024-01-01T11:00:00Z" }),
    ]);
    vi.advanceTimersByTime(200);

    // Before the fix every one of these was back to an initial letter.
    const after = avatarSrcs(timeline);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((src) => src === AVATAR)).toBe(true);
    // Bob never had an avatar downloaded, so his groups legitimately keep the
    // fallback — the fix must not paint Alice's picture onto everyone.
    expect(fallbackCount(timeline)).toBeGreaterThan(0);
  });

  it("only writes the avatar back onto that sender's messages", () => {
    timeline.setMessages(manyMsgs(10));
    timeline.updateSenderAvatar("@alice:x", AVATAR);

    const groups = [...timeline.getElement().querySelectorAll<HTMLElement>(".message-group-wrapper")];
    for (const g of groups) {
      const isAlice = g.dataset.sender === "@alice:x";
      const hasImg = !!g.querySelector("img.message-group__avatar");
      expect(hasImg).toBe(isAlice);
    }
  });

  it("keeps the avatar on older messages prepended after the download", () => {
    vi.useFakeTimers();
    timeline.setMessages([makeMsg({ id: "new" })]);
    timeline.updateSenderAvatar("@alice:x", AVATAR);

    // A page of history for the same sender arrives with no avatar resolved;
    // the app layer re-runs ensureSenderAvatarDownloaded, which is already
    // cached and calls straight back into updateSenderAvatar.
    timeline.prependMessages([makeMsg({ id: "old", timestamp: "2024-01-01T11:00:00Z" })]);
    timeline.updateSenderAvatar("@alice:x", AVATAR);
    vi.advanceTimersByTime(200);

    expect(fallbackCount(timeline)).toBe(0);
    expect(avatarSrcs(timeline).every((src) => src === AVATAR)).toBe(true);
  });

  it("matches on senderName when a message carries no senderId", () => {
    // buildMessageGroup writes `data-sender = senderId ?? senderName`, so the
    // buffer write-back has to use the same fallback chain.
    timeline.setMessages([makeMsg({ senderId: undefined })]);
    timeline.updateSenderAvatar("Alice", AVATAR);

    expect(fallbackCount(timeline)).toBe(0);
    expect(avatarSrcs(timeline)).toEqual([AVATAR]);
  });
});
