import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AppComponents } from "../../ui/App.js";

// Mock the IPC surface so no real invoke happens; capture the send call.
// Typed with the real signature so `.mock.calls[n]` destructures cleanly under
// `tsc` (the Nix build typechecks test files too, unlike vitest).
const sendPastedImage =
  vi.fn<
    (
      roomId: string,
      dataBase64: string,
      mimeType: string,
      filename: string,
      caption?: string,
      replyToEventId?: string,
    ) => Promise<string>
  >(async () => "$sent");
vi.mock("../../ipc/index.js", () => ({
  sendPastedImage: (...args: Parameters<typeof sendPastedImage>) => sendPastedImage(...args),
  // Referenced elsewhere in media.ts's module scope; stubbed to no-ops.
  serveMedia: vi.fn(),
  saveMediaToTemp: vi.fn(),
  getPlatform: vi.fn(),
  getAppConfig: vi.fn(),
  saveMediaWithDialog: vi.fn(),
  openMediaExternally: vi.fn(),
  sendFile: (...args: Parameters<typeof sendFile>) => sendFile(...args),
  sendVideo: (...args: Parameters<typeof sendVideo>) => sendVideo(...args),
}));

const sendFile =
  vi.fn<
    (
      roomId: string,
      dataBase64: string,
      mimeType: string,
      filename: string,
      fileSize?: number,
      uploadId?: string,
    ) => Promise<string>
  >(async () => "$file");

const sendVideo =
  vi.fn<
    (
      roomId: string,
      dataBase64: string,
      mimeType: string,
      filename: string,
      width?: number,
      height?: number,
      durationMs?: number,
      fileSize?: number,
      uploadId?: string,
    ) => Promise<string>
  >(async () => "$video");

// Upload-progress channel: capture the subscriber so tests can drive the row.
let progressHandler: ((p: { upload_id: string; transferred: number; total: number }) => void) | null =
  null;
const unlistenProgress = vi.fn();
vi.mock("../../ipc/media.js", () => ({
  newUploadId: () => "upload-1",
  listenAttachmentProgress: async (cb: (p: never) => void) => {
    progressHandler = cb as unknown as typeof progressHandler;
    return unlistenProgress;
  },
}));

// convertFileSrc pulls in the Tauri runtime; stub it.
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (s: string) => s }));

// Progress toast: return a controllable handle.
const succeed = vi.fn();
const fail = vi.fn();
vi.mock("../../ui/NotificationToast.js", () => ({
  showProgressToast: () => ({ succeed, fail }),
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

// cancelReply lives in messages.js; spy on it.
const cancelReply = vi.fn();
vi.mock("./messages.js", () => ({
  startReply: vi.fn(),
  cancelReply: () => cancelReply(),
}));

import { sendPendingImage, handleFilePick } from "./media.js";
import { setComponents } from "./context.js";
import { AppState } from "../state.js";

const showImagePreview = vi.fn();
const getValue = vi.fn(() => "");
const setValue = vi.fn();

// The inline composer progress row (#63) — recorded so the lifecycle can be
// asserted without standing up the real component.
const rowApi = {
  setPhase: vi.fn(),
  setProgress: vi.fn(),
  setIndeterminate: vi.fn(),
  setCancellable: vi.fn(),
  succeed: vi.fn(),
  fail: vi.fn(),
  dismiss: vi.fn(),
};
const startAttachmentProgress =
  vi.fn<(filename: string, onCancel?: () => void) => typeof rowApi>(() => rowApi);

beforeEach(() => {
  vi.clearAllMocks();
  getValue.mockReturnValue("");
  progressHandler = null;
  setComponents({
    input: { showImagePreview, getValue, setValue, startAttachmentProgress },
  } as unknown as AppComponents);
  AppState.patch({ currentRoomId: "!room:x", replyToEventId: null });
});

// jsdom's Blob.arrayBuffer() doesn't round-trip bytes, so give the test blob a
// working one (blobToBase64 relies on it).
const blob = () => {
  const b = new Blob(["x"], { type: "image/png" });
  Object.defineProperty(b, "arrayBuffer", {
    value: async () => new Uint8Array([120]).buffer,
  });
  return b;
};

describe("sendPendingImage", () => {
  it("generates a pasted-image filename when none is given", async () => {
    await sendPendingImage(blob(), null);

    expect(sendPastedImage).toHaveBeenCalledTimes(1);
    const [roomId, , mime, filename, caption, replyTo] = sendPastedImage.mock.calls[0];
    expect(roomId).toBe("!room:x");
    expect(mime).toBe("image/png");
    expect(filename).toMatch(/^pasted-image-\d+\.png$/);
    expect(caption).toBeUndefined();
    expect(replyTo).toBeUndefined();
    expect(rowApi.succeed).toHaveBeenCalled();
  });

  it("passes through the original filename and caption", async () => {
    await sendPendingImage(blob(), "cat.png", "a cat");

    const [, , , filename, caption] = sendPastedImage.mock.calls[0];
    expect(filename).toBe("cat.png");
    expect(caption).toBe("a cat");
  });

  it("drops a whitespace-only caption", async () => {
    await sendPendingImage(blob(), "cat.png", "   ");
    const [, , , , caption] = sendPastedImage.mock.calls[0];
    expect(caption).toBeUndefined();
  });

  it("sends as a reply and clears reply state on success", async () => {
    AppState.set("replyToEventId", "$parent");
    await sendPendingImage(blob(), "cat.png");

    const [, , , , , replyTo] = sendPastedImage.mock.calls[0];
    expect(replyTo).toBe("$parent");
    expect(cancelReply).toHaveBeenCalledTimes(1);
  });

  it("does not clear reply state when not replying", async () => {
    await sendPendingImage(blob(), "cat.png");
    expect(cancelReply).not.toHaveBeenCalled();
  });

  it("restores the staged image (and caption) when the send fails", async () => {
    sendPastedImage.mockRejectedValueOnce(new Error("boom"));
    const b = blob();

    await sendPendingImage(b, "cat.png", "a cat");

    expect(rowApi.fail).toHaveBeenCalledWith("boom");
    expect(showImagePreview).toHaveBeenCalledWith(b, "cat.png");
    // Field was empty, so the caption is restored.
    expect(setValue).toHaveBeenCalledWith("a cat");
    // Reply state is not cleared on failure.
    expect(cancelReply).not.toHaveBeenCalled();
  });
});

describe("attachment progress (#63)", () => {
  const file = (name = "notes.txt", type = "text/plain") =>
    new File(["hello"], name, { type });

  it("opens an inline composer row for the picked file", async () => {
    await handleFilePick(file());

    expect(startAttachmentProgress).toHaveBeenCalledTimes(1);
    expect(startAttachmentProgress.mock.calls[0][0]).toBe("notes.txt");
    expect(rowApi.succeed).toHaveBeenCalledTimes(1);
    expect(rowApi.fail).not.toHaveBeenCalled();
  });

  it("walks the row through read → upload before sending", async () => {
    await handleFilePick(file());

    const phases = rowApi.setPhase.mock.calls.map((c) => c[0]);
    expect(phases[0]).toBe("reading");
    expect(phases).toContain("uploading");
    // Cancelling can't reach the backend once the bytes are handed over.
    expect(rowApi.setCancellable).toHaveBeenCalledWith(false);
  });

  it("passes an upload id so progress events can be correlated", async () => {
    await handleFilePick(file());

    const [, , , , , uploadId] = sendFile.mock.calls[0];
    expect(uploadId).toBe("upload-1");
  });

  it("renders real byte progress from the backend, for the matching upload only", async () => {
    sendFile.mockImplementationOnce(async () => {
      progressHandler?.({ upload_id: "someone-else", transferred: 1, total: 100 });
      progressHandler?.({ upload_id: "upload-1", transferred: 40, total: 100 });
      return "$file";
    });

    await handleFilePick(file());

    expect(rowApi.setProgress).toHaveBeenCalledWith(40, 100);
    expect(rowApi.setProgress).not.toHaveBeenCalledWith(1, 100);
  });

  it("moves to sending once the last byte is out", async () => {
    sendFile.mockImplementationOnce(async () => {
      progressHandler?.({ upload_id: "upload-1", transferred: 100, total: 100 });
      return "$file";
    });

    await handleFilePick(file());

    expect(rowApi.setPhase).toHaveBeenCalledWith("sending");
  });

  it("surfaces a failed send in the row instead of leaving it spinning", async () => {
    sendFile.mockRejectedValueOnce(new Error("413 Payload Too Large"));

    await handleFilePick(file());

    expect(rowApi.fail).toHaveBeenCalledWith("413 Payload Too Large");
    expect(rowApi.succeed).not.toHaveBeenCalled();
  });

  it("unsubscribes from progress whether the send works or fails", async () => {
    await handleFilePick(file());
    expect(unlistenProgress).toHaveBeenCalledTimes(1);

    sendFile.mockRejectedValueOnce(new Error("nope"));
    await handleFilePick(file());
    expect(unlistenProgress).toHaveBeenCalledTimes(2);
  });

  it("cancels the send when the user cancels the row mid-read", async () => {
    startAttachmentProgress.mockImplementationOnce((_name, onCancel) => {
      // The read only starts after this returns, so cancel on the next tick.
      queueMicrotask(() => onCancel?.());
      return rowApi;
    });

    await handleFilePick(file());

    expect(sendFile).not.toHaveBeenCalled();
    expect(rowApi.dismiss).toHaveBeenCalledTimes(1);
    expect(rowApi.fail).not.toHaveBeenCalled();
  });

  it("still sends when the composer can't show a row", async () => {
    startAttachmentProgress.mockImplementationOnce(() => {
      throw new Error("no composer");
    });

    await handleFilePick(file());

    expect(sendFile).toHaveBeenCalledTimes(1);
  });
});
