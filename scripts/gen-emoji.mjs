#!/usr/bin/env node
// Generates src/data/unicode-emoji.ts from emojibase-data.
//
// Run with: pnpm gen:emoji
//
// We commit the generated TS (rather than importing emojibase-data at runtime)
// so the emoji set is reviewable in git and updates are intentional — bump
// emojibase-data and re-run this script when a new Unicode release lands.

import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

const compact = require("emojibase-data/en/compact.json");
const githubShortcodes = require("emojibase-data/en/shortcodes/github.json");
const emojibaseShortcodes = require("emojibase-data/en/shortcodes/emojibase.json");

// group number → { id, icon, name }. Group 2 (component / skin tones) is skipped.
const GROUPS = {
  0: { id: "smileys", icon: "😀", name: "Smileys & Emotion" },
  1: { id: "people", icon: "👋", name: "People & Body" },
  3: { id: "nature", icon: "🐱", name: "Animals & Nature" },
  4: { id: "food", icon: "🍕", name: "Food & Drink" },
  5: { id: "travel", icon: "✈️", name: "Travel & Places" },
  6: { id: "activities", icon: "⚽", name: "Activities" },
  7: { id: "objects", icon: "💡", name: "Objects" },
  8: { id: "symbols", icon: "❤️", name: "Symbols" },
  9: { id: "flags", icon: "🏁", name: "Flags" },
};

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

// Resolve shortcodes for a hexcode, preferring the github preset (matches the
// :thumbsup:/:+1: conventions other chat clients use), falling back to
// emojibase, then a slug derived from the label.
function shortcodesFor(entry) {
  const gh = asArray(githubShortcodes[entry.hexcode]);
  const eb = asArray(emojibaseShortcodes[entry.hexcode]);
  const all = [...gh, ...eb];
  if (all.length === 0) {
    all.push(entry.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""));
  }
  // De-dup while preserving order.
  return [...new Set(all)];
}

const byGroup = new Map();
for (const entry of compact) {
  const group = GROUPS[entry.group];
  if (!group) continue; // skip component/skin-tone group
  const shortcodes = shortcodesFor(entry);
  if (shortcodes.length === 0) continue;
  const [shortcode, ...aliases] = shortcodes;
  const record = {
    shortcode,
    glyph: entry.unicode,
    keywords: entry.tags ?? [],
    aliases,
    order: entry.order ?? 0,
  };
  if (!byGroup.has(entry.group)) byGroup.set(entry.group, []);
  byGroup.get(entry.group).push(record);
}

// Emit categories in group order; entries sorted by emojibase's `order`.
const categories = [];
for (const groupNum of Object.keys(GROUPS).map(Number)) {
  const records = byGroup.get(groupNum);
  if (!records || records.length === 0) continue;
  records.sort((a, b) => a.order - b.order);
  const { id, icon, name } = GROUPS[groupNum];
  categories.push({
    id,
    icon,
    name,
    entries: records.map(({ shortcode, glyph, keywords, aliases }) => ({
      shortcode,
      glyph,
      ...(keywords.length ? { keywords } : {}),
      ...(aliases.length ? { aliases } : {}),
    })),
  });
}

const total = categories.reduce((n, c) => n + c.entries.length, 0);

const header = `// AUTO-GENERATED — do not edit by hand.
// Regenerate with: pnpm gen:emoji
// Source: emojibase-data ${require("emojibase-data/package.json").version} (github shortcode preset).
// ${total} emoji across ${categories.length} categories.

import type { ShortcodeEntry } from "../ui/ShortcodePreview.js";

export interface EmojiDataEntry {
  /** Primary shortcode, e.g. "thumbsup". */
  shortcode: string;
  /** Unicode glyph. */
  glyph: string;
  /** Search keywords (Unicode CLDR tags). */
  keywords?: string[];
  /** Alternate shortcodes, e.g. "+1" for "thumbsup". */
  aliases?: string[];
}

export interface EmojiCategory {
  id: string;
  /** Emoji glyph used as the category button icon. */
  icon: string;
  name: string;
  entries: EmojiDataEntry[];
}

export const EMOJI_CATEGORIES: EmojiCategory[] = ${JSON.stringify(categories, null, 2)};

/**
 * Flat list of all built-in emoji shortcodes (including aliases) — used for
 * shortcode autocomplete and outgoing shortcode expansion. The emoji picker
 * reads EMOJI_CATEGORIES through ui/emoji_catalog.ts instead.
 */
export const BUILTIN_EMOJI: ShortcodeEntry[] = EMOJI_CATEGORIES.flatMap((cat) =>
  cat.entries.flatMap((e) => [
    { key: e.glyph, shortcode: e.shortcode },
    ...(e.aliases ?? []).map((alias) => ({ key: e.glyph, shortcode: alias })),
  ]),
);
`;

const outPath = join(__dirname, "..", "src", "data", "unicode-emoji.ts");
writeFileSync(outPath, header);
console.log(`Wrote ${total} emoji across ${categories.length} categories to ${outPath}`);
