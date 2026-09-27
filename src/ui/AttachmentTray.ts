// The composer's staged-attachments tray.
//
// Everything the user attaches — picked, pasted or dropped, image or not —
// waits here until the composer is submitted, so a batch can be checked,
// trimmed and captioned before any of it is sent. It replaced a single-image
// preview beside which every other file uploaded the moment it was attached.
//
// Inline in the compose region like the attachment progress rows, never an
// overlay: it belongs to the composer, it must not cover the timeline, and its
// only controls are real buttons, so it needs nothing from `app/keyboard.ts`
// beyond the Esc that clears it.
//
// Styling lives in `src/style/base.css` under "Staged attachments".

import { isMobile } from "../app/mobile.js";
import { formatBytes } from "./AttachmentProgress.js";

/** How an attachment is sent, and so how the tray shows it. */
export type AttachmentKind = "image" | "video" | "file";

/**
 * The event type a blob goes out as: `m.image`, `m.video`, or `m.file` for
 * everything else. One rule, shared by the tray and the send path, so what the
 * tray shows is what gets sent.
 */
export function attachmentKind(file: Blob): AttachmentKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return "file";
}

/** One attachment waiting in the tray. */
export interface StagedAttachment {
  /** Stable for the attachment's life in the tray; keys its remove control. */
  readonly id: number;
  readonly file: Blob;
  /** The file's own name; `null` for a pasted image that never had one. */
  readonly filename: string | null;
  readonly kind: AttachmentKind;
}

interface Entry {
  att: StagedAttachment;
  el: HTMLElement;
  /** Object URL behind an image thumbnail, revoked when the entry goes. */
  url: string | null;
}

let nextId = 1;

export class AttachmentTray {
  private _el: HTMLElement;
  private _itemsEl: HTMLElement;
  private _labelEl: HTMLElement;
  private _entries: Entry[] = [];
  private _onChange: () => void;

  /**
   * `onSend` runs from the tray's Send button, which submits the composer the
   * way Enter does. `onChange` runs whenever the set of staged attachments
   * changes, so the composer can update what depends on it.
   */
  constructor(opts: { onSend: () => void; onChange?: () => void }) {
    this._onChange = opts.onChange ?? (() => {});

    this._el = document.createElement("div");
    this._el.className = "attach-tray";
    this._el.style.display = "none";
    this._el.setAttribute("role", "group");
    this._el.setAttribute("aria-label", "Staged attachments");

    this._itemsEl = document.createElement("ul");
    this._itemsEl.className = "attach-tray__items";
    this._el.appendChild(this._itemsEl);

    const footer = document.createElement("div");
    footer.className = "attach-tray__footer";

    this._labelEl = document.createElement("span");
    this._labelEl.className = "attach-tray__label";
    footer.appendChild(this._labelEl);

    const sendBtn = document.createElement("button");
    sendBtn.type = "button";
    sendBtn.className = "attach-tray__btn attach-tray__btn--send";
    sendBtn.textContent = "Send";
    // Keep the caret (and a phone's soft keyboard) in the field.
    sendBtn.addEventListener("mousedown", (e) => e.preventDefault());
    sendBtn.addEventListener("click", () => opts.onSend());
    footer.appendChild(sendBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "attach-tray__btn attach-tray__btn--cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("mousedown", (e) => e.preventDefault());
    cancelBtn.addEventListener("click", () => this.clear());
    footer.appendChild(cancelBtn);

    this._el.appendChild(footer);
  }

  getElement(): HTMLElement {
    return this._el;
  }

  /** The staged attachments, in the order they were added. */
  items(): readonly StagedAttachment[] {
    return this._entries.map((e) => e.att);
  }

  get size(): number {
    return this._entries.length;
  }

  /** Stage one file at the end of the tray. */
  add(file: Blob, filename?: string | null): StagedAttachment {
    const att: StagedAttachment = {
      id: nextId++,
      file,
      filename: filename || null,
      kind: attachmentKind(file),
    };
    this._insert([att], "end");
    return att;
  }

  /**
   * Put attachments back at the front of the tray — ones whose send failed, so
   * they sit ahead of anything staged while the batch was going out, in their
   * original order.
   */
  restore(items: readonly StagedAttachment[]): void {
    this._insert(items, "start");
  }

  /** Remove one attachment. Returns false if it was not staged. */
  remove(id: number): boolean {
    const i = this._entries.findIndex((e) => e.att.id === id);
    if (i < 0) return false;
    const [entry] = this._entries.splice(i, 1);
    this._drop(entry);
    this._render();
    return true;
  }

  /** Remove everything. Returns false if the tray was already empty. */
  clear(): boolean {
    if (this._entries.length === 0) return false;
    this._take();
    return true;
  }

  /** Empty the tray, handing back what was in it. */
  take(): StagedAttachment[] {
    return this._take();
  }

  private _take(): StagedAttachment[] {
    const taken = this._entries.map((e) => e.att);
    for (const entry of this._entries) this._drop(entry);
    this._entries = [];
    this._render();
    return taken;
  }

  private _insert(items: readonly StagedAttachment[], where: "start" | "end"): void {
    if (items.length === 0) return;
    const fresh = items.map((att) => this._build(att));
    if (where === "start") {
      const anchor = this._itemsEl.firstChild;
      for (const e of fresh) this._itemsEl.insertBefore(e.el, anchor);
      this._entries = [...fresh, ...this._entries];
    } else {
      for (const e of fresh) this._itemsEl.appendChild(e.el);
      this._entries.push(...fresh);
    }
    this._render();
  }

  private _drop(entry: Entry): void {
    entry.el.remove();
    if (entry.url) URL.revokeObjectURL(entry.url);
  }

  private _build(att: StagedAttachment): Entry {
    const name = att.filename ?? (att.kind === "image" ? "pasted image" : "attachment");
    const el = document.createElement("li");
    el.className = `attach-tray__item attach-tray__item--${att.kind}`;
    el.dataset.attachmentId = String(att.id);
    el.title = `${name} · ${formatBytes(att.file.size)}`;

    let url: string | null = null;
    if (att.kind === "image") {
      url = URL.createObjectURL(att.file);
      const img = document.createElement("img");
      img.className = "attach-tray__thumb";
      img.alt = name;
      img.src = url;
      el.appendChild(img);
    } else {
      const glyph = document.createElement("span");
      glyph.className = "attach-tray__glyph";
      glyph.setAttribute("aria-hidden", "true");
      glyph.textContent = att.kind === "video" ? "▶" : "≡";
      el.appendChild(glyph);

      const nameEl = document.createElement("span");
      nameEl.className = "attach-tray__name";
      nameEl.textContent = name;
      el.appendChild(nameEl);

      const sizeEl = document.createElement("span");
      sizeEl.className = "attach-tray__size";
      sizeEl.textContent = formatBytes(att.file.size);
      el.appendChild(sizeEl);
    }

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "attach-tray__remove";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", `Remove ${name}`);
    removeBtn.addEventListener("mousedown", (e) => e.preventDefault());
    removeBtn.addEventListener("click", () => this.remove(att.id));
    el.appendChild(removeBtn);

    return { att, el, url };
  }

  private _render(): void {
    const n = this._entries.length;
    this._el.style.display = n > 0 ? "" : "none";
    const what =
      n === 1
        ? `Send ${this._entries[0].att.filename ?? (this._entries[0].att.kind === "image" ? "image" : "attachment")}?`
        : `Send ${n} attachments?`;
    this._labelEl.textContent = isMobile() ? what : `${what} — Enter to send · Esc to cancel`;
    this._onChange();
  }
}
