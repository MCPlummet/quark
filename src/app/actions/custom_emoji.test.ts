import { describe, it, expect, beforeEach, vi } from "vitest";
import type { EmojiPack } from "../../ipc/types.js";

// The one custom-emoji loader behind both picker contexts and `:shortcode`
// autocomplete. Each used to read the packs on its own.

const getEmojiPacks = vi.fn<(roomId?: string) => Promise<EmojiPack[]>>();
const getThumbnail = vi.fn(async () => ({ data_base64: "SU1H", mime_type: "image/png", filename: null }));
vi.mock("../../ipc/index.js", () => ({
  getEmojiPacks: (roomId?: string) => getEmojiPacks(roomId),
  getThumbnail: (...a: unknown[]) => getThumbnail(...(a as [])),
}));

import {
  loadCustomEmoji,
  customEmojiImage,
  cachedCustomEmoji,
  _resetCustomEmojiCache,
  invalidateCustomEmoji,
  customEmojiVersion,
} from "./custom_emoji.js";
import { _emojiImageCache, _shortcodeToMxcByRoom, customEmojiMxc, _downloadInlineEmoji } from "./context.js";

const PACK: EmojiPack = {
  pack_id: "blobs",
  display_name: null,
  avatar_url: null,
  source: "room",
  room_id: "!r:x",
  emojis: [
    { shortcode: "blob", url: "mxc://x/blob", body: "Blob", usage: ["emoticon"] },
    { shortcode: "both", url: "mxc://x/both", body: null, usage: ["emoticon", "sticker"] },
    { shortcode: "stk", url: "mxc://x/stk", body: null, usage: ["sticker"] },
    { shortcode: "web", url: "https://example.org/web.png", body: null, usage: ["emoticon"] },
  ],
};

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  _resetCustomEmojiCache();
  _emojiImageCache.clear();
  _shortcodeToMxcByRoom.clear();
  getEmojiPacks.mockReset();
  getEmojiPacks.mockResolvedValue([PACK]);
  getThumbnail.mockClear();
});

describe("loadCustomEmoji", () => {
  it("reports the cached packs at once, then the fresh ones, emoticons only", async () => {
    const seen: string[][] = [];
    const packs = await loadCustomEmoji("!r:x", { onPacks: (p) => seen.push(p.flatMap((x) => x.emojis.map((e) => e.shortcode))) });
    expect(seen).toEqual([[], ["blob", "both", "web"]]);
    expect(packs[0].name).toBe("blobs"); // display_name falls back to the pack id
  });

  it("records each emoticon's mxc so a typed :shortcode: can be sent as an image", async () => {
    await loadCustomEmoji("!r:x", { onPacks: () => {} });
    expect(customEmojiMxc("!r:x", "blob")).toBe("mxc://x/blob");
    expect(customEmojiMxc("!r:x", "stk")).toBeUndefined();
    expect(customEmojiMxc("!r:x", "web")).toBeUndefined();
  });

  // #12: packs arrive in precedence order (room, spaces, personal, favorites);
  // the pickers list a shared shortcode once — the winner — so what is picked
  // is what a typed :shortcode: sends.
  it("lets the first pack win a shortcode two packs share", async () => {
    getEmojiPacks.mockResolvedValue([
      { ...PACK, pack_id: "room", emojis: [{ shortcode: "blob", url: "mxc://x/room-blob", body: null, usage: ["emoticon"] }] },
      { ...PACK, pack_id: "fav", emojis: [
        { shortcode: "blob", url: "mxc://x/fav-blob", body: null, usage: ["emoticon"] },
        { shortcode: "only", url: "mxc://x/only", body: null, usage: ["emoticon"] },
      ] },
    ]);
    const packs = await loadCustomEmoji("!r:x", { onPacks: () => {} });
    const listed = packs.flatMap((p) => p.emojis.map((e) => `${p.id}:${e.shortcode}`));
    expect(listed).toEqual(["room:blob", "fav:only"]);
    expect(customEmojiMxc("!r:x", "blob")).toBe("mxc://x/room-blob");
  });

  it("replaces a room's shortcodes on reload, so a removed one stops resolving", async () => {
    await loadCustomEmoji("!r:x", { onPacks: () => {} });
    getEmojiPacks.mockResolvedValue([{ ...PACK, emojis: [] }]);
    await loadCustomEmoji("!r:x", { onPacks: () => {} });
    expect(customEmojiMxc("!r:x", "blob")).toBeUndefined();
  });

  // Review fix: every edit reloads; a slower, older load used to land last and
  // put back the packs as they were before the edit.
  it("keeps a slower, older load from overwriting a newer one", async () => {
    let finishOld!: (p: EmojiPack[]) => void;
    getEmojiPacks.mockReturnValueOnce(new Promise((r) => { finishOld = r; }));
    const oldLoad = loadCustomEmoji("!r:x", { onPacks: () => {} });
    getEmojiPacks.mockResolvedValueOnce([{ ...PACK, emojis: [{ shortcode: "new", url: "mxc://x/new", body: null, usage: ["emoticon"] }] }]);
    await loadCustomEmoji("!r:x", { onPacks: () => {} });
    const heard: string[][] = [];
    finishOld([{ ...PACK, emojis: [{ shortcode: "old", url: "mxc://x/old", body: null, usage: ["emoticon"] }] }]);
    await oldLoad;
    expect(customEmojiMxc("!r:x", "new")).toBe("mxc://x/new");
    expect(customEmojiMxc("!r:x", "old")).toBeUndefined();
    expect(cachedCustomEmoji("!r:x").flatMap((p) => p.emojis.map((e) => e.shortcode))).toEqual(["new"]);
    expect(heard).toEqual([]);
  });

  it("invalidateCustomEmoji drops cached packs and bumps the version", async () => {
    await loadCustomEmoji("!r:x", { onPacks: () => {} });
    const before = customEmojiVersion();
    invalidateCustomEmoji();
    expect(cachedCustomEmoji("!r:x")).toEqual([]);
    expect(customEmojiVersion()).toBe(before + 1);
  });

  it("fetches each thumbnail once, even for loads that overlap, and reports it", async () => {
    const images: Array<[string, string]> = [];
    await Promise.all([
      loadCustomEmoji("!r:x", { onPacks: () => {}, onImage: (u, i) => images.push([u, i]) }),
      loadCustomEmoji("!r:x", { onPacks: () => {} }),
    ]);
    await flush();
    expect(getThumbnail).toHaveBeenCalledTimes(2); // blob, both — never the https one
    expect(images.map(([u]) => u).sort()).toEqual(["mxc://x/blob", "mxc://x/both"]);
    expect(customEmojiImage("mxc://x/blob")).toBe("data:image/png;base64,SU1H");
  });

  // The timeline's inline emoji and reaction chips used to download through
  // their own copies of this, so an emoji the picker was already fetching was
  // fetched again for the message that showed it.
  it("shares each download with the timeline's inline emoji", async () => {
    const resolved: string[] = [];
    const host = {
      getPendingInlineEmojiUrls: () => ["mxc://x/blob"],
      resolveInlineEmoji: (mxc: string) => resolved.push(mxc),
    };
    const load = loadCustomEmoji("!r:x", { onPacks: () => {} });
    await flush(); // the packs have arrived; the picker's downloads are in flight
    _downloadInlineEmoji(host);
    await load;
    await flush();
    expect(getThumbnail.mock.calls.filter((c) => (c as unknown[])[0] === "mxc://x/blob")).toHaveLength(1);
    expect(resolved).toEqual(["mxc://x/blob"]);
  });

  it("hands over resolved images with the packs on the next load", async () => {
    await loadCustomEmoji("!r:x", { onPacks: () => {} });
    await flush();
    const first = cachedCustomEmoji("!r:x")[0].emojis;
    expect(first.find((e) => e.shortcode === "blob")?.imageUrl).toBe("data:image/png;base64,SU1H");
    expect(first.find((e) => e.shortcode === "web")?.imageUrl).toBe("https://example.org/web.png");
  });

  it("keeps the cached packs when a reload fails", async () => {
    await loadCustomEmoji("!r:x", { onPacks: () => {} });
    getEmojiPacks.mockRejectedValueOnce(new Error("offline"));
    const packs = await loadCustomEmoji("!r:x", { onPacks: () => {} });
    expect(packs).toHaveLength(1);
  });

  // Review fix: the per-room maps fill only when a room's load lands, so a
  // `:mine:` from the personal pack sent right after switching to a room not
  // opened yet went out as text — it used to resolve through one app-wide map.
  describe("in a room whose packs have not loaded yet", () => {
    const one = (pack_id: string, shortcode: string, over: Partial<EmojiPack> = {}): EmojiPack => ({
      ...PACK,
      pack_id,
      emojis: [{ shortcode, url: `mxc://x/${pack_id}-${shortcode}`, body: null, usage: ["emoticon"] }],
      ...over,
    });
    const roomA = [
      one("a-room", "roomblob", { scope: "room" }),
      one("a-space", "spaceblob", { scope: "space" }),
      one("a-fav-room", "favroom", { scope: "room", favorited: true }),
      one("user_default", "mine", { source: "user", room_id: null, scope: "user" }),
      one("fav", "fav", { scope: "favorite", favorited: true }),
    ];

    it("resolves the personal pack and favorites, never another room's or space's packs", async () => {
      getEmojiPacks.mockResolvedValue(roomA);
      await loadCustomEmoji("!a:x", { onPacks: () => {} });
      expect(customEmojiMxc("!b:x", "mine")).toBe("mxc://x/user_default-mine");
      expect(customEmojiMxc("!b:x", "fav")).toBe("mxc://x/fav-fav");
      expect(customEmojiMxc("!b:x", "favroom")).toBe("mxc://x/a-fav-room-favroom");
      expect(customEmojiMxc("!b:x", "roomblob")).toBeUndefined();
      expect(customEmojiMxc("!b:x", "spaceblob")).toBeUndefined();
    });

    it("resolves them while the room's own load is still in flight", async () => {
      getEmojiPacks.mockResolvedValueOnce(roomA);
      await loadCustomEmoji("!a:x", { onPacks: () => {} });
      getEmojiPacks.mockReturnValueOnce(new Promise(() => {}));
      void loadCustomEmoji("!b:x", { onPacks: () => {} });
      expect(customEmojiMxc("!b:x", "mine")).toBe("mxc://x/user_default-mine");
    });

    it("lets the room's own map decide once it has loaded", async () => {
      getEmojiPacks.mockResolvedValueOnce(roomA);
      await loadCustomEmoji("!a:x", { onPacks: () => {} });
      getEmojiPacks.mockResolvedValueOnce([one("b-room", "mine", { scope: "room" }), one("user_default", "mine", { source: "user" })]);
      await loadCustomEmoji("!b:x", { onPacks: () => {} });
      expect(customEmojiMxc("!b:x", "mine")).toBe("mxc://x/b-room-mine");
      expect(customEmojiMxc("!b:x", "fav")).toBeUndefined(); // not in the room's answer
    });

    it("believes the newest load of any room about the personal pack", async () => {
      let finishOld!: (p: EmojiPack[]) => void;
      getEmojiPacks.mockReturnValueOnce(new Promise((r) => { finishOld = r; }));
      const old = loadCustomEmoji("!a:x", { onPacks: () => {} });
      getEmojiPacks.mockResolvedValueOnce([one("user_default", "renamed", { source: "user" })]);
      await loadCustomEmoji("!c:x", { onPacks: () => {} });
      finishOld([one("user_default", "mine", { source: "user" })]);
      await old;
      expect(customEmojiMxc("!b:x", "renamed")).toBe("mxc://x/user_default-renamed");
      expect(customEmojiMxc("!b:x", "mine")).toBeUndefined();
    });
  });

  it("caches per room", async () => {
    await loadCustomEmoji("!r:x", { onPacks: () => {} });
    expect(cachedCustomEmoji("!other:x")).toEqual([]);
    expect(cachedCustomEmoji("!r:x")).toHaveLength(1);
  });
});
