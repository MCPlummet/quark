import { describe, it, expect, beforeEach } from "vitest";
import {
  addPackImages,
  createRoomPack,
  getEmojiPacks,
  getFavoritePacks,
  getRoomPacks,
  getUserPack,
  renamePackImage,
  setPackFavorite,
} from "./index.js";
import { _resetMockPacks } from "./mock_packs.js";

// The pack IPC (#12) against the mock backend, which keeps the packs in memory
// so `pnpm dev` shows an edit in the pickers as the real backend would.

beforeEach(() => _resetMockPacks());

describe("pack IPC (mock mode)", () => {
  it("renames an image in the personal pack", async () => {
    const before = await getUserPack();
    const old = before.images[0].shortcode;
    await renamePackImage({ kind: "user" }, old, "renamed");
    const after = await getUserPack();
    expect(after.images.map((i) => i.shortcode)).toContain("renamed");
    expect(after.images.map((i) => i.shortcode)).not.toContain(old);
  });

  it("refuses to rename onto a shortcode the pack already has", async () => {
    const [a, b] = (await getUserPack()).images;
    await expect(renamePackImage({ kind: "user" }, a.shortcode, b.shortcode)).rejects.toThrow(/already/);
  });

  it("gives added images unique shortcodes", async () => {
    const res = await addPackImages({ kind: "user" }, [
      { url: "data:x", body: null, info: null, filename: "wave.png" },
      { url: "data:y", body: null, info: null, filename: "wave.png" },
    ]);
    expect(res.added).toEqual(["wave", "wave_2"]);
    expect(res.pack.images.map((i) => i.shortcode)).toEqual(expect.arrayContaining(["wave", "wave_2"]));
  });

  it("lists a pack once it is favorited", async () => {
    await createRoomPack("!dev:matrix.org", "Dev Pack");
    const { packs } = await getRoomPacks("!dev:matrix.org");
    const key = packs.find((p) => p.display_name === "Dev Pack")!.state_key!;
    await setPackFavorite("!dev:matrix.org", key, true);
    const favorites = await getFavoritePacks();
    expect(favorites.some((f) => f.room_id === "!dev:matrix.org" && f.state_key === key)).toBe(true);
  });

  it("shows an edit in the packs the pickers load", async () => {
    const old = (await getUserPack()).images[0].shortcode;
    await renamePackImage({ kind: "user" }, old, "fresh");
    const packs = await getEmojiPacks("!general:matrix.org");
    const shortcodes = packs.flatMap((p) => p.emojis.map((e) => e.shortcode));
    expect(shortcodes).toContain("fresh");
    expect(shortcodes).not.toContain(old);
  });

  it("offers a space's pack in the space's rooms, after the room's own", async () => {
    const packs = await getEmojiPacks("!general:matrix.org");
    const scopes = packs.map((p) => p.scope);
    expect(scopes).toContain("space");
    expect(scopes.indexOf("space")).toBeLessThan(scopes.indexOf("user"));
  });

  it("reports an empty, editable room", async () => {
    expect(await getRoomPacks("!random:matrix.org")).toEqual({ can_edit: true, packs: [] });
  });
});
