import { describe, it, expect, beforeEach, vi } from "vitest";
import type { EditablePack, RoomPacks } from "../../ipc/types.js";
import type { RoomTabContext } from "../room/types.js";
import { makeControls } from "../settings/controls.js";

// The Emoji tab (#12): a room's — or a space's — packs, in the room dialog and
// in space settings.

const ipc = vi.hoisted(() => ({
  getRoomPacks: vi.fn<(roomId: string) => Promise<RoomPacks>>(),
  createRoomPack: vi.fn(),
}));
vi.mock("../../ipc/index.js", async (orig) => ({ ...(await orig<object>()), ...ipc }));

import { packsTab } from "./packs_tab.js";

function pack(key: string, name: string): EditablePack {
  return {
    room_id: "!r:x", state_key: key, display_name: name, avatar_url: null, usage: null,
    images: [{ shortcode: `${key}1`, url: "data:image/png;base64,AA", body: null, usage: null }],
    favorited: false, read_only: false,
  };
}

let refresh: ReturnType<typeof vi.fn>;

async function build(subject: "room" | "space" = "room"): Promise<HTMLElement> {
  const content = document.createElement("div");
  document.body.replaceChildren(content);
  refresh = vi.fn();
  const ctx: RoomTabContext = {
    content,
    controls: makeControls(),
    roomId: "!r:x",
    room: undefined,
    isMobile: false,
    close: vi.fn(),
    dispatch: vi.fn(),
    refresh,
    subject,
  };
  await packsTab.build(ctx);
  return content;
}

beforeEach(() => {
  ipc.getRoomPacks.mockReset();
  ipc.createRoomPack.mockReset();
});

describe("packsTab", () => {
  it("is the Emoji tab", () => {
    expect(packsTab.id).toBe("emoji");
    expect(packsTab.label).toBe("Emoji");
  });

  it("shows an editor per pack and a way to make a new one", async () => {
    ipc.getRoomPacks.mockResolvedValue({ can_edit: true, packs: [pack("", "Main"), pack("blobs", "Blobs")] });
    const el = await build();
    expect(ipc.getRoomPacks).toHaveBeenCalledWith("!r:x");
    expect(el.querySelectorAll(".pack-editor")).toHaveLength(2);
    expect(el.querySelector(".packs-tab__new input")).not.toBeNull();
  });

  it("shows packs read-only, and no new-pack field, without the power to change them", async () => {
    ipc.getRoomPacks.mockResolvedValue({ can_edit: false, packs: [pack("", "Main")] });
    const el = await build();
    expect(el.querySelectorAll(".pack-editor")).toHaveLength(1);
    expect(el.querySelector(".pack-editor__add")).toBeNull();
    expect(el.querySelector(".packs-tab__new")).toBeNull();
  });

  it("says so when there are no packs and none can be made", async () => {
    ipc.getRoomPacks.mockResolvedValue({ can_edit: false, packs: [] });
    const el = await build("space");
    expect(el.textContent).toContain("This space has no packs.");
  });

  it("creates a pack from the new-pack field, then rebuilds the tab", async () => {
    ipc.getRoomPacks.mockResolvedValue({ can_edit: true, packs: [] });
    ipc.createRoomPack.mockResolvedValue(pack("blobs", "Blobs"));
    const el = await build();
    const field = el.querySelector<HTMLInputElement>(".packs-tab__new input")!;
    field.value = "Blobs";
    field.dispatchEvent(new Event("input"));
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(ipc.createRoomPack).toHaveBeenCalledWith("!r:x", "Blobs");
  });

  // Review fix: the field committed on blur, and closing the dialog blurs it —
  // so a name typed and abandoned created a pack every member could see.
  it("creates nothing from a name left in the field when focus leaves it", async () => {
    ipc.getRoomPacks.mockResolvedValue({ can_edit: true, packs: [] });
    const el = await build();
    const field = el.querySelector<HTMLInputElement>(".packs-tab__new input")!;
    field.focus();
    field.value = "Blobs";
    field.dispatchEvent(new Event("input"));
    field.blur();
    field.dispatchEvent(new Event("blur"));
    await new Promise((r) => setTimeout(r, 0));
    expect(ipc.createRoomPack).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reports a failure to load the packs", async () => {
    ipc.getRoomPacks.mockRejectedValue(new Error("You are not in this room"));
    const el = await build();
    expect(el.textContent).toContain("You are not in this room");
  });
});
