import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { vi } from "vitest";
import { AppState } from "../app/state.js";
import type { RoomInfo } from "../ipc/types.js";

// The dialog's mute button must reflect the *push rule* (carried on RoomInfo by
// the backend), not the local `mute_rooms` list — which only records mutes this
// device tried to set and so misses mutes made from another client. The local
// list survives as the fallback for a room the store hasn't got yet.
const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  muteRoom: vi.fn(),
  unmuteRoom: vi.fn(),
}));

vi.mock("../app/notifications.js", () => mocks);

const { RoomInfoDialog } = await import("./RoomInfoDialog.js");

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
    muted: false,
    ...over,
  };
}

function muteButton(d: InstanceType<typeof RoomInfoDialog>): HTMLButtonElement {
  const btns = Array.from(
    d.getElement().querySelectorAll<HTMLButtonElement>(".room-info-dialog__btn")
  );
  const btn = btns.find((b) => b.textContent === "[mute]" || b.textContent === "[unmute]");
  if (!btn) throw new Error("mute button not found");
  return btn;
}

describe("RoomInfoDialog mute state", () => {
  let d: InstanceType<typeof RoomInfoDialog>;

  beforeEach(() => {
    mocks.getConfig.mockReset();
    mocks.muteRoom.mockReset().mockResolvedValue(undefined);
    mocks.unmuteRoom.mockReset().mockResolvedValue(undefined);
    mocks.getConfig.mockResolvedValue({
      enabled: true,
      show_body: true,
      show_sender: true,
      mute_rooms: [],
      background_sync: false,
      push_enabled: false,
      push_gateway_override: null,
    });
    AppState.set("currentRoomId", "!r:x");
    AppState.set("roomListCache", [makeRoom()]);
    d = new RoomInfoDialog();
    document.body.appendChild(d.getElement());
  });

  afterEach(() => {
    d.getElement().remove();
    AppState.set("roomListCache", []);
    AppState.set("currentRoomId", null);
  });

  it("offers [unmute] when the room's push rule mutes it, without reading the local list", async () => {
    AppState.set("roomListCache", [makeRoom({ muted: true })]);
    await d.show();
    expect(muteButton(d).textContent).toBe("[unmute]");
    expect(muteButton(d).classList.contains("room-info-dialog__btn--muted")).toBe(true);
    expect(mocks.getConfig).not.toHaveBeenCalled();
  });

  it("offers [mute] when the push rule says unmuted even if the local list still lists the room", async () => {
    mocks.getConfig.mockResolvedValue({ mute_rooms: ["!r:x"] });
    AppState.set("roomListCache", [makeRoom({ muted: false })]);
    await d.show();
    expect(muteButton(d).textContent).toBe("[mute]");
  });

  it("falls back to the local mute list when the room isn't in the cache", async () => {
    mocks.getConfig.mockResolvedValue({ mute_rooms: ["!r:x"] });
    AppState.set("roomListCache", []);
    await d.show();
    expect(mocks.getConfig).toHaveBeenCalled();
    expect(muteButton(d).textContent).toBe("[unmute]");
  });

  it("mutes through the push-rule command and patches the cached room", async () => {
    await d.show();
    muteButton(d).click();
    await vi.waitFor(() => expect(mocks.muteRoom).toHaveBeenCalledWith("!r:x"));
    expect(AppState.get("roomListCache")[0].muted).toBe(true);
  });

  it("unmutes a room the push rule reports as muted", async () => {
    AppState.set("roomListCache", [makeRoom({ muted: true })]);
    await d.show();
    muteButton(d).click();
    await vi.waitFor(() => expect(mocks.unmuteRoom).toHaveBeenCalledWith("!r:x"));
    expect(AppState.get("roomListCache")[0].muted).toBe(false);
  });
});
