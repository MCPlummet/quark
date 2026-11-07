// The emoji model behind the emoji picker: what it lists, in what order, and
// what a search finds. Pure — no DOM, no IPC — so it can be tested whole.
//
// There used to be two of these. The compose picker built its entries in
// `actions/gif.ts` from EMOJI_CATEGORIES (keywords and aliases folded in, one
// category at a time, custom packs as their own categories), and the reaction
// picker built its own at module load inside QuickReactPicker.ts from
// BUILTIN_EMOJI — the autocomplete list, one row per alias — which is why it
// grew a glyph dedupe, never saw a keyword, and matched none of the aliases.
// Each improvement to the data landed in whichever copy its author was
// touching. This module is the only copy now: the picker renders exactly what
// it returns, whichever context opened it.

import { EMOJI_CATEGORIES } from "../data/unicode-emoji.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/** One pickable emoji: a Unicode glyph or an MSC2545 custom emoji. */
export interface PickerEmoji {
  /**
   * Stable identity. The glyph with variation selectors stripped for a
   * built-in, `custom:<pack>:<shortcode>` for a custom emoji.
   */
  id: string;
  /** The Unicode glyph, exactly as the data carries it. Built-in only. */
  glyph?: string;
  /** Primary shortcode, without colons. */
  shortcode: string;
  /** Alternate shortcodes (`+1`, `thumbsup` for 👍). */
  aliases: readonly string[];
  /** Lowercased search keywords (CLDR tags; a custom emoji's `body` words). */
  keywords: readonly string[];
  /** Custom only: the image's source, `mxc://` for any real pack. */
  url?: string;
  /** Custom only: a displayable image URL, once the thumbnail has resolved. */
  imageUrl?: string;
  /** Custom only: the pack it belongs to. */
  packId?: string;
}

/** A run of entries under one header and one category-bar button. */
export interface EmojiSection {
  id: string;
  name: string;
  /** Category-bar glyph. For a custom pack, shown until `iconUrl` resolves. */
  icon: string;
  /** Custom pack only: the emoji whose image stands for the pack. */
  iconUrl?: string;
  entries: PickerEmoji[];
}

/** A custom emoji as the pack loader delivers it. */
export interface CustomEmoji {
  shortcode: string;
  /** `mxc://` for a real pack; a pack may also store a plain URL. */
  url: string;
  body?: string | null;
  /** Displayable image, when the loader already has one. */
  imageUrl?: string;
}

/** An MSC2545 pack, reduced to its `emoticon` entries. */
export interface CustomEmojiPack {
  id: string;
  name: string;
  emojis: CustomEmoji[];
}

// ── Variation selectors ───────────────────────────────────────────────────────

// Many glyphs carry U+FE0F (VS16, "emoji presentation") and some keyboards add
// or drop it, so 👍 and 👍️ are one emoji. Everything that compares glyphs goes
// through this; what is *sent* is still the data's own form.
const VARIATION_SELECTOR_RE = /[︎️]/g;

export function stripVariationSelectors(s: string): string {
  return s.replace(VARIATION_SELECTOR_RE, "");
}

// ── Built-in emoji ────────────────────────────────────────────────────────────

/**
 * The common reactions, pinned to the top of the picker in this order. They
 * started as the reaction picker's own idea; they are as useful in a message.
 */
export const COMMON_EMOJI: readonly string[] = [
  "👍", "👎", "❤️", "😂", "🎉", "🚀", "👀", "🤔", "💯", "✅", "😮", "😢",
];

/** Section id of the pinned common emoji. */
export const COMMON_SECTION_ID = "common";

/** Category-bar glyph for a custom pack whose first image has not loaded. */
export const CUSTOM_PACK_ICON = "🧩";

interface BuiltinCatalog {
  common: EmojiSection;
  categories: EmojiSection[];
}

let _builtin: BuiltinCatalog | null = null;

/**
 * The built-in sections, built once. Entries are deduplicated by glyph (with
 * variation selectors stripped) across the whole set, first occurrence wins.
 */
function builtinCatalog(): BuiltinCatalog {
  if (_builtin) return _builtin;
  const byGlyph = new Map<string, PickerEmoji>();
  const categories: EmojiSection[] = [];
  for (const cat of EMOJI_CATEGORIES) {
    const entries: PickerEmoji[] = [];
    for (const e of cat.entries) {
      const id = stripVariationSelectors(e.glyph);
      if (byGlyph.has(id)) continue;
      const entry: PickerEmoji = {
        id,
        glyph: e.glyph,
        shortcode: e.shortcode,
        aliases: e.aliases ?? [],
        keywords: (e.keywords ?? []).map((k) => k.toLowerCase()),
      };
      byGlyph.set(id, entry);
      entries.push(entry);
    }
    categories.push({ id: cat.id, name: cat.name, icon: cat.icon, entries });
  }
  const common: EmojiSection = {
    id: COMMON_SECTION_ID,
    name: "Common",
    icon: "★",
    entries: COMMON_EMOJI
      .map((g) => byGlyph.get(stripVariationSelectors(g)))
      .filter((e): e is PickerEmoji => e !== undefined),
  };
  _builtin = { common, categories };
  return _builtin;
}

// ── Sections ──────────────────────────────────────────────────────────────────

/** Turn loader packs into picker sections: one per non-empty pack. */
function customSections(packs: readonly CustomEmojiPack[]): EmojiSection[] {
  const sections: EmojiSection[] = [];
  for (const pack of packs) {
    const seen = new Set<string>();
    const entries: PickerEmoji[] = [];
    for (const e of pack.emojis) {
      if (seen.has(e.shortcode)) continue;
      seen.add(e.shortcode);
      entries.push({
        id: `custom:${pack.id}:${e.shortcode}`,
        shortcode: e.shortcode,
        aliases: [],
        keywords: (e.body ?? "").toLowerCase().split(/\s+/).filter(Boolean),
        url: e.url,
        imageUrl: e.imageUrl,
        packId: pack.id,
      });
    }
    if (entries.length === 0) continue;
    sections.push({
      id: `pack:${pack.id}`,
      name: pack.name,
      icon: CUSTOM_PACK_ICON,
      iconUrl: entries[0].url,
      entries,
    });
  }
  return sections;
}

/**
 * Every section the picker shows, in order: the pinned common emoji, then the
 * room's and the user's custom packs (one section each), then the built-in
 * categories. Built-in entries are shared between calls; custom entries are
 * fresh objects, so the picker may update their `imageUrl` in place.
 */
export function buildSections(custom: readonly CustomEmojiPack[]): EmojiSection[] {
  const { common, categories } = builtinCatalog();
  return [common, ...customSections(custom), ...categories];
}

/** The browse view: every section's entries in order (common ones twice). */
export function browseEntries(sections: readonly EmojiSection[]): PickerEmoji[] {
  return sections.flatMap((s) => s.entries);
}

/**
 * A signature of what the packs contain, ignoring resolved images, so a reload
 * that brings back the same packs need not rebuild the grid.
 */
export function customPacksSignature(packs: readonly CustomEmojiPack[]): string {
  return JSON.stringify(packs.map((p) => [p.id, p.name, p.emojis.map((e) => [e.shortcode, e.url, e.body ?? ""])]));
}

// ── Search ────────────────────────────────────────────────────────────────────

/**
 * The search terms in a query: lowercased, whitespace-separated, each with a
 * leading `:` or `/` and a trailing `:` dropped — `:joy:`, `joy` and a
 * habitual `/joy` are the same search. A lone `:` or `/` is no term yet.
 *
 * Emoticons keep their colons. `:D`, `:P`, `:3`, `:/`, `:-)` and `D:` are text
 * a reaction may be sent as, not shortcodes: stripped, they became a
 * one-letter search whose first result Enter would react with (`:D` → 🥸), or
 * nothing at all (`:/`). Kept, they match nothing and Enter sends them as typed.
 */
export function queryTokens(query: string): string[] {
  const tokens: string[] = [];
  for (const raw of query.trim().split(/\s+/)) {
    if (raw === "" || raw === ":" || raw === "/") continue;
    const inner = raw.replace(/^[:/]+/, "").replace(/:+$/, "");
    tokens.push((inner === raw || isShortcodeStart(inner) ? inner : raw).toLowerCase());
  }
  return tokens;
}

/**
 * Whether what follows a `:` can begin a shortcode: a letter, digit or `_`
 * (or `+1`/`-1`) — but not a lone capital or digit, which after a colon is an
 * emoticon (`:D`, `:3`); shortcodes are lowercase.
 */
function isShortcodeStart(inner: string): boolean {
  if (/^[+-]\d/.test(inner)) return true;
  if (!/^[\p{L}\p{N}_]/u.test(inner)) return false;
  return !(inner.length === 1 && /[\p{Lu}\p{N}]/u.test(inner));
}

/** What a search compares against for one entry, normalised once. */
interface SearchKey {
  /** The primary shortcode then the aliases, lowercased. */
  names: readonly string[];
  /** The glyph without variation selectors; null for a custom emoji. */
  glyph: string | null;
}

/**
 * Search keys by entry. Entries never change what they are named, so each is
 * normalised the first time a search reaches it rather than on every keystroke;
 * keyed weakly so a replaced custom pack's keys go with it.
 */
const _searchKeys = new WeakMap<PickerEmoji, SearchKey>();

function searchKey(e: PickerEmoji): SearchKey {
  let key = _searchKeys.get(e);
  if (!key) {
    key = {
      names: [e.shortcode, ...e.aliases].map((n) => n.toLowerCase()),
      glyph: e.glyph ? stripVariationSelectors(e.glyph) : null,
    };
    _searchKeys.set(e, key);
  }
  return key;
}

/** One query term, with the glyph form it is compared to glyphs as. */
interface Term {
  text: string;
  /** `text` without variation selectors; empty when it was nothing else. */
  bare: string;
}

/** How well one term matches an entry; lower is better, null is no match. */
function tokenScore(e: PickerEmoji, { text: t, bare }: Term): number | null {
  const { names, glyph } = searchKey(e);
  if (names[0] === t) return 0;
  if (names.includes(t) || (glyph !== null && bare !== "" && glyph === bare)) return 1;
  // A keyword that is the whole term beats a longer name it begins: `sad`
  // finds 😢 (keyword) before :sad_but_relieved_face:, `lol` 😂 before 🍭.
  if (e.keywords.includes(t)) return 2;
  if (names.some((n) => n.startsWith(t))) return 3;
  if (names.some((n) => n.includes(t))) return 4;
  if (glyph !== null && bare !== "" && glyph.includes(bare)) return 4;
  if (e.keywords.some((k) => k.startsWith(t))) return 5;
  return null;
}

/**
 * Entries matching every term of `query`, best first.
 *
 * A term matches, best first: the primary shortcode exactly; an alias or the
 * glyph exactly (regardless of variation selectors); a keyword exactly; the
 * start of a shortcode or alias; anywhere in one; the start of a keyword — not
 * anywhere in a keyword, which made `cat` find "communicate". An
 * entry ranks by its worst-matching term; ties keep picker order, so the
 * common emoji and then custom packs win them. Each entry appears once, even
 * though the browse view lists the common ones twice.
 */
export function searchEmoji(sections: readonly EmojiSection[], query: string): PickerEmoji[] {
  const tokens: Term[] = queryTokens(query).map((text) => ({ text, bare: stripVariationSelectors(text) }));
  if (tokens.length === 0) return [];
  const seen = new Set<string>();
  const hits: Array<{ entry: PickerEmoji; score: number; order: number }> = [];
  let order = 0;
  for (const section of sections) {
    for (const entry of section.entries) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      let score = 0;
      for (const t of tokens) {
        const s = tokenScore(entry, t);
        if (s === null) { score = -1; break; }
        score = Math.max(score, s);
      }
      if (score >= 0) hits.push({ entry, score, order });
      order++;
    }
  }
  hits.sort((a, b) => a.score - b.score || a.order - b.order);
  return hits.map((h) => h.entry);
}

// ── What a pick produces ──────────────────────────────────────────────────────

/**
 * The `m.annotation` key for reacting with `entry`: the glyph, or for a custom
 * emoji its `mxc://` URL, which is what MSC2545-aware clients render. A custom
 * emoji with no mxc source falls back to its `:shortcode:` as text.
 */
export function reactionKey(entry: PickerEmoji): string {
  if (entry.glyph) return entry.glyph;
  if (entry.url?.startsWith("mxc://")) return entry.url;
  return `:${entry.shortcode}:`;
}

/**
 * The text inserted into the compose box for `entry`: the glyph, or for a
 * custom emoji its `:shortcode:` (and a space, so the next word does not run
 * into it), which the outgoing formatter turns into `<img data-mx-emoticon>`.
 */
export function composeInsertion(entry: PickerEmoji): string {
  return entry.glyph ?? `:${entry.shortcode}: `;
}
