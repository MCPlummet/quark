import { describe, it, expect, beforeEach } from "vitest";
import {
  _applyEdits,
  stripReplyFallback,
  _buildThreadRootCounts,
  _resolveReactionImage,
  roomInfoToEntry,
  _buildFormattedBodyWithEmoji,
  replaceUnicodeEmojiShortcodes,
  prepareOutgoingBody,
  consumeOwnSentEvent,
  resolveDisplayName,
  timelineEventToMessage,
  _emojiImageCache,
  _shortcodeToMxc,
  _memberDisplayName,
  _dmUserByRoom,
  _ownSentEventIds,
} from "./context.js";
import { AppState } from "../state.js";
import type { TimelineEvent, RoomInfo } from "../../ipc/types.js";

// The pure converters/reconcilers that turn IPC payloads into UI state. These
// encode the trickiest, most drift-prone logic in the actions layer (edit
// reconciliation, reply-fallback stripping, custom-emoji HTML building) and had
// zero coverage. The shared module-level caches are cleared before each test.

function makeEvent(over: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    event_id: "$e",
    sender: "@bob:x",
    body: "hi",
    formatted_body: null,
    timestamp: 1000,
    msg_type: "m.text",
    is_edit: false,
    relates_to_event_id: null,
    in_reply_to: null,
    thread_root: null,
    media_url: null,
    media_mimetype: null,
    media_width: null,
    media_height: null,
    ...over,
  };
}

function makeRoom(over: Partial<RoomInfo> = {}): RoomInfo {
  return {
    room_id: "!r:x",
    name: "Room",
    topic: null,
    avatar_url: null,
    unread_count: 0,
    notification_count: 0,
    is_direct: false,
    is_encrypted: false,
    member_count: 2,
    ...over,
  };
}

beforeEach(() => {
  for (const m of [_emojiImageCache, _shortcodeToMxc, _memberDisplayName, _dmUserByRoom]) m.clear();
  _ownSentEventIds.clear();
  AppState.patch({ ownUserId: null });
});

describe("_applyEdits", () => {
  it("returns the original events unchanged when there are no edits", () => {
    const events = [makeEvent({ event_id: "$1" }), makeEvent({ event_id: "$2" })];
    expect(_applyEdits(events)).toEqual(events);
  });

  it("applies an edit to its original, drops the edit, and records the original body", () => {
    const original = makeEvent({ event_id: "$1", body: "old" });
    const edit = makeEvent({
      event_id: "$2",
      body: "new",
      is_edit: true,
      relates_to_event_id: "$1",
      timestamp: 2000,
    });
    const out = _applyEdits([original, edit]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      event_id: "$1",
      body: "new",
      was_edited: true,
      original_body: "old",
    });
  });

  it("keeps the latest edit by timestamp when several edits target one event", () => {
    const original = makeEvent({ event_id: "$1", body: "v0" });
    const e1 = makeEvent({ event_id: "$2", body: "v1", is_edit: true, relates_to_event_id: "$1", timestamp: 2000 });
    const e2 = makeEvent({ event_id: "$3", body: "v2", is_edit: true, relates_to_event_id: "$1", timestamp: 3000 });
    // Pass them out of order to prove it's timestamp-based, not positional.
    const out = _applyEdits([original, e2, e1]);
    expect(out[0].body).toBe("v2");
  });

  it("ignores an edit whose target is not present", () => {
    const edit = makeEvent({ event_id: "$2", is_edit: true, relates_to_event_id: "$missing", timestamp: 2000 });
    expect(_applyEdits([edit])).toEqual([]);
  });
});

describe("stripReplyFallback", () => {
  it("removes the > quoted block up to the first blank line", () => {
    const { body } = stripReplyFallback("> Alice said\n> something\n\nmy reply");
    expect(body).toBe("my reply");
  });

  it("leaves the body untouched when the prefix is not all quote lines", () => {
    const input = "not a quote\n\nmore text";
    expect(stripReplyFallback(input).body).toBe(input);
  });

  it("leaves a body without a blank-line separator untouched", () => {
    expect(stripReplyFallback("> only a quote").body).toBe("> only a quote");
  });

  it("strips a leading <mx-reply> block from the HTML body", () => {
    const html = "<mx-reply><blockquote>quoted</blockquote></mx-reply>actual <b>reply</b>";
    expect(stripReplyFallback("x", html).htmlBody).toBe("actual <b>reply</b>");
  });
});

describe("_buildThreadRootCounts", () => {
  it("counts replies per thread root and ignores non-threaded events", () => {
    const counts = _buildThreadRootCounts([
      makeEvent({ event_id: "$1", thread_root: "$root" }),
      makeEvent({ event_id: "$2", thread_root: "$root" }),
      makeEvent({ event_id: "$3", thread_root: "$other" }),
      makeEvent({ event_id: "$4" }),
    ]);
    expect(counts.get("$root")).toBe(2);
    expect(counts.get("$other")).toBe(1);
    expect(counts.has("$4")).toBe(false);
  });
});

describe("_resolveReactionImage", () => {
  it("returns a cached data URL for an mxc:// key", () => {
    _emojiImageCache.set("mxc://x/y", "data:image/png;base64,AAA");
    expect(_resolveReactionImage("mxc://x/y")).toBe("data:image/png;base64,AAA");
  });

  it("returns undefined for a plain unicode key", () => {
    expect(_resolveReactionImage("👍")).toBeUndefined();
  });

  it("returns undefined for an mxc key that isn't cached yet", () => {
    expect(_resolveReactionImage("mxc://not/cached")).toBeUndefined();
  });
});

describe("roomInfoToEntry", () => {
  it("falls back to the room ID when name is null and maps unread/mention counts", () => {
    const entry = roomInfoToEntry(makeRoom({ name: null, unread_count: 3, notification_count: 1 }));
    expect(entry.name).toBe("!r:x");
    expect(entry.unreadCount).toBe(3);
    expect(entry.mentionCount).toBe(1);
    expect(entry.dmUserId).toBeUndefined();
    expect(entry.presence).toBeUndefined();
  });

  it("resolves DM presence from the cache, defaulting to offline", () => {
    _dmUserByRoom.set("!dm:x", "@carol:x");
    AppState.cacheUserPresence("@carol:x", "online");
    const online = roomInfoToEntry(makeRoom({ room_id: "!dm:x", is_direct: true }));
    expect(online.dmUserId).toBe("@carol:x");
    expect(online.presence).toBe("online");

    _dmUserByRoom.set("!dm2:x", "@dave:x"); // no cached presence
    const offline = roomInfoToEntry(makeRoom({ room_id: "!dm2:x", is_direct: true }));
    expect(offline.presence).toBe("offline");
  });
});

describe("_buildFormattedBodyWithEmoji", () => {
  it("returns undefined when no known custom shortcode is present", () => {
    expect(_buildFormattedBodyWithEmoji("just text :unknown:")).toBeUndefined();
  });

  it("replaces a known shortcode with an mx-emoticon img and keeps surrounding text", () => {
    _shortcodeToMxc.set("party", "mxc://emoji/party");
    const html = _buildFormattedBodyWithEmoji("yay :party: time");
    expect(html).toBe(
      'yay <img data-mx-emoticon src="mxc://emoji/party" alt=":party:" title=":party:"> time',
    );
  });

  it("HTML-escapes the plain-text segments around the emoji", () => {
    _shortcodeToMxc.set("ok", "mxc://emoji/ok");
    const html = _buildFormattedBodyWithEmoji("a < b & c :ok:");
    expect(html).toContain("a &lt; b &amp; c ");
    expect(html).toContain("data-mx-emoticon");
  });

  it("leaves unknown shortcodes as escaped literal text", () => {
    _shortcodeToMxc.set("known", "mxc://emoji/known");
    const html = _buildFormattedBodyWithEmoji(":unknown: :known:");
    expect(html).toContain(":unknown:");
    expect(html).toContain("data-mx-emoticon");
  });
});

describe("replaceUnicodeEmojiShortcodes", () => {
  it("replaces a built-in Unicode shortcode with its glyph", () => {
    expect(replaceUnicodeEmojiShortcodes("hi :grinning:!")).toBe("hi 😀!");
  });

  it("replaces multiple shortcodes in one string", () => {
    expect(replaceUnicodeEmojiShortcodes(":grinning: :grinning:")).toBe("😀 😀");
  });

  it("leaves unknown shortcodes untouched", () => {
    expect(replaceUnicodeEmojiShortcodes("nope :definitely_not_real_xyz:")).toBe(
      "nope :definitely_not_real_xyz:",
    );
  });

  it("leaves custom-emoji shortcodes untouched (resolved separately as images)", () => {
    // A custom shortcode is, by construction, not in the built-in Unicode table.
    _shortcodeToMxc.set("mycustompog", "mxc://emoji/pog");
    expect(replaceUnicodeEmojiShortcodes("gg :mycustompog:")).toBe("gg :mycustompog:");
  });
});

describe("prepareOutgoingBody", () => {
  it("converts a Unicode shortcode to a glyph in the plain body, no formatted body", () => {
    expect(prepareOutgoingBody("hi :grinning:")).toEqual({
      body: "hi 😀",
      formattedBody: undefined,
    });
  });

  it("keeps a custom shortcode in the plain body and resolves it to an image in the formatted body", () => {
    _shortcodeToMxc.set("party", "mxc://emoji/party");
    const { body, formattedBody } = prepareOutgoingBody("yay :party:");
    expect(body).toBe("yay :party:");
    expect(formattedBody).toBe(
      'yay <img data-mx-emoticon src="mxc://emoji/party" alt=":party:" title=":party:">',
    );
  });

  it("handles Unicode and custom emoji together", () => {
    _shortcodeToMxc.set("party", "mxc://emoji/party");
    const { body, formattedBody } = prepareOutgoingBody(":grinning: :party:");
    expect(body).toBe("😀 :party:");
    expect(formattedBody).toBe(
      '😀 <img data-mx-emoticon src="mxc://emoji/party" alt=":party:" title=":party:">',
    );
  });

  it("preserves inline markdown alongside a Unicode glyph", () => {
    const { body, formattedBody } = prepareOutgoingBody("**bold** :grinning:");
    expect(body).toBe("**bold** 😀");
    expect(formattedBody).toBe("<strong>bold</strong> 😀");
  });
});

describe("consumeOwnSentEvent", () => {
  it("returns true and removes the id on first call, false afterwards", () => {
    _ownSentEventIds.add("$mine");
    expect(consumeOwnSentEvent("$mine")).toBe(true);
    expect(consumeOwnSentEvent("$mine")).toBe(false);
    expect(consumeOwnSentEvent("$never")).toBe(false);
  });
});

describe("resolveDisplayName", () => {
  it("uses the cached display name, falling back to the raw user ID", () => {
    _memberDisplayName.set("@bob:x", "Bob");
    expect(resolveDisplayName("@bob:x")).toBe("Bob");
    expect(resolveDisplayName("@nobody:x")).toBe("@nobody:x");
  });
});

describe("timelineEventToMessage", () => {
  it("maps msg_type to the UI message type", () => {
    expect(timelineEventToMessage(makeEvent({ msg_type: "m.image" })).type).toBe("image");
    expect(timelineEventToMessage(makeEvent({ msg_type: "m.sticker" })).type).toBe("sticker");
    expect(timelineEventToMessage(makeEvent({ msg_type: "m.file" })).type).toBe("file");
    expect(timelineEventToMessage(makeEvent({ msg_type: "m.text" })).type).toBe("text");
    expect(timelineEventToMessage(makeEvent({ msg_type: "m.notice" })).type).toBe("text");
  });

  it("flags own messages by comparing against AppState.ownUserId", () => {
    AppState.patch({ ownUserId: "@me:x" });
    expect(timelineEventToMessage(makeEvent({ sender: "@me:x" })).isOwn).toBe(true);
    expect(timelineEventToMessage(makeEvent({ sender: "@other:x" })).isOwn).toBe(false);
  });

  it("maps the image caption when present and leaves it undefined otherwise", () => {
    expect(
      timelineEventToMessage(makeEvent({ msg_type: "m.image", caption: "a wild sunset" })).caption,
    ).toBe("a wild sunset");
    expect(timelineEventToMessage(makeEvent({ msg_type: "m.image" })).caption).toBeUndefined();
  });

  it("resolves the sender name from the member cache", () => {
    _memberDisplayName.set("@bob:x", "Bob");
    expect(timelineEventToMessage(makeEvent({ sender: "@bob:x" })).senderName).toBe("Bob");
  });

  it("builds a reply preview from the referenced parent and strips the fallback", () => {
    const parent = makeEvent({ event_id: "$parent", sender: "@alice:x", body: "the original" });
    _memberDisplayName.set("@alice:x", "Alice");
    const reply = makeEvent({
      event_id: "$reply",
      in_reply_to: "$parent",
      body: "> Alice said\n> the original\n\nmy answer",
    });
    const msg = timelineEventToMessage(reply, [parent, reply]);
    expect(msg.body).toBe("my answer");
    expect(msg.replyTo).toEqual({
      eventId: "$parent",
      senderName: "Alice",
      body: "the original",
    });
  });

  it("strips the parent's own reply fallback in a reply-to-reply preview", () => {
    // A ← B ← C: C's preview must show B's words, not A's quoted text.
    const a = makeEvent({ event_id: "$a", sender: "@alice:x", body: "first message" });
    const b = makeEvent({
      event_id: "$b",
      sender: "@bob:x",
      in_reply_to: "$a",
      body: "> <@alice:x> first message\n\nsecond message",
    });
    _memberDisplayName.set("@bob:x", "Bob");
    const c = makeEvent({
      event_id: "$c",
      in_reply_to: "$b",
      body: "> <@bob:x> second message\n\nthird message",
    });
    const msg = timelineEventToMessage(c, [a, b, c]);
    expect(msg.replyTo).toEqual({
      eventId: "$b",
      senderName: "Bob",
      body: "second message",
    });
  });

  it("maps reactions through to the UI shape", () => {
    const e = makeEvent({
      reactions: [{ key: "👍", count: 2, own: true, senders: ["@bob:x", "@me:x"], own_event_id: "$react" }],
    });
    expect(timelineEventToMessage(e).reactions).toEqual([
      { key: "👍", count: 2, own: true, imageUrl: undefined },
    ]);
  });
});
