// Image lightbox — full-screen viewer with zoom, pan, and download

import { modalManager, type Modal } from "./ModalManager.js";

export class ImageLightbox implements Modal {
  private _el: HTMLElement;
  private _imgEl: HTMLImageElement;
  private _zoomLabel: HTMLElement;
  private _scale = 1;
  private _panX = 0;
  private _panY = 0;
  private _dragging = false;
  private _dragStartX = 0;
  private _dragStartY = 0;
  private _panStartX = 0;
  private _panStartY = 0;
  private _currentSrc = "";
  private _currentAlt = "";

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "image-lightbox";
    this._el.setAttribute("role", "dialog");
    this._el.setAttribute("aria-label", "Image viewer");
    this._el.setAttribute("aria-modal", "true");

    // Close on backdrop click (but not after a drag)
    this._el.addEventListener("click", (e) => {
      if (this._dragging) return;
      if (e.target === this._el || e.target === this._imgWrap) this.hide();
    });

    // Image wrapper
    const imgWrap = document.createElement("div");
    imgWrap.className = "image-lightbox__img-wrap";
    this._imgWrap = imgWrap;

    this._imgEl = document.createElement("img");
    this._imgEl.className = "image-lightbox__img";
    this._imgEl.alt = "";
    imgWrap.appendChild(this._imgEl);
    this._el.appendChild(imgWrap);

    // Pan via mouse drag
    imgWrap.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this._dragging = false;
      this._dragStartX = e.clientX;
      this._dragStartY = e.clientY;
      this._panStartX = this._panX;
      this._panStartY = this._panY;
      imgWrap.style.cursor = "grabbing";
      // Suppress the CSS transition while dragging so the image tracks the
      // cursor exactly. Transitions restart on every transform change, which
      // at mousemove frequency (~60fps) causes a visible stutter/vibration.
      this._imgEl.style.transition = "none";

      const onMove = (me: MouseEvent) => {
        const dx = me.clientX - this._dragStartX;
        const dy = me.clientY - this._dragStartY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this._dragging = true;
        this._panX = this._panStartX + dx;
        this._panY = this._panStartY + dy;
        this._applyTransform();
      };
      const onUp = () => {
        this._imgEl.style.transition = "";
        imgWrap.style.cursor = this._scale > 1 ? "grab" : "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        // Defer _dragging reset so the backdrop click handler sees it
        requestAnimationFrame(() => { this._dragging = false; });
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });

    // Zoom with scroll wheel — suppress transition while scrolling (same
    // reason as drag: the 150ms ease restarts on every wheel event, causing
    // jitter on trackpads). Restore once scrolling pauses for 200ms.
    let _wheelDebounce: ReturnType<typeof setTimeout> | null = null;
    imgWrap.addEventListener("wheel", (e) => {
      e.preventDefault();
      this._imgEl.style.transition = "none";
      if (_wheelDebounce !== null) clearTimeout(_wheelDebounce);
      _wheelDebounce = setTimeout(() => {
        this._imgEl.style.transition = "";
        _wheelDebounce = null;
      }, 200);
      // Proportional to deltaY so trackpad gestures feel natural. A sensitivity
      // of 0.005 gives ~0.5 per mouse-wheel notch (deltaY ≈ 100) and a gentle
      // ~0.05 per light trackpad tick (deltaY ≈ 10). Cap at 0.3 per event so a
      // fast flick doesn't jump the scale in one shot.
      const delta = -Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY) * 0.005, 0.3);
      this._setScale(Math.min(5, Math.max(0.25, this._scale + delta)));
    }, { passive: false });

    // Toolbar
    const toolbar = document.createElement("div");
    toolbar.className = "image-lightbox__toolbar";

    // Zoom controls are hidden on mobile (see base.css) — pinch + double-tap
    // cover them there — so they share a class the mobile rules can target.
    const zoomInBtn = this._makeBtn("zoom +", () => this._zoom(0.25));
    const zoomOutBtn = this._makeBtn("zoom -", () => this._zoom(-0.25));
    const resetBtn = this._makeBtn("1:1", () => this._setScale(1));
    zoomInBtn.classList.add("image-lightbox__zoom-ctl");
    zoomOutBtn.classList.add("image-lightbox__zoom-ctl");
    resetBtn.classList.add("image-lightbox__zoom-ctl");

    this._zoomLabel = document.createElement("span");
    this._zoomLabel.className = "image-lightbox__zoom-label image-lightbox__zoom-ctl";
    this._zoomLabel.textContent = "100%";

    const downloadBtn = this._makeBtn("⬇ download", () => this._download());
    const closeBtn = this._makeBtn("✕ close", () => this.hide());
    closeBtn.classList.add("image-lightbox__close");

    toolbar.appendChild(zoomOutBtn);
    toolbar.appendChild(zoomInBtn);
    toolbar.appendChild(resetBtn);
    toolbar.appendChild(this._zoomLabel);
    toolbar.appendChild(downloadBtn);
    toolbar.appendChild(closeBtn);
    this._el.appendChild(toolbar);

    // Keyboard handler
    this._el.addEventListener("keydown", (e) => this._handleKey(e));

    // Touch: pinch-to-zoom, one-finger pan, double-tap to toggle zoom.
    this._initTouch();
  }

  // Pinch-to-zoom + one-finger pan for touch devices. Driven by the events
  // themselves (not the mobile breakpoint), so it also works on touch laptops.
  private _initTouch(): void {
    const wrap = this._imgWrap;
    let mode: "none" | "pan" | "pinch" = "none";
    // Pan baseline.
    let panStartTouchX = 0;
    let panStartTouchY = 0;
    let panStartX = 0;
    let panStartY = 0;
    // Pinch baseline: wrap geometry + the content point pinned under the
    // gesture centroid, so zoom stays anchored where the fingers are.
    let startDist = 0;
    let startScale = 1;
    let rectLeft = 0;
    let rectTop = 0;
    let centreX = 0;
    let centreY = 0;
    let contentX = 0;
    let contentY = 0;
    let lastTapTime = 0;

    const dist = (a: Touch, b: Touch): number =>
      Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);

    const beginPan = (t: Touch): void => {
      mode = "pan";
      panStartTouchX = t.clientX;
      panStartTouchY = t.clientY;
      panStartX = this._panX;
      panStartY = this._panY;
      this._imgEl.style.transition = "none";
    };

    const beginPinch = (e: TouchEvent): void => {
      mode = "pinch";
      const rect = wrap.getBoundingClientRect();
      rectLeft = rect.left;
      rectTop = rect.top;
      centreX = rect.width / 2;
      centreY = rect.height / 2;
      startDist = dist(e.touches[0], e.touches[1]);
      startScale = this._scale;
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rectLeft;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rectTop;
      // Transform origin is the image centre, so content offset = (point − centre − pan) / scale.
      contentX = (cx - centreX - this._panX) / this._scale;
      contentY = (cy - centreY - this._panY) / this._scale;
      this._dragging = true; // suppress backdrop-close after the gesture
      this._imgEl.style.transition = "none";
    };

    wrap.addEventListener("touchstart", (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        beginPinch(e);
        return;
      }
      if (e.touches.length === 1) {
        const now = Date.now();
        if (now - lastTapTime < 300) {
          e.preventDefault();
          this._setScale(this._scale > 1 ? 1 : 2.5);
          lastTapTime = 0;
          mode = "none";
          return;
        }
        lastTapTime = now;
        this._dragging = false;
        beginPan(e.touches[0]);
      }
    }, { passive: false });

    wrap.addEventListener("touchmove", (e) => {
      if (mode === "pinch" && e.touches.length === 2) {
        e.preventDefault();
        const ratio = dist(e.touches[0], e.touches[1]) / startDist;
        this._scale = Math.min(5, Math.max(0.25, startScale * ratio));
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rectLeft;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rectTop;
        // Keep the pinned content point under the (possibly moved) centroid.
        this._panX = cx - centreX - contentX * this._scale;
        this._panY = cy - centreY - contentY * this._scale;
        this._zoomLabel.textContent = `${Math.round(this._scale * 100)}%`;
        this._applyTransform();
      } else if (mode === "pan" && e.touches.length === 1) {
        e.preventDefault();
        const dx = e.touches[0].clientX - panStartTouchX;
        const dy = e.touches[0].clientY - panStartTouchY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this._dragging = true;
        this._panX = panStartX + dx;
        this._panY = panStartY + dy;
        this._applyTransform();
      }
    }, { passive: false });

    const end = (e: TouchEvent): void => {
      if (e.touches.length === 0) {
        this._imgEl.style.transition = "";
        // A pinch can leave scale ≤ 1; _setScale re-centres and refreshes the label.
        if (this._scale <= 1) this._setScale(this._scale);
        mode = "none";
        requestAnimationFrame(() => { this._dragging = false; });
      } else if (e.touches.length === 1) {
        // Lifting one finger of a pinch → continue as a one-finger pan.
        beginPan(e.touches[0]);
      }
    };
    wrap.addEventListener("touchend", end);
    wrap.addEventListener("touchcancel", end);
  }

  private _imgWrap!: HTMLElement;

  getElement(): HTMLElement {
    return this._el;
  }

  isVisible(): boolean {
    return this._el.classList.contains("image-lightbox--open");
  }

  show(src: string, alt?: string): void {
    this._currentSrc = src;
    this._currentAlt = alt ?? "";
    this._imgEl.src = src;
    this._imgEl.alt = alt ?? "";
    this._panX = 0;
    this._panY = 0;
    this._setScale(1);
    this._el.classList.add("image-lightbox--open");
    this._el.setAttribute("tabindex", "-1");
    this._el.focus();
    modalManager.push(this);
  }

  hide(): void {
    this._el.classList.remove("image-lightbox--open");
    this._imgEl.src = "";
    this._currentSrc = "";
    modalManager.remove(this);
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _makeBtn(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "image-lightbox__btn";
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  }

  private _zoom(delta: number): void {
    this._setScale(Math.min(5, Math.max(0.25, this._scale + delta)));
  }

  private _setScale(scale: number): void {
    this._scale = scale;
    if (scale <= 1) {
      this._panX = 0;
      this._panY = 0;
    }
    this._applyTransform();
    this._zoomLabel.textContent = `${Math.round(scale * 100)}%`;
    this._imgWrap.style.cursor = scale > 1 ? "grab" : "";
  }

  private _applyTransform(): void {
    this._clampPan();
    this._imgEl.style.transform =
      `translate(${this._panX}px, ${this._panY}px) scale(${this._scale})`;
  }

  // Keep the image from being dragged off-screen. Once it's larger than its
  // container (zoomed past fit) pan is bounded so an edge can't cross the
  // viewport centre; while it still fits, pan is pinned to 0 (centred).
  private _clampPan(): void {
    const wrapW = this._imgWrap.clientWidth;
    const wrapH = this._imgWrap.clientHeight;
    // offsetWidth/Height are the laid-out size before transform, so scale here.
    const imgW = this._imgEl.offsetWidth * this._scale;
    const imgH = this._imgEl.offsetHeight * this._scale;
    if (!imgW || !imgH) return; // image not laid out yet
    const maxX = Math.max(0, (imgW - wrapW) / 2);
    const maxY = Math.max(0, (imgH - wrapH) / 2);
    this._panX = Math.min(maxX, Math.max(-maxX, this._panX));
    this._panY = Math.min(maxY, Math.max(-maxY, this._panY));
  }

  private _download(): void {
    if (!this._currentSrc) return;
    const a = document.createElement("a");
    a.href = this._currentSrc;
    a.download = this._currentAlt || "image";
    a.click();
  }

  private _handleKey(e: KeyboardEvent): void {
    e.stopPropagation();
    // Ctrl+[ is the vim equivalent of Escape — close the lightbox.
    if (e.ctrlKey && e.key === "[") {
      e.preventDefault();
      this.hide();
      return;
    }
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        this.hide();
        break;
      case "+":
      case "=":
        e.preventDefault();
        this._zoom(0.25);
        break;
      case "-":
        e.preventDefault();
        this._zoom(-0.25);
        break;
      case "0":
        e.preventDefault();
        this._panX = 0;
        this._panY = 0;
        this._setScale(1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        this._panX += 40;
        this._applyTransform();
        break;
      case "ArrowRight":
        e.preventDefault();
        this._panX -= 40;
        this._applyTransform();
        break;
      case "ArrowUp":
        e.preventDefault();
        this._panY += 40;
        this._applyTransform();
        break;
      case "ArrowDown":
        e.preventDefault();
        this._panY -= 40;
        this._applyTransform();
        break;
    }
  }
}
