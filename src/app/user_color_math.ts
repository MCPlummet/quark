// User color math (#45): the validator every color passes before it reaches a
// style, and the WCAG contrast check behind the low-contrast outline.

/** Below this contrast ratio against the theme background, Quark outlines. */
export const LOW_CONTRAST_RATIO = 3;

const SHORT_OR_LONG = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * A color as Quark stores and draws it — lowercase `#rrggbb` — or `null`.
 * Accepts `#rgb` / `#rrggbb` in either case and nothing else, matching the
 * backend's `normalize_color`: colors come from other people's profiles.
 */
export function normalizeHex(raw: unknown): string | null {
  if (typeof raw !== "string" || !SHORT_OR_LONG.test(raw)) return null;
  const hex = raw.slice(1).toLowerCase();
  return hex.length === 3 ? "#" + [...hex].map((c) => c + c).join("") : "#" + hex;
}

/** `[r, g, b]` from `#rgb`, `#rrggbb` or `#rrggbbaa` (alpha ignored). */
function rgb(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color.trim());
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG 2.x relative luminance of an sRGB color. */
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.x contrast ratio (1–21); `NaN` if either color doesn't parse. */
export function contrastRatio(a: string, b: string): number {
  const ca = rgb(a);
  const cb = rgb(b);
  if (!ca || !cb) return NaN;
  const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Too close to `background` to read without an outline? */
export function isLowContrast(color: string, background: string): boolean {
  const ratio = contrastRatio(color, background);
  return !Number.isNaN(ratio) && ratio < LOW_CONTRAST_RATIO;
}
