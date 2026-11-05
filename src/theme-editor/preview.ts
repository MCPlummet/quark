// Live preview: the real client from docs/demo (built in ?debug mock mode),
// themed from outside.
//
// The demo is same-origin (quark.tel/demo/), so we reach into its document and
// keep one <style> element in it holding the theme's custom properties. They
// are `!important` on purpose: the app applies its own startup theme as inline
// custom properties on :root, and an important author declaration outranks a
// normal inline one — so the preview wins regardless of when the app boots or
// whether someone types `:theme` inside it. The CSS comes from the same
// themeToCssVars the app's applyTheme uses, so the preview cannot drift from
// what quark renders.

import { themeToCssVars, type Theme } from "../theme/loader.js";

const STYLE_ID = "quark-theme-editor";

/** The app switches to its mobile drawer layout at ≤768px. */
const DESKTOP_MIN_W = 900;
const DESKTOP_H = 700;
const MOBILE_W = 400;
const MOBILE_H = 760;
/** Narrower than this, a scaled desktop layout is unreadable: show mobile. */
const STAGE_DESKTOP_MIN = 560;

export function themeCss(theme: Theme): string {
  const decls = Object.entries(themeToCssVars(theme))
    .map(([prop, value]) => `  ${prop}: ${value} !important;`)
    .join("\n");
  return `:root {\n${decls}\n}\n`;
}

export class Preview {
  private readonly iframe: HTMLIFrameElement;
  private css = "";
  private frame = 0;

  constructor(
    private readonly stage: HTMLElement,
    src: string,
  ) {
    this.iframe = document.createElement("iframe");
    this.iframe.className = "te-iframe";
    this.iframe.title = "Quark preview";
    this.iframe.addEventListener("load", () => {
      this.stage.classList.remove("demo-loading");
      this.inject();
    });
    this.iframe.src = src;
    stage.append(this.iframe);

    new ResizeObserver(() => this.fit()).observe(stage);
    this.fit();
  }

  setTheme(theme: Theme): void {
    this.css = themeCss(theme);
    // Colour pickers fire input events far faster than frames; coalesce.
    if (!this.frame) {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.inject();
      });
    }
  }

  private inject(): void {
    let doc: Document | null;
    try {
      doc = this.iframe.contentDocument;
    } catch {
      doc = null;
    }
    if (!doc) {
      // Cross-origin (e.g. the page opened from disk): the demo still runs,
      // just in its own theme.
      this.stage.dataset.note = "preview unavailable here — serve the site over http";
      return;
    }
    if (!doc.head) return; // still parsing; the load event will retry
    let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = doc.createElement("style");
      style.id = STYLE_ID;
    }
    // Keep it last in <head> so it also follows any stylesheet added later.
    if (style !== doc.head.lastElementChild) doc.head.append(style);
    if (style.textContent !== this.css) style.textContent = this.css;
  }

  /**
   * Render the client at a fixed logical size and scale it into the stage —
   * a desktop width wide enough for the three-pane layout, or the phone
   * layout when the stage is too narrow for that to stay legible.
   */
  private fit(): void {
    const w = this.stage.clientWidth;
    if (!w) return;
    const desktop = w >= STAGE_DESKTOP_MIN;
    const logicalW = desktop ? Math.max(w, DESKTOP_MIN_W) : MOBILE_W;
    const logicalH = desktop ? DESKTOP_H : MOBILE_H;
    const scale = Math.min(1, w / logicalW);
    this.iframe.width = String(logicalW);
    this.iframe.height = String(logicalH);
    this.iframe.style.transform = scale < 1 ? `scale(${scale})` : "";
    if (!desktop) this.iframe.style.marginInline = `${(w - logicalW * scale) / 2}px`;
    else this.iframe.style.marginInline = "";
    this.stage.style.height = `${logicalH * scale}px`;
  }
}
