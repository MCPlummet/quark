import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ThreadView, type ThreadMessageData } from "./ThreadView.js";
import { Timeline } from "./Timeline.js";

function msg(over: Partial<ThreadMessageData> = {}): ThreadMessageData {
  return {
    id: "$reply",
    senderName: "Bob",
    timestamp: "2024-01-01T12:00:00Z",
    body: "hello",
    ...over,
  };
}

const ROOT = msg({ id: "$root", senderName: "Alice", body: "the root" });

/** Give the panel's scroller a fake layout: `content` px of content in a
 *  `viewport` px window. jsdom lays nothing out, but it does keep scrollTop. */
function fakeLayout(view: ThreadView, content: number, viewport = 300): HTMLElement {
  const s = view.getScrollElement();
  Object.defineProperty(s, "scrollHeight", { value: content, configurable: true });
  Object.defineProperty(s, "clientHeight", { value: viewport, configurable: true });
  return s;
}

describe("ThreadView", () => {
  let view: ThreadView;

  beforeEach(() => {
    view = new ThreadView();
    document.body.appendChild(view.getElement());
  });

  afterEach(() => {
    view.getElement().remove();
  });

  it("is hidden until a thread is opened, and hidden again on close", () => {
    expect(view.getElement().style.display).toBe("none");
    view.open(ROOT);
    expect(view.getElement().style.display).toBe("");
    expect(view.rootId).toBe("$root");
    view.close();
    expect(view.getElement().style.display).toBe("none");
    expect(view.rootId).toBeNull();
    expect(view.getElement().querySelectorAll("[data-message-id]")).toHaveLength(0);
  });

  it("draws the root once, as the header, and counts only the replies", () => {
    view.open(ROOT);
    view.setReplies([msg({ id: "$a" }), msg({ id: "$b" })]);
    const el = view.getElement();
    expect(el.querySelectorAll('[data-message-id="$root"]')).toHaveLength(1);
    expect(el.querySelector(".thread-view__root [data-message-id]")?.getAttribute("data-message-id")).toBe("$root");
    expect(el.querySelectorAll(".thread-view__timeline [data-message-id]")).toHaveLength(2);
    expect(el.querySelector(".thread-view__count")?.textContent).toBe("2 replies");
  });

  it("says it is loading, then that the thread is empty", () => {
    view.open(ROOT);
    const status = () => view.getElement().querySelector<HTMLElement>(".thread-view__status")!;
    expect(status().textContent).toMatch(/loading/);
    view.setReplies([]);
    expect(status().textContent).toMatch(/No replies yet/);
    view.appendReply(msg({ id: "$first" }));
    expect(status().style.display).toBe("none");
  });

  // #131: the panel was rebuilt on every open with its scroller at the top, so a
  // long thread opened at its oldest reply and you scrolled down every time.
  it("opens scrolled to the newest reply", () => {
    view.open(ROOT);
    const s = fakeLayout(view, 2000);
    view.setReplies(Array.from({ length: 30 }, (_, i) => msg({ id: `$r${i}` })));
    expect(s.scrollTop).toBe(2000);
  });

  it("follows a new reply when the reader is at the bottom", () => {
    view.open(ROOT);
    const s = fakeLayout(view, 2000);
    view.setReplies([msg({ id: "$a" })]);
    s.scrollTop = 1700; // at the bottom (2000 - 300)
    s.dispatchEvent(new Event("scroll"));
    Object.defineProperty(s, "scrollHeight", { value: 2100, configurable: true });
    view.appendReply(msg({ id: "$b" }));
    expect(s.scrollTop).toBe(2100);
  });

  it("leaves a reader who scrolled up where they are", () => {
    view.open(ROOT);
    const s = fakeLayout(view, 2000);
    view.setReplies([msg({ id: "$a" })]);
    s.scrollTop = 200;
    s.dispatchEvent(new Event("scroll"));
    Object.defineProperty(s, "scrollHeight", { value: 2100, configurable: true });
    view.appendReply(msg({ id: "$b", senderName: "Carol" }));
    expect(s.scrollTop).toBe(200);
  });

  it("keeps a reply that arrived live while the thread was still loading", () => {
    view.open(ROOT);
    view.appendReply(msg({ id: "$live" }));
    view.setReplies([msg({ id: "$old" })]);
    const ids = [...view.getElement().querySelectorAll(".thread-view__timeline [data-message-id]")]
      .map((e) => e.getAttribute("data-message-id"));
    expect(ids).toEqual(["$old", "$live"]);
  });

  // #131: two replies inside one thread were drawn two ways. Every in-thread
  // reply now gets the same banner, whatever its body carried.
  it("draws an in-thread reply with the timeline's reply banner", () => {
    view.open(ROOT);
    view.setReplies([
      msg({ id: "$a", body: "plain thread message" }),
      msg({ id: "$b", body: "quoting", replyTo: { eventId: "$a", senderName: "Bob", body: "plain thread message" } }),
    ]);
    const quoted = view.getMessageEl("$b")!;
    expect(quoted.querySelector(":scope > .reply-preview .reply-preview__body")?.textContent).toBe("plain thread message");
    expect(view.getMessageEl("$a")!.querySelector(".reply-preview")).toBeNull();
  });

  it("jumps within the thread when a reply banner is clicked, without bubbling out", () => {
    let bubbled = false;
    const onDoc = () => { bubbled = true; };
    document.addEventListener("quark:jump-to-message", onDoc);
    try {
      view.open(ROOT);
      view.setReplies([
        msg({ id: "$a" }),
        msg({ id: "$b", replyTo: { eventId: "$a", senderName: "Bob", body: "hello" } }),
      ]);
      view.getMessageEl("$b")!.querySelector<HTMLElement>(".reply-preview")!.click();
      expect(view.selectedMessageId).toBe("$a");
      expect(bubbled).toBe(false);
    } finally {
      document.removeEventListener("quark:jump-to-message", onDoc);
    }
  });

  it("closes from the [x] and from the dimmed backdrop", () => {
    let closes = 0;
    view.onClose(() => closes++);
    view.open(ROOT);
    view.getElement().querySelector<HTMLElement>(".thread-view__close")!.click();
    view.getElement().querySelector<HTMLElement>(".thread-view__backdrop")!.click();
    expect(closes).toBe(2);
  });

  it("swallows wheel and drag over the backdrop so the room behind cannot scroll", () => {
    view.open(ROOT);
    const backdrop = view.getElement().querySelector<HTMLElement>(".thread-view__backdrop")!;
    const wheel = new Event("wheel", { cancelable: true, bubbles: true });
    const drag = new Event("touchmove", { cancelable: true, bubbles: true });
    backdrop.dispatchEvent(wheel);
    backdrop.dispatchEvent(drag);
    expect(wheel.defaultPrevented).toBe(true);
    expect(drag.defaultPrevented).toBe(true);
  });

  describe("keyboard selection", () => {
    beforeEach(() => {
      view.open(ROOT);
      view.setReplies([msg({ id: "$a" }), msg({ id: "$b" })]);
    });

    it("starts at the newest reply and walks up to the root", () => {
      expect(view.selectPrev()).toBe(true);
      expect(view.selectedMessageId).toBe("$b");
      view.selectPrev();
      view.selectPrev();
      expect(view.selectedMessageId).toBe("$root");
      expect(view.selectPrev()).toBe(false);
    });

    it("reports the bottom boundary so focus can drop into the compose box", () => {
      view.selectLast();
      expect(view.selectNext()).toBe(false);
    });

    it("forgets the selection on close", () => {
      view.selectLast();
      view.close();
      expect(view.selectedMessageId).toBeNull();
    });
  });

  it("promotes a provisional row to its real ID and gives it actions", () => {
    view.open(ROOT);
    view.setReplies([]);
    view.appendReply(msg({ id: "local-thread-1", isOwn: true }));
    expect(view.getMessageEl("local-thread-1")!.querySelector(".message__actions")).toBeNull();
    view.confirmMessage("local-thread-1", "$real");
    expect(view.getMessageEl("local-thread-1")).toBeNull();
    expect(view.getMessageEl("$real")!.querySelector(".message__actions")).not.toBeNull();
  });

  it("drops the provisional row when the sync echo beat the send's reply", () => {
    view.open(ROOT);
    view.setReplies([]);
    view.appendReply(msg({ id: "local-thread-1", isOwn: true }));
    view.appendReply(msg({ id: "$real", isOwn: true }));
    view.confirmMessage("local-thread-1", "$real");
    expect(view.getElement().querySelectorAll(".thread-view__timeline [data-message-id]")).toHaveLength(1);
  });

  it("replaces a row's reaction bar, and removes it when the last reaction goes", () => {
    view.open(ROOT);
    view.setReplies([msg({ id: "$a", reactions: [{ key: "👍", count: 1, own: false }] })]);
    view.updateMessageReactions("$a", [{ key: "🎉", count: 2, own: true }]);
    const bars = view.getMessageEl("$a")!.querySelectorAll(".reaction-bar");
    expect(bars).toHaveLength(1);
    expect(bars[0].textContent).toContain("🎉");
    view.updateMessageReactions("$a", []);
    expect(view.getMessageEl("$a")!.querySelector(".reaction-bar")).toBeNull();
  });

  // As an inline panel inside the timeline's list, a thread video was found by
  // the timeline and played in place; the panel keeps that rather than
  // dropping to the external player.
  it("plays a video reply inline in its own row", () => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    try {
      view.open(ROOT);
      view.setReplies([msg({ id: "$v", type: "video", mediaUrl: "mxc://x/v", mediaAlt: "clip.mp4" })]);
      let failed = false;
      view.showInlineVideo("$v", "http://127.0.0.1/clip", () => { failed = true; });
      const video = view.getMessageEl("$v")!.querySelector<HTMLVideoElement>("video.message__video");
      expect(failed).toBe(false);
      expect(video?.getAttribute("src")).toBe("http://127.0.0.1/clip");
    } finally {
      HTMLMediaElement.prototype.play = play;
    }
  });

  it("bubbles the timeline's reply event from a row's ↩ button", () => {
    const seen: string[] = [];
    const onReply = (e: Event) => seen.push((e as CustomEvent<{ eventId: string }>).detail.eventId);
    document.addEventListener("quark:msg-reply", onReply);
    try {
      view.open(ROOT);
      view.setReplies([msg({ id: "$a" })]);
      const btn = [...view.getMessageEl("$a")!.querySelectorAll<HTMLButtonElement>(".message__action-btn")]
        .find((b) => b.textContent === "↩")!;
      btn.click();
    } finally {
      document.removeEventListener("quark:msg-reply", onReply);
    }
    expect(seen).toEqual(["$a"]);
  });
});

// #132: the thread lived inside the timeline's scroller, so its rows were
// `[data-message-id]` elements in the list the windowed renderer pivots on, and
// a cull that pivoted on one re-centred the window on older history — dropping
// the live tail the moment a new message arrived. Mounted as App mounts it, the
// panel sits beside the scroller, never in it — the split around it is paint.
describe("ThreadView mounted over the timeline", () => {
  it("keeps its rows out of the timeline's scroller", () => {
    const timeline = new Timeline();
    const view = new ThreadView();
    view.embedIn(timeline);
    document.body.appendChild(timeline.getElement());
    try {
      timeline.setMessages([
        { id: "$root", senderName: "Alice", timestamp: "2024-01-01T12:00:00Z", body: "root" },
        { id: "$m2", senderName: "Bob", timestamp: "2024-01-01T12:01:00Z", body: "later" },
      ]);
      view.open(ROOT);
      view.setReplies([msg({ id: "$a" })]);

      expect(timeline.getScrollElement().contains(view.getMessageEl("$a"))).toBe(false);
      // …and the timeline's own selection is untouched by the open thread:
      // jump-to-latest lands on the room's newest message, not on the thread.
      timeline.selectLast();
      expect(timeline.selectedMessageId).toBe("$m2");
      expect(view.selectedMessageId).toBeNull();
    } finally {
      view.close();
      timeline.getElement().remove();
    }
  });
});

// #78 let a file be sent into a thread; the thread renderer has its own branch
// per media type, so the main timeline's tests say nothing about it.
describe("thread file and image replies", () => {
  let view: ThreadView;

  beforeEach(() => {
    view = new ThreadView();
    document.body.appendChild(view.getElement());
    view.open(ROOT);
  });

  afterEach(() => {
    view.getElement().remove();
  });

  function openWithFile(over: Partial<ThreadMessageData> = {}): HTMLElement {
    view.setReplies([
      msg({
        id: "$reply",
        body: "notes.pdf",
        type: "file",
        mediaUrl: "mxc://x/file",
        mediaAlt: "notes.pdf",
        mediaMimeType: "application/pdf",
        ...over,
      }),
    ]);
    return view.getElement();
  }

  it("renders a file reply as an openable affordance, not a line of text", () => {
    const aff = openWithFile().querySelector(".message__file-affordance");
    expect(aff).not.toBeNull();
    expect(aff?.querySelector(".message__file-affordance-label")?.textContent).toBe("notes.pdf");
    expect(aff?.getAttribute("role")).toBe("button");
  });

  it("bubbles quark:open-file with the event's media details", () => {
    const seen: Array<Record<string, unknown>> = [];
    const onOpen = (e: Event) => seen.push((e as CustomEvent).detail);
    document.addEventListener("quark:open-file", onOpen);
    try {
      openWithFile().querySelector<HTMLElement>(".message__file-affordance")?.click();
    } finally {
      document.removeEventListener("quark:open-file", onOpen);
    }
    expect(seen).toHaveLength(1);
    expect(seen[0].mxcUrl).toBe("mxc://x/file");
    expect(seen[0].filename).toBe("notes.pdf");
  });

  // The filename, not the caption: on a captioned upload the body is the
  // caption, and naming the row after it also names the saved file after it.
  it("labels the row with the filename and shows the caption beneath", () => {
    const panel = openWithFile({ body: "the good bits", caption: "the good bits" });
    expect(panel.querySelector(".message__file-affordance-label")?.textContent).toBe("notes.pdf");
    expect(panel.querySelector(".message__image-caption")?.textContent).toBe("the good bits");
  });

  // Where #78 and #84 meet: an image sent into a thread with a custom emoji in
  // its caption.
  it("renders an image reply's formatted caption as HTML, emoji stashed for download", () => {
    const panel = openWithFile({
      body: ":party: done",
      type: "image",
      mediaUrl: "mxc://x/img",
      mediaMimeType: "image/png",
      caption: ":party: done",
      captionHtml: '<img data-mx-emoticon src="mxc://e/1" alt=":party:"> done',
    });
    const emoji = panel.querySelector<HTMLImageElement>(".message__image-caption img[data-mx-emoticon]");
    expect(emoji?.dataset.mxc).toBe("mxc://e/1");
    expect(view.getPendingInlineEmojiUrls()).toContain("mxc://e/1");
  });
});
