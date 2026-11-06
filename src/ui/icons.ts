// Inline SVG icons.
//
// Glyph icons (Unicode symbols, emoji) are at the mercy of whichever font the
// platform falls back to for that code point: on WebKitGTK a symbol the
// monospace font lacks is drawn from some other font with its own size,
// baseline and side bearings, so it sits visibly off-centre in its button —
// and an emoji comes out in colour, ignoring the theme. An SVG drawn with
// `currentColor` avoids both: it is the same shape everywhere, sized by the
// button's font-size (1em), and takes the button's colour and hover colour.

const SVG_NS = "http://www.w3.org/2000/svg";

/** Build an `<svg class="icon">` on a 24×24 grid from stroke-only children. */
function strokeIcon(children: Array<[string, Record<string, string>]>): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const [tag, attrs] of children) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.appendChild(el);
  }
  return svg;
}

/** Magnifying glass. */
export function searchIcon(): SVGSVGElement {
  return strokeIcon([
    ["circle", { cx: "10.5", cy: "10.5", r: "6.5" }],
    ["line", { x1: "15.5", y1: "15.5", x2: "20.5", y2: "20.5" }],
  ]);
}

/**
 * Inbox tray with an arrow dropping in — pending invites. Not an envelope:
 * that glyph already stands for the Direct Messages pseudo-space.
 */
export function inviteIcon(): SVGSVGElement {
  return strokeIcon([
    ["path", { d: "M3.5 13.5h4.5l1.5 2.5h5l1.5-2.5h4.5", "stroke-linejoin": "round" }],
    ["path", { d: "M3.5 13.5V19.5h17v-6", "stroke-linejoin": "round" }],
    ["line", { x1: "12", y1: "3.5", x2: "12", y2: "11" }],
    ["polyline", { points: "8.5,8 12,11.5 15.5,8", "stroke-linejoin": "round" }],
  ]);
}

/** Gear — settings. Eight teeth around a hub, drawn as strokes. */
export function settingsIcon(): SVGSVGElement {
  const teeth: Array<[string, Record<string, string>]> = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const r1 = 7.2;
    const r2 = 10;
    teeth.push(["line", {
      x1: (12 + r1 * Math.cos(a)).toFixed(2), y1: (12 + r1 * Math.sin(a)).toFixed(2),
      x2: (12 + r2 * Math.cos(a)).toFixed(2), y2: (12 + r2 * Math.sin(a)).toFixed(2),
    }]);
  }
  return strokeIcon([
    ["circle", { cx: "12", cy: "12", r: "6" }],
    ["circle", { cx: "12", cy: "12", r: "2.2" }],
    ...teeth,
  ]);
}

/** Plus — create. */
export function plusIcon(): SVGSVGElement {
  return strokeIcon([
    ["line", { x1: "12", y1: "5", x2: "12", y2: "19" }],
    ["line", { x1: "5", y1: "12", x2: "19", y2: "12" }],
  ]);
}
