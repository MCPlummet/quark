import { describe, it, expect, beforeEach, vi } from "vitest";
import { swapComposeDraft, _composeDrafts } from "./rooms.js";
import { setComponents } from "./context.js";
import { AppState } from "../state.js";
import type { AppComponents } from "../../ui/App.js";

// Per-room compose drafts (#34): switching rooms stashes the outgoing room's
// compose text and restores the incoming room's draft; a room without a draft
// gets an empty box. An in-progress edit is cancelled on switch (its text is
// another room's message body, not a draft).

let fieldValue = "";
/** What an edit in progress set aside (Input.setDraftAside). */
let draftAside = "";
const input = {
  getValue: () => fieldValue,
  restoreDraft: vi.fn(() => {
    fieldValue = draftAside;
    draftAside = "";
  }),
  setValue: vi.fn((text: string) => {
    fieldValue = text;
  }),
  resetValue: vi.fn((text: string) => {
    fieldValue = text;
  }),
  switchContext: vi.fn((_key: string | null, text: string) => {
    fieldValue = text;
  }),
};
const replyPreview = { hide: vi.fn(), show: vi.fn(), showEdit: vi.fn(), showThread: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  fieldValue = "";
  draftAside = "";
  _composeDrafts.clear();
  setComponents({ input, replyPreview } as unknown as AppComponents);
  AppState.patch({ editingEventId: null, replyToEventId: null });
});

describe("swapComposeDraft", () => {
  it("stashes the outgoing room's text and restores the incoming room's draft", () => {
    _composeDrafts.set("!b:x", "draft for b");
    fieldValue = "typed in a";
    swapComposeDraft("!a:x", "!b:x");
    expect(_composeDrafts.get("!a:x")).toBe("typed in a");
    expect(fieldValue).toBe("draft for b");
  });

  // #117: each room keeps its own undo history alongside its draft.
  it("hands the compose box the incoming room, so its undo history comes back too", () => {
    _composeDrafts.set("!b:x", "draft for b");
    swapComposeDraft("!a:x", "!b:x");
    expect(input.switchContext).toHaveBeenCalledExactlyOnceWith("!b:x", "draft for b");
    expect(input.setValue).not.toHaveBeenCalled();
  });

  it("clears the box when the incoming room has no draft", () => {
    fieldValue = "typed in a";
    swapComposeDraft("!a:x", "!b:x");
    expect(fieldValue).toBe("");
  });

  it("drops the stored draft when the box was emptied", () => {
    _composeDrafts.set("!a:x", "old draft");
    fieldValue = "";
    swapComposeDraft("!a:x", "!b:x");
    expect(_composeDrafts.has("!a:x")).toBe(false);
  });

  it("saves nothing when there was no previous room", () => {
    fieldValue = "login screen leftovers";
    swapComposeDraft(null, "!b:x");
    expect(_composeDrafts.size).toBe(0);
    expect(fieldValue).toBe("");
  });

  it("cancels an in-progress edit instead of saving its text as a draft", () => {
    AppState.set("editingEventId", "$edit:x");
    fieldValue = "edited message body";
    swapComposeDraft("!a:x", "!b:x");
    expect(AppState.get("editingEventId")).toBeNull();
    expect(replyPreview.hide).toHaveBeenCalled();
    expect(_composeDrafts.has("!a:x")).toBe(false);
    expect(fieldValue).toBe("");
  });

  // Review fix (#117): starting an edit threw away the draft it displaced.
  it("keeps the draft an edit displaced as the room's draft", () => {
    AppState.set("editingEventId", "$edit:x");
    draftAside = "half-written reply";
    fieldValue = "edited message body";
    swapComposeDraft("!a:x", "!b:x");
    expect(_composeDrafts.get("!a:x")).toBe("half-written reply");
  });
});
