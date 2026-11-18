import { describe, it, expect, beforeEach, vi } from "vitest";
import type { EditablePack, PackLocation } from "../../ipc/types.js";

// The one pack editor (#12), mounted by Settings → Emoji (personal pack) and by
// the Emoji tab of the room dialog and space settings.

const ipc = vi.hoisted(() => ({
  renamePackImage: vi.fn(),
  removePackImage: vi.fn(),
  setPackFavorite: vi.fn(),
  uploadPackMedia: vi.fn(),
  addPackImages: vi.fn(),
  setPackImageUsage: vi.fn(),
  setPackImageBody: vi.fn(),
  setPackMeta: vi.fn(),
  deleteRoomPack: vi.fn(),
  getThumbnail: vi.fn(async () => ({ data_base64: "SU1H", mime_type: "image/png", filename: null })),
}));
vi.mock("../../ipc/index.js", async (orig) => ({ ...(await orig<object>()), ...ipc }));

const askConfirm = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../ConfirmDialog.js", () => ({ askConfirm }));

const invalidateCustomEmoji = vi.hoisted(() => vi.fn());
vi.mock("../../app/actions/custom_emoji.js", async (orig) => ({
  ...(await orig<object>()),
  invalidateCustomEmoji,
}));

const readImageFile = vi.hoisted(() => vi.fn());
vi.mock("./image_file.js", () => ({ readImageFile }));

import { PackEditor } from "./PackEditor.js";

const ROOM_LOC: PackLocation = { kind: "room", room_id: "!r:x", state_key: "blobs" };

function pack(over: Partial<EditablePack> = {}): EditablePack {
  return {
    room_id: "!r:x",
    state_key: "blobs",
    display_name: "Blobs",
    avatar_url: null,
    usage: null,
    images: [
      { shortcode: "blobcat", url: "data:image/png;base64,AA", body: null, usage: null },
      { shortcode: "blobwave", url: "data:image/png;base64,BB", body: "Wave", usage: ["emoticon"] },
    ],
    favorited: false,
    read_only: false,
    ...over,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

let editor: PackEditor;
let onChange: ReturnType<typeof vi.fn>;

function mount(opts: { canEdit?: boolean; favoritable?: boolean; p?: EditablePack; location?: PackLocation } = {}): HTMLElement {
  onChange = vi.fn();
  editor = new PackEditor({
    location: opts.location ?? ROOM_LOC,
    pack: opts.p ?? pack(),
    canEdit: opts.canEdit ?? true,
    favoritable: opts.favoritable ?? true,
    onChange,
  });
  document.body.innerHTML = "";
  document.body.appendChild(editor.getElement());
  return editor.getElement();
}

const cells = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>(".pack-editor__cell")];
const cell = (el: HTMLElement, code: string) => el.querySelector<HTMLButtonElement>(`.pack-editor__cell[data-shortcode="${code}"]`)!;
const detailInput = (el: HTMLElement, label: string) =>
  el.querySelector<HTMLInputElement>(`.pack-editor__detail input[aria-label="${label}"]`)!;

beforeEach(() => {
  for (const f of Object.values(ipc)) f.mockReset();
  ipc.getThumbnail.mockResolvedValue({ data_base64: "SU1H", mime_type: "image/png", filename: null });
  askConfirm.mockReset();
  askConfirm.mockResolvedValue(true);
  invalidateCustomEmoji.mockReset();
  readImageFile.mockReset();
});

describe("PackEditor", () => {
  it("shows a cell per image, labelled with its shortcode", () => {
    const el = mount();
    expect(cells(el).map((c) => c.dataset.shortcode)).toEqual(["blobcat", "blobwave"]);
    expect(cell(el, "blobwave").textContent).toContain(":blobwave:");
  });

  it("opens an image's details when its cell is clicked", () => {
    const el = mount();
    cell(el, "blobwave").click();
    expect(detailInput(el, "Shortcode").value).toBe("blobwave");
    expect(detailInput(el, "Description").value).toBe("Wave");
  });

  it("renames on Enter and redraws from the pack the backend returns", async () => {
    const renamed = pack({
      images: [
        { shortcode: "blobcat", url: "data:image/png;base64,AA", body: null, usage: null },
        { shortcode: "wave", url: "data:image/png;base64,BB", body: "Wave", usage: ["emoticon"] },
      ],
    });
    ipc.renamePackImage.mockResolvedValue(renamed);
    const el = mount();
    cell(el, "blobwave").click();
    const field = detailInput(el, "Shortcode");
    field.value = "wave";
    field.dispatchEvent(new Event("input"));
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();
    expect(ipc.renamePackImage).toHaveBeenCalledWith(ROOM_LOC, "blobwave", "wave");
    expect(cells(el).map((c) => c.dataset.shortcode)).toEqual(["blobcat", "wave"]);
    expect(invalidateCustomEmoji).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith(renamed);
  });

  it("shows a failed rename under the field and leaves the grid alone", async () => {
    ipc.renamePackImage.mockRejectedValue(new Error(":blobcat: is already in this pack"));
    const el = mount();
    cell(el, "blobwave").click();
    const field = detailInput(el, "Shortcode");
    field.value = "blobcat";
    field.dispatchEvent(new Event("input"));
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();
    expect(el.querySelector(".pack-editor__detail .settings-dialog__field-status--error")?.textContent)
      .toContain("already in this pack");
    expect(cells(el).map((c) => c.dataset.shortcode)).toEqual(["blobcat", "blobwave"]);
    expect(invalidateCustomEmoji).not.toHaveBeenCalled();
  });

  it("deletes the focused image with x, after confirming", async () => {
    ipc.removePackImage.mockResolvedValue(pack({ images: [pack().images[0]] }));
    const el = mount();
    const target = cell(el, "blobwave");
    target.focus();
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    await flush();
    await flush();
    expect(askConfirm).toHaveBeenCalledWith(expect.objectContaining({ danger: true }));
    expect(ipc.removePackImage).toHaveBeenCalledWith(ROOM_LOC, "blobwave");
    expect(cells(el).map((c) => c.dataset.shortcode)).toEqual(["blobcat"]);
  });

  it("deletes nothing when the confirmation is declined", async () => {
    askConfirm.mockResolvedValue(false);
    const el = mount();
    cell(el, "blobwave").dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    await flush();
    expect(ipc.removePackImage).not.toHaveBeenCalled();
  });

  it("offers no editing without permission, but still the favorite toggle", () => {
    const el = mount({ canEdit: false });
    cell(el, "blobwave").click();
    const controls = [...el.querySelectorAll("input, select")];
    expect(controls).toHaveLength(1);
    expect(controls[0].classList.contains("pack-editor__favorite")).toBe(true);
    expect(el.querySelector(".pack-editor__add")).toBeNull();
  });

  it("offers no editing for a read-only (legacy) personal pack", () => {
    const el = mount({ location: { kind: "user" }, favoritable: false, p: pack({ room_id: null, state_key: null, read_only: true }) });
    cell(el, "blobwave").click();
    expect(el.querySelectorAll("input, select")).toHaveLength(0);
  });

  it("favorites a room pack from its toggle", async () => {
    ipc.setPackFavorite.mockResolvedValue(undefined);
    const el = mount();
    const box = el.querySelector<HTMLInputElement>(".pack-editor__favorite")!;
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    await flush();
    expect(ipc.setPackFavorite).toHaveBeenCalledWith("!r:x", "blobs", true);
    expect(invalidateCustomEmoji).toHaveBeenCalled();
  });

  it("uploads each picked file, then adds them all in one write", async () => {
    readImageFile.mockImplementation(async (f: File) => ({ dataBase64: btoa(f.name), mimetype: "image/png", size: 3, w: 32, h: 32 }));
    ipc.uploadPackMedia.mockImplementation(async (b64: string) => `mxc://x/${b64}`);
    ipc.addPackImages.mockResolvedValue({ pack: pack(), added: ["a", "b"] });
    const el = mount();
    const input = el.querySelector<HTMLInputElement>(".pack-editor__file")!;
    const files = [new File(["a"], "a.png", { type: "image/png" }), new File(["b"], "b.png", { type: "image/png" })];
    Object.defineProperty(input, "files", { value: files, configurable: true });
    input.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(ipc.addPackImages).toHaveBeenCalledOnce());
    expect(ipc.uploadPackMedia).toHaveBeenCalledTimes(2);
    const [, images] = ipc.addPackImages.mock.calls[0];
    expect(images).toEqual([
      { url: `mxc://x/${btoa("a.png")}`, body: null, info: { w: 32, h: 32, mimetype: "image/png", size: 3 }, filename: "a.png" },
      { url: `mxc://x/${btoa("b.png")}`, body: null, info: { w: 32, h: 32, mimetype: "image/png", size: 3 }, filename: "b.png" },
    ]);
  });

  it("reports a file that failed to upload and adds the rest", async () => {
    readImageFile.mockImplementation(async (f: File) => {
      if (f.name === "bad.txt") throw new Error("bad.txt is not an image");
      return { dataBase64: "AA", mimetype: "image/png", size: 1 };
    });
    ipc.uploadPackMedia.mockResolvedValue("mxc://x/ok");
    ipc.addPackImages.mockResolvedValue({ pack: pack(), added: ["ok"] });
    const el = mount();
    const input = el.querySelector<HTMLInputElement>(".pack-editor__file")!;
    Object.defineProperty(input, "files", {
      value: [new File(["x"], "bad.txt", { type: "text/plain" }), new File(["y"], "ok.png", { type: "image/png" })],
      configurable: true,
    });
    input.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(ipc.addPackImages).toHaveBeenCalledOnce());
    expect(ipc.addPackImages.mock.calls[0][1]).toHaveLength(1);
    await vi.waitFor(() =>
      expect(el.querySelector(".pack-editor__upload-status")?.textContent).toContain("bad.txt"),
    );
  });
});
