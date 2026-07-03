import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AppComponents } from "../../ui/App.js";

// Mock the IPC surface so no real invoke happens; capture the send call.
const sendPastedImage = vi.fn(async () => "$sent");
vi.mock("../../ipc/index.js", () => ({
  sendPastedImage: (...args: unknown[]) => sendPastedImage(...args),
  // Referenced elsewhere in media.ts's module scope; stubbed to no-ops.
  serveMedia: vi.fn(),
  saveMediaToTemp: vi.fn(),
  getPlatform: vi.fn(),
  getAppConfig: vi.fn(),
  saveMediaWithDialog: vi.fn(),
  openMediaExternally: vi.fn(),
  sendFile: vi.fn(),
  sendVideo: vi.fn(),
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

import { sendPendingImage } from "./media.js";
import { setComponents } from "./context.js";
import { AppState } from "../state.js";

const showImagePreview = vi.fn();
const getValue = vi.fn(() => "");
const setValue = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  getValue.mockReturnValue("");
  setComponents({ input: { showImagePreview, getValue, setValue } } as unknown as AppComponents);
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
    expect(succeed).toHaveBeenCalled();
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

    expect(fail).toHaveBeenCalled();
    expect(showImagePreview).toHaveBeenCalledWith(b, "cat.png");
    // Field was empty, so the caption is restored.
    expect(setValue).toHaveBeenCalledWith("a cat");
    // Reply state is not cleared on failure.
    expect(cancelReply).not.toHaveBeenCalled();
  });
});
