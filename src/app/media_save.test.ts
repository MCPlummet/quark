import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../ipc/index.js", () => ({
  getPlatform: vi.fn(async () => "android"),
  saveMediaToPhotos: vi.fn(async () => "Pictures/Quark"),
  saveMediaWithDialog: vi.fn(async () => "cat.png"),
}));
vi.mock("../ui/NotificationToast.js", () => ({
  showToast: vi.fn(() => dismissProgress),
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));
const dismissProgress = vi.fn();

import {
  currentSaveTargets,
  initSaveTargets,
  savableMediaForEvent,
  savedMessage,
  saveMedia,
  saveMenuHandlers,
  saveTargetsFor,
} from "./media_save.js";
import { getPlatform, saveMediaToPhotos, saveMediaWithDialog } from "../ipc/index.js";
import { showError, showSuccess } from "../ui/NotificationToast.js";
import type { TimelineEvent } from "../ipc/types.js";

const event = (over: Partial<TimelineEvent> = {}): TimelineEvent =>
  ({
    event_id: "$img",
    sender: "@alice:example.com",
    body: "cat.png",
    msg_type: "m.image",
    media_url: "mxc://example.com/abc",
    media_mimetype: "image/png",
    ...over,
  }) as TimelineEvent;

describe("save targets", () => {
  it("offers Photos and Files on the mobile platforms", () => {
    expect(saveTargetsFor("ios")).toEqual(["photos", "files"]);
    expect(saveTargetsFor("android")).toEqual(["photos", "files"]);
  });

  it("offers only Files on desktop, which has no photo library", () => {
    for (const p of ["linux", "macos", "windows"]) expect(saveTargetsFor(p)).toEqual(["files"]);
  });

  it("starts from Files alone and learns the platform's set at init", async () => {
    expect(currentSaveTargets()).toEqual(["files"]);
    await initSaveTargets();
    expect(currentSaveTargets()).toEqual(["photos", "files"]);
  });

  it("keeps what it had when the platform lookup fails", async () => {
    vi.mocked(getPlatform).mockRejectedValueOnce(new Error("no backend"));
    const before = currentSaveTargets();
    expect(await initSaveTargets()).toEqual(before);
  });
});

describe("savableMediaForEvent", () => {
  // The rendered message's mediaUrl becomes a blob: URL once fetched; only the
  // event still has an address the backend can download.
  it("reads the mxc:// address, name and key from the raw event", () => {
    expect(
      savableMediaForEvent(event({ filename: "original.png", body: "a caption", media_encryption_info: "{}" })),
    ).toEqual({
      mxcUrl: "mxc://example.com/abc",
      filename: "original.png",
      encryptionInfo: "{}",
      mimeType: "image/png",
    });
  });

  it("falls back to the body for an uncaptioned upload with no filename", () => {
    expect(savableMediaForEvent(event())?.filename).toBe("cat.png");
  });

  it("has nothing to save without an mxc:// address", () => {
    expect(savableMediaForEvent(undefined)).toBeNull();
    expect(savableMediaForEvent(event({ media_url: null }))).toBeNull();
    expect(savableMediaForEvent(event({ media_url: "blob:http://x/1" }))).toBeNull();
  });
});

describe("saveMenuHandlers (#124)", () => {
  // Runs after the save-targets block above has learned "android".
  it("offers both rows on an image message where there is a photo library", () => {
    const rows = saveMenuHandlers(event());
    expect(typeof rows["save-image-photos"]).toBe("function");
    expect(typeof rows["save-image-file"]).toBe("function");
  });

  it("offers nothing on a message that is not an image", () => {
    expect(saveMenuHandlers(event({ msg_type: "m.text", media_url: null }))).toEqual({});
    expect(saveMenuHandlers(event({ msg_type: "m.video" }))).toEqual({});
    expect(saveMenuHandlers(undefined)).toEqual({});
  });

  it("saves the image to the chosen destination", () => {
    saveMenuHandlers(event({ media_mimetype: "image/heic" }))["save-image-photos"]!();
    // The declared type travels with it: the backend's sniff would call HEIC a video.
    expect(saveMediaToPhotos).toHaveBeenCalledWith("mxc://example.com/abc", "cat.png", undefined, "image/heic");
  });
});

describe("savedMessage", () => {
  it("names the album for a Photos save", () => {
    expect(savedMessage("photos", "Pictures/Quark")).toBe("Saved to Pictures/Quark");
    expect(savedMessage("photos", "")).toBe("Saved to Photos");
  });

  it("reads naturally for a desktop path and a mobile file name alike", () => {
    expect(savedMessage("files", "/home/me/cat.png")).toBe("Saved to /home/me/cat.png");
    expect(savedMessage("files", "cat.png")).toBe("Saved cat.png");
  });
});

describe("saveMedia", () => {
  const media = { mxcUrl: "mxc://example.com/abc", filename: "cat.png" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves to Photos through its own command and confirms where", async () => {
    await saveMedia(media, "photos");
    expect(saveMediaToPhotos).toHaveBeenCalledWith("mxc://example.com/abc", "cat.png", undefined, undefined);
    expect(showSuccess).toHaveBeenCalledWith("Saved to Pictures/Quark");
  });

  it("saves to Files through the dialog command", async () => {
    await saveMedia(media, "files");
    expect(saveMediaWithDialog).toHaveBeenCalledWith("mxc://example.com/abc", "cat.png", undefined, undefined);
    expect(showSuccess).toHaveBeenCalledWith("Saved cat.png");
  });

  it("clears its progress toast and says nothing more when the dialog is cancelled", async () => {
    vi.mocked(saveMediaWithDialog).mockResolvedValueOnce(null);
    await saveMedia(media, "files");
    expect(dismissProgress).toHaveBeenCalled();
    expect(showSuccess).not.toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
  });

  // The backend rejects with a plain string (Tauri's command error), not an Error.
  it("shows the backend's reason when the save fails, without throwing", async () => {
    vi.mocked(saveMediaToPhotos).mockRejectedValueOnce("Quark isn't allowed to add to Photos.");
    await expect(saveMedia(media, "photos")).resolves.toBeUndefined();
    expect(showError).toHaveBeenCalledWith("Couldn't save: Quark isn't allowed to add to Photos.", 6000);
  });
});
