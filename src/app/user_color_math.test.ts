import { describe, it, expect } from "vitest";
import { contrastRatio, isLowContrast, LOW_CONTRAST_RATIO, normalizeHex } from "./user_color_math.js";

describe("normalizeHex", () => {
  it("normalizes like the backend", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("#00FF41")).toBe("#00ff41");
  });

  it("rejects everything else", () => {
    for (const bad of ["red", "#12345", "#1234567", "#ff0000; background:url(x)", " #fff", "#fff ", "", "#ff00ff00", 42, null, undefined, {}]) {
      expect(normalizeHex(bad), String(bad)).toBeNull();
    }
  });
});

describe("contrastRatio", () => {
  it("computes WCAG ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
    expect(contrastRatio("#777", "#777777")).toBeCloseTo(1, 5);
  });

  it("reads 8-digit theme colors, ignoring alpha", () => {
    expect(contrastRatio("#000000", "#ffffff80")).toBeCloseTo(21, 1);
  });

  it("is NaN when either side doesn't parse", () => {
    expect(contrastRatio("#000", "white")).toBeNaN();
  });
});

describe("isLowContrast", () => {
  it("flags low contrast below 3:1 only", () => {
    expect(LOW_CONTRAST_RATIO).toBe(3);
    expect(isLowContrast("#0b0b0b", "#0a0a0a")).toBe(true);
    expect(isLowContrast("#00ff41", "#0a0a0a")).toBe(false);
    expect(isLowContrast("#ffff00", "#ffffff")).toBe(true);
  });

  it("never flags against an unreadable background", () => {
    expect(isLowContrast("#00ff41", "not-a-color")).toBe(false);
  });
});
