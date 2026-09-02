import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Timeline, type MessageData } from "./Timeline.js";

function makeMsg(overrides: Partial<MessageData> = {}): MessageData {
  return {
    id: "evt1",
    senderName: "Alice",
    timestamp: "2024-01-01T12:00:00Z",
    body: "Hello, world!",
    ...overrides,
  };
}

describe("Timeline", () => {
  let timeline: Timeline;

  beforeEach(() => {
    timeline = new Timeline();
    document.body.appendChild(timeline.getElement());
  });

  afterEach(() => {
    timeline.getElement().remove();
  });

  describe("setMessages", () => {
    it("renders messages with sender and body", () => {
      timeline.setMessages([
        makeMsg({ id: "e1", senderName: "Alice", body: "Hello" }),
        makeMsg({ id: "e2", senderName: "Bob", body: "Hi there" }),
      ]);

      const el = timeline.getElement();
      const senders = el.querySelectorAll(".message__sender");
      const bodies = el.querySelectorAll(".message__body");

      expect(senders).toHaveLength(2);
      expect(senders[0].textContent).toBe("<Alice>");
      expect(senders[1].textContent).toBe("<Bob>");
      expect(bodies[0].textContent).toBe("Hello");
      expect(bodies[1].textContent).toBe("Hi there");
    });

    it("replaces existing messages when called again", () => {
      timeline.setMessages([makeMsg({ id: "e1", body: "First" })]);
      timeline.setMessages([makeMsg({ id: "e2", body: "Second" })]);

      const bodies = timeline.getElement().querySelectorAll(".message__body");
      expect(bodies).toHaveLength(1);
      expect(bodies[0].textContent).toBe("Second");
    });

    it("renders a timestamp on each message", () => {
      timeline.setMessages([makeMsg({ timestamp: "2024-06-15T12:34:00Z" })]);

      const ts = timeline.getElement().querySelector(".message__timestamp");
      // The timestamp is formatted as HH:MM in local time; just verify it's non-empty
      // and has the expected HH:MM shape (two digits, colon, two digits).
      expect(ts?.textContent).toMatch(/^\d{2}:\d{2}$/);
      // The title attribute holds the full localized datetime (non-empty).
      expect(ts?.getAttribute("title")).toBeTruthy();
    });

    it("shows the exact send time (HH:MM:SS) in the hover action bar", () => {
      timeline.setMessages([makeMsg({ timestamp: "2024-06-15T12:34:56Z" })]);

      const timeEl = timeline.getElement().querySelector(".message__actions-time");
      expect(timeEl?.textContent).toMatch(/^\d{2}:\d{2}:\d{2}$/);
      // Tooltip carries the full localized datetime.
      expect(timeEl?.getAttribute("title")).toBeTruthy();
    });

    it("adds own-sender class when isOwn is true", () => {
      timeline.setMessages([makeMsg({ isOwn: true })]);

      const sender = timeline.getElement().querySelector(".message__sender");
      expect(sender?.classList.contains("message__sender--own")).toBe(true);
    });
  });

  describe("appendMessage", () => {
    it("adds a message to the end", () => {
      timeline.setMessages([makeMsg({ id: "e1", body: "First" })]);
      timeline.appendMessage(makeMsg({ id: "e2", body: "Second" }));

      const bodies = timeline.getElement().querySelectorAll(".message__body");
      expect(bodies).toHaveLength(2);
      expect(bodies[1].textContent).toBe("Second");
    });

    it("does not remove existing messages", () => {
      timeline.setMessages([
        makeMsg({ id: "e1", body: "A" }),
        makeMsg({ id: "e2", body: "B" }),
      ]);
      timeline.appendMessage(makeMsg({ id: "e3", body: "C" }));

      const bodies = timeline.getElement().querySelectorAll(".message__body");
      expect(bodies).toHaveLength(3);
    });
  });

  describe("image messages", () => {
    it("renders an img tag for image type", () => {
      timeline.setMessages([
        makeMsg({
          type: "image",
          mediaUrl: "https://example.com/photo.jpg",
          mediaAlt: "A photo",
        }),
      ]);

      const img = timeline.getElement().querySelector<HTMLImageElement>(".message__image");
      expect(img).not.toBeNull();
      expect(img?.src).toBe("https://example.com/photo.jpg");
      expect(img?.alt).toBe("A photo");
    });

    it("renders an img tag for sticker type", () => {
      timeline.setMessages([
        makeMsg({
          type: "sticker",
          mediaUrl: "https://example.com/sticker.png",
          mediaAlt: "Cool sticker",
        }),
      ]);

      const img = timeline.getElement().querySelector<HTMLImageElement>(".message__sticker");
      expect(img).not.toBeNull();
      expect(img?.src).toBe("https://example.com/sticker.png");
    });

    it("does not render a text body for image messages", () => {
      timeline.setMessages([makeMsg({ type: "image", mediaUrl: "https://x.com/img.png" })]);

      const body = timeline.getElement().querySelector(".message__body");
      expect(body).toBeNull();
    });

    it("renders the caption beneath an image when present", () => {
      timeline.setMessages([
        makeMsg({ type: "image", mediaUrl: "https://x.com/img.png", caption: "a wild sunset" }),
      ]);

      const caption = timeline.getElement().querySelector(".message__image-caption");
      expect(caption).not.toBeNull();
      expect(caption?.textContent).toBe("a wild sunset");
    });
  });

  describe("confirmMessage", () => {
    it("promotes an optimistic message to its real event ID", () => {
      timeline.setMessages([]);
      timeline.appendMessage(makeMsg({ id: "optimistic-1", body: "hi" }));

      timeline.confirmMessage("optimistic-1", "$real:server");

      expect(timeline.getMessageElementById("$real:server")).not.toBeNull();
      expect(timeline.getMessageElementById("optimistic-1")).toBeNull();
    });

    it("drops the optimistic duplicate when the sync echo already rendered the event", () => {
      timeline.setMessages([]);
      // Optimistic local echo, still keyed by its temporary ID...
      timeline.appendMessage(makeMsg({ id: "optimistic-1", body: "hi" }));
      // ...then the homeserver sync echo wins the race and is appended under the
      // real event ID (the sync-path dedup checks all miss in this window).
      timeline.appendMessage(makeMsg({ id: "$real:server", body: "hi" }));

      timeline.confirmMessage("optimistic-1", "$real:server");

      // The duplicate is collapsed: exactly one node carries the real event ID.
      expect(
        timeline.getElement().querySelectorAll('[data-message-id="$real:server"]'),
      ).toHaveLength(1);
      expect(timeline.getMessageElementById("optimistic-1")).toBeNull();
      expect(timeline.getElement().querySelectorAll(".message__body")).toHaveLength(1);
    });
  });

  describe("reply messages", () => {
    it("shows reply preview when replyTo is set", () => {
      timeline.setMessages([
        makeMsg({
          replyTo: { eventId: "$evt-orig", senderName: "Charlie", body: "Original message" },
        }),
      ]);

      const reply = timeline.getElement().querySelector(".reply-preview");
      expect(reply).not.toBeNull();

      const replySender = reply?.querySelector(".reply-preview__sender");
      expect(replySender?.textContent).toBe("Charlie");

      const replyBody = reply?.querySelector(".reply-preview__body");
      expect(replyBody?.textContent).toBe("Original message");
    });

    it("does not render reply preview when replyTo is absent", () => {
      timeline.setMessages([makeMsg()]);

      const reply = timeline.getElement().querySelector(".reply-preview");
      expect(reply).toBeNull();
    });
  });

  describe("system messages", () => {
    it("adds system class for system type messages", () => {
      timeline.setMessages([makeMsg({ type: "system", body: "Alice joined the room" })]);

      const msg = timeline.getElement().querySelector(".message");
      expect(msg?.classList.contains("message--system")).toBe(true);
    });

    it("does not render a sender header for system messages", () => {
      timeline.setMessages([makeMsg({ type: "system", body: "System event" })]);

      const header = timeline.getElement().querySelector(".message__header");
      expect(header).toBeNull();
    });
  });

  describe("spoilers", () => {
    it("obscures data-mx-spoiler spans and reveals them on click", () => {
      timeline.setMessages([
        makeMsg({
          body: "secret",
          htmlBody: 'before <span data-mx-spoiler="plot">secret</span> after',
        }),
      ]);

      const spoiler = timeline.getElement().querySelector<HTMLElement>(".message__spoiler");
      expect(spoiler).not.toBeNull();
      expect(spoiler!.classList.contains("message__spoiler--revealed")).toBe(false);
      expect(spoiler!.getAttribute("role")).toBe("button");
      // Reason surfaces as a tooltip.
      expect(spoiler!.title).toContain("plot");

      spoiler!.click();
      expect(spoiler!.classList.contains("message__spoiler--revealed")).toBe(true);
      expect(spoiler!.hasAttribute("role")).toBe(false);
    });

    it("handles reasonless spoilers", () => {
      timeline.setMessages([
        makeMsg({ body: "x", htmlBody: "<span data-mx-spoiler>x</span>" }),
      ]);
      const spoiler = timeline.getElement().querySelector<HTMLElement>(".message__spoiler");
      expect(spoiler).not.toBeNull();
      expect(spoiler!.title).toBe("Spoiler — click to reveal");
    });
  });

  describe("reactions", () => {
    it("renders reaction bar when reactions are present", () => {
      timeline.setMessages([
        makeMsg({
          reactions: [{ key: "👍", count: 3, own: false }],
        }),
      ]);

      const bar = timeline.getElement().querySelector(".reaction-bar");
      expect(bar).not.toBeNull();
    });

    it("does not render reaction bar when no reactions", () => {
      timeline.setMessages([makeMsg()]);

      const bar = timeline.getElement().querySelector(".reaction-bar");
      expect(bar).toBeNull();
    });
  });

  describe("searchLoaded", () => {
    beforeEach(() => {
      timeline.setMessages([
        makeMsg({ id: "e1", senderName: "Alice", body: "Hello world", timestamp: "2024-01-01T12:00:00Z" }),
        makeMsg({ id: "e2", senderName: "Bob", body: "Goodbye WORLD", timestamp: "2024-01-01T12:05:00Z" }),
        makeMsg({ id: "e3", senderName: "Carol", body: "unrelated", timestamp: "2024-01-01T12:10:00Z" }),
        makeMsg({ id: "e4", senderName: "System", body: "Dave joined", type: "system", timestamp: "2024-01-01T12:15:00Z" }),
      ]);
    });

    it("matches case-insensitively across loaded messages", () => {
      const results = timeline.searchLoaded("world");
      expect(results.map((r) => r.eventId).sort()).toEqual(["e1", "e2"]);
    });

    it("returns normalized fields including a numeric timestamp", () => {
      const [hit] = timeline.searchLoaded("Hello");
      expect(hit.eventId).toBe("e1");
      expect(hit.sender).toBe("Alice");
      expect(hit.body).toBe("Hello world");
      expect(hit.timestamp).toBe(Date.parse("2024-01-01T12:00:00Z"));
    });

    it("skips system messages", () => {
      expect(timeline.searchLoaded("joined")).toHaveLength(0);
    });

    it("returns nothing for an empty or whitespace query", () => {
      expect(timeline.searchLoaded("")).toHaveLength(0);
      expect(timeline.searchLoaded("   ")).toHaveLength(0);
    });

    it("returns nothing when there are no matches", () => {
      expect(timeline.searchLoaded("zzz-nomatch")).toHaveLength(0);
    });
  });

  // #15 — selection navigation must report when it hits a boundary so the
  // keyboard layer can hand focus to the compose box (which sits just below
  // the bottom-most message).
  describe("selection navigation boundaries (#15)", () => {
    it("selectNext returns true while it moves and false at the last message", () => {
      timeline.setMessages([makeMsg({ id: "e1" }), makeMsg({ id: "e2" })]);
      expect(timeline.selectNext()).toBe(true); // nothing selected → lands on the last
      expect(timeline.selectedMessageId).toBe("e2");
      expect(timeline.selectNext()).toBe(false); // already at the bottom — boundary
    });

    it("selectPrev returns false at the first message", () => {
      timeline.setMessages([makeMsg({ id: "e1" }), makeMsg({ id: "e2" })]);
      timeline.selectFirst();
      expect(timeline.selectedMessageId).toBe("e1");
      expect(timeline.selectPrev()).toBe(false);
    });

    it("selectLast reports whether a message was selected", () => {
      timeline.setMessages([]);
      expect(timeline.selectLast()).toBe(false);
      timeline.setMessages([makeMsg({ id: "e1" })]);
      expect(timeline.selectLast()).toBe(true);
    });
  });

  // Sending implies reading: a user's receipt avatar must sit on their own
  // newest message even when the homeserver never sends a receipt alongside it.
  // The placement logic lives in _renderReceipts, so every path that puts new
  // message DOM on screen has to re-run it — otherwise the avatar sits above
  // messages the user demonstrably has seen.
  describe("read receipts", () => {
    const ts = (iso: string): number => Date.parse(iso);
    /** Event ID of the message carrying a receipt cluster, or null. */
    const receiptOn = (): string | null =>
      timeline.getElement().querySelector<HTMLElement>(".read-receipts")?.dataset.receiptEvent ??
      null;

    // Bob has read up to 12:00:30 and has not posted since, so his avatar sits
    // on Alice's 12:00 message.
    beforeEach(() => {
      timeline.setMessages([
        makeMsg({ id: "e1", senderId: "@alice:x", senderName: "Alice", timestamp: "2024-01-01T12:00:00Z" }),
        makeMsg({ id: "e2", senderId: "@alice:x", senderName: "Alice", timestamp: "2024-01-01T12:01:00Z" }),
      ]);
      timeline.setReadReceipts([
        { userId: "@bob:x", eventId: "e1", ts: ts("2024-01-01T12:00:30Z") },
      ]);
    });

    it("places a receipt on the newest message at or before its timestamp", () => {
      expect(receiptOn()).toBe("e1");
    });

    it("advances a receipt to the reader's own live-appended message", () => {
      timeline.appendMessage(
        makeMsg({ id: "e3", senderId: "@bob:x", senderName: "Bob", timestamp: "2024-01-01T12:02:00Z" }),
      );

      expect(receiptOn()).toBe("e3");
    });

    it("advances a receipt when the live message merges into the sender's group", () => {
      // Merging into the previous group is its own early-return path out of
      // appendMessage, so it needs its own re-decoration.
      timeline.appendMessage(
        makeMsg({ id: "e3", senderId: "@bob:x", senderName: "Bob", timestamp: "2024-01-01T12:02:00Z" }),
      );
      expect(receiptOn()).toBe("e3");

      timeline.appendMessage(
        makeMsg({ id: "e4", senderId: "@bob:x", senderName: "Bob", timestamp: "2024-01-01T12:02:10Z" }),
      );

      expect(receiptOn()).toBe("e4");
    });

    it("leaves a receipt alone when someone else posts", () => {
      timeline.appendMessage(
        makeMsg({ id: "e3", senderId: "@carol:x", senderName: "Carol", timestamp: "2024-01-01T12:02:00Z" }),
      );

      expect(receiptOn()).toBe("e1");
    });

    it("advances a receipt through forward pagination", () => {
      timeline.appendMessages([
        makeMsg({ id: "e3", senderId: "@bob:x", senderName: "Bob", timestamp: "2024-01-01T12:02:00Z" }),
      ]);

      expect(receiptOn()).toBe("e3");
    });

    it("decorates freshly prepended history", () => {
      timeline.setMessages([
        makeMsg({ id: "e9", senderId: "@dave:x", senderName: "Dave", timestamp: "2024-01-01T13:00:00Z" }),
      ]);
      timeline.setReadReceipts([
        { userId: "@bob:x", eventId: "e0", ts: ts("2024-01-01T11:00:30Z") },
      ]);
      expect(receiptOn()).toBeNull(); // receipted event is older than the window

      timeline.prependMessages([
        makeMsg({ id: "e0", senderId: "@alice:x", senderName: "Alice", timestamp: "2024-01-01T11:00:00Z" }),
      ]);

      expect(receiptOn()).toBe("e0");
    });
  });
});

// #40 — separator labels are relative to "now", so they must be built against a
// calendar day (not a 24h window) *and* refreshed when the day rolls over under
// a session that stays open. Own describe block: these mount their own timeline
// after the clock is faked, so the rollover timer is faked too.
describe("time separator day labels (#40)", () => {
  /** ISO timestamp for a local wall-clock time — keeps assertions TZ-independent. */
  const localIso = (y: number, mo: number, d: number, h: number, mi: number): string =>
    new Date(y, mo - 1, d, h, mi).toISOString();

  let tl: Timeline | null = null;

  /** Mount a timeline with the clock pinned to the given local wall-clock time. */
  function mountAt(y: number, mo: number, d: number, h: number, mi: number): Timeline {
    vi.setSystemTime(new Date(y, mo - 1, d, h, mi));
    tl = new Timeline();
    document.body.appendChild(tl.getElement());
    return tl;
  }

  /** Render two messages more than 30 minutes apart — the gap puts a time
   *  separator on the second one. */
  function showGap(t: Timeline, first: string, second: string): void {
    t.setMessages([makeMsg({ id: "e1", timestamp: first }), makeMsg({ id: "e2", timestamp: second })]);
  }

  const labels = (t: Timeline): string[] =>
    Array.from(t.getElement().querySelectorAll(".time-separator")).map((el) => el.textContent ?? "");

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    tl?.getElement().remove();
    tl = null;
    vi.useRealTimers();
  });

  it("labels an earlier gap on the same calendar day as Today", () => {
    const t = mountAt(2026, 7, 15, 11, 6);
    showGap(t, localIso(2026, 7, 15, 9, 0), localIso(2026, 7, 15, 10, 30));
    expect(labels(t)).toEqual(["Today at 10:30 AM"]);
  });

  it("labels last night as Yesterday even when less than 24h has passed", () => {
    const t = mountAt(2026, 7, 15, 11, 6);
    showGap(t, localIso(2026, 7, 14, 16, 0), localIso(2026, 7, 14, 17, 3));
    expect(labels(t)).toEqual(["Yesterday at 5:03 PM"]);
  });

  it("labels older days with the date, not Today/Yesterday", () => {
    const t = mountAt(2026, 7, 15, 11, 6);
    showGap(t, localIso(2026, 7, 13, 16, 0), localIso(2026, 7, 13, 17, 3));
    const [label] = labels(t);
    expect(label).not.toMatch(/Today|Yesterday/);
    expect(label).toContain("13");
    expect(label).toContain("at 5:03 PM");
  });

  it("re-labels separators when the local day rolls over mid-session", () => {
    const t = mountAt(2026, 7, 14, 17, 30);
    showGap(t, localIso(2026, 7, 14, 16, 0), localIso(2026, 7, 14, 17, 3));
    expect(labels(t)).toEqual(["Today at 5:03 PM"]);

    // Same session, seven hours later — it is now 00:30 on the 15th, so the
    // separator the user is still looking at belongs to yesterday.
    vi.advanceTimersByTime(7 * 60 * 60 * 1000);
    expect(labels(t)).toEqual(["Yesterday at 5:03 PM"]);
  });

  it("labels yesterday as Yesterday across a DST spring-forward boundary", () => {
    // 2026-03-08 is 23 hours long in America/New_York (clocks jump 02:00→03:00),
    // so "yesterday" is not "now minus 86400000ms". Reached through globalThis
    // because the app's tsconfig type-checks these tests without @types/node.
    const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
    if (!env) return; // not running under Node — nothing to pin the zone to
    const prevTz = env.TZ;
    env.TZ = "America/New_York";
    try {
      const t = mountAt(2026, 3, 9, 10, 0);
      showGap(t, localIso(2026, 3, 8, 16, 0), localIso(2026, 3, 8, 17, 3));
      expect(labels(t)).toEqual(["Yesterday at 5:03 PM"]);
    } finally {
      // Assigning undefined would leave the literal string "undefined" behind.
      if (prevTz === undefined) delete env.TZ;
      else env.TZ = prevTz;
    }
  });
});
