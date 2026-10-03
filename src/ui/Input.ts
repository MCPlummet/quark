// Compose bar with mode indicator

import { Mode } from "../vim/mode.js";
import { isMobile, onMobileChange, guardViewportPan } from "../app/mobile.js";
import { AttachmentProgressList, type AttachmentProgressHandle } from "./AttachmentProgress.js";
import { AttachmentTray, type StagedAttachment } from "./AttachmentTray.js";

export type { StagedAttachment };

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

/**
 * What the compose field held either side of a default paste, so the async
 * clipboard fallback can undo one — see {@link Input._undoDefaultPaste}.
 */
interface PasteUndo {
  /** The value before the paste. */
  value: string;
  /** The caret before the paste. */
  caret: number | null;
  /** The value immediately after the paste; `null` until it has landed. */
  pasted: string | null;
}

/**
 * The text a paste inserted, as the difference between the field before and
 * after. Derived rather than read from the clipboard: the async fallback exists
 * precisely because the `paste` event's own `clipboardData` can't be trusted to
 * hold it.
 */
function insertedText(before: string, after: string): string {
  let start = 0;
  while (start < before.length && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < after.length - start &&
    end < before.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) end++;
  return after.slice(start, after.length - end);
}

/**
 * Whether inserted text reads as a clipboard image's text stand-in rather than
 * as prose the user meant to paste.
 *
 * A stand-in is what a source puts on the clipboard *because* the payload is an
 * image: the URL it was dragged from, or the path of the file. Both are a single
 * token. Prose is not — and where the two can't be told apart, keeping the text
 * is the recoverable mistake.
 */
function looksLikeImageFallbackText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/\s/.test(trimmed)) return false; // prose, or a multi-line selection
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ||               // http:, file:, data:, blob:…
    /^[/~]/.test(trimmed) ||                              // /home/u/pic.png, ~/pic.png
    /^[a-z]:[\\/]/i.test(trimmed) ||                      // C:\Users\…\pic.png
    /\.(png|jpe?g|gif|webp|bmp|avif|heic|tiff?|svg)$/i.test(trimmed) // a bare filename
  );
}

/**
 * Reads a file-manager copy off the OS clipboard. `listed` says whether the
 * clipboard held a file list at all — it can hold one with nothing attachable
 * in it (only folders), which the reader reports itself.
 */
export type ClipboardFileReader = () => Promise<{ files: File[]; listed: boolean }>;

const NO_COPIED_FILES = { files: [] as File[], listed: false };

/**
 * The images on the OS clipboard, through the async Clipboard API — the
 * fallback for engines (WebKitGTK) that leave them out of a paste's
 * `clipboardData`. One image per clipboard item: an item offering the same
 * picture as PNG *and* JPEG is one picture, not two. Empty when the API is
 * unavailable or the read is refused.
 */
async function readClipboardImages(): Promise<File[]> {
  try {
    const images: File[] = [];
    for (const ci of await navigator.clipboard.read()) {
      const type = ci.types.find((t) => t.startsWith("image/"));
      if (!type) continue;
      const blob = await ci.getType(type);
      images.push(new File([blob], "", { type: blob.type || type }));
    }
    return images;
  } catch {
    return [];
  }
}

/** One flavour of a paste's clipboard data as text; "" when absent or unreadable. */
function readClipboardText(data: DataTransfer | null | undefined, type: string): string {
  try {
    return data?.getData?.(type) ?? "";
  } catch {
    return "";
  }
}

/**
 * The entries of a clipboard text flavour, one per line: blank lines and
 * `text/uri-list` `#` comments dropped.
 */
function listLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

/**
 * Whether a paste's text is nothing but `file:` URIs — the text a file manager
 * puts beside a copied-files list, and never something a person types. A paste
 * like this is intercepted outright and the files read by the backend.
 */
export function isFileUriList(text: string): boolean {
  const lines = listLines(text);
  return lines.length > 0 && lines.every((l) => /^file:/i.test(l));
}

/**
 * Whether a paste's text reads as a copied-files list in either form a file
 * manager writes it: `file:` URIs, or absolute paths one per line (the plain
 * text Nautilus offers). Paths are also what a user copies out of a terminal,
 * so this only prompts a look at the OS clipboard — the paste itself goes
 * ahead, and is taken back out only if a file list really is there.
 */
export function looksLikeFileListText(text: string): boolean {
  const lines = listLines(text);
  return lines.length > 0 && lines.every((l) => /^file:/i.test(l) || l.startsWith("/"));
}

export class Input {
  private _el: HTMLElement;
  private _modeEl: HTMLElement;
  private _fieldEl: HTMLTextAreaElement;
  private _composeBoxEl: HTMLElement;
  private _tray: AttachmentTray;
  private _inputBarEl: HTMLElement;
  private _currentMode: string = "Normal";
  private _onEmojiClick: (() => void) | null = null;
  private _onGifClick: (() => void) | null = null;
  private _onAttachClick: (() => void) | null = null;
  private _onSendClick: (() => void) | null = null;
  private _sendBtnEl: HTMLButtonElement;
  private _onAttachFiles: ((files: File[]) => void) | null = null;
  private _readClipboardFiles: ClipboardFileReader | null = null;
  private _onFocusEnterInsert: (() => void) | null = null;
  private _fileInputEl: HTMLInputElement | null = null;
  private _attachProgress: AttachmentProgressList;
  private _vimMode: boolean = true;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "input-bar-wrap";
    this._el.setAttribute("role", "region");
    this._el.setAttribute("aria-label", "Message input");
    // Nothing in the compose region scrolls except the field and the staged-
    // attachments row, so no other drag over it may reach the visual-viewport
    // pan (#33).
    guardViewportPan(this._el, (t) => !!t?.closest(".input-bar__field, .attach-tray__items"));

    // ── Attachment progress (hidden until something is being attached) ────
    // Above the staged-attachments tray so a queued send and the row describing it read
    // top-down in the order they happened.
    this._attachProgress = new AttachmentProgressList();
    this._el.appendChild(this._attachProgress.getElement());

    // ── Staged attachments (hidden until something is attached) ─────────
    // The Send button routes through the same submit path as Enter and the ➤
    // button, so the caption and edit-precedence rules apply whichever is used.
    this._tray = new AttachmentTray({
      onSend: () => this._onSendClick?.(),
      onChange: () => this._refreshPlaceholder(),
    });
    this._el.appendChild(this._tray.getElement());

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

    // Attachment paste handler. clipboardData.items is standard; .files is an
    // alternative that some Linux clipboard managers populate instead.
    // On Linux/Wayland, WebKit2GTK text inputs may not expose image data
    // in clipboardData at all, so we also fall back to navigator.clipboard.read().
    //
    // Both synchronous paths take *any* file, not just images (#83). Every
    // branch used to filter on `image/`, so a PDF, zip or mp4 on the clipboard
    // fell through to the browser's default text paste and vanished — even
    // though the file picker beside it has sent those as `m.file`/`m.video` all
    // along. Every file, whatever its type, goes to the same handler as a
    // picked one and waits in the tray until the composer is submitted.
    this._fieldEl.addEventListener("paste", (e) => this._handlePaste(e));

    // Hidden file input — triggered by the attach button
    this._fileInputEl = document.createElement("input");
    this._fileInputEl.type = "file";
    this._fileInputEl.multiple = true;
    this._fileInputEl.style.display = "none";
    this._fileInputEl.setAttribute("aria-hidden", "true");
    this._fileInputEl.addEventListener("change", () => {
      const files = Array.from(this._fileInputEl!.files ?? []);
      if (files.length > 0) {
        this._onAttachFiles?.(files);
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

  /**
   * Route a paste: files the webview exposes attach directly; a copied-files
   * list it only shows as text is read by the backend; an image it exposes
   * only through the async Clipboard API is fetched after the fact.
   */
  private _handlePaste(e: ClipboardEvent): void {
    const data = e.clipboardData;
    // Standard path: items. Every file on the clipboard, not just the first —
    // copying several files in a file manager puts them all there.
    const fromItems = data?.items ? clipboardItemFiles(data.items) : [];
    // Fallback: files list (used by some Linux clipboard managers)
    const files = fromItems.length > 0 ? fromItems : Array.from(data?.files ?? []);
    if (files.length > 0) {
      e.preventDefault();
      this._onAttachFiles?.(files);
      return;
    }

    // A file-manager copy (Dolphin, Nautilus) reaches a WebKitGTK page only as
    // text: the files' `file://` URIs, or their paths. The page cannot open
    // either, so the backend reads the list off the OS clipboard itself.
    const text = readClipboardText(data, "text/plain");
    const uriList = readClipboardText(data, "text/uri-list");
    if (this._readClipboardFiles && (isFileUriList(uriList) || isFileUriList(text))) {
      // Nothing but file URIs: no one means to paste that as a message, so
      // suppress it now rather than take it back later. If the OS clipboard
      // turns out not to hold the files after all, the text goes in as typed.
      e.preventDefault();
      void this._pasteCopiedFiles(text || uriList);
      return;
    }

    // What remains is either an ordinary text paste, or a clipboard the engine
    // could not describe synchronously (WebKitGTK, for images). Neither can be
    // `preventDefault()`ed on a guess — that would break every text paste — so
    // snapshot the field and put it back only if something to attach turns up:
    // the default paste has already run by then, which is how the clipboard's
    // *text* flavour ended up typed into the composer at the same moment an
    // image staged.
    const hasText = text.length > 0;
    const askBackend = this._readClipboardFiles && (!hasText || looksLikeFileListText(text));
    const readImages = typeof navigator !== "undefined" && !!navigator.clipboard?.read;
    if (!askBackend && !readImages) return;
    const before = this._snapshotForUndo();
    // The image read starts here, inside the paste event, although the
    // backend's answer outranks it. WebKit lets a page read the clipboard only
    // while the paste is being dispatched: issued after the `await` below, the
    // read is refused and the image silently never arrives.
    const images = readImages ? readClipboardImages() : Promise.resolve([]);
    void (async () => {
      if (askBackend) {
        const { files: copied } = await this._readClipboardFiles!().catch(() => NO_COPIED_FILES);
        if (copied.length > 0) {
          // A fast answer can beat the snapshot of what the paste inserted;
          // that snapshot is a task queued before this one, so yield once.
          await new Promise((r) => setTimeout(r, 0));
          this._undoDefaultPaste(before, (t) => looksLikeFileListText(t) || looksLikeImageFallbackText(t));
          this._onAttachFiles?.(copied);
          return;
        }
      }
      const found = await images;
      if (found.length === 0) return;
      this._undoDefaultPaste(before);
      this._onAttachFiles?.(found);
    })();
  }

  /**
   * Attach the files a file manager put on the OS clipboard. `text` is what
   * the suppressed default paste would have inserted, put in by hand if the
   * clipboard holds no file list after all (a URI copied out of a terminal).
   */
  private async _pasteCopiedFiles(text: string): Promise<void> {
    const copied = await this._readClipboardFiles!().catch(() => NO_COPIED_FILES);
    if (copied.files.length > 0) {
      this._onAttachFiles?.(copied.files);
      return;
    }
    // A list with nothing attachable in it (only folders, say) has already been
    // reported by the reader. Only a clipboard that held no list at all gets
    // its text pasted back.
    if (!copied.listed) this._insertText(text);
  }

  /** Insert text at the caret as a paste would, keeping the field's undo history. */
  private _insertText(text: string): void {
    if (!text) return;
    const field = this._fieldEl;
    field.focus();
    const viaCommand =
      typeof document.execCommand === "function" && document.execCommand("insertText", false, text);
    if (!viaCommand) {
      const start = field.selectionStart ?? field.value.length;
      const end = field.selectionEnd ?? field.value.length;
      field.setRangeText(text, start, end, "end");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
    this._autoGrow();
  }

  /**
   * Record what the field held before a default paste, and what it holds
   * immediately after — the two values {@link _undoDefaultPaste} needs.
   *
   * `pasted` is captured on the next task rather than now: the default paste
   * has not run yet when the `paste` listener is on the stack, so this is the
   * earliest point at which the inserted text is visible.
   */
  private _snapshotForUndo(): PasteUndo {
    const undo: PasteUndo = {
      value: this._fieldEl.value,
      caret: this._fieldEl.selectionStart,
      pasted: null,
    };
    setTimeout(() => {
      undo.pasted = this._fieldEl.value;
    }, 0);
    return undo;
  }

  /**
   * Put the compose field back the way it was before a default paste ran.
   *
   * Only for the async clipboard fallback, which cannot call
   * `preventDefault()` in time.
   *
   * It restores only if the field still holds exactly what the paste left
   * there. `navigator.clipboard.read()` can sit behind a permission prompt, so
   * that window is not always a microtask — and restoring a stale snapshot
   * wholesale would silently delete everything the user typed while waiting.
   * Better to leave the pasted text in place than to take their sentence with
   * it.
   *
   * The same caution applies to the text itself: an image on the clipboard does
   * not mean the text beside it was a stand-in for it. A rich selection copied
   * out of a browser or a spreadsheet carries `text/plain` *and* `image/png`,
   * and taking the text back out there deletes a paste the user asked for. So
   * the undo is limited to text that reads as the image's fallback — see
   * {@link looksLikeImageFallbackText}. Anything else stays, and becomes the
   * first staged attachment's caption (#84), which is visible and removable either way.
   */
  private _undoDefaultPaste(
    undo: PasteUndo,
    isStandIn: (inserted: string) => boolean = looksLikeImageFallbackText,
  ): void {
    if (undo.pasted === null) return; // the default paste has not landed yet
    if (this._fieldEl.value !== undo.pasted) return; // the user has typed since
    if (undo.pasted === undo.value) return; // nothing was inserted
    // …and only when what landed was the image's own stand-in, not text the
    // user meant to paste alongside it.
    if (!isStandIn(insertedText(undo.value, undo.pasted))) return;
    this._fieldEl.value = undo.value;
    if (undo.caret !== null) {
      this._fieldEl.selectionStart = this._fieldEl.selectionEnd = undo.caret;
    }
    this._autoGrow();
  }

  /**
   * Register the handler for files the user attached — from the attach button
   * or pasted into the composer. The component only collects them; staging
   * them is the app's decision (`attachFiles`), made once for every entry
   * point including a window drop.
   */
  onAttachFiles(handler: (files: File[]) => void): void {
    this._onAttachFiles = handler;
  }

  /**
   * Register how a paste reads files a file manager copied to the OS clipboard
   * (`read_clipboard_files`). Without one, a paste of copied files falls back
   * to pasting their text.
   */
  setClipboardFileReader(reader: ClipboardFileReader): void {
    this._readClipboardFiles = reader;
  }

  /**
   * Mark the composer as the target of a file drag in progress. The native drop
   * lands anywhere in the window (see `app/file_drop.ts`), so this is the one
   * place that says where the files will go.
   */
  setDropActive(active: boolean): void {
    this._el.classList.toggle("input-bar-wrap--drop", active);
  }

  /**
   * Start an inline attachment-progress row for `filename` (#63). Returns the
   * handle that drives it through read → upload → send, or into an error the
   * user can actually see. `onCancel` renders a cancel button; omit it where a
   * cancel could not take effect. `roomId` scopes the row to the room the
   * attachment is going to, so it does not follow the user out of it.
   */
  startAttachmentProgress(
    filename: string,
    onCancel?: () => void,
    roomId?: string,
  ): AttachmentProgressHandle {
    return this._attachProgress.start(filename, onCancel, roomId);
  }

  /** Scope the visible attachment rows to the room now open (null for none). */
  setAttachmentRoom(roomId: string | null): void {
    this._attachProgress.setActiveRoom(roomId);
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
    this._setModeHidden(!enabled);
    this._inputBarEl.classList.toggle("input-bar--no-vim", !enabled);
  }

  /** Hide the indicator while keeping its box, so the compose box stays put.
   * The mechanism is the stylesheet's to choose, so toggle a class rather than an
   * inline style — an inline one would beat any rule trying to override it, and
   * mobile overrides exactly that (it hides by paint, so the strip stays a touch
   * surface the pan guard can claim — see base.css).
   * `aria-hidden` carries the a11y half that `visibility` used to do implicitly. */
  private _setModeHidden(hidden: boolean): void {
    this._modeEl.classList.toggle("input-bar__mode--hidden", hidden);
    if (hidden) this._modeEl.setAttribute("aria-hidden", "true");
    else this._modeEl.removeAttribute("aria-hidden");
  }

  setMode(mode: Mode): void {
    const label: string = mode;
    this._currentMode = label;

    // When vim is disabled, keep the indicator invisible (still occupies space)
    if (!this._vimMode) {
      this._setModeHidden(true);
      this._refreshPlaceholder();
      return;
    }

    this._setModeHidden(false);

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

  // ── Staged attachments ─────────────────────────────────────────────────────

  /**
   * Stage a file in the tray above the compose bar, after anything already
   * there. Nothing is sent until the composer is submitted, which takes the
   * whole tray ({@link takeStagedAttachments}); typed text is left alone and
   * becomes the first attachment's caption.
   */
  stageAttachment(file: Blob, filename?: string | null): StagedAttachment {
    return this._tray.add(file, filename);
  }

  /** Put attachments whose send failed back at the front of the tray. */
  restoreStagedAttachments(items: readonly StagedAttachment[]): void {
    this._tray.restore(items);
  }

  /** Whether anything is staged and waiting to be sent. */
  hasStagedAttachments(): boolean {
    return this._tray.size > 0;
  }

  /** The staged attachments, in order, without taking them. */
  stagedAttachments(): readonly StagedAttachment[] {
    return this._tray.items();
  }

  /** Atomically take every staged attachment, emptying the tray. */
  takeStagedAttachments(): StagedAttachment[] {
    return this._tray.take();
  }

  /** Remove one staged attachment. Returns false if it was not staged. */
  removeStagedAttachment(id: number): boolean {
    return this._tray.remove(id);
  }

  /** Clear the whole tray. Returns true if there was anything to clear. */
  discardStagedAttachments(): boolean {
    return this._tray.clear();
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /**
   * The placeholder doubles as the staged-attachments hint: Command mode keeps
   * its prompt, otherwise a staged attachment invites a caption.
   */
  private _refreshPlaceholder(): void {
    if (this._vimMode && this._currentMode === "Command") {
      this._fieldEl.placeholder = "command…";
    } else if (this.hasStagedAttachments()) {
      this._fieldEl.placeholder = "Add a caption…";
    } else {
      this._fieldEl.placeholder = "…";
    }
  }
}

/**
 * The files in a paste's `DataTransferItemList`.
 *
 * `getAsFile()` is the test for "is this a file": it returns null for a string
 * item by spec, which makes it a stricter check than `kind` and one less thing
 * an engine has to have implemented. Where the engine hands back a file with no
 * type, the item's own type — the clipboard target it came from — is kept
 * instead, so an image does not lose the one label that says it is an image.
 */
export function clipboardItemFiles(items: DataTransferItemList): File[] {
  const files: File[] = [];
  for (const item of Array.from(items)) {
    const file = item.getAsFile();
    if (!file) continue;
    files.push(
      file.type || !item.type
        ? file
        : new File([file], file.name, { type: item.type, lastModified: file.lastModified }),
    );
  }
  return files;
}
