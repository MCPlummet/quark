import { describe, it, expect, vi, beforeEach } from "vitest";
import { ImageLightbox } from "./ImageLightbox.js";

const media = { mxcUrl: "mxc://example.com/abc", filename: "cat.png" };

describe("ImageLightbox saving (#125)", () => {
  let lightbox: ImageLightbox;

  beforeEach(() => {
    document.body.innerHTML = "";
    lightbox = new ImageLightbox();
    document.body.appendChild(lightbox.getElement());
  });

  const saveButtons = (): HTMLButtonElement[] => [
    ...lightbox.getElement().querySelectorAll<HTMLButtonElement>("[data-save-target]"),
  ];

  it("offers a single save button where Files is the only destination", () => {
    expect(saveButtons().map((b) => b.textContent)).toEqual(["⬇ save"]);
  });

  it("offers Photos and Files separately on mobile", () => {
    lightbox.setSaveTargets(["photos", "files"]);
    expect(saveButtons().map((b) => b.dataset.saveTarget)).toEqual(["photos", "files"]);
  });

  it("saves the original behind the image, not the displayed blob URL", async () => {
    const handler = vi.fn(async () => undefined);
    lightbox.setSaveHandler(handler);
    lightbox.setSaveTargets(["photos", "files"]);
    lightbox.show("blob:http://localhost/1", "cat", media);

    saveButtons()[0].click();
    await Promise.resolve();

    expect(handler).toHaveBeenCalledWith(media, "photos");
  });

  it("shows that it is working, and ignores a second tap until done", async () => {
    let finish!: () => void;
    const handler = vi.fn(() => new Promise<void>((r) => { finish = r; }));
    lightbox.setSaveHandler(handler);
    lightbox.setSaveTargets(["photos", "files"]);
    lightbox.show("blob:x", "cat", media);

    const [photos, files] = saveButtons();
    photos.click();
    expect(photos.textContent).toBe("saving…");
    expect(files.disabled).toBe(true);
    files.click();
    expect(handler).toHaveBeenCalledTimes(1);

    finish();
    await new Promise((r) => setTimeout(r, 0));
    expect(photos.textContent).toBe("⬇ photos");
    expect(files.disabled).toBe(false);
  });

  it("saves with `s` from the keyboard, through the Files dialog", () => {
    const handler = vi.fn(async () => undefined);
    lightbox.setSaveHandler(handler);
    lightbox.setSaveTargets(["photos", "files"]);
    lightbox.show("blob:x", "cat", media);

    lightbox.getElement().dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }));

    expect(handler).toHaveBeenCalledWith(media, "files");
  });

  it("falls back to a plain download when it has no original to fetch", () => {
    const handler = vi.fn(async () => undefined);
    lightbox.setSaveHandler(handler);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    lightbox.show("data:image/png;base64,AAAA", "cat");

    saveButtons()[0].click();

    expect(handler).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it("offers no save button on mobile for an image with no original to fetch", () => {
    lightbox.setSaveTargets(["photos", "files"]);
    lightbox.show("data:image/png;base64,AAAA", "cat");
    expect(lightbox.getElement().querySelector<HTMLElement>(".image-lightbox__save")!.style.display).toBe("none");
    lightbox.show("blob:x", "cat", media);
    expect(lightbox.getElement().querySelector<HTMLElement>(".image-lightbox__save")!.style.display).toBe("");
  });

  // A native dialog that never appears never answers; the next image opened
  // must not inherit a viewer stuck on "saving…".
  it("recovers from a save that never finishes once another image is opened", () => {
    const handler = vi.fn(() => new Promise<void>(() => {}));
    lightbox.setSaveHandler(handler);
    lightbox.setSaveTargets(["photos", "files"]);
    lightbox.show("blob:x", "cat", media);
    saveButtons()[0].click();
    lightbox.hide();

    lightbox.show("blob:y", "dog", media);

    expect(saveButtons().map((b) => [b.textContent, b.disabled])).toEqual([
      ["⬇ photos", false],
      ["⬇ files", false],
    ]);
    saveButtons()[1].click();
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
