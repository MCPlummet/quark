import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AppState } from "../app/state.js";
import { setComponents } from "../app/actions/context.js";
import type { AppComponents } from "./App.js";
import type { RoomInfo } from "../ipc/types.js";

// The mute button must reflect the *push rule* (carried on RoomInfo by the
// backend), not the local `mute_rooms` list — which only records mutes this
// device tried to set and so misses mutes made from another client. The local
// list survives as the fallback for a room the store hasn't got yet. Ported
// from RoomInfoDialog.test.ts, whose dialog this replaces (#92).
const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  muteRoom: vi.fn(),
  unmuteRoom: vi.fn(),
}));

vi.mock("../app/notifications.js", () => mocks);
vi.mock("../ipc/room_settings.js", () => ({
  getPowerLevels: vi.fn().mockResolvedValue({
    events: {}, users: {}, events_default: 0, state_default: 50,
    users_default: 0, kick: 50, ban: 50, invite: 50, redact: 50,
  }),
  setPowerLevels: vi.fn(),
  setRoomName: vi.fn(),
  setRoomTopic: vi.fn(),
  setRoomJoinRule: vi.fn(),
  setRoomHistoryVisibility: vi.fn(),
}));

const { RoomDialog } = await import("./RoomDialog.js");

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
  } as RoomInfo;
}

type Dialog = InstanceType<typeof RoomDialog>;

const tabLabels = (d: Dialog): string[] =>
  Array.from(d.getElement().querySelectorAll<HTMLElement>(".settings-dialog__tab"))
    .map((el) => el.textContent ?? "");

const activeTab = (d: Dialog): string =>
  d.getElement().querySelector<HTMLElement>(".settings-dialog__tab--active")?.textContent ?? "";

const text = (d: Dialog): string =>
  d.getElement().querySelector<HTMLElement>(".settings-dialog__content")?.textContent ?? "";

function muteButton(d: Dialog): HTMLButtonElement {
  const btns = Array.from(
    d.getElement().querySelectorAll<HTMLButtonElement>(".settings-dialog__btn"),
  );
  const btn = btns.find((b) => b.textContent === "[mute room]" || b.textContent === "[unmute room]");
  if (!btn) throw new Error(`mute button not found; saw: ${btns.map((b) => b.textContent).join(", ")}`);
  return btn;
}

let d: Dialog;
/**
 * Muting repaints the room-list row in place, so the action layer needs its
 * components. Without this the mute path threw behind the Info tab's catch and
 * these tests passed on the cache patch alone, never seeing the button.
 */
const roomList = { updateRoomMuted: vi.fn() };

beforeEach(() => {
  setComponents({ roomList } as unknown as AppComponents);
  roomList.updateRoomMuted.mockReset();
  mocks.getConfig.mockReset();
  // muteRoom/unmuteRoom resolve with the backend's MuteOutcome — they resolve
  // on a *failed* rule write too, which is the whole point of the flag (#82).
  mocks.muteRoom.mockReset().mockResolvedValue({ synced: true, warning: null });
  mocks.unmuteRoom.mockReset().mockResolvedValue({ synced: true, warning: null });
  mocks.getConfig.mockResolvedValue({
    enabled: true, show_body: true, show_sender: true, mute_rooms: [],
    background_sync: false, push_enabled: false, push_gateway_override: null,
  });
  AppState.set("currentRoomId", "!r:x");
  AppState.set("roomListCache", [makeRoom()]);
  d = new RoomDialog();
  document.body.appendChild(d.getElement());
});

afterEach(() => {
  d.getElement().remove();
  AppState.set("roomListCache", []);
  AppState.set("currentRoomId", null);
});

describe("RoomDialog", () => {
  it("collapses room info and settings into one tabbed dialog (#92)", () => {
    d.show();
    expect(tabLabels(d)).toEqual(["Info", "Settings", "Members", "Permissions"]);
  });

  // `:info` and `:roomsettings` are now two doors into the same dialog.
  it("lands on the tab the caller asked for", () => {
    d.show("info");
    expect(activeTab(d)).toBe("Info");
    d.hide();
    d.show("settings");
    expect(activeTab(d)).toBe("Settings");
  });

  it("falls back to the first tab for an unknown tab id", () => {
    d.show("nonsense");
    expect(activeTab(d)).toBe("Info");
  });

  it("states the read-only facts once, on Info", async () => {
    AppState.set("roomListCache", [makeRoom({ name: "General", is_encrypted: true })]);
    d.show("info");
    await vi.waitFor(() => expect(text(d)).toContain("General"));
    expect(text(d)).toContain("!r:x");
    expect(text(d)).toContain("encrypted");
  });

  // Said once by the host rather than by each tab builder repeating the check,
  // which is what the old dialog did in three places.
  it("reports having no room once, not per tab", () => {
    AppState.set("currentRoomId", null);
    d.show();
    expect(text(d)).toBe("No room selected.");
  });

  // Tab builders are async — Info awaits the notification config to resolve the
  // mute state — so a build suspended at an `await` when the user switches tabs
  // used to resume and append its rows into the element now showing a different
  // tab: open on Info before getConfig() had cached, press Tab, and Info's
  // Notifications and Actions rows appeared inside Settings.
  it("does not let a suspended tab build append into the tab that replaced it", async () => {
    // Info can only suspend when the cache has no answer for it, which is what
    // sends resolveMuted to getConfig.
    AppState.set("roomListCache", [makeRoom({ muted: undefined })]);
    let releaseConfig: () => void = () => {};
    mocks.getConfig.mockReturnValue(
      new Promise((resolve) => {
        releaseConfig = () => resolve({ mute_rooms: [] });
      }),
    );

    d.show("info");
    await vi.waitFor(() => expect(mocks.getConfig).toHaveBeenCalled());
    // The element Info's build captured, held so the assertion can wait for that
    // build to finish rather than racing it.
    const captured = d.getElement().querySelector<HTMLElement>(".settings-dialog__content")!;

    d.getElement().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
    );
    expect(activeTab(d)).toBe("Settings");

    releaseConfig();
    // Info's build has now resumed and written its rows into the element it
    // captured. That element must no longer be the one on screen.
    await vi.waitFor(() => expect(captured.textContent).toContain("mute room"));
    expect(captured.isConnected).toBe(false);
    expect(text(d)).not.toContain("mute room");
    expect(text(d)).not.toContain("leave room");
  });
});

describe("RoomDialog mute state", () => {
  it("offers unmute when the room's push rule mutes it, without reading the local list", async () => {
    AppState.set("roomListCache", [makeRoom({ muted: true })]);
    d.show("info");
    await vi.waitFor(() => expect(muteButton(d).textContent).toBe("[unmute room]"));
    expect(mocks.getConfig).not.toHaveBeenCalled();
  });

  it("offers mute when the push rule says unmuted even if the local list still lists the room", async () => {
    mocks.getConfig.mockResolvedValue({ mute_rooms: ["!r:x"] });
    AppState.set("roomListCache", [makeRoom({ muted: false })]);
    d.show("info");
    await vi.waitFor(() => expect(muteButton(d).textContent).toBe("[mute room]"));
  });

  it("falls back to the local mute list when the room isn't in the cache", async () => {
    mocks.getConfig.mockResolvedValue({ mute_rooms: ["!r:x"] });
    AppState.set("roomListCache", []);
    d.show("info");
    await vi.waitFor(() => expect(mocks.getConfig).toHaveBeenCalled());
    await vi.waitFor(() => expect(muteButton(d).textContent).toBe("[unmute room]"));
  });

  it("mutes through the push-rule command and patches the cached room", async () => {
    d.show("info");
    await vi.waitFor(() => muteButton(d));
    muteButton(d).click();
    await vi.waitFor(() => expect(mocks.muteRoom).toHaveBeenCalledWith("!r:x"));
    await vi.waitFor(() => expect(AppState.get("roomListCache")[0].muted).toBe(true));
    // The row in the room list is repainted too — the context menus used to skip
    // this and leave a muted room styled as unmuted.
    expect(roomList.updateRoomMuted).toHaveBeenCalledWith("!r:x", true);
    await vi.waitFor(() => expect(muteButton(d).textContent).toBe("[unmute room]"));
  });

  it("unmutes a room the push rule reports as muted", async () => {
    AppState.set("roomListCache", [makeRoom({ muted: true })]);
    d.show("info");
    await vi.waitFor(() => muteButton(d));
    muteButton(d).click();
    await vi.waitFor(() => expect(mocks.unmuteRoom).toHaveBeenCalledWith("!r:x"));
    await vi.waitFor(() => expect(AppState.get("roomListCache")[0].muted).toBe(false));
  });

  // With the homeserver unreachable the rule write fails but the promise still
  // resolves. Patching the cache on that left the room list and a reopened
  // dialog both reporting a mute the account's ruleset never got — until the
  // next get_rooms silently flipped it back (#82).
  it("leaves the cached room alone when the mute never reached the server", async () => {
    mocks.muteRoom.mockResolvedValue({
      synced: false,
      warning: "Homeserver unreachable; muted on this device only",
    });
    d.show("info");
    await vi.waitFor(() => muteButton(d));
    muteButton(d).click();
    await vi.waitFor(() => expect(mocks.muteRoom).toHaveBeenCalledWith("!r:x"));
    expect(AppState.get("roomListCache")[0].muted).toBe(false);
    expect(roomList.updateRoomMuted).not.toHaveBeenCalled();
    expect(muteButton(d).textContent).toBe("[mute room]");
  });

  it("leaves the cached room alone when the unmute never reached the server", async () => {
    mocks.unmuteRoom.mockResolvedValue({ synced: false, warning: "Homeserver unreachable" });
    AppState.set("roomListCache", [makeRoom({ muted: true })]);
    d.show("info");
    await vi.waitFor(() => muteButton(d));
    muteButton(d).click();
    await vi.waitFor(() => expect(mocks.unmuteRoom).toHaveBeenCalledWith("!r:x"));
    expect(AppState.get("roomListCache")[0].muted).toBe(true);
  });
});
