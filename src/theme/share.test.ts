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
  BORDER_STYLES,
  UNTITLED_THEME_NAME,
  U32_MAX,
  type CompleteTheme,
} from "./share.js";
import { FRAME_STYLES } from "./loader.js";

/** themes/*.toml by file name, e.g. `nord.toml`. */
const THEME_FILES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("../../themes/*.toml", { query: "?raw", import: "default", eager: true }),
  ).map(([path, text]) => [path.split("/").pop()!, text]),
);
const phosphor = BUILTIN_THEME_MAP.phosphor as CompleteTheme;

/** Dotted paths of every leaf value in a nested object. */
function leafPaths(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => leafPaths(v, prefix ? `${prefix}.${k}` : k));
}

describe("THEME_SCHEMA", () => {
  const schemaPaths = THEME_FIELDS.map((f) => f.path).sort();

  it("covers exactly the fields of every themes/*.toml file", () => {
    expect(Object.keys(THEME_FILES).length).toBeGreaterThan(0);
    for (const [file, text] of Object.entries(THEME_FILES)) {
      expect(leafPaths(parse(text)).sort(), file).toEqual(schemaPaths);
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
      expect(themeToToml(theme as CompleteTheme), name).toBe(THEME_FILES[`${name}.toml`]);
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
    const toml = themeToToml(setField(phosphor, "prompt.insert_indicator", "λ❯ 🐉"));
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
    const std = encodeThemeShare(toml).replace(/-/g, "+").replace(/_/g, "/");
    expect(atob(std + "=".repeat((4 - (std.length % 4)) % 4))).toBe(toml); // ASCII theme

  });

  it("rejects strings that are not base64 or not text", () => {
    expect(() => decodeThemeShare("")).toThrow();
    expect(() => decodeThemeShare("not base64!")).toThrow();
    expect(() => decodeThemeShare("A")).toThrow();
    expect(() => decodeThemeShare(btoa("\xff\xfe\x00"))).toThrow(/does not decode to text/);
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
    expect(paths(setField(phosphor, "prompt.normal_indicator", 3))).toEqual(["prompt.normal_indicator"]);
    expect(paths(setField(phosphor, "meta.name", "  "))).toEqual(["meta.name"]);
  });

  it("caps every integer at u32, bounded in the editor or not", () => {
    const paths = (t: unknown) => validateTheme(t).map((i) => i.path);
    expect(paths(setField(phosphor, "typography.message_spacing", U32_MAX))).toEqual([]);
    expect(paths(setField(phosphor, "typography.message_spacing", U32_MAX + 1))).toEqual(["typography.message_spacing"]);
    // Past i64, and past the point String() switches to exponent notation.
    expect(paths(setField(phosphor, "emoji.sticker_max_size", 1e20))).toEqual(["emoji.sticker_max_size"]);
    expect(paths(setField(phosphor, "emoji.reaction_size", 1e21))).toEqual(["emoji.reaction_size"]);
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

    const byPath = new Map(issues.map((i) => [i.path, i]));
    expect(byPath.get("colors.foreground")).toMatchObject({ kind: "invalid", message: expect.stringMatching(/"nope" must be a hex colour/) });
    expect(byPath.get("colors.cursor")).toMatchObject({ kind: "missing", message: expect.stringMatching(/^missing/) });
    expect(byPath.has("meta.author")).toBe(false);
  });

  it("reports keys that aren't theme settings", () => {
    const input = setField(setField(phosphor, "colors.accent.tertiary", "#fff"), "extra", { a: 1 });
    const { theme, issues } = completeTheme(input, phosphor);
    expect(issues.map((i) => i.path).sort()).toEqual(["colors.accent.tertiary", "extra"]);
    expect(issues.every((i) => i.kind === "unknown")).toBe(true);
    expect(getField(theme, "colors.accent.tertiary")).toBeUndefined();
  });

  it("names a nameless theme as untitled, not after the base", () => {
    const { theme, issues } = completeTheme({ colors: { background: "#000000" } }, phosphor);
    expect(theme.meta.name).toBe(UNTITLED_THEME_NAME);
    expect(themeSlug(theme.meta.name)).not.toBe("phosphor");
    expect(issues.find((i) => i.path === "meta.name")).toMatchObject({
      kind: "missing",
      message: `missing — using "${UNTITLED_THEME_NAME}"`,
    });

    const blank = completeTheme(setField(phosphor, "meta.name", " "), phosphor);
    expect(blank.theme.meta.name).toBe(UNTITLED_THEME_NAME);
  });

  it("leaves out an invalid author rather than crediting the base's", () => {
    const base = setField(phosphor, "meta.author", "Base Author");
    const { theme, issues } = completeTheme(setField(phosphor, "meta.author", 42), base);
    expect(theme.meta.author).toBe("");
    expect(issues.find((i) => i.path === "meta.author")?.message).toMatch(/— left out$/);
  });

  it("drops retired settings without reporting them", () => {
    const { theme, issues } = completeTheme(setField(phosphor, "prompt.symbol", ":>"), phosphor);
    expect(issues).toEqual([]);
    expect(getField(theme, "prompt.symbol")).toBeUndefined();
  });

  it("does not mutate the base", () => {
    const before = JSON.stringify(phosphor);
    completeTheme({ meta: { name: "x" }, colors: { background: "#000" } }, phosphor);
    expect(JSON.stringify(phosphor)).toBe(before);
  });
});

describe("borders.style", () => {
  it("offers exactly the styles the app knows how to draw", () => {
    const field = THEME_FIELDS.find((f) => f.path === "borders.style")!.field;
    expect(field.kind).toEqual({ type: "enum", options: BORDER_STYLES });
    expect([...BORDER_STYLES].sort()).toEqual(Object.keys(FRAME_STYLES).sort());
  });
});

describe("themeSlug", () => {
  it("makes a filesystem-friendly name", () => {
    expect(themeSlug("Catppuccin Mocha")).toBe("catppuccin-mocha");
    expect(themeSlug("  Crème Brûlée!! v2 ")).toBe("creme-brulee-v2");
    expect(themeSlug("🐉")).toBe("theme");
  });
});
