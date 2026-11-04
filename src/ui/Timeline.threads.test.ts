import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Timeline, type MessageData } from "./Timeline.js";

// The reply count on a thread root. It used to be patched into the DOM alone,
// so a windowed re-render — which rebuilds rows from `MessageData` (the #55
// class of bug) — put the count back to what the room loaded with, and a reply
// counted from two directions (our own send returning, its sync echo) went up
// by two.

const ROOT: MessageData = {
  id: "$root",
  senderId: "@alice:x",
  senderName: "Alice",
  timestamp: "2024-01-01T12:00:00Z",
  body: "the root",
};

describe("Timeline thread reply counts", () => {
  let timeline: Timeline;
  const indicator = () =>
    timeline.getMessageElementById("$root")?.querySelector(".message__thread-indicator")?.textContent ?? null;

  beforeEach(() => {
    timeline = new Timeline();
    document.body.appendChild(timeline.getElement());
  });

  afterEach(() => timeline.getElement().remove());

  it("counts each reply once, however many times it is reported", () => {
    timeline.setMessages([{ ...ROOT, isThreadRoot: true, threadReplyCount: 2 }]);
    timeline.countThreadReply("$root", "$r3");
    timeline.countThreadReply("$root", "$r3");
    expect(indicator()).toBe("⌥ 3 replies");
  });

  it("gives a message its first reply's indicator", () => {
    timeline.setMessages([ROOT]);
    expect(indicator()).toBeNull();
    timeline.countThreadReply("$root", "$r1");
    expect(indicator()).toBe("⌥ 1 reply");
  });

  it("keeps the count when the row is rebuilt from its data", () => {
    timeline.setMessages([ROOT]);
    timeline.countThreadReply("$root", "$r1");
    timeline.selectLast();
    const stored = timeline.selectedMessage!;
    expect(stored.threadReplyCount).toBe(1);
    timeline.setMessages([stored]);
    expect(indicator()).toBe("⌥ 1 reply");
  });

  it("takes a thread's loaded replies as its count, and counts none of them again", () => {
    timeline.setMessages([{ ...ROOT, isThreadRoot: true, threadReplyCount: 7 }]);
    timeline.setThreadReplies("$root", ["$a", "$b", "$c"]);
    expect(indicator()).toBe("⌥ 3 replies");
    timeline.countThreadReply("$root", "$b");
    expect(indicator()).toBe("⌥ 3 replies");
  });

  // A re-render's counts include the replies already in the room's buffer.
  // Clearing the "already counted" record with it let one of those, reported
  // again afterwards (our send returning after its echo), count a second time.
  it("counts none of the replies a re-rendered count already includes", () => {
    timeline.setMessages([{ ...ROOT, isThreadRoot: true, threadReplyCount: 12, threadReplyIds: ["$echoed"] }]);
    timeline.countThreadReply("$root", "$echoed");
    expect(indicator()).toBe("⌥ 12 replies");
  });

  it("keeps a reply counted while its thread was loading", () => {
    timeline.setMessages([{ ...ROOT, isThreadRoot: true, threadReplyCount: 2 }]);
    timeline.countThreadReply("$root", "$live");
    timeline.setThreadReplies("$root", ["$a", "$b"]);
    expect(indicator()).toBe("⌥ 3 replies");
  });

  it("takes a redacted reply back off the count, once", () => {
    timeline.setMessages([{ ...ROOT, isThreadRoot: true, threadReplyCount: 2, threadReplyIds: ["$a", "$b"] }]);
    timeline.uncountThreadReply("$a");
    timeline.uncountThreadReply("$a");
    expect(indicator()).toBe("⌥ 1 reply");
  });

  it("leaves the count alone for a redacted reply it does not include", () => {
    timeline.setMessages([{ ...ROOT, isThreadRoot: true, threadReplyCount: 2 }]);
    timeline.uncountThreadReply("$unknown");
    expect(indicator()).toBe("⌥ 2 replies");
  });

  it("does not make a thread root of a message whose thread has no replies", () => {
    timeline.setMessages([ROOT]);
    timeline.setThreadReplies("$root", []);
    expect(indicator()).toBeNull();
  });
});
