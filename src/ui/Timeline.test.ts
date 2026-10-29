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

    // MSC2530 captions ride on any media type; a staged file or video sent
    // with typed text carries one.
    it("renders the caption beneath a file and a video", () => {
      timeline.setMessages([
        makeMsg({ id: "$f", type: "file", mediaUrl: "mxc://x/f", mediaAlt: "notes.pdf", caption: "the notes" }),
        makeMsg({ id: "$v", type: "video", mediaUrl: "mxc://x/v", mediaAlt: "clip.mp4", caption: "watch this" }),
      ]);

      const captions = [...timeline.getElement().querySelectorAll(".message__image-caption")].map(
        (el) => el.textContent,
      );
      expect(captions).toEqual(["the notes", "watch this"]);
    });

    it("renders the caption beneath an image when present", () => {
      timeline.setMessages([
        makeMsg({ type: "image", mediaUrl: "https://x.com/img.png", caption: "a wild sunset" }),
      ]);

      const caption = timeline.getElement().querySelector(".message__image-caption");
      expect(caption).not.toBeNull();
      expect(caption?.textContent).toBe("a wild sunset");
      // The caption is still a message body, not a class of its own — the
      // stylesheet's `.message__body` rules are what give it its type.
      expect(caption?.classList.contains("message__body")).toBe(true);
    });

    // #84's render half: the caption was drawn with `textContent`, so a custom
    // emoji in it came out as the literal `:shortcode:` — including one Quark
    // had just sent itself.
    it("renders a formatted caption as HTML, stashing custom emoji for download", () => {
      timeline.setMessages([
        makeMsg({
          type: "image",
          mediaUrl: "https://x.com/img.png",
          caption: ":party: nice",
          captionHtml: '<img data-mx-emoticon src="mxc://e/1" alt=":party:"> nice',
        }),
      ]);

      const img = timeline
        .getElement()
        .querySelector<HTMLImageElement>(".message__image-caption img[data-mx-emoticon]");
      expect(img).not.toBeNull();
      // The mxc:// src is unloadable, so it moves to data-mxc until the app
      // layer swaps in a data: URL.
      expect(img?.dataset.mxc).toBe("mxc://e/1");
      expect(img?.hasAttribute("src")).toBe(false);
    });

    // The resolver queries the whole list element, so a caption's emoji is
    // picked up by the same pass that handles message bodies — but only if the
    // caption went through the stash.
    it("offers a caption's custom emoji to the inline-emoji resolver", () => {
      timeline.setMessages([
        makeMsg({
          type: "image",
          mediaUrl: "https://x.com/img.png",
          caption: ":party:",
          captionHtml: '<img data-mx-emoticon src="mxc://e/1" alt=":party:">',
        }),
      ]);

      expect(timeline.getPendingInlineEmojiUrls()).toContain("mxc://e/1");

      timeline.resolveInlineEmoji("mxc://e/1", "data:image/png;base64,AA");
      const img = timeline
        .getElement()
        .querySelector<HTMLImageElement>(".message__image-caption img[data-mx-emoticon]");
      expect(img?.getAttribute("src")).toBe("data:image/png;base64,AA");
    });

    it("falls back to plain text for a caption with no formatted body", () => {
      timeline.setMessages([
        makeMsg({ type: "image", mediaUrl: "https://x.com/img.png", caption: "<b>not html</b>" }),
      ]);

      const caption = timeline.getElement().querySelector(".message__image-caption");
      expect(caption?.querySelector("b")).toBeNull();
      expect(caption?.textContent).toBe("<b>not html</b>");
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

    // #106: the click that jumped to the original used to bubble on to the
    // timeline's own click handler, which re-selected the *reply* and scrolled
    // it back into view — undoing the jump whenever the two were far apart.
    it("clicking the preview leaves the original selected, not the reply", () => {
      Element.prototype.scrollIntoView ??= () => {};
      timeline.setMessages([
        makeMsg({ id: "$orig", body: "Original message" }),
        makeMsg({
          id: "$reply",
          senderName: "Bob",
          body: "Answer",
          replyTo: { eventId: "$orig", senderName: "Alice", body: "Original message" },
        }),
      ]);
      const reply = timeline.getElement().querySelector<HTMLElement>(".reply-preview")!;
      reply.click();
      expect(timeline.selectedMessageId).toBe("$orig");
    });

    it("clicking the preview of an unloaded original asks for a fetch", () => {
      const onJump = vi.fn();
      timeline.onJumpToMessage(onJump);
      timeline.setMessages([
        makeMsg({
          id: "$reply",
          replyTo: { eventId: "$gone", senderName: "Alice", body: "Old" },
        }),
      ]);
      timeline.getElement().querySelector<HTMLElement>(".reply-preview")!.click();
      expect(onJump).toHaveBeenCalledWith("$gone");
    });

    it("renders a loading preview and asks for its original once", () => {
      const onUnresolved = vi.fn();
      timeline.onUnresolvedReply(onUnresolved);
      const pending = { eventId: "$old", senderName: "", body: "", state: "loading" as const };
      timeline.setMessages([
        makeMsg({ id: "$r1", replyTo: pending }),
        makeMsg({ id: "$r2", senderName: "Bob", replyTo: pending }),
      ]);
      const previews = timeline.getElement().querySelectorAll(".reply-preview--loading");
      expect(previews).toHaveLength(2);
      expect(onUnresolved).toHaveBeenCalledTimes(1);
      expect(onUnresolved).toHaveBeenCalledWith("$old");
    });

    it("asks for unresolved originals on every entry point", () => {
      const onUnresolved = vi.fn();
      timeline.onUnresolvedReply(onUnresolved);
      const pending = (id: string) => ({ eventId: id, senderName: "", body: "", state: "loading" as const });
      timeline.setMessages([makeMsg({ id: "$a" })]);
      timeline.appendMessage(makeMsg({ id: "$b", replyTo: pending("$x1") }));
      timeline.prependMessages([makeMsg({ id: "$c", replyTo: pending("$x2") })]);
      timeline.appendMessages([makeMsg({ id: "$d", replyTo: pending("$x3") })]);
      expect(onUnresolved.mock.calls.map((c) => c[0])).toEqual(["$x1", "$x2", "$x3"]);
    });

    it("does not ask for resolved previews", () => {
      const onUnresolved = vi.fn();
      timeline.onUnresolvedReply(onUnresolved);
      timeline.setMessages([
        makeMsg({ replyTo: { eventId: "$o", senderName: "A", body: "hi" } }),
      ]);
      expect(onUnresolved).not.toHaveBeenCalled();
    });

    it("updateReplyPreview swaps the banner in the DOM and the buffer", () => {
      timeline.setMessages([
        makeMsg({ id: "$r", replyTo: { eventId: "$old", senderName: "", body: "", state: "loading" } }),
      ]);
      timeline.updateReplyPreview("$old", { eventId: "$old", senderName: "Carol", body: "found it" });
      const reply = timeline.getElement().querySelector(".reply-preview")!;
      expect(reply.classList.contains("reply-preview--loading")).toBe(false);
      expect(reply.querySelector(".reply-preview__body")?.textContent).toBe("found it");
      expect(reply.querySelector(".reply-preview__sender")?.textContent).toBe("Carol");
      expect(timeline.getElement().querySelectorAll(".reply-preview")).toHaveLength(1);
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
  // Placement is reconciled in a microtask queued by every change to the buffer,
  // the window or receipt state, so each test flushes before it looks.
  describe("read receipts", () => {
    /** 2024-01-01 at the given UTC time, as ISO and as ms. */
    const iso = (hms: string): string => `2024-01-01T${hms}Z`;
    const ms = (hms: string): number => Date.parse(iso(hms));
    const msg = (id: string, who: string, hms: string): MessageData =>
      makeMsg({ id, senderId: `@${who}:x`, senderName: who, timestamp: iso(hms) });
    /** Let the queued reconciliation run (it was queued first, so it goes first). */
    const flush = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve));
    /** `receiptEvent` of every cluster on screen, in document order. Asserting
     *  the whole list also catches a stray second cluster. */
    const clusters = (): string[] =>
      Array.from(
        timeline.getElement().querySelectorAll<HTMLElement>(".read-receipts"),
        (c) => c.dataset.receiptEvent ?? "",
      );
    const clusterOn = (eventId: string): HTMLElement | null =>
      timeline.getMessageElementById(eventId)?.querySelector<HTMLElement>(".read-receipts") ?? null;
    /** Readers shown on `eventId`'s cluster, most recent first. */
    const readersOn = (eventId: string): string[] =>
      Array.from(
        clusterOn(eventId)?.querySelectorAll<HTMLElement>(".read-receipt") ?? [],
        (s) => s.dataset.receiptUser ?? "",
      );
    /** This test's hover card. Earlier tests' timelines leave theirs on <body>. */
    const card = (): HTMLElement | undefined => {
      const cards = document.querySelectorAll<HTMLElement>(".read-receipts-tooltip");
      return cards[cards.length - 1];
    };
    const hover = (el: HTMLElement): void => {
      el.dispatchEvent(new MouseEvent("mouseenter"));
    };

    // Bob has read Alice's 12:00 message and has not posted since.
    beforeEach(async () => {
      timeline.setMessages([msg("e1", "alice", "12:00:00"), msg("e2", "alice", "12:01:00")]);
      timeline.setReadReceipts([{ userId: "@bob:x", eventId: "e1", ts: ms("12:00:30") }]);
      await flush();
    });

    it("places a receipt on the event it names", () => {
      expect(clusters()).toEqual(["e1"]);
      expect(readersOn("e1")).toEqual(["@bob:x"]);
    });

    it("advances a receipt to the reader's own live-appended message", async () => {
      timeline.appendMessage(msg("e3", "bob", "12:02:00"));
      await flush();

      expect(clusters()).toEqual(["e3"]);
    });

    it("advances a receipt when the live message merges into the sender's group", async () => {
      timeline.appendMessage(msg("e3", "bob", "12:02:00"));
      await flush();
      expect(clusters()).toEqual(["e3"]);

      // Merging into the previous group is a separate exit from appendMessage.
      timeline.appendMessage(msg("e4", "bob", "12:02:10"));
      await flush();

      expect(clusters()).toEqual(["e4"]);
    });

    it("leaves a receipt alone when someone else posts", async () => {
      const before = clusterOn("e1");
      timeline.appendMessage(msg("e3", "carol", "12:02:00"));
      await flush();

      expect(clusters()).toEqual(["e1"]);
      expect(clusterOn("e1")).toBe(before);
    });

    it("advances a receipt through forward pagination", async () => {
      timeline.appendMessages([msg("e3", "bob", "12:02:00")]);
      await flush();

      expect(clusters()).toEqual(["e3"]);
    });

    it("decorates freshly prepended history", async () => {
      timeline.setMessages([msg("e9", "dave", "13:00:00")]);
      timeline.setReadReceipts([{ userId: "@bob:x", eventId: "e0", ts: ms("11:00:30") }]);
      await flush();
      expect(clusters()).toEqual([]); // the receipted event is older than the buffer

      timeline.prependMessages([msg("e0", "alice", "11:00:00")]);
      await flush();

      expect(clusters()).toEqual(["e0"]);
    });

    it("clears every cluster when receipts are turned off", async () => {
      timeline.setReadReceipts([]);
      await flush();

      expect(clusters()).toEqual([]);
    });

    // The review probe for #72: rebuilding every cluster on each append threw
    // away the one under the pointer, and with it the hover card.
    it("keeps the hovered cluster and its card across an unrelated append", async () => {
      const cluster = clusterOn("e1")!;
      hover(cluster);
      expect(card()?.style.display).toBe("block");

      timeline.appendMessage(msg("e3", "carol", "12:02:00"));
      await flush();

      expect(clusterOn("e1")).toBe(cluster);
      expect(card()?.style.display).toBe("block");
    });

    // Touch: a tap opens the card and mouseleave may never come, so a scroll
    // has to keep the card with its cluster rather than leave it floating.
    describe("when the timeline scrolls with the card open", () => {
      const rect = (top: number, bottom: number, right = 300): DOMRect =>
        ({ top, bottom, left: right - 40, right, width: 40, height: bottom - top, x: right - 40, y: top, toJSON() {} }) as DOMRect;
      const scroller = (): HTMLElement => timeline.getElement().querySelector<HTMLElement>(".timeline")!;
      const scroll = (): void => {
        scroller().dispatchEvent(new Event("scroll"));
      };

      it("moves the card with its cluster", () => {
        const cluster = clusterOn("e1")!;
        vi.spyOn(scroller(), "getBoundingClientRect").mockReturnValue(rect(0, 600));
        const at = vi.spyOn(cluster, "getBoundingClientRect").mockReturnValue(rect(400, 414));
        hover(cluster);
        const before = card()!.style.top;

        at.mockReturnValue(rect(300, 314));
        scroll();

        expect(card()?.style.display).toBe("block");
        expect(card()!.style.top).not.toBe(before);
      });

      it("closes the card once its cluster scrolls out of view", () => {
        const cluster = clusterOn("e1")!;
        vi.spyOn(scroller(), "getBoundingClientRect").mockReturnValue(rect(0, 600));
        const at = vi.spyOn(cluster, "getBoundingClientRect").mockReturnValue(rect(400, 414));
        hover(cluster);

        at.mockReturnValue(rect(700, 714));
        scroll();

        expect(card()?.style.display).toBe("none");
      });
    });

    it("refreshes the open card in place when the hovered cluster loses a reader", async () => {
      timeline.setReadReceipts([
        { userId: "@bob:x", eventId: "e1", ts: ms("12:00:30") },
        { userId: "@dave:x", eventId: "e1", ts: ms("12:00:40") },
      ]);
      await flush();
      const cluster = clusterOn("e1")!;
      expect(readersOn("e1")).toEqual(["@dave:x", "@bob:x"]);
      hover(cluster);
      expect(card()?.textContent).toContain("Read by 2");

      timeline.appendMessage(msg("e3", "dave", "12:02:00"));
      await flush();

      expect(clusterOn("e1")).toBe(cluster);
      expect(readersOn("e1")).toEqual(["@bob:x"]);
      expect(readersOn("e3")).toEqual(["@dave:x"]);
      expect(card()?.style.display).toBe("block");
      expect(card()?.textContent).not.toContain("Read by 2");
    });

    it("closes the card when its cluster goes away", async () => {
      hover(clusterOn("e1")!);
      timeline.appendMessage(msg("e3", "bob", "12:02:00")); // Bob, the only reader, moves on
      await flush();

      expect(clusters()).toEqual(["e3"]);
      expect(card()?.style.display).toBe("none");
    });

    it("leaves a cluster alone when a neighbouring message is redacted", async () => {
      const cluster = clusterOn("e1");
      timeline.removeMessage("e2");
      await flush();

      expect(clusters()).toEqual(["e1"]);
      expect(clusterOn("e1")).toBe(cluster);
    });

    it("moves readers off a redacted message instead of dropping them", async () => {
      // The receipt names e2. Once e2 is gone, the receipt time puts Bob on e1.
      timeline.setReadReceipts([{ userId: "@bob:x", eventId: "e2", ts: ms("12:01:30") }]);
      await flush();
      expect(clusters()).toEqual(["e2"]);

      timeline.removeMessage("e2");
      await flush();

      expect(clusters()).toEqual(["e1"]);
    });

    it("returns a reader to their receipt when their own message is redacted", async () => {
      timeline.appendMessage(msg("e3", "bob", "12:02:00"));
      await flush();
      expect(clusters()).toEqual(["e3"]);

      timeline.removeMessage("e3");
      await flush();

      expect(clusters()).toEqual(["e1"]);
    });

    it("follows an optimistic message's rename to its real event ID", async () => {
      timeline.appendMessage(makeMsg({ id: "optimistic-1", senderId: "@me:x", isOwn: true, timestamp: iso("12:02:00") }));
      // Carol's receipt names the real ID, which isn't known yet. The receipt
      // time puts her on the echo anyway.
      timeline.setReadReceipt("@carol:x", "$real", ms("12:02:30"));
      await flush();
      const cluster = clusterOn("optimistic-1");
      expect(clusters()).toEqual(["e1", "optimistic-1"]); // Bob's still on e1
      expect(readersOn("optimistic-1")).toEqual(["@carol:x"]);

      timeline.confirmMessage("optimistic-1", "$real");
      await flush();

      expect(clusters()).toEqual(["e1", "$real"]);
      expect(clusterOn("$real")).toBe(cluster);
    });

    // Clock skew: an optimistic echo carries the client clock, and a federated
    // event can arrive with an older origin_server_ts. A binary search over the
    // buffer assumed ascending timestamps, so one outlier sent its search the
    // wrong way and misplaced every time-based receipt.
    it("is not thrown off by timestamps that run out of order", async () => {
      timeline.setMessages([
        msg("e1", "alice", "12:00:00"),
        msg("e2", "alice", "12:01:00"),
        msg("e3", "alice", "13:00:00"), // skewed ahead
        msg("e4", "alice", "12:03:00"),
        msg("e5", "alice", "12:04:00"),
        msg("e6", "dave", "11:00:00"), // arrived last, stamped early
      ]);
      timeline.setReadReceipts([
        // Names a reaction, which isn't in the timeline, so the time decides:
        // the latest message stamped at or before 12:03:30 is e4.
        { userId: "@bob:x", eventId: "$reaction", ts: ms("12:03:30") },
        // Names e5, so it goes on e5, even though the receipt's own time is earlier.
        { userId: "@carol:x", eventId: "e5", ts: ms("12:00:10") },
        // Names e2, but Dave has posted since. e6 comes later in the timeline,
        // whatever its timestamp says.
        { userId: "@dave:x", eventId: "e2", ts: ms("12:01:30") },
      ]);
      await flush();

      expect(clusters()).toEqual(["e4", "e5", "e6"]);
      expect(readersOn("e4")).toEqual(["@bob:x"]);
      expect(readersOn("e5")).toEqual(["@carol:x"]);
      expect(readersOn("e6")).toEqual(["@dave:x"]);
    });

    it("coalesces a burst of appends into one reconciliation pass", async () => {
      const pass = vi.spyOn(timeline as unknown as { _reconcileReceipts(): void }, "_reconcileReceipts");
      for (let i = 0; i < 20; i++) {
        timeline.appendMessage(msg(`n${i}`, i % 2 ? "bob" : "carol", `12:02:${String(i).padStart(2, "0")}`));
      }
      await flush();

      expect(pass).toHaveBeenCalledTimes(1);
      expect(clusters()).toEqual(["n19"]); // Bob's last
    });

    describe("with Bob's newest message outside the rendered window", () => {
      /** 300 messages a minute apart from 10:00. Alice posts them all except the
       *  last, which is Bob's. */
      const history = (): MessageData[] =>
        Array.from({ length: 300 }, (_, i) =>
          makeMsg({
            id: `m${i}`,
            senderId: i === 299 ? "@bob:x" : "@alice:x",
            senderName: i === 299 ? "bob" : "alice",
            timestamp: new Date(Date.UTC(2024, 0, 1, 10, i)).toISOString(),
          }),
        );

      beforeEach(async () => {
        timeline.setMessages(history()); // renders m50..m299
        timeline.setReadReceipts([{ userId: "@bob:x", eventId: "m100", ts: null }]);
        await flush();
        expect(clusters()).toEqual(["m299"]); // sending implies reading

        // Jump back into history. The window becomes m0..m249, and m299 drops out.
        timeline.scrollToMessage("m10");
        await flush();
      });

      it("falls back to the explicit receipt instead of dropping the reader", () => {
        expect(timeline.getMessageElementById("m299")).toBeNull();
        expect(clusters()).toEqual(["m100"]);
      });

      it("keeps that fallback through a history prepend", async () => {
        const cluster = clusterOn("m100");
        timeline.prependMessages([
          makeMsg({ id: "p0", senderId: "@alice:x", senderName: "alice", timestamp: iso("09:00:00") }),
        ]);
        await flush();

        expect(clusters()).toEqual(["m100"]);
        expect(clusterOn("m100")).toBe(cluster);
      });

      it("leaves the reader in place when they post off screen", async () => {
        timeline.appendMessage(msg("m300", "bob", "15:00:00")); // window isn't at the tail: buffer only
        await flush();

        expect(timeline.getMessageElementById("m300")).toBeNull();
        expect(clusters()).toEqual(["m100"]);
      });
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

describe("Timeline stick-to-bottom observer", () => {
  let observed: (() => void) | null;
  let tl: Timeline;
  let scroller: HTMLElement;
  let scrollTop: number;
  let writes: number[];

  beforeEach(() => {
    observed = null;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          // The constructor builds the stick observer before any other.
          observed ??= cb;
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    tl = new Timeline();
    document.body.appendChild(tl.getElement());
    scroller = tl.getElement().querySelector<HTMLElement>(".timeline")!;
    scrollTop = 0;
    writes = [];
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (v: number) => {
        writes.push(v);
        scrollTop = v;
      },
    });
  });

  afterEach(() => {
    tl.getElement().remove();
    vi.unstubAllGlobals();
  });

  it("re-pins to the tail when growth leaves the stuck view short of it", () => {
    scrollTop = -12; // a resize clamped the view above the tail
    observed!();
    expect(writes).toEqual([0]);
  });

  it("leaves an overscroll past the tail to the rubber-band spring", () => {
    // column-reverse: past the tail scrollTop is positive while the bounce runs.
    scrollTop = 30;
    observed!();
    expect(writes).toEqual([]);
  });
});
