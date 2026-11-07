import { describe, it, expect } from "vitest";
import {
  buildSections,
  browseEntries,
  composeInsertion,
  COMMON_EMOJI,
  COMMON_SECTION_ID,
  customPacksSignature,
  queryTokens,
  reactionKey,
  searchEmoji,
  stripVariationSelectors,
  type CustomEmojiPack,
} from "./emoji_catalog.js";
import { EMOJI_CATEGORIES } from "../data/unicode-emoji.js";

const PACKS: CustomEmojiPack[] = [
  {
    id: "blobs",
    name: "Blobs",
    emojis: [
      { shortcode: "PartyBlob", url: "mxc://x/party", body: "Party blob" },
      { shortcode: "blobcat", url: "mxc://x/cat", body: null, imageUrl: "data:image/png;base64,AA" },
    ],
  },
  { id: "empty", name: "Empty", emojis: [] },
];

const glyphs = (entries: { glyph?: string; shortcode: string }[]) => entries.map((e) => e.glyph ?? `:${e.shortcode}:`);
const bare = (g: string) => stripVariationSelectors(g);

describe("sections", () => {
  it("orders common emoji, then custom packs, then the built-in categories", () => {
    const ids = buildSections(PACKS).map((s) => s.id);
    expect(ids).toEqual([COMMON_SECTION_ID, "pack:blobs", ...EMOJI_CATEGORIES.map((c) => c.id)]);
  });

  it("skips a pack with no emoji", () => {
    expect(buildSections(PACKS).some((s) => s.id === "pack:empty")).toBe(false);
  });

  it("pins the common emoji in their stated order", () => {
    const common = buildSections([])[0];
    expect(common.entries.map((e) => bare(e.glyph!))).toEqual(COMMON_EMOJI.map(bare));
  });

  // The flat BUILTIN_EMOJI list has a row per alias (👍 three times); the
  // picker must list each glyph once.
  it("lists each built-in glyph once across all categories", () => {
    const builtins = buildSections([]).slice(1).flatMap((s) => s.entries);
    const seen = new Set(builtins.map((e) => e.id));
    expect(seen.size).toBe(builtins.length);
    const total = EMOJI_CATEGORIES.reduce((n, c) => n + c.entries.length, 0);
    expect(builtins.length).toBeLessThanOrEqual(total);
  });

  it("keeps the primary shortcode, aliases and keywords on each entry", () => {
    const thumbs = buildSections([])[0].entries[0];
    expect(thumbs.shortcode).toBe("+1");
    expect(thumbs.aliases).toEqual(expect.arrayContaining(["thumbsup"]));
    expect(thumbs.keywords).toEqual(expect.arrayContaining(["like"]));
  });

  it("gives a custom pack its first emoji as its category icon", () => {
    const pack = buildSections(PACKS)[1];
    expect(pack.iconUrl).toBe("mxc://x/party");
    expect(pack.entries.map((e) => e.id)).toEqual(["custom:blobs:PartyBlob", "custom:blobs:blobcat"]);
    expect(pack.entries[1].imageUrl).toBe("data:image/png;base64,AA");
  });

  it("lists the common emoji twice in the browse view: pinned and at home", () => {
    const entries = browseEntries(buildSections([]));
    expect(entries.filter((e) => e.shortcode === "+1")).toHaveLength(2);
  });

  it("signs packs by content, not by resolved image", () => {
    const resolved = PACKS.map((p) => ({ ...p, emojis: p.emojis.map((e) => ({ ...e, imageUrl: "data:x" })) }));
    expect(customPacksSignature(resolved)).toBe(customPacksSignature(PACKS));
    expect(customPacksSignature([])).not.toBe(customPacksSignature(PACKS));
  });
});

describe("search", () => {
  const sections = buildSections(PACKS);
  const search = (q: string) => searchEmoji(sections, q);

  it("finds nothing for an empty query", () => {
    expect(search("")).toEqual([]);
    expect(search("  :  ")).toEqual([]);
  });

  it("matches aliases, which the reaction picker never did", () => {
    expect(bare(search("thumbsup")[0].glyph!)).toBe(bare("👍"));
    expect(bare(search("+1")[0].glyph!)).toBe(bare("👍"));
  });

  it("matches CLDR keywords, which the reaction picker never did", () => {
    expect(glyphs(search("hooray")).map(bare)).toContain(bare("🎉"));
  });

  it("ranks an exact shortcode above prefix and keyword matches", () => {
    expect(search("joy")[0].glyph).toBe("😂");
    expect(search("heart")[0].shortcode).toBe("heart");
  });

  it("ranks an exact keyword above a longer name it starts", () => {
    const lol = glyphs(search("lol"));
    expect(lol.indexOf("😂")).toBeLessThan(lol.indexOf("🍭"));
    expect(search("sad")[0].glyph).toBe("😢");
  });

  it("matches keywords by prefix, not anywhere inside them", () => {
    // "communicate"-style hits made `cat` noisy; a keyword must start with it.
    for (const e of search("cat")) {
      const names = [e.shortcode, ...e.aliases].map((n) => n.toLowerCase());
      const named = names.some((n) => n.includes("cat"));
      const keyword = e.keywords.some((k) => k.startsWith("cat"));
      expect(named || keyword).toBe(true);
    }
  });

  it("ignores variation selectors on either side", () => {
    expect(search("👍")[0].id).toBe(bare("👍"));
    expect(search("👍️")[0].id).toBe(bare("👍"));
    expect(search("❤")[0].shortcode).toBe("heart");
  });

  it("drops the colons of a typed :shortcode: and a habitual leading slash", () => {
    expect(search(":joy:")[0].glyph).toBe("😂");
    expect(search("/joy")[0].glyph).toBe("😂");
    expect(queryTokens(" :Red Heart: ")).toEqual(["red", "heart"]);
    expect(queryTokens(":+1:")).toEqual(["+1"]);
    expect(queryTokens(":-1")).toEqual(["-1"]);
    // A shortcode being typed still searches from its first letter.
    expect(queryTokens(":d")).toEqual(["d"]);
    // A lone colon or slash is the start of a query, not a term.
    expect(queryTokens(":")).toEqual([]);
    expect(queryTokens("/")).toEqual([]);
  });

  // People react with emoticons as text. Stripped of their colons they were a
  // one-letter search (`:D` → a face starting with "d") or no search at all.
  it("keeps an emoticon's colons, so it matches nothing and is sent as typed", () => {
    for (const emoticon of [":D", ":P", ":O", ":3", ":/", ":)", ":(", ":-)", ":-D", ":-P", ":'(", "D:"]) {
      expect(queryTokens(emoticon)).toEqual([emoticon.toLowerCase()]);
      expect(search(emoticon)).toEqual([]);
    }
  });

  it("requires every term to match", () => {
    const hits = search("red heart");
    expect(hits[0].shortcode).toBe("heart");
    for (const e of hits) {
      const text = [e.shortcode, ...e.aliases, ...e.keywords].join(" ").toLowerCase();
      expect(text).toContain("red");
      expect(text).toContain("heart");
    }
  });

  it("matches custom emoji case-insensitively, by shortcode and body", () => {
    expect(search("partyblob").map((e) => e.id)).toContain("custom:blobs:PartyBlob");
    expect(search("party blob")[0].id).toBe("custom:blobs:PartyBlob");
  });

  it("lists each emoji once though the browse view has the common ones twice", () => {
    const ids = search("thumb").map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("breaks ties in picker order: common emoji, then custom packs, then categories", () => {
    // `party` is an exact alias of 🎉 (common) and a prefix of :PartyBlob:.
    const ids = search("party").map((e) => e.id);
    expect(ids[0]).toBe(bare("🎉"));
    expect(ids.indexOf("custom:blobs:PartyBlob")).toBeGreaterThan(0);
  });
});

describe("what a pick produces", () => {
  const [common, blobs] = buildSections(PACKS);
  const thumbs = common.entries[0];
  const party = blobs.entries[0];

  it("reacts with the glyph exactly as the data carries it", () => {
    expect(reactionKey(thumbs)).toBe(thumbs.glyph);
  });

  it("reacts with a custom emoji's mxc URL (MSC2545)", () => {
    expect(reactionKey(party)).toBe("mxc://x/party");
  });

  it("falls back to :shortcode: for a custom emoji with no mxc source", () => {
    const [, local] = buildSections([{ id: "p", name: "P", emojis: [{ shortcode: "x", url: "data:image/png;base64,AA" }] }]);
    expect(reactionKey(local.entries[0])).toBe(":x:");
  });

  it("inserts the glyph, or a custom emoji's :shortcode: and a space", () => {
    expect(composeInsertion(thumbs)).toBe(thumbs.glyph);
    expect(composeInsertion(party)).toBe(":PartyBlob: ");
  });
});
