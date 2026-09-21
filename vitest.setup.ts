// jsdom does not provide the CSS global, but components use CSS.escape() to
// build attribute selectors from user-controlled IDs. Minimal escape for tests:
// backslash-escape everything outside [a-zA-Z0-9_-].
if (typeof (globalThis as { CSS?: unknown }).CSS === "undefined") {
  (globalThis as { CSS?: unknown }).CSS = {};
}
const css = (globalThis as { CSS: { escape?: (v: string) => string } }).CSS;
if (typeof css.escape !== "function") {
  css.escape = (value: string): string =>
    String(value).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

// jsdom implements no layout, so Element.scrollIntoView is simply absent —
// calling it throws rather than no-oping. Components that keep a focused row in
// view (the command palette, the autocomplete popovers, the room directory,
// the timeline) would each have to guard a call that is unconditionally present
// in every real browser. Stub it once here instead.
if (typeof Element !== "undefined" && typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = function scrollIntoView(): void { /* no layout in jsdom */ };
}
