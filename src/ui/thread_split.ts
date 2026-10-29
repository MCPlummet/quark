// The thread split — an open thread drawn *in* the timeline. The room parts at
// the thread's root, the rows above sliding up and the rows below sliding down,
// and the thread panel opens in the gap.
//
// Only paint moves. The panel is still ThreadView's overlay in .timeline-wrap,
// never a row in the scroller (#132); the parting is a pair of translateY
// transforms on the rows either side of the root. They are written as one
// generated stylesheet keyed on the root's event ID rather than as classes on
// rows, so they hold when the windowed renderer rebuilds the list underneath.
// A transform changes neither layout nor scroll position: the frozen room's
// scrollTop, rendered window and cull see nothing at all.

/** What the split needs from the timeline. `Timeline` provides it. */
export interface SplitHost {
  /** `.timeline-wrap`: the region the panel is positioned in. */
  getElement(): HTMLElement;
  getScrollElement(): HTMLElement;
  getListElement(): HTMLElement;
  getMessageElementById(eventId: string): HTMLElement | null;
}

/** On `.timeline-wrap` while a split is drawn; scopes the generated rules. */
export const SPLIT_CLASS = "timeline-wrap--thread-split";
/** On `.timeline-wrap` for the frame the split comes off: the root's box gets
 *  its own frame back at once, not by fading in from transparent. */
const SETTLING_CLASS = "timeline-wrap--thread-settling";

const DURATION_MS = 240;
const EASING = "cubic-bezier(0.25, 0.46, 0.45, 0.94)";
/** Least distance between the panel and the top or bottom of the region. */
const EDGE_PX = 12;
/** Space between the panel and the halves of the room either side of it. */
const GAP_PX = 8;
/** How far the clip reaches past the panel at rest, so its shadow shows. */
const SHADOW_PX = 32;
/** Corner radius of the panel — and of a group box's halves — in px. */
const RADIUS_PX = 8;
/** The most the room's scroll position is put back by (see `_holdScroll`). */
const NUDGE_PX = 2;

export interface SplitInput {
  /** Height of the timeline region. */
  viewport: number;
  /** The band of the room the panel stands in for (the root's row, or its
   *  whole box when the root is alone in it), in region coordinates, before
   *  any split transform. */
  seamTop: number;
  seamBottom: number;
  /** Top of the root's row: the panel lines its own root row up with it when
   *  there is room, so the message reads as opening into its thread. */
  anchor: number;
  panelHeight: number;
  /** Offset of the panel's root row from the panel's top (its header). */
  rootOffset: number;
  /** Where the panel already is. Once open it stays put: the room moving
   *  underneath (a message landing at the tail pushes the root up) moves the
   *  halves to stay flush with it instead, so nothing on screen shifts. */
  pinnedTop?: number;
}

export interface SplitLayout {
  panelTop: number;
  /** translateY for the room above the seam, and for the room below it. */
  before: number;
  after: number;
  /** The seam band in the panel's own coordinates, as clip insets: the panel
   *  unfolds from it and folds back into it. */
  clipTop: number;
  clipBottom: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Where the panel goes and how far each half of the room moves to make room
 *  for it. The panel never leaves the region: near an edge it is pushed back
 *  in, and the halves move further to stay flush with it. */
export function computeSplit(i: SplitInput): SplitLayout {
  const maxTop = Math.max(EDGE_PX, i.viewport - EDGE_PX - i.panelHeight);
  const panelTop = clamp(i.pinnedTop ?? i.anchor - i.rootOffset, EDGE_PX, maxTop);
  const panelBottom = panelTop + i.panelHeight;
  const clipTop = clamp(i.seamTop - panelTop, 0, i.panelHeight);
  return {
    panelTop,
    before: panelTop - GAP_PX - i.seamTop,
    after: panelBottom + GAP_PX - i.seamBottom,
    clipTop,
    clipBottom: clamp(panelBottom - i.seamBottom, 0, i.panelHeight - clipTop),
  };
}

/** The root as the timeline currently draws it, in region coordinates with
 *  the split's own transforms taken out. */
interface Seam {
  /** False when the root is not in the rendered window: the thread then opens
   *  from the top edge, where older history is, and the whole room moves down. */
  rendered: boolean;
  top: number;
  bottom: number;
  anchor: number;
  /** The panel's horizontal extent — the root's box — or null for the CSS default. */
  left: number | null;
  width: number | null;
  /** The root's group box, when it shares one: the box is split in two around
   *  the panel rather than torn, so each half keeps a frame. */
  group: { top: number; rowTop: number; rowBottom: number; first: boolean; last: boolean } | null;
}

/** The translateY an element is drawn with right now — mid-transition too. */
function currentTranslateY(el: Element): number {
  const t = getComputedStyle(el).transform;
  const m = t?.match(/^matrix(3d)?\((.+)\)$/);
  if (!m) return 0;
  const v = m[2].split(",").map(Number);
  return (m[1] ? v[13] : v[5]) || 0;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export class TimelineSplit {
  private _rootId: string | null = null;
  private _style: HTMLStyleElement | null = null;
  private _resize: ResizeObserver | null = null;
  /** Last size seen per observed element: ResizeObserver also reports the
   *  initial size on observe, which must not cut the unfold short. */
  private _sizes = new Map<Element, string>();
  private _closing: {
    timer: ReturnType<typeof setTimeout>;
    mutations: MutationObserver | null;
    onEnd: (e: TransitionEvent) => void;
    done: () => void;
  } | null = null;
  /** The unfold waits a frame (see open); this is that frame. */
  private _pendingOpen: number | null = null;
  /** Where the panel was placed, once unfolded (see SplitInput.pinnedTop). */
  private _panelTop: number | null = null;
  /** The room's scrollTop as the split found it (see `_holdScroll`). */
  private _scrollTop: number | null = null;
  private readonly _onScroll = () => {
    if (!this._holdScroll()) this._relayout(false);
  };

  constructor(
    private readonly _host: SplitHost,
    private readonly _panel: HTMLElement,
    /** Offset of the panel's root row from its top. */
    private readonly _rootOffset: () => number,
  ) {}

  /** Part the room at `rootId` and unfold the panel into the gap. The panel
   *  must already be displayed, so it can be measured.
   *
   *  The measuring waits for the next frame (before it is painted): opening a
   *  thread also freezes the room and puts a banner over the composer, which
   *  shrinks the region, and measuring before that would have the first
   *  re-layout cut the unfold short. */
  open(rootId: string): void {
    this.settle();
    this._cancelPendingOpen();
    this._unobserve();
    this._rootId = rootId;
    this._host.getElement().classList.add(SPLIT_CLASS);
    // Out of sight until placed — no frame may show it at its CSS default.
    this._panel.style.visibility = "hidden";
    if (typeof requestAnimationFrame === "undefined") {
      this._unfold();
      return;
    }
    this._pendingOpen = requestAnimationFrame(() => {
      this._pendingOpen = null;
      this._unfold();
    });
  }

  private _unfold(): void {
    if (!this._rootId) return;
    this._panel.style.visibility = "";
    const seam = this._measure();
    const layout = this._layoutFor(seam);
    // Frame 0: the panel folded into the seam band, the room at rest — with
    // the rules already in place, so the box halves' frames (pseudo-elements
    // the rules create) exist at rest too. Commit it: a transition needs a
    // style to start from, and an element that only just appeared has none.
    this._placePanel(seam, layout, { folded: true, animate: false });
    this._scrollTop = this._host.getScrollElement().scrollTop;
    this._host.getScrollElement().addEventListener("scroll", this._onScroll, { passive: true });
    this._writeRules(seam, { ...layout, before: 0, after: 0 }, false);
    void this._panel.offsetHeight;
    const animate = !prefersReducedMotion();
    this._placePanel(seam, layout, { folded: false, animate });
    this._writeRules(seam, layout, animate);
    this._observe();
  }

  /** Fold the panel back into the root and close the room over it, then call
   *  `done` (at once when there is nothing to animate). */
  close(done: () => void): void {
    this.settle();
    this._unobserve();
    const unfolded = this._pendingOpen === null;
    this._cancelPendingOpen();
    if (!this._rootId || !unfolded || prefersReducedMotion()) {
      this._teardown();
      done();
      return;
    }
    const seam = this._measure();
    const layout = this._layoutFor(seam);
    this._placePanel(seam, layout, { folded: true, animate: true });
    this._writeRules(seam, { ...layout, before: 0, after: 0 }, true);

    // A re-render mid-fold — the room being switched away, usually — means the
    // rows being animated are not the ones the split was measured on: finish
    // at once rather than slide the new room's rows into place.
    const mutations = typeof MutationObserver !== "undefined"
      ? new MutationObserver(() => this.settle({ holdScroll: false }))
      : null;
    mutations?.observe(this._host.getListElement(), { childList: true });
    // The fold ends with the panel's clip; the timer is for a transition that
    // never runs (the panel already folded, a hidden tab).
    const onEnd = (e: TransitionEvent) => {
      if (e.target === this._panel && e.propertyName === "clip-path") this.settle();
    };
    this._panel.addEventListener("transitionend", onEnd);
    this._closing = { timer: setTimeout(() => this.settle(), DURATION_MS * 4), mutations, onEnd, done };
  }

  /** Finish a running fold now. `holdScroll: false` when the room has been
   *  re-rendered — its scroll position is no longer the one the split found. */
  settle(opts: { holdScroll?: boolean } = {}): void {
    const closing = this._closing;
    if (!closing) return;
    this._closing = null;
    clearTimeout(closing.timer);
    closing.mutations?.disconnect();
    this._panel.removeEventListener("transitionend", closing.onEnd);
    this._teardown(opts.holdScroll ?? true);
    closing.done();
  }

  private _cancelPendingOpen(): void {
    if (this._pendingOpen === null) return;
    cancelAnimationFrame(this._pendingOpen);
    this._pendingOpen = null;
  }

  // ── Layout ──────────────────────────────────────────────────────────────

  /**
   * Put back a nudge of the room's scroll position. The halves' transforms
   * count toward the scroller's scrollable overflow, and WebKit re-anchors a
   * `column-reverse` scroller by a rounding pixel when that overflow changes
   * (any upward transform of the list will do it) — a scroll the split must
   * not cause. A larger move is real (the timeline re-pinning to its tail)
   * and becomes the position to hold. True when it wrote.
   */
  private _holdScroll(): boolean {
    const scroll = this._host.getScrollElement();
    if (this._scrollTop === null || scroll.scrollTop === this._scrollTop) return false;
    if (Math.abs(scroll.scrollTop - this._scrollTop) > NUDGE_PX) {
      this._scrollTop = scroll.scrollTop;
      return false;
    }
    scroll.scrollTop = this._scrollTop;
    return true;
  }

  /** Re-measure and re-place after the room or the panel changed size.
   *  `animate` for the panel's own growth (replies arriving); the room's
   *  changes snap, so a message landing underneath never shows as a wobble. */
  private _relayout(animate: boolean): void {
    if (!this._rootId || this._closing) return;
    const seam = this._measure();
    const layout = this._layoutFor(seam);
    animate &&= !prefersReducedMotion();
    this._placePanel(seam, layout, { folded: false, animate });
    this._writeRules(seam, layout, animate);
  }

  private _layoutFor(seam: Seam): SplitLayout {
    const layout = computeSplit({
      viewport: this._host.getElement().clientHeight,
      seamTop: seam.top,
      seamBottom: seam.bottom,
      anchor: seam.anchor,
      panelHeight: this._panel.offsetHeight,
      rootOffset: this._rootOffset(),
      pinnedTop: this._panelTop ?? undefined,
    });
    this._panelTop = layout.panelTop;
    return layout;
  }

  private _measure(): Seam {
    const wrap = this._host.getElement().getBoundingClientRect();
    const row = this._rootId ? this._host.getMessageElementById(this._rootId) : null;
    if (!row) return { rendered: false, top: 0, bottom: 0, anchor: 0, left: null, width: null, group: null };

    // Everything measured here sits above the seam, so the list's transform is
    // the only split transform on it.
    const shift = currentTranslateY(this._host.getListElement());
    const y = (r: DOMRect) => ({ top: r.top - wrap.top - shift, bottom: r.bottom - wrap.top - shift });
    const rowBox = y(row.getBoundingClientRect());

    const groupEl = row.parentElement?.classList.contains("message-group") ? row.parentElement : null;
    const boxRect = (groupEl ?? row).getBoundingClientRect();
    const horizontal = { left: boxRect.left - wrap.left, width: boxRect.width };
    if (!groupEl) return { rendered: true, ...rowBox, anchor: rowBox.top, ...horizontal, group: null };

    const rows = Array.from(groupEl.children).filter((c) => c.classList.contains("message"));
    const first = rows[0] === row;
    const last = rows[rows.length - 1] === row;
    const groupBox = y(groupEl.getBoundingClientRect());
    const legend = groupEl.querySelector(":scope > .message-group__header");
    // Alone at an end of its box, the root takes that end of the frame with
    // it — the sender legend on top, the bottom border below.
    const top = first ? Math.min(groupBox.top, legend ? y(legend.getBoundingClientRect()).top : groupBox.top) : rowBox.top;
    const bottom = last ? groupBox.bottom : rowBox.bottom;
    return {
      rendered: true,
      top,
      bottom,
      anchor: rowBox.top,
      ...horizontal,
      group: { top: groupBox.top, rowTop: rowBox.top, rowBottom: rowBox.bottom, first, last },
    };
  }

  // ── Painting ────────────────────────────────────────────────────────────

  private _transition(animate: boolean, ...props: string[]): string {
    return animate ? props.map((p) => `${p} ${DURATION_MS}ms ${EASING}`).join(", ") : "none";
  }

  private _placePanel(seam: Seam, l: SplitLayout, opts: { folded: boolean; animate: boolean }): void {
    const s = this._panel.style;
    s.transition = this._transition(opts.animate, "transform", "clip-path");
    s.transform = `translateY(${l.panelTop}px)`;
    s.clipPath = opts.folded
      ? `inset(${l.clipTop}px ${-SHADOW_PX}px ${l.clipBottom}px ${-SHADOW_PX}px round ${RADIUS_PX}px)`
      : `inset(${-SHADOW_PX}px round ${RADIUS_PX}px)`;
    s.left = seam.left === null ? "" : `${seam.left}px`;
    s.width = seam.width === null ? "" : `${seam.width}px`;
    s.right = seam.width === null ? "" : "auto";
  }

  /** The room's half of the split, as one stylesheet keyed on the root. */
  private _writeRules(seam: Seam, l: SplitLayout, animate: boolean): void {
    if (!this._rootId) return;
    const w = `.${SPLIT_CLASS}`;
    // Every selector naming the root is scoped to the room's list: the panel's
    // own root row carries the same data-message-id.
    const list = `${w} .timeline__list`;
    const root = `[data-message-id="${CSS.escape(this._rootId)}"]`;
    const move = (y: number) => `transform: translateY(${y}px); transition: ${this._transition(animate, "transform")};`;
    const rules: string[] = [];

    if (!seam.rendered) {
      // Nothing of the root on screen: the whole room is "below" it.
      rules.push(`${list} { ${move(l.after)} }`);
    } else {
      // The list carries the upper half; the lower half moves the rest of the
      // way on top of that.
      rules.push(`${list} { ${move(l.before)} }`);
      rules.push(
        `${list} > :has(${root}) ~ *, ` +
        `${list} > ${root} ~ *, ` +
        `${list} .message-group > ${root} ~ .message { ${move(l.after - l.before)} }`,
      );
      // The panel stands in for the root; nothing of it may peek past an edge.
      rules.push(`${list} ${root} { visibility: hidden; }`);
    }

    const g = seam.group;
    if (g) {
      const box = `${list} .message-group:has(> ${root})`;
      const frame =
        "content: \"\"; position: absolute; left: calc(-1 * var(--border-width)); " +
        "right: calc(-1 * var(--border-width)); border: var(--border-width) solid var(--border-color); " +
        `border-radius: ${RADIUS_PX}px; pointer-events: none;`;
      // The box's own frame would run straight through the panel; each half of
      // the box draws its own instead.
      rules.push(`${box} { border-color: transparent !important; box-shadow: none !important; }`);
      if (g.first) rules.push(`${box} > .message-group__header { visibility: hidden; }`);
      else rules.push(`${box}::before { ${frame} top: calc(-1 * var(--border-width)); height: ${g.rowTop - g.top}px; }`);
      if (!g.last) {
        rules.push(
          `${box}::after { ${frame} top: calc(${g.rowBottom - g.top}px - var(--border-width)); ` +
          `bottom: calc(-1 * var(--border-width)); ${move(l.after - l.before)} }`,
        );
        // The next message's dashed divider would double the new top border.
        rules.push(`${list} .message-group > ${root} + .message { border-top-color: transparent; }`);
      }
    }

    if (!this._style) {
      this._style = document.createElement("style");
      this._style.dataset.threadSplit = "";
      document.head.appendChild(this._style);
    }
    this._style.textContent = rules.join("\n");
  }

  private _teardown(holdScroll = true): void {
    const wrap = this._host.getElement();
    if (this._style && typeof requestAnimationFrame !== "undefined") {
      wrap.classList.add(SETTLING_CLASS);
      requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.remove(SETTLING_CLASS)));
    }
    this._style?.remove();
    this._style = null;
    this._rootId = null;
    this._panelTop = null;
    wrap.classList.remove(SPLIT_CLASS);
    // The overflow just shrank back: a last nudge to put back.
    if (holdScroll) this._holdScroll();
    this._scrollTop = null;
    this._host.getScrollElement().removeEventListener("scroll", this._onScroll);
    const s = this._panel.style;
    s.transition = s.transform = s.clipPath = s.left = s.width = s.right = s.visibility = "";
  }

  // ── Observation ─────────────────────────────────────────────────────────

  private _observe(): void {
    if (typeof ResizeObserver === "undefined") return;
    const targets = [this._host.getListElement(), this._host.getScrollElement(), this._panel];
    const size = (el: Element) => `${(el as HTMLElement).offsetWidth}x${(el as HTMLElement).offsetHeight}`;
    for (const el of targets) this._sizes.set(el, size(el));
    // Callbacks land after layout and before paint, so a re-place made here is
    // on screen in the same frame as the change that caused it.
    this._resize = new ResizeObserver((entries) => {
      const changed = entries.map((e) => e.target).filter((el) => {
        const now = size(el);
        if (this._sizes.get(el) === now) return false;
        this._sizes.set(el, now);
        return true;
      });
      if (changed.length === 0) return;
      this._relayout(changed.every((el) => el === this._panel));
    });
    for (const el of targets) this._resize.observe(el);
  }

  /** Stop following the room's changes. The scroll hold stays on until the
   *  split is fully off (`_teardown`): the fold changes the overflow too. */
  private _unobserve(): void {
    this._resize?.disconnect();
    this._resize = null;
    this._sizes.clear();
  }
}
