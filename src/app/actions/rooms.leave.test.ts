import { describe, it, expect, beforeEach, vi } from "vitest";
import { confirmAndLeaveRoom, leaveRoomWithFeedback } from "./rooms.js";
import { setComponents } from "./context.js";
import { AppState } from "../state.js";
import { askConfirm } from "../../ui/ConfirmDialog.js";
import { leaveRoom } from "../../ipc/index.js";
import { showError, showSuccess } from "../../ui/NotificationToast.js";
import type { AppComponents } from "../../ui/App.js";

// The Room Info "[leave room]" flow (#22): confirm via the shared ConfirmDialog,
// then leave over IPC and clear the active room. IPC and the dialog are mocked;
// refreshRooms runs for real against the mocked (empty) room list.

vi.mock("../../ui/ConfirmDialog.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ui/ConfirmDialog.js")>();
  return { ...actual, askConfirm: vi.fn() };
});

vi.mock("../../ipc/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ipc/index.js")>();
  return {
    ...actual,
    leaveRoom: vi.fn(async () => {}),
    getRooms: vi.fn(async () => []),
    getUserSpaces: vi.fn(async () => []),
  };
});

vi.mock("../../ui/NotificationToast.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ui/NotificationToast.js")>();
  return { ...actual, showError: vi.fn(), showSuccess: vi.fn() };
});

const spaceStrip = { setSpaces: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  setComponents({ spaceStrip } as unknown as AppComponents);
  AppState.patch({
    currentRoomId: "!room:x",
    // Keep refreshRooms off the room-list rendering path — the Home canvas
    // owns its own refresh, so only spaceStrip is touched.
    homeViewActive: true,
  });
});

describe("confirmAndLeaveRoom", () => {
  it("shows an error and no dialog when there is no current room", async () => {
    AppState.set("currentRoomId", null);
    await confirmAndLeaveRoom();
    expect(showError).toHaveBeenCalled();
    expect(askConfirm).not.toHaveBeenCalled();
    expect(leaveRoom).not.toHaveBeenCalled();
  });

  it("does nothing when the user cancels the confirmation", async () => {
    vi.mocked(askConfirm).mockResolvedValue(false);
    await confirmAndLeaveRoom();
    expect(leaveRoom).not.toHaveBeenCalled();
    expect(AppState.get("currentRoomId")).toBe("!room:x");
  });

  it("leaves the room and clears the active room on confirm", async () => {
    vi.mocked(askConfirm).mockResolvedValue(true);
    await confirmAndLeaveRoom();
    expect(leaveRoom).toHaveBeenCalledExactlyOnceWith("!room:x");
    expect(showSuccess).toHaveBeenCalled();
    expect(AppState.get("currentRoomId")).toBeNull();
  });

  it("asks with a danger-styled prompt", async () => {
    vi.mocked(askConfirm).mockResolvedValue(false);
    await confirmAndLeaveRoom();
    expect(askConfirm).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ danger: true }),
    );
  });
});

describe("leaveRoomWithFeedback", () => {
  it("surfaces IPC failures as an error toast without throwing", async () => {
    vi.mocked(leaveRoom).mockRejectedValueOnce(new Error("nope"));
    await leaveRoomWithFeedback("!room:x");
    expect(showError).toHaveBeenCalled();
    // Room stays active — the leave did not happen.
    expect(AppState.get("currentRoomId")).toBe("!room:x");
  });
});
