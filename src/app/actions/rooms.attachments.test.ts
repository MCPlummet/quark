import { describe, it, expect, beforeEach, vi } from "vitest";

// The composer — attachment progress rows included — is shared by every room,
// so opening a room has to tell it which room's rows belong on screen. Without
// this a failed upload parked its red `[!] file — reason` row for ten seconds
// in whatever room the user switched to next, and a success tick landed in the
// wrong room entirely. The row-level behaviour is pinned in
// `ui/AttachmentProgress.test.ts`; this pins the wiring.

vi.mock("../../ipc/index.js", () => ({
  markRoomRead: vi.fn().mockResolvedValue(undefined),
  openRoomTimeline: vi.fn(),
  getRoomMembers: vi.fn().mockResolvedValue([]),
  getRoomReceipts: vi.fn().mockResolvedValue([]),
  downloadMedia: vi.fn().mockResolvedValue({ mime_type: "image/png", data_base64: "" }),
  getTimeline: vi.fn().mockResolvedValue({ events: [], prev_batch: null }),
  loadOlderTimeline: vi.fn().mockResolvedValue({ events: [], reached_start: true }),
  paginateForward: vi.fn().mockResolvedValue({ events: [], next_batch: null }),
  getEventContext: vi.fn(),
  getRooms: vi.fn().mockResolvedValue([]),
  getSpaceChildren: vi.fn().mockResolvedValue([]),
  getUserSpaces: vi.fn().mockResolvedValue([]),
  findDmRoom: vi.fn().mockResolvedValue(null),
  createRoom: vi.fn(),
  joinRoom: vi.fn(),
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
    _downloadMemberAvatars: vi.fn(),
    ensureSenderAvatarDownloaded: vi.fn(),
  };
});

import { selectRoom } from "./rooms.js";
import { setComponents } from "./context.js";
import { AppState } from "../state.js";
import type { AppComponents } from "../../ui/App.js";

const setAttachmentRoom = vi.fn();

function fakeComponents(): AppComponents {
  const stub = () => new Proxy({}, { get: () => vi.fn() });
  const typingIndicator = document.createElement("div");
  typingIndicator.appendChild(
    Object.assign(document.createElement("span"), { className: "typing-indicator__text" }),
  );
  const input = new Proxy(
    { setAttachmentRoom },
    { get: (target, prop) => Reflect.get(target, prop) ?? vi.fn() },
  );
  return {
    roomList: stub(), roomHeader: stub(), timeline: stub(),
    memberList: stub(), statusBar: stub(), mobileTopBar: stub(),
    input, typingIndicator, spaceStrip: stub(),
  } as unknown as AppComponents;
}

describe("selectRoom → attachment rows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setComponents(fakeComponents());
    AppState.patch({ roomListCache: [], currentRoomId: null, currentTimeline: [] });
  });

  it("scopes the composer's attachment rows to the room being opened", async () => {
    await selectRoom("!general:x");

    expect(setAttachmentRoom).toHaveBeenCalledWith("!general:x");
  });

  it("re-scopes them on every switch, so rows don't follow the user", async () => {
    await selectRoom("!general:x");
    await selectRoom("!random:x");

    expect(setAttachmentRoom.mock.calls.map((c) => c[0])).toEqual(["!general:x", "!random:x"]);
  });
});
