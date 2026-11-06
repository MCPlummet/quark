import { describe, expect, it } from "vitest";

import { applyThemeVars } from "./preview.js";

function sheet(): CSSStyleSheet {
  const style = document.createElement("style");
  document.head.append(style);
  return style.sheet!;
}

describe("applyThemeVars", () => {
  it("writes the variables into one :root rule, each !important", () => {
    const s = sheet();
    applyThemeVars(s, { "--bg": "#000000", "--font-size": "14px" });
    expect(s.cssRules).toHaveLength(1);
    const rule = s.cssRules[0] as CSSStyleRule;
    expect(rule.selectorText).toBe(":root");
    expect(rule.style.getPropertyValue("--bg")).toBe("#000000");
    expect(rule.style.getPropertyPriority("--bg")).toBe("important");
  });

  it("replaces the previous theme instead of piling up", () => {
    const s = sheet();
    applyThemeVars(s, { "--bg": "#000000", "--fg": "#ffffff" });
    applyThemeVars(s, { "--bg": "#111111" });
    expect(s.cssRules).toHaveLength(1);
    const decls = (s.cssRules[0] as CSSStyleRule).style;
    expect(decls.getPropertyValue("--bg")).toBe("#111111");
    expect(decls.getPropertyValue("--fg")).toBe("");
  });

  it("can't be broken out of by a value: no new rules, whatever it holds", () => {
    const s = sheet();
    applyThemeVars(s, { "--font-family": "x;}body{display:none}:root{--q:0" });
    expect(s.cssRules).toHaveLength(1);
    expect((s.cssRules[0] as CSSStyleRule).selectorText).toBe(":root");
  });
});
