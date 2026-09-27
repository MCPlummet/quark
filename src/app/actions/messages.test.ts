import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  startReply,
  promoteReplyTarget,
  cancelReply,
  startEdit,
  cancelEdit,
  applyIncomingRedaction,
} from "./messages.js";
import { setComponents } from "./context.js";
import { AppState } from "../state.js";
import type { AppComponents } from "../../ui/App.js";
import type { TimelineEvent } from "../../ipc/types.js";

// The synchronous reply/edit/redaction state transitions. They coordinate
// AppState with a few UI components; we inject stub components via
// setComponents (the same seam main.ts uses) so the transitions can be tested
// without a real DOM tree or backend.

function makeEvent(id: string): TimelineEvent {
  return {
    event_id: id,
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
  };
}

const replyPreview = {
  show: vi.fn(),
  hide: vi.fn(),
  showEdit: vi.fn(),
  isThreadMode: vi.fn(() => false),
};
const input = { setValue: vi.fn() };
const timeline = { removeMessage: vi.fn(), updateMessageBody: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  replyPreview.isThreadMode.mockReturnValue(false);
  setComponents({ replyPreview, input, timeline } as unknown as AppComponents);
  AppState.patch({
    replyToEventId: null,
    editingEventId: null,
    currentTimeline: [],
  });
});

describe("promoteReplyTarget (#106)", () => {
  it("follows a still-sending message to its real event ID", () => {
    startReply("optimistic-1", "me", "just sent");
    promoteReplyTarget("optimistic-1", "$real:x");
    expect(AppState.get("replyToEventId")).toBe("$real:x");
  });

  it("leaves a reply to some other message alone", () => {
    startReply("$other:x", "Alice", "hello");
    promoteReplyTarget("optimistic-1", "$real:x");
    expect(AppState.get("replyToEventId")).toBe("$other:x");
  });
});

describe("startReply / cancelReply", () => {
  it("startReply records the target and shows the reply preview", () => {
    startReply("$e1", "Alice", "hello there");
    expect(AppState.get("replyToEventId")).toBe("$e1");
    expect(replyPreview.show).toHaveBeenCalledExactlyOnceWith({
      eventId: "$e1",
      senderName: "Alice",
      snippet: "hello there",
    });
  });

  it("cancelReply clears the target and hides the preview when NOT in thread mode", () => {
    AppState.set("replyToEventId", "$e1");
    replyPreview.isThreadMode.mockReturnValue(false);
    cancelReply();
    expect(AppState.get("replyToEventId")).toBeNull();
    expect(replyPreview.hide).toHaveBeenCalledOnce();
  });

  it("cancelReply keeps the preview visible in thread mode (thread has its own banner)", () => {
    AppState.set("replyToEventId", "$e1");
    replyPreview.isThreadMode.mockReturnValue(true);
    cancelReply();
    expect(AppState.get("replyToEventId")).toBeNull();
    expect(replyPreview.hide).not.toHaveBeenCalled();
  });
});

describe("startEdit / cancelEdit", () => {
  it("startEdit records the edit target, shows the edit banner and loads the body", () => {
    startEdit("$e2", "original body");
    expect(AppState.get("editingEventId")).toBe("$e2");
    expect(replyPreview.showEdit).toHaveBeenCalledExactlyOnceWith("original body");
    expect(input.setValue).toHaveBeenCalledExactlyOnceWith("original body");
  });

  it("cancelEdit clears the target, empties the compose box and hides the banner", () => {
    AppState.set("editingEventId", "$e2");
    cancelEdit();
    expect(AppState.get("editingEventId")).toBeNull();
    expect(input.setValue).toHaveBeenCalledExactlyOnceWith("");
    expect(replyPreview.hide).toHaveBeenCalledOnce();
  });

  it("cancelEdit is a no-op when nothing is being edited", () => {
    AppState.set("editingEventId", null);
    cancelEdit();
    expect(input.setValue).not.toHaveBeenCalled();
    expect(replyPreview.hide).not.toHaveBeenCalled();
  });
});

describe("applyIncomingRedaction", () => {
  it("removes the message from the DOM and from the timeline cache", () => {
    AppState.set("currentTimeline", [makeEvent("$a"), makeEvent("$b"), makeEvent("$c")]);
    applyIncomingRedaction("$b");
    expect(timeline.removeMessage).toHaveBeenCalledExactlyOnceWith("$b");
    expect(AppState.get("currentTimeline").map((e) => e.event_id)).toEqual(["$a", "$c"]);
  });

  it("leaves the cache intact when the redacted event isn't present", () => {
    AppState.set("currentTimeline", [makeEvent("$a")]);
    applyIncomingRedaction("$missing");
    expect(AppState.get("currentTimeline").map((e) => e.event_id)).toEqual(["$a"]);
  });
});
