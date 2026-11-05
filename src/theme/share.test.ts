import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { parse } from "smol-toml";

import { BUILTIN_THEME_MAP } from "./builtins.js";
import {
  THEME_FIELDS,
  completeTheme,
  decodeThemeShare,
  encodeThemeShare,
  getField,
  setField,
  themeSlug,
  themeToToml,
  validateTheme,
  type CompleteTheme,
} from "./share.js";

const THEMES_DIR = resolve(__dirname, "../../themes");
const phosphor = BUILTIN_THEME_MAP.phosphor as CompleteTheme;

/** Dotted paths of every leaf value in a nested object. */
function leafPaths(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => leafPaths(v, prefix ? `${prefix}.${k}` : k));
}

describe("THEME_SCHEMA", () => {
  const schemaPaths = THEME_FIELDS.map((f) => f.path).sort();

  it("covers exactly the fields of every themes/*.toml file", () => {
    for (const file of readdirSync(THEMES_DIR).filter((f) => f.endsWith(".toml"))) {
      const parsed = parse(readFileSync(resolve(THEMES_DIR, file), "utf8"));
      expect(leafPaths(parsed).sort(), file).toEqual(schemaPaths);
    }
  });

  it("covers exactly the fields of every built-in theme", () => {
    for (const [name, theme] of Object.entries(BUILTIN_THEME_MAP)) {
      expect(leafPaths(theme).sort(), name).toEqual(schemaPaths);
    }
  });
});

describe("themeToToml", () => {
  it("reproduces each built-in theme's file in /themes/ byte for byte", () => {
    for (const [name, theme] of Object.entries(BUILTIN_THEME_MAP)) {
      const file = readFileSync(resolve(THEMES_DIR, `${name}.toml`), "utf8");
      expect(themeToToml(theme as CompleteTheme), name).toBe(file);
    }
  });

  it("round-trips through a TOML parser", () => {
    for (const theme of Object.values(BUILTIN_THEME_MAP)) {
      expect(parse(themeToToml(theme as CompleteTheme))).toEqual(theme);
    }
  });

  it("escapes strings so hostile text stays a single value", () => {
    const theme = setField(phosphor, "meta.name", 'a "quoted" \\ name\nwith [colors] newline');
    const parsed = parse(themeToToml(theme)) as Record<string, any>;
    expect(parsed.meta.name).toBe('a "quoted" \\ name\nwith [colors] newline');
    expect(parsed.colors.background).toBe(phosphor.colors.background);
  });

  it("writes line_height as a float literal even when whole", () => {
    const toml = themeToToml(setField(phosphor, "typography.line_height", 2));
    expect(toml).toContain("line_height = 2.0\n");
  });

  it("omits empty optional meta fields", () => {
    let theme = setField(phosphor, "meta.author", "");
    theme = setField(theme, "meta.version", "");
    const toml = themeToToml(theme);
    expect(toml).not.toMatch(/^author/m);
    expect(toml).not.toMatch(/^version/m);
    expect(validateTheme(parse(toml))).toEqual([]);
  });
});

describe("share string", () => {
  it("round-trips TOML, including non-ASCII", () => {
    const toml = themeToToml(setField(phosphor, "prompt.symbol", "λ❯ 🐉"));
    const encoded = encodeThemeShare(toml);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeThemeShare(encoded)).toBe(toml);
  });

  it("accepts a full link, the standard alphabet, padding and line wraps", () => {
    const toml = themeToToml(BUILTIN_THEME_MAP.dracula as CompleteTheme);
    const url = encodeThemeShare(toml);
    const std = url.replace(/-/g, "+").replace(/_/g, "/");
    const padded = std + "=".repeat((4 - (std.length % 4)) % 4);

    expect(decodeThemeShare(`https://quark.tel/theme/#${url}`)).toBe(toml);
    expect(decodeThemeShare(padded)).toBe(toml);
    expect(decodeThemeShare(`  ${url.slice(0, 40)}\n${url.slice(40)}  `)).toBe(toml);
  });

  it("is plain base64 of the TOML, so any decoder can read it", () => {
    const toml = themeToToml(phosphor);
    const b64 = Buffer.from(encodeThemeShare(toml), "base64url").toString("utf8");
    expect(b64).toBe(toml);
  });

  it("rejects strings that are not base64 or not text", () => {
    expect(() => decodeThemeShare("")).toThrow();
    expect(() => decodeThemeShare("not base64!")).toThrow();
    expect(() => decodeThemeShare("A")).toThrow();
    expect(() => decodeThemeShare(Buffer.from([0xff, 0xfe, 0x00]).toString("base64url"))).toThrow();
  });
});

describe("validateTheme", () => {
  it("passes every built-in theme", () => {
    for (const [name, theme] of Object.entries(BUILTIN_THEME_MAP)) {
      expect(validateTheme(theme), name).toEqual([]);
    }
  });

  it("mirrors the Rust validator's colour and range rules", () => {
    const paths = (t: unknown) => validateTheme(t).map((i) => i.path);
    expect(paths(setField(phosphor, "colors.accent.primary", "red"))).toEqual(["colors.accent.primary"]);
    expect(paths(setField(phosphor, "colors.border", "#12345"))).toEqual(["colors.border"]);
    expect(paths(setField(phosphor, "colors.border", "#abc"))).toEqual([]);
    expect(paths(setField(phosphor, "colors.border", "#aabbccdd"))).toEqual([]);
    expect(paths(setField(phosphor, "typography.font_size", 5))).toEqual(["typography.font_size"]);
    expect(paths(setField(phosphor, "typography.font_size", 72))).toEqual([]);
    expect(paths(setField(phosphor, "emoji.size", 257))).toEqual(["emoji.size"]);
    expect(paths(setField(phosphor, "borders.style", "dotted"))).toEqual(["borders.style"]);
  });

  it("flags values quark's parser can't deserialize", () => {
    const paths = (t: unknown) => validateTheme(t).map((i) => i.path);
    expect(paths(setField(phosphor, "emoji.reaction_size", 20.5))).toEqual(["emoji.reaction_size"]);
    expect(paths(setField(phosphor, "typography.message_spacing", -1))).toEqual(["typography.message_spacing"]);
    expect(paths(setField(phosphor, "prompt.symbol", 3))).toEqual(["prompt.symbol"]);
    expect(paths(setField(phosphor, "meta.name", "  "))).toEqual(["meta.name"]);
  });
});

describe("completeTheme", () => {
  it("returns a complete theme unchanged with no issues", () => {
    const nord = BUILTIN_THEME_MAP.nord as CompleteTheme;
    expect(completeTheme(nord, phosphor)).toEqual({ theme: nord, issues: [] });
  });

  it("fills missing and invalid fields from the base and reports each", () => {
    const { theme, issues } = completeTheme(
      { meta: { name: "Partial" }, colors: { background: "#123456", foreground: "nope" } },
      phosphor,
    );
    expect(theme.meta.name).toBe("Partial");
    expect(theme.colors.background).toBe("#123456");
    expect(theme.colors.foreground).toBe(phosphor.colors.foreground);
    expect(theme.colors.accent).toEqual(phosphor.colors.accent);
    // Optional meta fields absent from the input stay absent, not inherited.
    expect(theme.meta.author).toBe("");
    expect(validateTheme(theme)).toEqual([]);

    const byPath = new Map(issues.map((i) => [i.path, i.message]));
    expect(byPath.get("colors.foreground")).toMatch(/"nope" must be a hex colour/);
    expect(byPath.get("colors.cursor")).toMatch(/^missing/);
    expect(byPath.has("meta.author")).toBe(false);
  });

  it("reports keys that aren't theme settings", () => {
    const input = setField(setField(phosphor, "colors.accent.tertiary", "#fff"), "extra", { a: 1 });
    const { theme, issues } = completeTheme(input, phosphor);
    expect(issues.map((i) => i.path).sort()).toEqual(["colors.accent.tertiary", "extra"]);
    expect(getField(theme, "colors.accent.tertiary")).toBeUndefined();
  });

  it("does not mutate the base", () => {
    const before = JSON.stringify(phosphor);
    completeTheme({ meta: { name: "x" }, colors: { background: "#000" } }, phosphor);
    expect(JSON.stringify(phosphor)).toBe(before);
  });
});

describe("themeSlug", () => {
  it("makes a filesystem-friendly name", () => {
    expect(themeSlug("Catppuccin Mocha")).toBe("catppuccin-mocha");
    expect(themeSlug("  Crème Brûlée!! v2 ")).toBe("creme-brulee-v2");
    expect(themeSlug("🐉")).toBe("theme");
  });
});
