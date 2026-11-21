// The emoji/sticker pack editor (#12).
//
// One component for every place a pack is managed: the personal pack in
// Settings → Emoji, and each room's or space's packs in their Emoji tab. It
// shows the pack's images as a grid; picking one opens its fields underneath.
//
// Every change is its own backend operation (see src-tauri/src/matrix/packs.rs):
// the backend re-reads the pack, applies the change and returns the pack as
// written, which this redraws from. Fields save themselves (commit_field.ts),
// as in the rest of the settings dialogs. Only the grid and the icon are
// redrawn after a write — the open image's fields stay, so their "saved" line
// is still there to read.

import {
  addPackImages,
  deleteRoomPack,
  removePackImage,
  renamePackImage,
  setPackFavorite,
  setPackImageBody,
  setPackImageUsage,
  setPackMeta,
  uploadPackMedia,
} from "../../ipc/index.js";
import type { EditableImage, EditablePack, NewPackImage, PackLocation, PackUsage } from "../../ipc/types.js";
import { commitSelectRow, commitTextRow, errorText, statusLine, type StatusLine } from "../settings/commit_field.js";
import { askConfirm } from "../ConfirmDialog.js";
import { sectionedGridMove } from "../grid_nav.js";
import type { DirectionalAction } from "../PickerBase.js";
import { customEmojiImage, invalidateCustomEmoji } from "../../app/actions/custom_emoji.js";
import { resolveEmojiThumbnail } from "../../app/actions/context.js";
import { readImageFile } from "./image_file.js";

export interface PackEditorOpts {
  location: PackLocation;
  pack: EditablePack;
  canEdit: boolean;
  /** Room/space packs only: show the "use in every room" toggle. */
  favoritable: boolean;
  /** After a successful write, with the pack as written (null once deleted). */
  onChange?(pack: EditablePack | null): void;
}

/** Grid keys once a cell has focus (decision 7 of the design). */
const DIRECTIONS: Record<string, DirectionalAction> = {
  ArrowLeft: "nav-left",
  h: "nav-left",
  ArrowRight: "nav-right",
  l: "nav-right",
  ArrowUp: "nav-up",
  k: "nav-up",
  ArrowDown: "nav-down",
  j: "nav-down",
};

const PACK_USE: Array<[string, string]> = [
  ["both", "emoji + sticker"],
  ["emoticon", "emoji only"],
  ["sticker", "sticker only"],
];

const IMAGE_USE: Array<[string, string]> = [
  ["inherit", "pack default"],
  ["emoticon", "emoji"],
  ["sticker", "sticker"],
  ["both", "emoji + sticker"],
];

/** A usage list as a select value (`null` → the "absent" value given). */
function usageKey(usage: PackUsage[] | null, absent: string): string {
  if (!usage) return absent;
  const emoji = usage.includes("emoticon");
  const sticker = usage.includes("sticker");
  if (emoji && sticker) return "both";
  if (emoji) return "emoticon";
  if (sticker) return "sticker";
  return absent;
}

function usageFromKey(key: string): PackUsage[] | null {
  switch (key) {
    case "emoticon": return ["emoticon"];
    case "sticker": return ["sticker"];
    case "both": return ["emoticon", "sticker"];
    default: return null;
  }
}

function button(label: string, className: string, onClick: () => void, danger = false): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `settings-dialog__btn${danger ? " settings-dialog__btn--danger" : ""} ${className}`;
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function imageFileInput(className: string, multiple: boolean, onFiles: (files: File[]) => void): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = multiple;
  input.className = className;
  input.hidden = true;
  input.setAttribute("aria-hidden", "true");
  input.addEventListener("change", () => {
    const files = Array.from(input.files ?? []);
    if (files.length > 0) onFiles(files);
    input.value = "";
  });
  return input;
}

export class PackEditor {
  private readonly _el: HTMLElement;
  private readonly _opts: PackEditorOpts;
  private _pack: EditablePack;
  private readonly _editable: boolean;
  private _selected: string | null = null;
  private readonly _iconEl: HTMLImageElement;
  private readonly _gridEl: HTMLElement;
  private readonly _detailEl: HTMLElement;
  private readonly _status: StatusLine;
  private readonly _uploadStatus: StatusLine;
  /** Edits issued, and the newest whose answer has been drawn (see `_write`). */
  private _issued = 0;
  private _drawn = 0;

  constructor(opts: PackEditorOpts) {
    this._opts = opts;
    this._pack = opts.pack;
    this._editable = opts.canEdit && !opts.pack.read_only;

    this._el = document.createElement("div");
    this._el.className = "pack-editor";

    this._iconEl = document.createElement("img");
    this._iconEl.className = "pack-editor__icon";
    this._iconEl.alt = "";

    this._status = statusLine();
    this._uploadStatus = statusLine(null);

    this._el.appendChild(this._buildHeader());

    this._gridEl = document.createElement("div");
    this._gridEl.className = "pack-editor__grid";
    this._gridEl.setAttribute("role", "listbox");
    this._gridEl.setAttribute("aria-label", "Images in this pack");
    this._el.appendChild(this._gridEl);

    const upload = document.createElement("div");
    upload.className = "pack-editor__upload-status";
    upload.appendChild(this._uploadStatus.el);
    this._el.appendChild(upload);

    this._detailEl = document.createElement("div");
    this._detailEl.className = "pack-editor__detail";
    this._el.appendChild(this._detailEl);

    this._renderIcon();
    this._renderGrid();
    this._renderDetail();
  }

  getElement(): HTMLElement {
    return this._el;
  }

  // ── Header: name, icon, default use, favorite, delete ─────────────────────

  private _buildHeader(): HTMLElement {
    const header = document.createElement("div");
    header.className = "pack-editor__header";
    const { location } = this._opts;

    const titleRow = document.createElement("div");
    titleRow.className = "pack-editor__title-row";
    titleRow.appendChild(this._iconEl);
    if (!this._editable) {
      const title = document.createElement("span");
      title.className = "pack-editor__title";
      title.textContent = this._pack.display_name ?? "(unnamed pack)";
      titleRow.appendChild(title);
    } else {
      const iconInput = imageFileInput("pack-editor__icon-file", false, (files) => void this._uploadIcon(files[0]));
      titleRow.appendChild(iconInput);
      titleRow.appendChild(button("[upload icon]", "pack-editor__upload-icon", () => iconInput.click()));
    }
    header.appendChild(titleRow);

    if (this._editable) {
      header.appendChild(commitTextRow({
        label: "name",
        value: this._pack.display_name ?? "",
        placeholder: "Pack name",
        ariaLabel: "Pack name",
        save: (v) => this._edit(() => setPackMeta(location, { display_name: v.trim() })),
      }).row);
      header.appendChild(commitSelectRow({
        label: "default use",
        value: usageKey(this._pack.usage, "both"),
        options: PACK_USE,
        ariaLabel: "Default use",
        save: (v) => this._edit(() => setPackMeta(location, { usage: v === "both" ? [] : (usageFromKey(v) ?? []) })),
      }).row);
    }

    if (this._opts.favoritable && location.kind === "room") {
      header.appendChild(this._favoriteRow(location.room_id, location.state_key));
    }

    if (this._editable && location.kind === "room") {
      const actions = document.createElement("div");
      actions.className = "pack-editor__pack-actions";
      actions.appendChild(button("[delete pack]", "pack-editor__delete-pack", () => void this._deletePack(), true));
      header.appendChild(actions);
    }

    header.appendChild(this._status.el);
    return header;
  }

  private _favoriteRow(roomId: string, stateKey: string): HTMLElement {
    const label = document.createElement("label");
    label.className = "settings-dialog__checkbox-label pack-editor__favorite-row";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "pack-editor__favorite";
    box.checked = this._pack.favorited;
    box.addEventListener("change", () => {
      const favorite = box.checked;
      box.disabled = true;
      setPackFavorite(roomId, stateKey, favorite)
        .then(() => {
          this._pack = { ...this._pack, favorited: favorite };
          invalidateCustomEmoji();
          this._opts.onChange?.(this._pack);
          this._status.set("saved", favorite ? "usable in every room" : "only usable here");
        })
        .catch((err) => {
          box.checked = !favorite;
          this._status.set("error", errorText(err));
        })
        .finally(() => {
          box.disabled = false;
        });
    });
    label.append(box, document.createTextNode(" use in every room (favorite)"));
    return label;
  }

  // ── Writes ────────────────────────────────────────────────────────────────

  /**
   * Run an edit; on success redraw from the pack it returns, unless the answer
   * of an edit issued after it has been drawn already. The backend applies a
   * pack's edits one at a time, in the order they were sent, so a later edit's
   * pack includes this one's change — drawing this one's last would put the
   * pack back as it was between the two (a rename undone on screen, and edits
   * to the new shortcode refused). `beforeDraw` runs on success either way,
   * before any redraw. Throws on failure.
   */
  private async _write<T>(
    op: () => Promise<T>,
    packOf: (result: T) => EditablePack,
    beforeDraw?: (result: T) => void,
  ): Promise<T> {
    const seq = ++this._issued;
    const result = await op();
    beforeDraw?.(result);
    if (seq > this._drawn) {
      this._drawn = seq;
      this._applyPack(packOf(result));
    }
    return result;
  }

  /** `_write` for the edits that answer with the pack alone. */
  private async _edit(op: () => Promise<EditablePack>): Promise<void> {
    await this._write(op, (p) => p);
  }

  private _applyPack(next: EditablePack): void {
    // An edit never changes whether the pack is a favorite, and the toggle here
    // is where that changes: keep what it says over the edit's answer, which
    // may predate a toggle made moments ago.
    this._pack = { ...next, favorited: this._pack.favorited };
    invalidateCustomEmoji();
    this._opts.onChange?.(this._pack);
    this._renderIcon();
    this._renderGrid();
    if (this._selected !== null && !next.images.some((i) => i.shortcode === this._selected)) {
      this._selected = null;
      this._renderDetail();
    }
  }

  private async _uploadIcon(file: File): Promise<void> {
    this._status.set("saving", "uploading icon…");
    try {
      const img = await readImageFile(file);
      const url = await uploadPackMedia(img.dataBase64, img.mimetype);
      await this._edit(() => setPackMeta(this._opts.location, { avatar_url: url }));
      this._status.set("saved", "icon set");
    } catch (err) {
      this._status.set("error", errorText(err));
    }
  }

  private async _addFiles(files: File[]): Promise<void> {
    const images: NewPackImage[] = [];
    const failed: string[] = [];
    for (const [i, file] of files.entries()) {
      this._uploadStatus.set("saving", `uploading ${i + 1}/${files.length}…`);
      try {
        const img = await readImageFile(file);
        const url = await uploadPackMedia(img.dataBase64, img.mimetype);
        images.push({
          url,
          body: null,
          info: {
            ...(img.w !== undefined ? { w: img.w } : {}),
            ...(img.h !== undefined ? { h: img.h } : {}),
            mimetype: img.mimetype,
            size: img.size,
          },
          filename: file.name,
        });
      } catch (err) {
        failed.push(`${file.name} (${errorText(err)})`);
      }
    }
    let added = 0;
    if (images.length > 0) {
      try {
        const res = await this._write(() => addPackImages(this._opts.location, images), (r) => r.pack);
        added = res.added.length;
      } catch (err) {
        failed.push(`adding to the pack failed: ${errorText(err)}`);
      }
    }
    const parts = [];
    if (added > 0) parts.push(`added ${added}`);
    if (failed.length > 0) parts.push(`failed: ${failed.join(", ")}`);
    this._uploadStatus.set(failed.length > 0 ? "error" : "saved", parts.join(" · "));
  }

  private async _confirmRemove(shortcode: string): Promise<void> {
    const ok = await askConfirm({
      title: "Delete emoji",
      message: this._opts.location.kind === "user"
        ? `Delete :${shortcode}: from your pack?`
        : `Delete :${shortcode}: from this pack? Everyone using the pack loses it.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await this._edit(() => removePackImage(this._opts.location, shortcode));
      this._uploadStatus.set("saved", `deleted :${shortcode}:`);
    } catch (err) {
      this._uploadStatus.set("error", errorText(err));
    }
  }

  private async _deletePack(): Promise<void> {
    const { location } = this._opts;
    if (location.kind !== "room") return;
    const name = this._pack.display_name ?? "this pack";
    const ok = await askConfirm({
      title: "Delete pack",
      message: `Delete ${name} and its ${this._pack.images.length} image${this._pack.images.length === 1 ? "" : "s"}? Every room using it loses them.`,
      confirmLabel: "Delete pack",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteRoomPack(location.room_id, location.state_key);
      invalidateCustomEmoji();
      this._el.replaceChildren(Object.assign(document.createElement("div"), {
        className: "settings-dialog__hint",
        textContent: `${name} deleted.`,
      }));
      this._opts.onChange?.(null);
    } catch (err) {
      this._status.set("error", errorText(err));
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  private _setImage(img: HTMLImageElement, url: string): void {
    const now = customEmojiImage(url);
    if (now) {
      img.src = now;
      return;
    }
    img.classList.add("pack-editor__img--pending");
    void resolveEmojiThumbnail(url).then((src) => {
      if (!src) return;
      img.src = src;
      img.classList.remove("pack-editor__img--pending");
    });
  }

  private _renderIcon(): void {
    const url = this._pack.avatar_url ?? this._pack.images[0]?.url ?? null;
    this._iconEl.hidden = url === null;
    if (url) this._setImage(this._iconEl, url);
  }

  private _renderGrid(): void {
    // Keep focus on the cell it was on — this grid's cell only: another
    // editor in the tab may hold a cell with the same shortcode, and moving
    // focus there would aim the next `x` at the wrong pack.
    const active = document.activeElement;
    const focusedCode = active instanceof HTMLElement && this._gridEl.contains(active)
      ? (active.dataset.shortcode ?? null)
      : null;
    this._gridEl.replaceChildren();
    for (const image of this._pack.images) {
      this._gridEl.appendChild(this._cell(image));
    }
    if (this._editable) {
      const input = imageFileInput("pack-editor__file", true, (files) => void this._addFiles(files));
      this._gridEl.appendChild(input);
      this._gridEl.appendChild(button("[+ add images]", "pack-editor__add", () => input.click()));
    }
    if (this._pack.images.length === 0) {
      const empty = document.createElement("div");
      empty.className = "settings-dialog__hint pack-editor__empty";
      empty.textContent = this._editable ? "No images yet." : "This pack is empty.";
      this._gridEl.prepend(empty);
    }
    if (focusedCode) this._cellFor(focusedCode)?.focus();
  }

  private _cell(image: EditableImage): HTMLButtonElement {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "pack-editor__cell";
    cell.dataset.shortcode = image.shortcode;
    cell.title = `:${image.shortcode}:`;
    cell.setAttribute("role", "option");
    cell.setAttribute("aria-selected", String(image.shortcode === this._selected));
    if (image.shortcode === this._selected) cell.classList.add("pack-editor__cell--selected");
    const img = document.createElement("img");
    img.className = "pack-editor__img";
    img.alt = "";
    this._setImage(img, image.url);
    const code = document.createElement("span");
    code.className = "pack-editor__code";
    code.textContent = `:${image.shortcode}:`;
    cell.append(img, code);
    cell.addEventListener("click", () => this._select(image.shortcode));
    cell.addEventListener("keydown", (e) => this._onCellKey(e, image.shortcode));
    return cell;
  }

  private _cellFor(shortcode: string): HTMLButtonElement | null {
    return [...this._gridEl.querySelectorAll<HTMLButtonElement>(".pack-editor__cell")]
      .find((c) => c.dataset.shortcode === shortcode) ?? null;
  }

  private _onCellKey(e: KeyboardEvent, shortcode: string): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const move = DIRECTIONS[e.key];
    if (move) {
      e.preventDefault();
      e.stopPropagation();
      const cells = [...this._gridEl.querySelectorAll<HTMLButtonElement>(".pack-editor__cell")];
      const from = cells.findIndex((c) => c.dataset.shortcode === shortcode);
      // Columns as laid out: the cells sharing the first one's row.
      const top = cells[0]?.offsetTop ?? 0;
      const columns = Math.max(1, cells.filter((c) => c.offsetTop === top).length);
      const to = sectionedGridMove([cells.length], columns, from, move);
      if (to !== null) cells[to]?.focus();
      return;
    }
    if ((e.key === "x" || e.key === "Delete") && this._editable) {
      e.preventDefault();
      e.stopPropagation();
      void this._confirmRemove(shortcode);
    }
  }

  private _select(shortcode: string): void {
    this._selected = shortcode;
    for (const cell of this._gridEl.querySelectorAll<HTMLElement>(".pack-editor__cell")) {
      const on = cell.dataset.shortcode === shortcode;
      cell.classList.toggle("pack-editor__cell--selected", on);
      cell.setAttribute("aria-selected", String(on));
    }
    this._renderDetail();
    // Below a long grid — on a phone above all — the details would open out of view.
    this._detailEl.scrollIntoView?.({ block: "nearest" });
  }

  private _renderDetail(): void {
    this._detailEl.replaceChildren();
    const image = this._pack.images.find((i) => i.shortcode === this._selected);
    this._detailEl.hidden = !image;
    if (!image) return;

    const title = document.createElement("div");
    title.className = "settings-dialog__section-title pack-editor__detail-title";
    title.textContent = `:${image.shortcode}:`;
    this._detailEl.appendChild(title);

    if (!this._editable) {
      const facts: Array<[string, string]> = [
        ["description", image.body ?? "—"],
        ["use", IMAGE_USE.find(([k]) => k === usageKey(image.usage, "inherit"))?.[1] ?? "pack default"],
      ];
      for (const [label, value] of facts) {
        const row = document.createElement("div");
        row.className = "settings-dialog__row";
        const l = document.createElement("span");
        l.className = "settings-dialog__label";
        l.textContent = label;
        const v = document.createElement("span");
        v.className = "settings-dialog__value";
        v.textContent = value;
        row.append(l, v);
        this._detailEl.appendChild(row);
      }
      return;
    }

    const loc = this._opts.location;
    // The shortcode this panel's fields act on: theirs, not the editor's
    // selection. A rename changes it; a slow rename that lands after another
    // image was opened must not move that image's edits onto the renamed one.
    let code = image.shortcode;
    const current = (): string => code;

    this._detailEl.appendChild(commitTextRow({
      label: "shortcode",
      value: image.shortcode,
      placeholder: "shortcode",
      ariaLabel: "Shortcode",
      save: async (v) => {
        const from = code;
        const to = v.trim();
        await this._write(() => renamePackImage(loc, from, to), (p) => p, () => {
          code = to;
          title.textContent = `:${to}:`;
          if (this._selected === from) this._selected = to;
        });
      },
    }).row);
    this._detailEl.appendChild(commitSelectRow({
      label: "use",
      value: usageKey(image.usage, "inherit"),
      options: IMAGE_USE,
      ariaLabel: "Use",
      save: (v) => this._edit(() => setPackImageUsage(loc, current(), usageFromKey(v))),
    }).row);
    this._detailEl.appendChild(commitTextRow({
      label: "description",
      value: image.body ?? "",
      placeholder: "What it shows (alt text)",
      ariaLabel: "Description",
      save: (v) => this._edit(() => setPackImageBody(loc, current(), v.trim() || null)),
    }).row);

    const actions = document.createElement("div");
    actions.className = "pack-editor__image-actions";
    actions.appendChild(button("[use as pack icon]", "pack-editor__make-icon", () => {
      const url = this._pack.images.find((i) => i.shortcode === current())?.url;
      if (!url) return;
      this._edit(() => setPackMeta(loc, { avatar_url: url }))
        .then(() => this._status.set("saved", "icon set"))
        .catch((err) => this._status.set("error", errorText(err)));
    }));
    actions.appendChild(button("[delete]", "pack-editor__delete", () => void this._confirmRemove(current()), true));
    this._detailEl.appendChild(actions);
  }
}
