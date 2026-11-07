import { parse } from "smol-toml";
import { deflateSync } from "fflate";

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
  MAX_SHARE_LENGTH,
  MAX_SHARED_TOML_BYTES,
  ThemeShareVersionError,
  type CompleteTheme,
} from "./share.js";
import { SHARE_DICTIONARY_V1 } from "./share_dictionary.js";
import { FRAME_STYLES } from "./loader.js";

/** Unpadded base64url, written independently of the code under test. */
function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(s: string): Uint8Array {
  const std = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(std + "=".repeat((4 - (std.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

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

  it("still reads version-0 strings — plain base64 of the TOML, from before compression", () => {
    const toml = themeToToml(BUILTIN_THEME_MAP.nord as CompleteTheme);
    const plain = base64url(new TextEncoder().encode(toml));
    expect(plain.startsWith("W21ldGFd")).toBe(true); // "[meta]"
    expect(decodeThemeShare(`https://quark.tel/theme/#${plain}`)).toBe(toml);
  });

  it("reads version 1 exactly as an independent encoder writes it", () => {
    // Made with Node's zlib — deflateRawSync(nord, { level: 9, dictionary:
    // SHARE_DICTIONARY_V1 }) after a 0x01 byte — not with the encoder under
    // test. If this fails, the dictionary or the format changed, and every
    // version-1 link already shared is broken: put it back, and add a version
    // instead.
    const NORD_V1 =
      "Ae3Uyw3DIAwG4JUINshdogv0hI2z_wilUixMQWmlKrdeQ3j4x3yP0ZJ7q_YXR6ICYpgcqVRVb4MjRBJqWDgCjDHFhSMq2tp17KHj31NH-k7eEWoPQjbvCO95y2V0RFmYeHSkACuJcyRpW0xOHbE53RGLxDmCkvLrAG-OQPuukyPAsKNOjtiBJ0es3qUjNvjREQt8dMQSdo7YZc2OWMzOkaPuLxyx_nKFWT7OESjYJPGO9C3-jlziyBM";
    expect(decodeThemeShare(NORD_V1)).toBe(themeToToml(BUILTIN_THEME_MAP.nord as CompleteTheme));
    expect(decodeThemeShare("AYseLUtGy5LRsmS0LKFCWQIA")).toBe(SHARE_DICTIONARY_V1);
  });

  it("writes version 1: a 0x01 byte, then compressed TOML", () => {
    const encoded = encodeThemeShare(themeToToml(phosphor));
    expect(fromBase64url(encoded)[0]).toBe(0x01);
  });

  it("keeps every built-in theme's link short", () => {
    for (const [id, theme] of Object.entries(BUILTIN_THEME_MAP)) {
      const toml = themeToToml(theme as CompleteTheme);
      const encoded = encodeThemeShare(toml);
      // ~250 today; uncompressed is ~1,470. A jump means the dictionary
      // stopped applying.
      expect(encoded.length, id).toBeLessThan(350);
      expect(decodeThemeShare(encoded), id).toBe(toml);
    }
  });

  it("says when a string needs a newer Quark", () => {
    for (const version of [0x00, 0x02, 0x08]) {
      const future = base64url(new Uint8Array([version, 1, 2, 3]));
      expect(() => decodeThemeShare(future)).toThrow(ThemeShareVersionError);
    }
  });

  it("refuses a damaged version-1 string", () => {
    const encoded = encodeThemeShare(themeToToml(phosphor));
    const bytes = fromBase64url(encoded);
    expect(() => decodeThemeShare(base64url(bytes.subarray(0, 4)))).toThrow(/damaged/);
  });

  it("stops inflating at the size limit instead of following a bomb", () => {
    // 1 MiB of spaces compresses to about a kilobyte.
    const bomb = deflateSync(new Uint8Array(1024 * 1024).fill(0x20), { level: 9 });
    const encoded = base64url(Uint8Array.of(0x01, ...bomb));
    expect(encoded.length).toBeLessThan(MAX_SHARE_LENGTH);
    expect(() => decodeThemeShare(encoded)).toThrow(/too large/);
    expect(MAX_SHARED_TOML_BYTES).toBe(64 * 1024);
  });

  it("refuses a string too long to be a theme", () => {
    expect(() => decodeThemeShare("A".repeat(MAX_SHARE_LENGTH + 4))).toThrow(/too long/);
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
