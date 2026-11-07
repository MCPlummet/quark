// Theme sharing: the canonical TOML form of a theme, the base64url string that
// carries it in a quark.tel/theme link, and the rules a theme must satisfy.
//
// A share string carries the theme's TOML, compressed (see "Share string"
// below). Importing one needs no format of its own past that — decode, then
// hand the text to the same TOML parser that reads the themes folder's
// *.toml files. See DESIGN.md → Theming → Theme Editor & Sharing.
//
// Everything here is driven by THEME_SCHEMA, which mirrors the Rust `Theme`
// struct (src-tauri/src/config/theme.rs): every field is required there, so a
// theme this module emits always carries all of them.

import { deflateSync, inflateSync } from "fflate";

import { BORDER_STYLES, type Theme } from "./loader.js";
import { SHARE_DICTIONARY_V1 } from "./share_dictionary.js";

export { BORDER_STYLES };

// ── Types ────────────────────────────────────────────────────────────────────

type DeepRequired<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends object
    ? DeepRequired<NonNullable<T[K]>>
    : NonNullable<T[K]>;
};

/**
 * A theme with every field present — what quark's strict parser requires.
 * `meta.author` / `meta.version` are optional in TOML; here an empty string
 * means "absent" and the line is omitted on output.
 */
export type CompleteTheme = DeepRequired<Theme>;

export type FieldKind =
  /** `#rgb`, `#rrggbb` or `#rrggbbaa`. */
  | { type: "color" }
  | { type: "string"; required?: boolean }
  /** A u32 in Rust, so never above {@link U32_MAX}. `min`/`max` are hard
   *  limits when `enforce` is set (they mirror `validate_theme`), otherwise
   *  sensible bounds for an editor input. */
  | { type: "int"; min: number; max: number; enforce?: boolean }
  | { type: "float"; min: number; max: number; step: number }
  | { type: "enum"; options: readonly string[] };

export interface ThemeField {
  key: string;
  kind: FieldKind;
  /** One-line description of what the field controls. */
  hint: string;
  /** May be left out of the TOML entirely (`Option<String>` in Rust). */
  optional?: boolean;
}

export interface ThemeSection {
  /** Dotted table path, e.g. `colors.accent`. */
  path: string;
  title: string;
  fields: readonly ThemeField[];
}

export interface ThemeIssue {
  /** Dotted field path, e.g. `colors.accent.primary`. */
  path: string;
  /** Absent, present with a bad value, or not a theme setting at all. */
  kind: "missing" | "invalid" | "unknown";
  message: string;
}

// ── Schema ───────────────────────────────────────────────────────────────────

const color = (key: string, hint: string): ThemeField => ({ key, kind: { type: "color" }, hint });
const text = (key: string, hint: string, extra: Partial<ThemeField> = {}): ThemeField => ({
  key,
  kind: { type: "string" },
  hint,
  ...extra,
});

/** Field order here is the order fields are written to TOML. */
export const THEME_SCHEMA: readonly ThemeSection[] = [
  {
    path: "meta",
    title: "Meta",
    fields: [
      { key: "name", kind: { type: "string", required: true }, hint: "Display name in Settings → Themes" },
      text("author", "Who made it", { optional: true }),
      text("version", "Your own version string", { optional: true }),
    ],
  },
  {
    path: "colors",
    title: "Base",
    fields: [
      color("background", "Window background"),
      color("foreground", "Default text"),
      color("cursor", "Input caret"),
      color("selection_bg", "Selected text background"),
      color("selection_fg", "Selected text"),
      color("border", "Panel borders and dividers"),
    ],
  },
  {
    path: "colors.accent",
    title: "Accent",
    fields: [
      color("primary", "Focus, highlights, active mode"),
      color("secondary", "Secondary highlights"),
      color("error", "Errors and destructive actions"),
      color("warning", "Warnings"),
      color("success", "Confirmations"),
      color("link", "Links"),
    ],
  },
  {
    path: "colors.messages",
    title: "Messages",
    fields: [
      color("own", "Your own sender name"),
      color("other", "Other senders"),
      color("system", "Membership and state events"),
      color("timestamp", "Timestamps"),
      color("mention_bg", "Background of messages that mention you"),
      color("mention_fg", "Mention pill text"),
      color("reply_border", "Quote bar on replies"),
      color("thread_indicator", "Thread reply counts"),
    ],
  },
  {
    path: "colors.roomlist",
    title: "Room list",
    fields: [
      color("active_bg", "Selected room background"),
      color("active_fg", "Selected room text"),
      color("unread", "Rooms with unread messages"),
      color("mention_badge", "Mention count badge"),
      color("muted", "Muted rooms"),
    ],
  },
  {
    path: "colors.reactions",
    title: "Reactions",
    fields: [
      color("background", "Reaction chip background"),
      color("border", "Reaction chip border"),
      color("own_bg", "Chips you reacted with"),
      color("count", "Reaction counts"),
    ],
  },
  {
    path: "typography",
    title: "Typography",
    fields: [
      text("font_family", "CSS font stack for the interface"),
      { key: "font_size", kind: { type: "int", min: 6, max: 72, enforce: true }, hint: "Base size in px" },
      { key: "line_height", kind: { type: "float", min: 1, max: 2.5, step: 0.05 }, hint: "Multiple of font size" },
      { key: "message_spacing", kind: { type: "int", min: 0, max: 32 }, hint: "Space around each message in a group, px" },
    ],
  },
  {
    path: "borders",
    title: "Borders",
    fields: [
      { key: "style", kind: { type: "enum", options: BORDER_STYLES }, hint: "Frames: message boxes, compose box, pane dividers" },
      text("room_list_width", "CSS width of the room list, e.g. 25% or 240px"),
    ],
  },
  {
    path: "emoji",
    title: "Emoji",
    fields: [
      { key: "size", kind: { type: "int", min: 8, max: 256, enforce: true }, hint: "Emoji in a message that is only emoji, px" },
      { key: "sticker_max_size", kind: { type: "int", min: 32, max: 1024 }, hint: "Largest sticker dimension, px" },
      { key: "reaction_size", kind: { type: "int", min: 8, max: 64 }, hint: "Emoji in a reaction chip, px" },
    ],
  },
  {
    path: "prompt",
    title: "Mode labels",
    fields: [
      text("normal_indicator", "Mode label in normal mode"),
      text("insert_indicator", "Mode label in insert mode"),
      text("command_indicator", "Mode label in command mode"),
      text("visual_indicator", "Mode label in visual mode"),
    ],
  },
];

/** Every field with its full dotted path, in schema order. */
export const THEME_FIELDS: readonly { path: string; section: ThemeSection; field: ThemeField }[] =
  THEME_SCHEMA.flatMap((section) =>
    section.fields.map((field) => ({ path: `${section.path}.${field.key}`, section, field })),
  );

// ── Path helpers ─────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Read a dotted path from a theme-shaped object. */
export function getField(theme: unknown, path: string): unknown {
  let cur: unknown = theme;
  for (const part of path.split(".")) {
    if (!isObj(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

/** Return a copy of `theme` with the value at a dotted path replaced. */
export function setField<T>(theme: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split(".");
  const obj = (isObj(theme) ? theme : {}) as Obj;
  return {
    ...obj,
    [head]: rest.length ? setField(obj[head], rest.join("."), value) : value,
  } as T;
}

// ── Validation ───────────────────────────────────────────────────────────────

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * The largest integer setting quark can read: its fields are `u32`. Anything
 * above fails to deserialize, and from 2^63 up isn't even a TOML integer.
 */
export const U32_MAX = 4_294_967_295;

/** Same rule as the Rust `is_valid_hex_color`. */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

/**
 * Why `value` is not acceptable for `field`, or `null` if it is. Mirrors what
 * quark rejects: a type its strict parser can't deserialize, or a value
 * `validate_theme` flags. A blank theme name is also refused — it would render
 * as an empty button in Settings.
 */
export function checkField(field: ThemeField, value: unknown): string | null {
  const k = field.kind;
  switch (k.type) {
    case "color":
      return isHexColor(value) ? null : "must be a hex colour: #rgb, #rrggbb or #rrggbbaa";
    case "string":
      if (typeof value !== "string") return "must be text";
      if (k.required && !value.trim()) return "must not be empty";
      return null;
    case "int":
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        return "must be a whole number ≥ 0";
      }
      if (k.enforce && (value < k.min || value > k.max)) return `must be between ${k.min} and ${k.max}`;
      if (value > U32_MAX) return `must be at most ${U32_MAX}`;
      return null;
    case "float":
      return typeof value === "number" && Number.isFinite(value) && value > 0
        ? null
        : "must be a positive number";
    case "enum":
      return typeof value === "string" && k.options.includes(value)
        ? null
        : `must be one of ${k.options.join(", ")}`;
  }
}

/** Every problem quark would have with this theme. Empty means it loads. */
export function validateTheme(theme: unknown): ThemeIssue[] {
  const issues: ThemeIssue[] = [];
  for (const { path, field } of THEME_FIELDS) {
    const value = getField(theme, path);
    if (value === undefined && field.optional) continue;
    if (value === undefined) {
      issues.push({ path, kind: "missing", message: "is missing" });
      continue;
    }
    const problem = checkField(field, value);
    if (problem) issues.push({ path, kind: "invalid", message: problem });
  }
  return issues;
}

/** The name a theme gets when it arrives without a usable one. */
export const UNTITLED_THEME_NAME = "Untitled theme";

/**
 * What a missing or invalid field becomes. Most take the base theme's value,
 * but not the ones that say whose theme it is: a nameless import named after
 * the base would pass itself off as that built-in (and download as
 * `phosphor.toml`), and one with a bad `author` would credit the base's.
 */
function fallbackFor(path: string, field: ThemeField, base: CompleteTheme): unknown {
  if (path === "meta.name") return UNTITLED_THEME_NAME;
  if (field.optional) return "";
  return getField(base, path);
}

/**
 * Fill a parsed (possibly partial or partly invalid) theme into a complete one.
 * Each field missing or invalid in `input` is replaced (see fallbackFor) and
 * reported; keys the schema doesn't know are reported and dropped.
 */
export function completeTheme(
  input: unknown,
  base: CompleteTheme,
): { theme: CompleteTheme; issues: ThemeIssue[] } {
  const issues: ThemeIssue[] = [];
  let theme = structuredClone(base);

  for (const { path, field } of THEME_FIELDS) {
    const value = getField(input, path);
    const problem = value === undefined ? null : checkField(field, value);
    if (value !== undefined && !problem) {
      theme = setField(theme, path, value);
      continue;
    }
    const fallback = fallbackFor(path, field, base);
    theme = setField(theme, path, fallback);
    const instead = fallback === "" ? "left out" : `using ${show(fallback)}`;
    if (value === undefined) {
      if (!field.optional) issues.push({ path, kind: "missing", message: `missing — ${instead}` });
    } else {
      issues.push({ path, kind: "invalid", message: `${show(value)} ${problem} — ${instead}` });
    }
  }

  for (const path of unknownPaths(input)) {
    issues.push({ path, kind: "unknown", message: "not a theme setting — ignored" });
  }
  return { theme, issues };
}

const SECTION_PATHS = new Set(THEME_SCHEMA.map((s) => s.path));
const FIELD_PATHS = new Set(THEME_FIELDS.map((f) => f.path));
/**
 * Settings themes used to have. Older files still carry them, and the app
 * ignores them, so they are dropped without being reported as mistakes.
 */
const RETIRED_PATHS = new Set(["prompt.symbol"]);

function unknownPaths(input: unknown, prefix = ""): string[] {
  if (!isObj(input)) return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (FIELD_PATHS.has(path) || RETIRED_PATHS.has(path)) continue;
    if (SECTION_PATHS.has(path) || (isObj(value) && [...SECTION_PATHS].some((s) => s.startsWith(`${path}.`)))) {
      out.push(...unknownPaths(value, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

function show(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

// ── TOML output ──────────────────────────────────────────────────────────────

function tomlString(s: string): string {
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\r") out += "\\r";
    else if (code < 0x20 || code === 0x7f) out += `\\u${code.toString(16).padStart(4, "0")}`;
    else out += ch;
  }
  return `${out}"`;
}

function tomlValue(field: ThemeField, value: unknown): string {
  switch (field.kind.type) {
    case "int":
      return String(Math.round(Number(value)));
    case "float": {
      // Always write a float literal: `1.0`, never `1`, so the value reads as
      // the f32 it deserializes to.
      const s = String(Number(value));
      return /[.eE]/.test(s) ? s : `${s}.0`;
    }
    default:
      return tomlString(String(value));
  }
}

/**
 * Serialize a theme to TOML in the same layout as the files in /themes/:
 * one table per schema section, fields in schema order, a blank line between
 * tables. Optional fields that are empty are left out.
 */
export function themeToToml(theme: CompleteTheme): string {
  return THEME_SCHEMA.map((section) => {
    const lines = [`[${section.path}]`];
    for (const field of section.fields) {
      const value = getField(theme, `${section.path}.${field.key}`);
      if (field.optional && (value === undefined || value === "")) continue;
      lines.push(`${field.key} = ${tomlValue(field, value)}`);
    }
    return `${lines.join("\n")}\n`;
  }).join("\n");
}

// ── Share string ─────────────────────────────────────────────────────────────
//
// A share string is base64url (RFC 4648 §5, unpadded) of a payload in one of
// two forms, told apart by its first byte:
//
//   version 0  the theme's UTF-8 TOML, as is. What links carried before
//              compression; still read, never written.
//   version 1  the byte 0x01, then the TOML compressed with raw DEFLATE
//              (RFC 1951) using SHARE_DICTIONARY_V1 as the preset dictionary.
//
// TOML can't begin with a byte below 0x09: a document opens with whitespace,
// a newline, `#`, `[` or a key. So bytes 0x00–0x08 are free to mark versioned
// payloads, and a version-0 string needs no marker. Every theme shares its
// keys and layout with the dictionary (Phosphor), so a full theme comes to
// ~250 characters instead of ~1,470 — short enough to paste into a chat or
// fit in a small QR code.

/** First payload byte of a version-1 share string. */
const SHARE_V1 = 0x01;

/** Payload bytes from here up are text: a version-0 share string. */
const FIRST_TEXT_BYTE = 0x09;

/**
 * Longest share string (base64 characters) worth decoding. A full theme is
 * ~250; even version 0 stays under 2,000. The cap bounds the work a crafted
 * string can cause, since DEFLATE expands up to ~1,000×.
 */
export const MAX_SHARE_LENGTH = 16 * 1024;

/**
 * Largest theme TOML a share string may carry — the backend's limit on a
 * theme file (`MAX_THEME_FILE_BYTES`). Decompression stops past it.
 */
export const MAX_SHARED_TOML_BYTES = 64 * 1024;

/**
 * Shortest payload worth reading as a versioned share string. The shortest
 * real one — Phosphor itself, every byte found in the dictionary — is 18
 * bytes. Shorter text whose first byte happens to fall in 0x00–0x08 is a word
 * that is also base64 ("Blue" decodes to 0x06 …), not a link from a newer
 * Quark, and saying "update Quark" about it would send the user the wrong way.
 */
const MIN_VERSIONED_PAYLOAD = 12;

/** The share string is a format this build doesn't know — made by a newer one. */
export class ThemeShareVersionError extends Error {
  constructor() {
    super("This theme link needs a newer version of Quark.");
    this.name = "ThemeShareVersionError";
  }
}

let _dictionaryV1: Uint8Array | undefined;
function dictionaryV1(): Uint8Array {
  return (_dictionaryV1 ??= new TextEncoder().encode(SHARE_DICTIONARY_V1));
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The bytes of a share string, lenient about what it is handed: a full
 * quark.tel/theme link (the part after `#` is used), standard or URL-safe
 * alphabet, with or without padding, wrapped across lines.
 */
function fromBase64(input: string): Uint8Array {
  let s = input.trim();
  const hash = s.indexOf("#");
  if (hash !== -1) s = s.slice(hash + 1);
  s = s.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (!s || !/^[A-Za-z0-9+/]+$/.test(s) || s.length % 4 === 1) {
    throw new Error("not a base64 theme string");
  }
  if (s.length > MAX_SHARE_LENGTH) throw new Error("theme string is too long");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/**
 * Whether a payload with an unknown version byte is credibly a share string
 * from a newer Quark, rather than text that merely decodes as base64: long
 * enough to hold a theme, and one token. A link wrapped across lines breaks at
 * line ends; words separated by spaces on one line are prose.
 */
function couldBeNewerShare(input: string, payload: Uint8Array): boolean {
  return payload.length >= MIN_VERSIONED_PAYLOAD && !/\S[ \t]+\S/.test(input.trim());
}

function inflateV1(compressed: Uint8Array): Uint8Array {
  // Checked here because fflate hands back the caller's whole `out` buffer,
  // unwritten, for empty input — which would read as "too large" below.
  if (compressed.length === 0) throw new Error("theme string is damaged");
  // fflate writes into a buffer it is given and never grows it, so one byte
  // past the limit is enough to tell "too large" without inflating a bomb.
  const out = new Uint8Array(MAX_SHARED_TOML_BYTES + 1);
  let toml: Uint8Array;
  try {
    toml = inflateSync(compressed, { out, dictionary: dictionaryV1() });
  } catch {
    throw new Error("theme string is damaged");
  }
  if (toml.length > MAX_SHARED_TOML_BYTES) throw new Error("theme in this string is too large");
  return toml;
}

/** The share string (version 1) for theme TOML. */
export function encodeThemeShare(toml: string): string {
  // No `mem`: fflate's default is already more than a ~1.3 KB theme can use.
  // Raising it allocates a 2^(mem+12)-entry hash table per call (32 MB at 12)
  // for byte-identical output, and the editor encodes on every edit.
  const compressed = deflateSync(new TextEncoder().encode(toml), {
    level: 9,
    dictionary: dictionaryV1(),
  });
  const payload = new Uint8Array(compressed.length + 1);
  payload[0] = SHARE_V1;
  payload.set(compressed, 1);
  return toBase64Url(payload);
}

/**
 * Decode a share string, of either version, back to TOML text. Accepts a
 * whole link and is lenient about alphabet, padding and line breaks (see
 * fromBase64). Throws {@link ThemeShareVersionError} for a version this build
 * doesn't know, and an Error for anything that isn't a theme string.
 */
export function decodeThemeShare(input: string): string {
  const payload = fromBase64(input);
  let bytes: Uint8Array;
  if (payload[0] >= FIRST_TEXT_BYTE) {
    bytes = payload;
  } else if (payload[0] === SHARE_V1) {
    bytes = inflateV1(payload.subarray(1));
  } else if (couldBeNewerShare(input, payload)) {
    throw new ThemeShareVersionError();
  } else {
    throw new Error("not a theme string");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("theme string does not decode to text");
  }
}

/** A filesystem-friendly name for a theme: `Catppuccin Mocha` → `catppuccin-mocha`. */
export function themeSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "theme";
}
