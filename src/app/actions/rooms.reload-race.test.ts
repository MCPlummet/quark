import { describe, it, expect, beforeEach, vi } from "vitest";

// #143: a send landing while reloadCurrentRoomTimeline's fetch is in flight
// must survive the rebuild.

vi.mock("../../ipc/index.js", () => ({
  markRoomRead: vi.fn().mockResolvedValue(undefined),
  openRoomTimeline: vi.fn(),
  getRoomMembers: vi.fn().mockResolvedValue([]),
  getRoomReceipts: vi.fn().mockResolvedValue([]),
  downloadMedia: vi.fn(),
  getTimeline: vi.fn(),
  loadOlderTimeline: vi.fn(),
  paginateForward: vi.fn(),
  getEventContext: vi.fn(),
  getRooms: vi.fn().mockResolvedValue([]),
  getSpaceChildren: vi.fn().mockResolvedValue([]),
  getUserSpaces: vi.fn().mockResolvedValue([]),
  joinRoom: vi.fn(),
  createRoom: vi.fn(),
}));
vi.mock("../mobile.js", () => ({ isMobile: () => false, closeDrawer: vi.fn() }));
vi.mock("./threads.js", () => ({ closeThread: vi.fn() }));
vi.mock("./messages.js", () => ({ cancelReply: vi.fn(), cancelEdit: vi.fn() }));
vi.mock("./dialogs.js", () => ({ openRoomSettings: vi.fn() }));
vi.mock("./profile.js", () => ({ openProfileForUser: vi.fn() }));
vi.mock("../../ui/NotificationToast.js", () => ({ showError: vi.fn(), showSuccess: vi.fn() }));
vi.mock("./context.js", async (importActual) => {
  const actual = await importActual<typeof import("./context.js")>();
  return {
    ...actual,
    _downloadMessageImages: vi.fn(),
    _downloadReactionEmoji: vi.fn(),
    _downloadInlineEmoji: vi.fn(),
  };
});

import { reloadCurrentRoomTimeline } from "./rooms.js";
import { setComponents } from "./context.js";
import { AppState } from "../state.js";
import * as ipc from "../../ipc/index.js";
import type { AppComponents } from "../../ui/App.js";
import type { TimelineEvent } from "../../ipc/types.js";

function ev(id: string, ts: number, type = "m.text"): TimelineEvent {
  return {
    event_id: id, sender: "@a:x", body: id, formatted_body: null,
    timestamp: ts, msg_type: type, is_edit: false,
    relates_to_event_id: null, in_reply_to: null, thread_root: null,
    media_url: null, media_mimetype: null, media_width: null, media_height: null,
  };
}

describe("reloadCurrentRoomTimeline keeps events that arrive mid-fetch (#143)", () => {
  const setMessages = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    const timeline = new Proxy({}, {
      get: (_t, k) => (k === "setMessages" ? setMessages : vi.fn()),
    });
    setComponents({ timeline } as unknown as AppComponents);
  });

  it("merges a just-sent message missing from the fetched page", async () => {
    AppState.patch({
      currentRoomId: "!r:x",
      currentTimeline: [ev("$1", 100), ev("$utd", 200, "m.room.encrypted")],
    });
    let release: (v: unknown) => void = () => {};
    (ipc.openRoomTimeline as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise((r) => { release = r; }),
    );
    const pending = reloadCurrentRoomTimeline();

    // Own message echoes in while the fetch is outstanding.
    AppState.set("currentTimeline", [...AppState.get("currentTimeline"), ev("$mine", 300)]);

    release({ events: [ev("$1", 100), ev("$utd", 200)], reached_start: true });
    await pending;

    expect(AppState.get("currentTimeline").map((e) => e.event_id)).toEqual(["$1", "$utd", "$mine"]);
    const rendered = setMessages.mock.calls[setMessages.mock.calls.length - 1]![0] as { id?: string; eventId?: string }[];
    expect(rendered.length).toBe(3);
  });
});
