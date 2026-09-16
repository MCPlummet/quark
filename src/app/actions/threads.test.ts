import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TimelineEvent } from "../../ipc/types.js";

// Thread panel wiring: what opening a thread does to the compose bar's armed
// state, and what it schedules for the replies it just rendered.

const getThreadTimeline = vi.fn<(roomId: string, rootId: string) => Promise<TimelineEvent[]>>(
  async () => [],
);
vi.mock("../../ipc/index.js", () => ({
  getThreadTimeline: (...args: [string, string]) => getThreadTimeline(...args),
  sendThreadReplyIpc: vi.fn(),
}));

vi.mock("../../ui/NotificationToast.js", () => ({ showError: vi.fn() }));
vi.mock("../mobile.js", () => ({ isMobile: () => false, closeDrawer: vi.fn() }));

const openInlineThread = vi.fn();
const showThread = vi.fn();
const _downloadInlineEmoji = vi.fn();
const _downloadMessageImages = vi.fn();
vi.mock("./context.js", () => ({
  getComponents: () => ({
    timeline: { openInlineThread, updateInlineThreadMedia: vi.fn() },
    replyPreview: { showThread, hide: vi.fn(), isThreadMode: () => true },
    input: { getComposeBoxElement: vi.fn() },
  }),
  _ownSentEventIds: new Set<string>(),
  prepareOutgoingBody: (b: string) => ({ body: b }),
  timelineEventToThreadMessage: (e: TimelineEvent) => ({ id: e.event_id, body: e.body }),
  _downloadMessageImages: (...args: unknown[]) => _downloadMessageImages(...args),
  _downloadInlineEmoji: (...args: unknown[]) => _downloadInlineEmoji(...args),
}));

import { openThread } from "./threads.js";
import { AppState } from "../state.js";

beforeEach(() => {
  vi.clearAllMocks();
  AppState.patch({
    currentRoomId: "!room:x",
    replyToEventId: null,
    threadRootEventId: null,
    currentTimeline: [],
  });
});

describe("openThread", () => {
  // The thread banner takes the reply banner's place, so a reply left armed is
  // armed invisibly — and since #78 the attachment paths read it, folding it
  // into the thread's relation as a reply to an event outside the thread.
  it("disarms a reply armed on the main timeline", async () => {
    AppState.set("replyToEventId", "$elsewhere");

    await openThread("$root");

    expect(AppState.get("replyToEventId")).toBeNull();
    expect(AppState.get("threadRootEventId")).toBe("$root");
    expect(showThread).toHaveBeenCalled();
  });

  // renderFormattedBody moves a custom emoji's unloadable mxc:// src to
  // data-mxc and waits for a resolver. Nothing in this path ran one, so thread
  // emoji stayed blank until an unrelated sync event happened to do it.
  it("resolves inline custom emoji in the replies it renders", async () => {
    await openThread("$root");

    expect(openInlineThread).toHaveBeenCalled();
    expect(_downloadInlineEmoji).toHaveBeenCalledTimes(1);
  });

  it("schedules neither when the thread fails to load", async () => {
    getThreadTimeline.mockRejectedValueOnce(new Error("boom"));

    await openThread("$root");

    expect(_downloadInlineEmoji).not.toHaveBeenCalled();
  });
});
