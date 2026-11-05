// Theme sharing: the canonical TOML form of a theme, the base64url string that
// carries it in a quark.tel/theme link, and the rules a theme must satisfy.
//
// A share string is nothing but base64url(UTF-8 TOML). Importing one needs no
// format of its own — decode, then hand the text to the same TOML parser that
// reads ~/.config/quark/themes/*.toml (the Rust `parse_theme`, or smol-toml in
// the theme editor). See DESIGN.md → Theming → Sharing themes.
//
// Everything here is driven by THEME_SCHEMA, which mirrors the Rust `Theme`
// struct (src-tauri/src/config/theme.rs): every field is required there, so a
// theme this module emits always carries all of them.

import type { Theme } from "./loader.js";

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
  /** A u32 in Rust. `min`/`max` are hard limits when `enforce` is set (they
   *  mirror `validate_theme`), otherwise sensible bounds for an editor input. */
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

export const BORDER_STYLES = ["single", "double", "rounded", "ascii", "none"] as const;

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

/**
 * Fill a parsed (possibly partial or partly invalid) theme into a complete one.
 * Each field missing or invalid in `input` takes `base`'s value and is reported;
 * keys the schema doesn't know are reported and dropped.
 */
export function completeTheme(
  input: unknown,
  base: CompleteTheme,
): { theme: CompleteTheme; issues: ThemeIssue[] } {
  const issues: ThemeIssue[] = [];
  let theme = structuredClone(base);

  for (const { path, field } of THEME_FIELDS) {
    const value = getField(input, path);
    if (value === undefined) {
      if (field.optional) {
        theme = setField(theme, path, "");
      } else {
        issues.push({ path, kind: "missing", message: `missing — using ${show(getField(base, path))}` });
      }
      continue;
    }
    const problem = checkField(field, value);
    if (problem) {
      issues.push({
        path,
        kind: "invalid",
        message: `${show(value)} ${problem} — using ${show(getField(base, path))}`,
      });
    } else {
      theme = setField(theme, path, value);
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

/** base64url (RFC 4648 §5, unpadded) of the UTF-8 bytes of `toml`. */
export function encodeThemeShare(toml: string): string {
  const bytes = new TextEncoder().encode(toml);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decode a share string back to TOML text. Lenient about what it is handed:
 * a full quark.tel/theme link (the part after `#` is used), standard or
 * URL-safe alphabet, with or without padding, wrapped across lines.
 * Throws if the input is not base64 or does not decode to UTF-8.
 */
export function decodeThemeShare(input: string): string {
  let s = input.trim();
  const hash = s.indexOf("#");
  if (hash !== -1) s = s.slice(hash + 1);
  s = s.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (!s || !/^[A-Za-z0-9+/]+$/.test(s) || s.length % 4 === 1) {
    throw new Error("not a base64 theme string");
  }
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
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
