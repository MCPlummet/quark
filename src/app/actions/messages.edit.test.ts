import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Regression tests for #74 — an edit dropped every bit of formatting.
//
// `editMessage` only ever passed a plain body to the `edit_message` command, so
// the Rust `build_edit_content` HTML branch (fixed in #71) was unreachable: a
// message containing a custom (MSC2545) emoji degraded to a literal
// `:shortcode:` in `m.new_content` for every viewer, the editor included.
//
// The three render paths a message feature has to survive are all pinned here:
//   1. optimistic  — the editor's own timeline, updated in place before sync
//   2. sync echo   — another user's edit arriving over the wire
//   3. fresh load  — the same event re-read from the homeserver after a reload
//
// Typed mock signatures (see media.test.ts) keep `.mock.calls[n]` destructuring
// clean under `tsc`, which typechecks test files in the Nix build.

const ipcEditMessage =
  vi.fn<(roomId: string, eventId: string, newBody: string, newFormattedBody?: string) => Promise<string>>(
    async () => "$edit1",
  );
const getThumbnail =
  vi.fn<(mxc: string, w: number, h: number) => Promise<{ mime_type: string; data_base64: string }>>(
    async () => ({ mime_type: "image/png", data_base64: "AAAA" }),
  );

vi.mock("../../ipc/index.js", () => ({
  editMessage: (...args: Parameters<typeof ipcEditMessage>) => ipcEditMessage(...args),
  getThumbnail: (...args: Parameters<typeof getThumbnail>) => getThumbnail(...args),
  // Imported at module scope by messages.ts / context.ts; unused by these tests.
  sendMessage: vi.fn(),
  redactMessage: vi.fn(),
  downloadMedia: vi.fn(),
  getPresenceStatus: vi.fn(),
}));
// messages.ts imports the thread reply path at module scope; it pulls in a much
// larger slice of the IPC surface and no edit ever routes through it.
vi.mock("./threads.js", () => ({ sendThreadReply: vi.fn() }));
vi.mock("../../ui/NotificationToast.js", () => ({ showError: vi.fn(), showSuccess: vi.fn() }));

import { editMessage } from "./messages.js";
import {
  setComponents,
  _shortcodeToMxc,
  _emojiImageCache,
  _applyEdits,
  timelineEventToMessage,
  resolveInlineEmojiForTimeline,
} from "./context.js";
import { AppState } from "../state.js";
import { Timeline } from "../../ui/Timeline.js";
import type { AppComponents } from "../../ui/App.js";
import type { TimelineEvent } from "../../ipc/types.js";

const ROOM = "!room:x";
const ORIGINAL = "$orig:x";
const PARTY_IMG = '<img data-mx-emoticon src="mxc://emoji/party" alt=":party:" title=":party:">';

let timeline: Timeline;

/** The `.message__body` element of the original message, as rendered. */
function bodyEl(): HTMLElement {
  const el = timeline.getMessageElementById(ORIGINAL);
  if (!el) throw new Error("original message not rendered");
  return el.querySelector<HTMLElement>(".message__body")!;
}

/** Let the emoji-download promise chain settle. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function makeEditEvent(body: string, formattedBody: string | null): TimelineEvent {
  // What the backend hands back for our own edit: `convert_sync_room_message`
  // reads `m.new_content`, so body/formatted_body are the clean edited values.
  return {
    event_id: "$edit1",
    sender: "@me:x",
    body,
    formatted_body: formattedBody,
    timestamp: 2000,
    msg_type: "m.text",
    is_edit: true,
    relates_to_event_id: ORIGINAL,
    in_reply_to: null,
    thread_root: null,
    media_url: null,
    media_mimetype: null,
    media_width: null,
    media_height: null,
  };
}

function makeOriginalEvent(): TimelineEvent {
  return {
    ...makeEditEvent("yay :party:", PARTY_IMG),
    event_id: ORIGINAL,
    timestamp: 1000,
    is_edit: false,
    relates_to_event_id: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  ipcEditMessage.mockResolvedValue("$edit1");
  getThumbnail.mockResolvedValue({ mime_type: "image/png", data_base64: "AAAA" });
  _shortcodeToMxc.clear();
  _emojiImageCache.clear();
  _shortcodeToMxc.set("party", "mxc://emoji/party");

  timeline = new Timeline();
  document.body.appendChild(timeline.getElement());
  setComponents({ timeline } as unknown as AppComponents);
  AppState.patch({ currentRoomId: ROOM, editingEventId: null, currentTimeline: [] });

  timeline.setMessages([
    {
      id: ORIGINAL,
      senderName: "me",
      isOwn: true,
      timestamp: "2024-01-01T12:00:00Z",
      body: "yay :party:",
      htmlBody: PARTY_IMG,
    },
  ]);
});

afterEach(() => {
  timeline.getElement().remove();
});

describe("editMessage → IPC", () => {
  it("sends the HTML formatted body for a custom-emoji edit", async () => {
    await editMessage(ORIGINAL, "woo :party:");

    expect(ipcEditMessage).toHaveBeenCalledOnce();
    const [roomId, eventId, newBody, newFormattedBody] = ipcEditMessage.mock.calls[0];
    expect(roomId).toBe(ROOM);
    expect(eventId).toBe(ORIGINAL);
    // The custom shortcode stays in the plain body (the text fallback) and
    // becomes an <img> in the formatted body — exactly as sendMessage does.
    expect(newBody).toBe("woo :party:");
    expect(newFormattedBody).toBe(`woo ${PARTY_IMG}`);
  });

  it("sends inline markdown as HTML while converting Unicode shortcodes in the body", async () => {
    await editMessage(ORIGINAL, "**fixed** :grinning:");

    const [, , newBody, newFormattedBody] = ipcEditMessage.mock.calls[0];
    expect(newBody).toBe("**fixed** 😀");
    expect(newFormattedBody).toBe("<strong>fixed</strong> 😀");
  });

  it("sends no formatted body for a plain-text edit", async () => {
    await editMessage(ORIGINAL, "just text");

    const [, , newBody, newFormattedBody] = ipcEditMessage.mock.calls[0];
    expect(newBody).toBe("just text");
    // Not "" — an empty string would make the backend take the HTML branch and
    // ship a `formatted_body` for a message that has no formatting.
    expect(newFormattedBody).toBeUndefined();
  });

  it("does nothing when no room is open", async () => {
    AppState.set("currentRoomId", null);
    await editMessage(ORIGINAL, "woo :party:");
    expect(ipcEditMessage).not.toHaveBeenCalled();
  });
});

describe("editMessage — optimistic render (path 1)", () => {
  it("renders the custom emoji as an image and resolves its mxc:// URL", async () => {
    await editMessage(ORIGINAL, "woo :party:");
    await flush();

    const img = bodyEl().querySelector<HTMLImageElement>("img[data-mx-emoticon]");
    expect(img).not.toBeNull();
    expect(getThumbnail).toHaveBeenCalledWith("mxc://emoji/party", 64, 64);
    expect(img!.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    // …and the message is marked as edited.
    expect(bodyEl().querySelector(".message__edited-marker")).not.toBeNull();
  });

  it("stashes the unloadable mxc:// src instead of painting a broken image", async () => {
    // Hold the download open so the pre-resolution DOM state is observable.
    getThumbnail.mockReturnValue(new Promise(() => {}));
    await editMessage(ORIGINAL, "woo :party:");

    const img = bodyEl().querySelector<HTMLImageElement>("img[data-mx-emoticon]")!;
    expect(img.dataset.mxc).toBe("mxc://emoji/party");
    expect(img.getAttribute("src")).toBeNull();
  });

  it("keeps body and formatted body on the stored MessageData (survives a re-render)", async () => {
    await editMessage(ORIGINAL, "woo :party:");

    // Timeline re-renders windows from its MessageData store, and the `e` edit
    // keybinding reloads the compose box from it — both must see the new text.
    timeline.selectLast();
    expect(timeline.selectedMessage?.body).toBe("woo :party:");
    expect(timeline.selectedMessage?.htmlBody).toBe(`woo ${PARTY_IMG}`);
  });

  it("falls back to plain text (no stray HTML) for an unformatted edit", async () => {
    await editMessage(ORIGINAL, "just text");

    expect(bodyEl().querySelector("img")).toBeNull();
    expect(bodyEl().textContent).toContain("just text");
    expect(getThumbnail).not.toHaveBeenCalled();
  });

  it("clears the stored formatted body when an edit strips all formatting", async () => {
    // The message starts out as custom-emoji HTML. Editing it down to plain
    // text painted plain text in the DOM but left the pre-edit <img> on the
    // stored MessageData, so the emoji came back the moment the timeline
    // rebuilt the group from its store — the #55 class of bug, on the #74 path.
    await editMessage(ORIGINAL, "just text");

    timeline.selectLast();
    const stored = timeline.selectedMessage!;
    expect(stored.body).toBe("just text");
    expect(stored.htmlBody).toBeUndefined();

    // Re-render from the store: no resurrected emoji.
    timeline.setMessages([stored]);
    expect(bodyEl().querySelector("img")).toBeNull();
    expect(bodyEl().textContent).toContain("just text");
  });
});

describe("edit render — sync echo (path 2)", () => {
  it("renders a remote edit's formatted body and resolves its custom emoji", async () => {
    // Exactly what sync.ts does for an incoming `is_edit` event.
    const ev = makeEditEvent("woo :party:", `woo ${PARTY_IMG}`);
    timeline.updateMessageBody(ev.relates_to_event_id!, ev.body, ev.formatted_body ?? undefined);
    if (ev.formatted_body) resolveInlineEmojiForTimeline(timeline);

    const img = bodyEl().querySelector<HTMLImageElement>("img[data-mx-emoticon]");
    expect(img).not.toBeNull();
    await flush();
    expect(img!.getAttribute("src")).toBe("data:image/png;base64,AAAA");
  });
});

describe("edit render — fresh load (path 3)", () => {
  it("carries the edit's formatted body onto the original message", () => {
    const events = [makeOriginalEvent(), makeEditEvent("woo :party:", `woo ${PARTY_IMG}`)];
    const merged = _applyEdits(events);

    expect(merged).toHaveLength(1);
    expect(merged[0].body).toBe("woo :party:");
    expect(merged[0].formatted_body).toBe(`woo ${PARTY_IMG}`);

    const msg = timelineEventToMessage(merged[0], merged);
    expect(msg.body).toBe("woo :party:");
    expect(msg.htmlBody).toBe(`woo ${PARTY_IMG}`);
    expect(msg.wasEdited).toBe(true);
  });

  it("round-trips a custom-emoji edit from compose box to reloaded timeline", async () => {
    await editMessage(ORIGINAL, "woo :party:");
    const [, , newBody, newFormattedBody] = ipcEditMessage.mock.calls[0];

    // The homeserver echoes back what we sent (Rust reads it from m.new_content).
    const merged = _applyEdits([
      makeOriginalEvent(),
      makeEditEvent(newBody, newFormattedBody ?? null),
    ]);
    const msg = timelineEventToMessage(merged[0], merged);

    timeline.setMessages([msg]);
    const img = bodyEl().querySelector<HTMLImageElement>("img[data-mx-emoticon]");
    expect(img).not.toBeNull();
    expect(img!.dataset.mxc).toBe("mxc://emoji/party");
    // No literal shortcode left in the rendered HTML — the #74 symptom.
    expect(bodyEl().textContent).not.toContain(":party:");
  });
});
