// Compose bar with mode indicator

import { Mode } from "../vim/mode.js";
import { isMobile, onMobileChange } from "../app/mobile.js";

const MODE_LABELS: Record<string, string> = {
  Normal: "NOR",
  Insert: "INS",
  Command: "CMD",
  Visual: "VIS",
};

const MODE_CSS_CLASS: Record<string, string> = {
  Normal: "",
  Insert: "input-bar__mode--insert",
  Command: "input-bar__mode--command",
  Visual: "input-bar__mode--visual",
};

export class Input {
  private _el: HTMLElement;
  private _modeEl: HTMLElement;
  private _fieldEl: HTMLTextAreaElement;
  private _composeBoxEl: HTMLElement;
  private _pastePreviewEl: HTMLElement;
  private _pastePreviewImg: HTMLImageElement;
  private _pastePreviewLabelEl: HTMLSpanElement;
  private _inputBarEl: HTMLElement;
  private _pendingImageBlob: Blob | null = null;
  private _pendingImageName: string | null = null;
  private _currentMode: string = "Normal";
  private _onEmojiClick: (() => void) | null = null;
  private _onGifClick: (() => void) | null = null;
  private _onAttachClick: (() => void) | null = null;
  private _onSendClick: (() => void) | null = null;
  private _sendBtnEl: HTMLButtonElement;
  private _onFilePick: ((file: File) => void) | null = null;
  private _onFocusEnterInsert: (() => void) | null = null;
  private _fileInputEl: HTMLInputElement | null = null;
  private _vimMode: boolean = true;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "input-bar-wrap";
    this._el.setAttribute("role", "region");
    this._el.setAttribute("aria-label", "Message input");

    // ── Paste image preview (hidden by default, shown above compose bar) ──
    this._pastePreviewEl = document.createElement("div");
    this._pastePreviewEl.className = "paste-preview";
    this._pastePreviewEl.style.display = "none";
    this._pastePreviewEl.setAttribute("role", "group");
    this._pastePreviewEl.setAttribute("aria-label", "Image paste preview");

    this._pastePreviewImg = document.createElement("img");
    this._pastePreviewImg.className = "paste-preview__img";
    this._pastePreviewImg.alt = "Pasted image";
    this._pastePreviewEl.appendChild(this._pastePreviewImg);

    this._pastePreviewLabelEl = document.createElement("span");
    this._pastePreviewLabelEl.className = "paste-preview__label";
    this._pastePreviewLabelEl.textContent = "Send image?";
    this._pastePreviewEl.appendChild(this._pastePreviewLabelEl);

    // Send routes through the same submit path as the ➤ button so the typed
    // caption / edit precedence logic applies regardless of affordance.
    const sendBtn = document.createElement("button");
    sendBtn.type = "button";
    sendBtn.className = "paste-preview__btn paste-preview__btn--send";
    sendBtn.textContent = "Send";
    sendBtn.addEventListener("click", () => this._onSendClick?.());
    this._pastePreviewEl.appendChild(sendBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "paste-preview__btn paste-preview__btn--cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => this.discardPendingImage());
    this._pastePreviewEl.appendChild(cancelBtn);

    this._el.appendChild(this._pastePreviewEl);

    // ── The actual input bar ──────────────────────────────────────────────
    const inputBar = document.createElement("div");
    inputBar.className = "input-bar";
    this._inputBarEl = inputBar;

    // Mode indicator (stays on far left, full height)
    this._modeEl = document.createElement("span");
    this._modeEl.className = "input-bar__mode";
    this._modeEl.setAttribute("aria-live", "polite");
    this._modeEl.setAttribute("aria-label", "Editor mode");
    this._modeEl.textContent = "NOR";
    inputBar.appendChild(this._modeEl);

    // Compose box — directly after mode indicator, no avatar
    this._composeBoxEl = document.createElement("div");
    this._composeBoxEl.className = "input-bar__compose-box";

    // Text field — a textarea (not an <input>) so Shift+Enter can insert a
    // newline. It starts one row tall and auto-grows with content (#45).
    this._fieldEl = document.createElement("textarea");
    this._fieldEl.rows = 1;
    this._fieldEl.className = "input-bar__field";
    // Autocorrect/autocapitalise/spellcheck are off on desktop (the terminal
    // aesthetic, and vim navigation lives in this field), but on mobile the
    // field is a plain text box with vim disabled — there, users expect the
    // soft keyboard's autocorrect and sentence capitalisation. Re-applied on
    // viewport changes so dev resizing across the breakpoint behaves too.
    this._applyTextAssistAttributes();
    onMobileChange(() => this._applyTextAssistAttributes());
    this._fieldEl.setAttribute("aria-label", "Compose message");
    this._fieldEl.placeholder = "…";
    this._composeBoxEl.appendChild(this._fieldEl);

    // Clicking the field while not in insert mode should switch to insert mode
    this._fieldEl.addEventListener("click", () => this._onFocusEnterInsert?.());

    // Grow with content as the user adds lines (Shift+Enter); capped by the
    // CSS max-height, beyond which the textarea scrolls.
    this._fieldEl.addEventListener("input", () => this._autoGrow());

    // Image paste handler. clipboardData.items is standard; .files is an
    // alternative that some Linux clipboard managers populate instead.
    // On Linux/Wayland, WebKit2GTK text inputs may not expose image data
    // in clipboardData at all, so we also fall back to navigator.clipboard.read().
    this._fieldEl.addEventListener("paste", (e) => {
      // Standard path: items
      const items = e.clipboardData?.items;
      if (items) {
        for (const item of Array.from(items)) {
          if (item.type.startsWith("image/")) {
            const blob = item.getAsFile();
            if (blob) {
              e.preventDefault();
              this.showImagePreview(blob);
              return;
            }
          }
        }
      }
      // Fallback: files list (used by some Linux clipboard managers)
      const files = e.clipboardData?.files;
      if (files && files.length > 0) {
        for (const file of Array.from(files)) {
          if (file.type.startsWith("image/")) {
            e.preventDefault();
            this.showImagePreview(file);
            return;
          }
        }
      }
      // Async fallback: Clipboard API (Linux/Wayland may not populate clipboardData
      // for images pasted into a text input)
      if (typeof navigator !== "undefined" && navigator.clipboard?.read) {
        void navigator.clipboard.read().then((clipItems) => {
          for (const ci of clipItems) {
            for (const type of ci.types) {
              if (type.startsWith("image/")) {
                void ci.getType(type).then((blob) => this.showImagePreview(blob));
                return;
              }
            }
          }
        }).catch(() => { /* Clipboard API unavailable or permission denied */ });
      }
    });

    // Hidden file input — triggered by the attach button
    this._fileInputEl = document.createElement("input");
    this._fileInputEl.type = "file";
    this._fileInputEl.style.display = "none";
    this._fileInputEl.setAttribute("aria-hidden", "true");
    this._fileInputEl.addEventListener("change", () => {
      const file = this._fileInputEl!.files?.[0];
      if (file) {
        this._onFilePick?.(file);
        // Reset so the same file can be picked again
        this._fileInputEl!.value = "";
      }
    });
    this._el.appendChild(this._fileInputEl);

    // Action buttons on the right side of the compose box
    const actionsEl = document.createElement("div");
    actionsEl.className = "input-bar__actions";

    const emojiBtn = document.createElement("button");
    emojiBtn.type = "button";
    emojiBtn.className = "input-bar__action-btn";
    emojiBtn.setAttribute("title", "Emoji picker (Ctrl+E)");
    emojiBtn.setAttribute("aria-label", "Open emoji picker");
    emojiBtn.setAttribute("tabindex", "-1");
    emojiBtn.textContent = "🙂";
    emojiBtn.addEventListener("click", () => this._onEmojiClick?.());
    actionsEl.appendChild(emojiBtn);

    // GIF picker — the emoji picker has a button but the GIF picker was only
    // reachable via Ctrl+G, so it had no mouse/touch affordance.
    const gifBtn = document.createElement("button");
    gifBtn.type = "button";
    gifBtn.className = "input-bar__action-btn input-bar__action-btn--gif";
    gifBtn.setAttribute("title", "GIF picker (Ctrl+G)");
    gifBtn.setAttribute("aria-label", "Open GIF picker");
    gifBtn.setAttribute("tabindex", "-1");
    gifBtn.textContent = "GIF";
    gifBtn.addEventListener("click", () => this._onGifClick?.());
    actionsEl.appendChild(gifBtn);

    const attachBtn = document.createElement("button");
    attachBtn.type = "button";
    attachBtn.className = "input-bar__action-btn";
    attachBtn.setAttribute("title", "Attach file");
    attachBtn.setAttribute("aria-label", "Attach file");
    attachBtn.setAttribute("tabindex", "-1");
    attachBtn.textContent = "📎";
    attachBtn.addEventListener("click", () => this._onAttachClick?.());
    actionsEl.appendChild(attachBtn);

    // Dedicated send button (#4). Hidden by default; shown on mobile or when the
    // send-key behavior means Enter won't send (see app/send_behavior.ts).
    const sendBtn2 = document.createElement("button");
    sendBtn2.type = "button";
    sendBtn2.className = "input-bar__action-btn input-bar__send-btn";
    sendBtn2.setAttribute("title", "Send message");
    sendBtn2.setAttribute("aria-label", "Send message");
    sendBtn2.setAttribute("tabindex", "-1");
    sendBtn2.textContent = "➤";
    sendBtn2.style.display = "none";
    // Don't steal focus from the field on press — keeps the soft keyboard open on
    // mobile and the caret in place after sending.
    sendBtn2.addEventListener("mousedown", (e) => e.preventDefault());
    sendBtn2.addEventListener("click", () => this._onSendClick?.());
    actionsEl.appendChild(sendBtn2);
    this._sendBtnEl = sendBtn2;

    this._composeBoxEl.appendChild(actionsEl);

    inputBar.appendChild(this._composeBoxEl);

    // No mobile formatting toolbar: a custom HTML bar duplicates the native
    // selection callout poorly, and surfacing real B/I/U/strike/spoiler items
    // in the OS long-press menu needs native (UIEditMenuInteraction / Android
    // ActionMode) work, which is out of scope here. Mobile users format by
    // typing markdown; desktop keeps the Ctrl/Cmd shortcuts. (#54 — punted.)
    this._el.appendChild(inputBar);
  }

  /**
   * Set the soft-keyboard assist attributes on the compose field. On mobile we
   * want autocorrect, sentence-casing, and spellcheck; on desktop they stay off
   * to preserve the terminal feel and avoid interfering with vim keystrokes.
   */
  private _applyTextAssistAttributes(): void {
    const mobile = isMobile();
    this._fieldEl.setAttribute("autocorrect", mobile ? "on" : "off");
    this._fieldEl.setAttribute("autocapitalize", mobile ? "sentences" : "off");
    this._fieldEl.setAttribute("spellcheck", mobile ? "true" : "false");
    // iOS/WKWebView suppresses the QuickType predictive-text bar (and typing
    // suggestions generally) whenever autocomplete="off" — so even with the
    // attributes above, suggestions never appeared on mobile. Desktop keeps it
    // off for the terminal aesthetic and to avoid autofill in vim navigation. (#40)
    this._fieldEl.setAttribute("autocomplete", mobile ? "on" : "off");
  }

  /**
   * Re-apply the soft-keyboard assist attributes now that mobile state is known.
   * The constructor runs before initMobile(), so on a device that boots straight
   * into mobile it would otherwise keep the desktop (assist-off) attributes —
   * onMobileChange only fires when the breakpoint is *crossed*, which never
   * happens on a real phone. Call this once after initMobile().
   */
  applyTextAssist(): void {
    this._applyTextAssistAttributes();
  }

  /** Register a callback invoked when the field is clicked to enter insert mode. */
  onFocusEnterInsert(handler: () => void): void {
    this._onFocusEnterInsert = handler;
  }

  /** Register a callback for the emoji picker button. */
  onEmojiPickerClick(handler: () => void): void {
    this._onEmojiClick = handler;
  }

  /** Register a callback for the GIF picker button. */
  onGifPickerClick(handler: () => void): void {
    this._onGifClick = handler;
  }

  /** Register a callback for the attach file button. */
  onAttachClick(handler: () => void): void {
    this._onAttachClick = handler;
  }

  /** Register a callback for the dedicated send button (#4). */
  onSendClick(handler: () => void): void {
    this._onSendClick = handler;
  }

  /** Show or hide the dedicated send button. */
  setSendButtonVisible(visible: boolean): void {
    this._sendBtnEl.style.display = visible ? "" : "none";
  }

  /** Register a callback invoked when the user picks a file via the attach button. */
  onFilePick(handler: (file: File) => void): void {
    this._onFilePick = handler;
  }

  /** Open the native file picker dialog. */
  openFilePicker(): void {
    this._fileInputEl?.click();
  }

  /** Returns the inner input-bar div (used for scrollbar sync padding). */
  getInputBarElement(): HTMLElement {
    return this._inputBarEl;
  }

  /** Returns the compose box element (for position measurement and animation). */
  getComposeBoxElement(): HTMLElement {
    return this._composeBoxEl;
  }

  /** Returns the text input field element (for precise text position measurement). */
  getFieldElement(): HTMLTextAreaElement {
    return this._fieldEl;
  }

  /**
   * Animate the compose box when a message merges into an existing bubble.
   * The border fades to transparent and back, signalling absorption rather than flight.
   */
  animateMerge(): void {
    this._composeBoxEl.classList.remove("input-bar__compose-box--merge");
    void this._composeBoxEl.offsetWidth;
    this._composeBoxEl.classList.add("input-bar__compose-box--merge");
  }

  /** Trigger a brief refresh animation on the compose box after sending. */
  animateSent(): void {
    this._composeBoxEl.classList.remove("input-bar__compose-box--sent");
    void this._composeBoxEl.offsetWidth; // force reflow to restart animation
    this._composeBoxEl.classList.add("input-bar__compose-box--sent");
  }

  getElement(): HTMLElement {
    return this._el;
  }

  getValue(): string {
    return this._fieldEl.value;
  }

  setValue(text: string): void {
    this._fieldEl.value = text;
    this._autoGrow();
  }

  /**
   * Wrap the current selection in markdown markers (e.g. `**` for bold), or
   * insert an empty pair with the caret between them when nothing is selected.
   * The inner text stays selected so the user can keep typing or toggle again.
   * Used by the desktop formatting shortcuts and the mobile toolbar (#54).
   */
  wrapSelection(marker: string, closing: string = marker): void {
    const field = this._fieldEl;
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? field.value.length;
    const selected = field.value.slice(start, end);
    const before = field.value.slice(0, start);
    const after = field.value.slice(end);
    field.value = before + marker + selected + closing + after;

    const innerStart = start + marker.length;
    const innerEnd = innerStart + selected.length;
    field.focus();
    field.setSelectionRange(innerStart, innerEnd);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    this._autoGrow();
  }

  /** Resize the textarea to fit its content, up to the CSS max-height. */
  private _autoGrow(): void {
    // Reset first so scrollHeight reflects the content, not the previous height.
    this._fieldEl.style.height = "auto";
    const h = this._fieldEl.scrollHeight;
    // scrollHeight is 0 before the element is laid out (e.g. setValue during
    // init) — leave the rows-based height in that case rather than collapsing.
    if (h > 0) this._fieldEl.style.height = `${h}px`;
  }

  focus(): void {
    this._fieldEl.focus();
  }

  blur(): void {
    this._fieldEl.blur();
  }

  /** Show or hide the vim mode indicator. When hidden, the input always behaves as Insert. */
  setVimMode(enabled: boolean): void {
    this._vimMode = enabled;
    // Use visibility so the indicator still occupies space — no layout shift.
    this._modeEl.style.visibility = enabled ? "" : "hidden";
    this._inputBarEl.classList.toggle("input-bar--no-vim", !enabled);
  }

  setMode(mode: Mode): void {
    const label: string = mode;
    this._currentMode = label;

    // When vim is disabled, keep the indicator invisible (still occupies space)
    if (!this._vimMode) {
      this._modeEl.style.visibility = "hidden";
      this._refreshPlaceholder();
      return;
    }

    this._modeEl.style.visibility = "";

    // Remove previous mode class
    for (const cls of Object.values(MODE_CSS_CLASS)) {
      if (cls) this._modeEl.classList.remove(cls);
    }

    // Set mode label
    this._modeEl.textContent = MODE_LABELS[label] ?? label.slice(0, 3).toUpperCase();

    // Apply mode class
    const cls = MODE_CSS_CLASS[label];
    if (cls) this._modeEl.classList.add(cls);

    this._refreshPlaceholder();
    if (label === "Command" || label === "Insert") {
      this._fieldEl.focus();
    }
  }

  onSubmit(handler: (value: string) => void): void {
    this._fieldEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handler(this._fieldEl.value);
      }
    });
  }

  onInput(handler: (value: string) => void): void {
    this._fieldEl.addEventListener("input", () => handler(this._fieldEl.value));
  }

  // ── Pending image (paste / attach staging) ─────────────────────────────────

  /**
   * Stage an image for sending: show the preview above the compose bar and
   * hold the blob until a submit consumes it (`takePendingImage`) or the user
   * discards it. A second call while one is staged replaces it; any typed
   * caption in the field is left alone.
   */
  showImagePreview(blob: Blob, filename?: string): void {
    // Replacing a staged image before its object URL loaded would leak it.
    this._revokePreviewUrl();
    this._pendingImageBlob = blob;
    this._pendingImageName = filename ?? null;
    const url = URL.createObjectURL(blob);
    this._pastePreviewImg.src = url;
    // Clean up the object URL when the image loads
    this._pastePreviewImg.onload = () => {
      this._pastePreviewImg.onload = null;
      URL.revokeObjectURL(url);
    };
    const name = filename ? `Send ${filename}?` : "Send image?";
    this._pastePreviewLabelEl.textContent = isMobile()
      ? name
      : `${name} — Enter to send · Esc to cancel`;
    this._pastePreviewEl.style.display = "flex";
    this._refreshPlaceholder();
  }

  /** Whether an image is staged and waiting to be sent. */
  hasPendingImage(): boolean {
    return this._pendingImageBlob !== null;
  }

  /** Atomically take the staged image (clearing the preview), or null if none. */
  takePendingImage(): { blob: Blob; filename: string | null } | null {
    const blob = this._pendingImageBlob;
    if (!blob) return null;
    const filename = this._pendingImageName;
    this._clearPendingImage();
    return { blob, filename };
  }

  /** Discard the staged image. Returns true if there was one to discard. */
  discardPendingImage(): boolean {
    if (!this._pendingImageBlob) return false;
    this._clearPendingImage();
    return true;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _clearPendingImage(): void {
    this._pendingImageBlob = null;
    this._pendingImageName = null;
    this._revokePreviewUrl();
    this._pastePreviewImg.src = "";
    this._pastePreviewEl.style.display = "none";
    this._refreshPlaceholder();
  }

  /** Revoke a preview object URL whose `onload` hasn't fired yet. */
  private _revokePreviewUrl(): void {
    if (this._pastePreviewImg.onload && this._pastePreviewImg.src) {
      URL.revokeObjectURL(this._pastePreviewImg.src);
      this._pastePreviewImg.onload = null;
    }
  }

  /**
   * The placeholder doubles as the staged-image hint: Command mode keeps its
   * prompt, otherwise a pending image invites a caption.
   */
  private _refreshPlaceholder(): void {
    if (this._vimMode && this._currentMode === "Command") {
      this._fieldEl.placeholder = "command…";
    } else if (this.hasPendingImage()) {
      this._fieldEl.placeholder = "Add a caption…";
    } else {
      this._fieldEl.placeholder = "…";
    }
  }
}
