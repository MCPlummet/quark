import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EditablePack, FavoritePack } from "../../../ipc/types.js";

// Settings → Emoji (#12): the autocomplete settings, then the personal pack,
// then the favorited packs.

const ipc = vi.hoisted(() => ({
  getUserPack: vi.fn<() => Promise<EditablePack>>(),
  getFavoritePacks: vi.fn<() => Promise<FavoritePack[]>>(),
  setPackFavorite: vi.fn(async () => undefined),
}));
vi.mock("../../../ipc/index.js", async (orig) => ({ ...(await orig<object>()), ...ipc }));
vi.mock("../../../ipc/app_config.js", async (orig) => {
  const actual = await orig<typeof import("../../../ipc/app_config.js")>();
  return { ...actual, getAppConfig: vi.fn(async () => structuredClone(actual.DEFAULT_APP_CONFIG)), setAppConfig: vi.fn() };
});

import { emojiTab } from "./emoji.js";
import { makeControls } from "../controls.js";

const USER_PACK: EditablePack = {
  room_id: null, state_key: null, display_name: "Mine", avatar_url: null, usage: null,
  images: [{ shortcode: "myblob", url: "data:image/png;base64,AA", body: null, usage: null }],
  favorited: false, read_only: false,
};

function favorite(over: Partial<FavoritePack> = {}): FavoritePack {
  return {
    room_id: "!r:x", state_key: "", room_name: "general", joined: true,
    display_name: "Stickers", avatar_url: null, image_count: 3, ...over,
  };
}

async function render(): Promise<HTMLElement> {
  const content = document.createElement("div");
  document.body.replaceChildren(content);
  await emojiTab.build({ content, controls: makeControls(), isMobile: false, close: vi.fn(), dispatch: vi.fn() });
  await vi.waitFor(() => expect(content.querySelector(".emoji-settings__favorites")).not.toBeNull());
  return content;
}

const titles = (el: HTMLElement) =>
  [...el.querySelectorAll(".settings-dialog__section-title")].map((t) => t.textContent);

beforeEach(() => {
  ipc.getUserPack.mockReset();
  ipc.getUserPack.mockResolvedValue(USER_PACK);
  ipc.getFavoritePacks.mockReset();
  ipc.getFavoritePacks.mockResolvedValue([favorite()]);
  ipc.setPackFavorite.mockClear();
});

describe("Settings → Emoji", () => {
  it("shows autocomplete, then your pack, then favorites", async () => {
    const el = await render();
    expect(titles(el)).toEqual(["Emoji Autocomplete", "Your pack", "Favorite packs"]);
  });

  it("edits the personal pack in an editor", async () => {
    const el = await render();
    expect(el.querySelector(".emoji-settings__user-pack .pack-editor__cell[data-shortcode='myblob']")).not.toBeNull();
    // Personal packs aren't favorited: they are already usable everywhere.
    expect(el.querySelector(".emoji-settings__user-pack .pack-editor__favorite")).toBeNull();
  });

  // Review fix (spec decision 6): images in the legacy { packs } form are
  // shown apart and read-only; the personal pack itself stays editable.
  it("shows legacy-format images apart, read-only, and keeps your pack editable", async () => {
    ipc.getUserPack.mockResolvedValue({
      ...USER_PACK,
      images: [],
      legacy_images: [{ shortcode: "oldblob", url: "data:image/png;base64,AA", body: null, usage: null }],
    });
    const el = await render();
    const editors = [...el.querySelectorAll(".emoji-settings__user-pack .pack-editor")];
    expect(editors).toHaveLength(2);
    expect(editors[0].querySelector(".pack-editor__add")).not.toBeNull();
    expect(editors[1].querySelector(".pack-editor__cell[data-shortcode='oldblob']")).not.toBeNull();
    expect(editors[1].querySelector(".pack-editor__add")).toBeNull();
    expect(el.querySelector(".emoji-settings__user-pack")!.textContent).toMatch(/older format/i);
  });

  it("lists a favorite from a room you left as not joined", async () => {
    ipc.getFavoritePacks.mockResolvedValue([favorite({ joined: false, room_name: null, room_id: "!gone:x", display_name: null, image_count: 0 })]);
    const el = await render();
    const row = el.querySelector(".favorite-packs__row")!;
    expect(row.textContent).toContain("!gone:x");
    expect(row.textContent).toContain("not joined");
  });

  it("removes a favorite", async () => {
    const el = await render();
    el.querySelector<HTMLButtonElement>(".favorite-packs__remove")!.click();
    await vi.waitFor(() => expect(el.querySelector(".favorite-packs__row")).toBeNull());
    expect(ipc.setPackFavorite).toHaveBeenCalledWith("!r:x", "", false);
  });

  it("says how to add one when there are none", async () => {
    ipc.getFavoritePacks.mockResolvedValue([]);
    const el = await render();
    expect(el.querySelector(".emoji-settings__favorites")!.textContent).toContain("No favorite packs");
  });
});
