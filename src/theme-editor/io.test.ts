import { describe, expect, it } from "vitest";
import { parse } from "smol-toml";

import { BUILTIN_THEME_MAP } from "../theme/builtins.js";
import { setField, type CompleteTheme } from "../theme/share.js";
import { importTheme, themeFileText } from "./io.js";

const phosphor = BUILTIN_THEME_MAP.phosphor as CompleteTheme;

describe("themeFileText", () => {
  it("stays valid TOML whatever control characters the name holds", () => {
    const name = "bell\u0007 unit\u001f del\u007f nul\u0000 line\r\nbreak\ttab";
    const text = themeFileText(setField(phosphor, "meta.name", name));
    const parsed = parse(text) as { meta: { name: string } };
    // The comment is cleaned; the value itself keeps every character.
    expect(parsed.meta.name).toBe(name);
    expect(importTheme(text, phosphor).theme.meta.name).toBe(name);
  });

  it("gives the themes folder for every desktop platform", () => {
    const header = themeFileText(phosphor).split("\n[meta]")[0];
    expect(header).toContain("~/.config/quark/themes/");
    expect(header).toContain("~/Library/Application Support/quark/themes/");
    expect(header).toContain("%APPDATA%\\quark\\config\\themes\\");
  });
});
