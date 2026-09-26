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
