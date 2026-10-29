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

  it("does not make a thread root of a message whose thread has no replies", () => {
    timeline.setMessages([ROOT]);
    timeline.setThreadReplies("$root", []);
    expect(indicator()).toBeNull();
  });
});
