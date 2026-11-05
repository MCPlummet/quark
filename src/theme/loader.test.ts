import { describe, it, expect, beforeEach } from "vitest";
import { applyTheme, resetTheme, themeToCssVars, type Theme } from "./loader.js";

describe("theme/loader", () => {
  let root: HTMLElement;

  beforeEach(() => {
    // Use a fresh element as the root for each test to avoid cross-test pollution
    root = document.createElement("div");
    // Clear any leftover inline styles
    root.removeAttribute("style");
  });

  describe("applyTheme", () => {
    it("sets --bg CSS custom property from colors.background", () => {
      const theme: Theme = { colors: { background: "#1a1a1a" } };

      applyTheme(theme, root);

      expect(root.style.getPropertyValue("--bg")).toBe("#1a1a1a");
    });

    it("sets --fg CSS custom property from colors.foreground", () => {
      const theme: Theme = { colors: { foreground: "#c0c0c0" } };

      applyTheme(theme, root);

      expect(root.style.getPropertyValue("--fg")).toBe("#c0c0c0");
    });

    it("sets accent primary color", () => {
      const theme: Theme = { colors: { accent: { primary: "#ff6600" } } };

      applyTheme(theme, root);

      expect(root.style.getPropertyValue("--accent-primary")).toBe("#ff6600");
    });

    it("sets accent error color", () => {
      const theme: Theme = { colors: { accent: { error: "#ff0000" } } };

      applyTheme(theme, root);

      expect(root.style.getPropertyValue("--accent-error")).toBe("#ff0000");
    });

    it("sets message colors", () => {
      const theme: Theme = {
        colors: { messages: { own: "#aaffaa", other: "#aaaaff" } },
      };

      applyTheme(theme, root);

      expect(root.style.getPropertyValue("--msg-own")).toBe("#aaffaa");
      expect(root.style.getPropertyValue("--msg-other")).toBe("#aaaaff");
    });

    it("sets roomlist colors", () => {
      const theme: Theme = {
        colors: { roomlist: { active_bg: "#333", unread: "#ff0" } },
      };

      applyTheme(theme, root);

      expect(root.style.getPropertyValue("--roomlist-active-bg")).toBe("#333");
      expect(root.style.getPropertyValue("--roomlist-unread")).toBe("#ff0");
    });

    it("sets reaction colors", () => {
      const theme: Theme = {
        colors: { reactions: { background: "#222", own_bg: "#444" } },
      };

      applyTheme(theme, root);

      expect(root.style.getPropertyValue("--reaction-bg")).toBe("#222");
      expect(root.style.getPropertyValue("--reaction-own-bg")).toBe("#444");
    });

    it("sets typography font-family", () => {
      const theme: Theme = { typography: { font_family: "monospace" } };

      applyTheme(theme, root);

      expect(root.style.getPropertyValue("--font-family")).toBe("monospace");
    });

    it("sets typography font-size with px suffix", () => {
      const theme: Theme = { typography: { font_size: 14 } };

      applyTheme(theme, root);

      expect(root.style.getPropertyValue("--font-size")).toBe("14px");
    });

    it("sets typography line-height as string", () => {
      const theme: Theme = { typography: { line_height: 1.5 } };

      applyTheme(theme, root);

      expect(root.style.getPropertyValue("--line-height")).toBe("1.5");
    });

    it.each([
      ["rounded", "solid", "2px", "8px"],
      ["single", "solid", "2px", "0px"],
      ["double", "double", "3px", "0px"],
      ["ascii", "dashed", "2px", "0px"],
      ["none", "none", "0px", "0px"],
    ] as const)("draws %s borders as a %s frame, %s wide, %s corners", (style, line, width, radius) => {
      applyTheme({ borders: { style } }, root);

      expect(root.style.getPropertyValue("--frame-line")).toBe(line);
      expect(root.style.getPropertyValue("--frame-width")).toBe(width);
      expect(root.style.getPropertyValue("--frame-radius")).toBe(radius);
    });

    it("ignores an unknown border style instead of throwing", () => {
      const theme = { borders: { style: "square" } } as unknown as Theme;

      expect(() => applyTheme(theme, root)).not.toThrow();
      expect(root.style.getPropertyValue("--frame-line")).toBe("");
    });

    it("sets room list width", () => {
      const theme: Theme = { borders: { room_list_width: "200px" } };

      applyTheme(theme, root);

      expect(root.style.getPropertyValue("--room-list-width")).toBe("200px");
    });

    it("sets emoji size with px suffix", () => {
      const theme: Theme = { emoji: { size: 24 } };

      applyTheme(theme, root);

      expect(root.style.getPropertyValue("--emoji-size")).toBe("24px");
    });

    it("sets mode indicators", () => {
      const theme: Theme = {
        prompt: { normal_indicator: "NOR", insert_indicator: "INS" },
      };

      applyTheme(theme, root);

      expect(root.style.getPropertyValue("--mode-normal")).toBe('"NOR"');
      expect(root.style.getPropertyValue("--mode-insert")).toBe('"INS"');
    });

    it("escapes mode indicators into valid CSS strings", () => {
      const vars = themeToCssVars({
        prompt: { normal_indicator: 'say "hi"', insert_indicator: "a\\b", command_indicator: "" },
      });

      expect(vars["--mode-normal"]).toBe('"say \\"hi\\""');
      expect(vars["--mode-insert"]).toBe('"a\\\\b"');
      // Empty is a choice (no label), not a missing field.
      expect(vars["--mode-command"]).toBe('""');
    });
  });

  describe("partial theme", () => {
    it("only sets provided values — does not clear other properties", () => {
      // Apply a full theme first
      applyTheme(
        { colors: { background: "#000", foreground: "#fff" } },
        root
      );

      // Apply a partial theme
      applyTheme({ colors: { background: "#111" } }, root);

      // --fg should still be set from the first apply
      expect(root.style.getPropertyValue("--bg")).toBe("#111");
      expect(root.style.getPropertyValue("--fg")).toBe("#fff");
    });

    it("does not set properties for missing sections", () => {
      const theme: Theme = { colors: { background: "#000" } };

      applyTheme(theme, root);

      // Typography was not in the theme — should not be set
      expect(root.style.getPropertyValue("--font-size")).toBe("");
    });

    it("handles completely empty theme object gracefully", () => {
      expect(() => applyTheme({}, root)).not.toThrow();
    });
  });

  describe("resetTheme", () => {
    it("removes all CSS custom properties set by applyTheme", () => {
      const theme: Theme = {
        colors: {
          background: "#1a1a1a",
          foreground: "#c0c0c0",
          accent: { primary: "#ff6600" },
        },
        typography: { font_size: 14 },
      };

      applyTheme(theme, root);

      // Confirm they were set
      expect(root.style.getPropertyValue("--bg")).toBe("#1a1a1a");

      resetTheme(root);

      expect(root.style.getPropertyValue("--bg")).toBe("");
      expect(root.style.getPropertyValue("--fg")).toBe("");
      expect(root.style.getPropertyValue("--accent-primary")).toBe("");
      expect(root.style.getPropertyValue("--font-size")).toBe("");
    });

    it("removes border frame properties", () => {
      applyTheme({ borders: { style: "single" } }, root);

      resetTheme(root);

      expect(root.style.getPropertyValue("--frame-line")).toBe("");
      expect(root.style.getPropertyValue("--frame-radius")).toBe("");
    });

    it("removes mode indicators", () => {
      applyTheme({ prompt: { normal_indicator: "N" } }, root);

      resetTheme(root);

      expect(root.style.getPropertyValue("--mode-normal")).toBe("");
    });

    it("does not throw when called on a clean element", () => {
      expect(() => resetTheme(root)).not.toThrow();
    });

    it("removes reaction-related properties", () => {
      applyTheme(
        { colors: { reactions: { background: "#111", own_bg: "#222" } } },
        root
      );

      resetTheme(root);

      expect(root.style.getPropertyValue("--reaction-bg")).toBe("");
      expect(root.style.getPropertyValue("--reaction-own-bg")).toBe("");
    });
  });
});
