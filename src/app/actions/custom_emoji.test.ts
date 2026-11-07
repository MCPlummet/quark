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

import { loadCustomEmoji, customEmojiImage, cachedCustomEmoji, _resetCustomEmojiCache } from "./custom_emoji.js";
import { _emojiImageCache, _shortcodeToMxc, _downloadInlineEmoji } from "./context.js";

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
  _shortcodeToMxc.clear();
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
    expect(_shortcodeToMxc.get("blob")).toBe("mxc://x/blob");
    expect(_shortcodeToMxc.has("stk")).toBe(false);
    expect(_shortcodeToMxc.has("web")).toBe(false);
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

  it("caches per room", async () => {
    await loadCustomEmoji("!r:x", { onPacks: () => {} });
    expect(cachedCustomEmoji("!other:x")).toEqual([]);
    expect(cachedCustomEmoji("!r:x")).toHaveLength(1);
  });
});
