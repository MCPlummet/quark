import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AppComponents } from "../../ui/App.js";
import type { SentMessage, TimelineEvent } from "../../ipc/types.js";

// Mock the IPC surface so no real invoke happens; capture the send call.
// Typed with the real signature so `.mock.calls[n]` destructures cleanly under
// `tsc` (the Nix build typechecks test files too, unlike vitest).
type Sent = {
  roomId: string;
  dataBase64: string;
  mimeType: string;
  filename: string;
  caption?: string;
  formattedCaption?: string;
  replyToEventId?: string;
  threadRootEventId?: string;
  uploadId?: string;
  fileSize?: number;
  width?: number;
  height?: number;
  durationMs?: number;
};

const sendPastedImage = vi.fn<(send: Sent) => Promise<SentMessage>>(async () => ({ event_id: "$sent", echo: null }));
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
  readClipboardFiles: () => readClipboardFiles(),
}));

const readClipboardFiles = vi.fn<() => Promise<{ files: File[]; errors: string[] }>>(
  async () => ({ files: [], errors: [] }),
);

const sendFile = vi.fn<(send: Sent) => Promise<SentMessage>>(async () => ({ event_id: "$file", echo: null }));

const sendVideo = vi.fn<(send: Sent) => Promise<SentMessage>>(async () => ({ event_id: "$video", echo: null }));

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

vi.mock("../../ui/NotificationToast.js", () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

// cancelReply lives in messages.js; spy on it.
const cancelReply = vi.fn();
vi.mock("./messages.js", () => ({
  startReply: vi.fn(),
  cancelReply: () => cancelReply(),
}));

// The local echo (#112): recorded rather than rendered — `live.test.ts` covers
// what painting it does.
const showSentEvent = vi.fn<(roomId: string, event: TimelineEvent) => void>();
vi.mock("./live.js", () => ({
  showSentEvent: (...args: Parameters<typeof showSentEvent>) => showSentEvent(...args),
}));

import { sendStagedAttachments, attachFiles, readCopiedFiles } from "./media.js";
import { attachmentKind, type StagedAttachment } from "../../ui/AttachmentTray.js";
import { showError } from "../../ui/NotificationToast.js";
import { setComponents, _shortcodeToMxc } from "./context.js";
import { AppState } from "../state.js";

const stageAttachment = vi.fn<(file: Blob, filename?: string | null) => void>();
const restoreStagedAttachments = vi.fn<(items: readonly StagedAttachment[]) => void>();
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
    input: { stageAttachment, restoreStagedAttachments, getValue, setValue, startAttachmentProgress },
  } as unknown as AppComponents);
  AppState.patch({
    currentRoomId: "!room:x",
    replyToEventId: null,
    threadRootEventId: null,
    currentTimeline: [],
  });
  // Module-global, so a room's custom emoji would otherwise leak between tests.
  _shortcodeToMxc.clear();
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

// What the composer's tray hands over on submit.
let nextStagedId = 1;
const staged = (file: Blob, filename: string | null): StagedAttachment => ({
  id: nextStagedId++,
  file,
  filename,
  kind: attachmentKind(file),
});
/** Submit a tray holding one image (the old single-image preview's path). */
const sendPendingImage = (b: Blob, filename: string | null, caption?: string) =>
  sendStagedAttachments([staged(b, filename)], caption);
/** Submit a tray holding one picked file. */
const handleFilePick = (f: File) => sendStagedAttachments([staged(f, f.name || null)]);

describe("sending a staged image", () => {
  it("generates a pasted-image filename when none is given", async () => {
    await sendPendingImage(blob(), null);

    expect(sendPastedImage).toHaveBeenCalledTimes(1);
    const [send] = sendPastedImage.mock.calls[0];
    expect(send.roomId).toBe("!room:x");
    expect(send.mimeType).toBe("image/png");
    expect(send.filename).toMatch(/^pasted-image-\d+\.png$/);
    expect(send.caption).toBeUndefined();
    expect(send.replyToEventId).toBeUndefined();
    expect(rowApi.succeed).toHaveBeenCalled();
  });

  it("passes through the original filename and caption", async () => {
    await sendPendingImage(blob(), "cat.png", "a cat");

    const [send] = sendPastedImage.mock.calls[0];
    expect(send.filename).toBe("cat.png");
    expect(send.caption).toBe("a cat");
  });

  it("drops a whitespace-only caption", async () => {
    await sendPendingImage(blob(), "cat.png", "   ");
    expect(sendPastedImage.mock.calls[0][0].caption).toBeUndefined();
  });

  it("sends as a reply and clears reply state on success", async () => {
    AppState.set("replyToEventId", "$parent");
    await sendPendingImage(blob(), "cat.png");

    expect(sendPastedImage.mock.calls[0][0].replyToEventId).toBe("$parent");
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
    expect(restoreStagedAttachments).toHaveBeenCalledWith([
      expect.objectContaining({ file: b, filename: "cat.png" }),
    ]);
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

    expect(sendFile.mock.calls[0][0].uploadId).toBe("upload-1");
  });

  it("renders real byte progress from the backend, for the matching upload only", async () => {
    sendFile.mockImplementationOnce(async () => {
      progressHandler?.({ upload_id: "someone-else", transferred: 1, total: 100 });
      progressHandler?.({ upload_id: "upload-1", transferred: 40, total: 100 });
      return { event_id: "$file", echo: null };
    });

    await handleFilePick(file());

    expect(rowApi.setProgress).toHaveBeenCalledWith(40, 100);
    expect(rowApi.setProgress).not.toHaveBeenCalledWith(1, 100);
  });

  it("moves to sending once the last byte is out", async () => {
    sendFile.mockImplementationOnce(async () => {
      progressHandler?.({ upload_id: "upload-1", transferred: 100, total: 100 });
      return { event_id: "$file", echo: null };
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

  it("settles the read when the reader's abort dispatches nothing", async () => {
    // `abort()` on a reader that has already reached DONE dispatches no `abort`
    // event, and it can throw in its own right — both were swallowed, while
    // onload/onerror bail out once cancelled. The read promise then never
    // settled, so `runAttachment` never returned: the row stayed on screen for
    // good, the blob stayed pinned, and a cancelled `sendPendingImage` never
    // reached the `restore()` that hands the staged image back to the composer.
    class SilentAbortReader {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      onprogress: ((e: ProgressEvent) => void) | null = null;
      result: string | null = null;
      error: DOMException | null = null;
      readAsDataURL(): void {
        /* never completes on its own; the test cancels instead */
      }
      abort(): void {
        throw new Error("abort on a reader that is already DONE");
      }
    }
    const RealFileReader = globalThis.FileReader;
    globalThis.FileReader = SilentAbortReader as unknown as typeof FileReader;
    startAttachmentProgress.mockImplementationOnce((_name, onCancel) => {
      queueMicrotask(() => onCancel?.());
      return rowApi;
    });

    try {
      const outcome = await Promise.race([
        handleFilePick(file()).then(() => "settled"),
        new Promise((r) => setTimeout(() => r("hung"), 50)),
      ]);

      expect(outcome).toBe("settled");
      expect(sendFile).not.toHaveBeenCalled();
      expect(rowApi.dismiss).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.FileReader = RealFileReader;
    }
  });

  it("still sends when the composer can't show a row", async () => {
    startAttachmentProgress.mockImplementationOnce(() => {
      throw new Error("no composer");
    });

    await handleFilePick(file());

    expect(sendFile).toHaveBeenCalledTimes(1);
  });
});

// #78: the attachment path was thread-blind at every layer while the text path
// had routed on the open thread since threads landed. Attaching an image with a
// thread open uploaded fine, reported success, and put the image in the main
// timeline — no error, and no row in the thread panel either.
/**
 * jsdom has no `URL.createObjectURL` and never fires media events, so the
 * metadata probe would throw on the way in. Stand in for it with a video element
 * that reports failure — the probe is best-effort by design, and the send goes
 * ahead without dimensions.
 */
function stubVideoProbe(): () => void {
  const url = URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown };
  const hadCreate = "createObjectURL" in url;
  const hadRevoke = "revokeObjectURL" in url;
  url.createObjectURL = () => "blob:stub";
  url.revokeObjectURL = () => {};

  const realCreate = document.createElement.bind(document);
  const spy = vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    if (tag !== "video") return realCreate(tag);
    const el = { preload: "", onloadedmetadata: null, onerror: null } as Record<string, unknown>;
    Object.defineProperty(el, "src", {
      set() {
        queueMicrotask(() => (el.onerror as (() => void) | null)?.());
      },
    });
    return el as unknown as HTMLElement;
  }) as typeof document.createElement);

  return () => {
    spy.mockRestore();
    if (!hadCreate) delete url.createObjectURL;
    if (!hadRevoke) delete url.revokeObjectURL;
  };
}

/** A timeline event that is only ever looked up by id and thread root. */
function threadEvent(eventId: string, threadRoot: string | null): TimelineEvent {
  return {
    event_id: eventId,
    sender: "@bob:x",
    body: "hi",
    formatted_body: null,
    timestamp: 1000,
    msg_type: "m.text",
    is_edit: false,
    relates_to_event_id: null,
    in_reply_to: null,
    thread_root: threadRoot,
    media_url: null,
    media_mimetype: null,
    media_width: null,
    media_height: null,
  };
}

describe("attachments follow the open thread (#78)", () => {
  it("sends a staged image into the open thread", async () => {
    AppState.set("threadRootEventId", "$root");

    await sendPendingImage(blob(), "cat.png");

    expect(sendPastedImage.mock.calls[0][0].threadRootEventId).toBe("$root");
  });

  it("sends a picked file into the open thread", async () => {
    AppState.set("threadRootEventId", "$root");

    await handleFilePick(new File(["hi"], "notes.txt", { type: "text/plain" }));

    expect(sendFile.mock.calls[0][0].threadRootEventId).toBe("$root");
  });

  it("sends a video into the open thread", async () => {
    AppState.set("threadRootEventId", "$root");
    const restore = stubVideoProbe();

    try {
      await handleFilePick(new File(["hi"], "clip.mp4", { type: "video/mp4" }));
    } finally {
      restore();
    }

    expect(sendVideo.mock.calls[0][0].threadRootEventId).toBe("$root");
  });

  // A reply armed inside a thread is still a thread event — the backend folds
  // the two into one relation, but it can only do that if it gets both.
  it("carries a reply and a thread root together", async () => {
    AppState.patch({
      threadRootEventId: "$root",
      replyToEventId: "$parent",
      currentTimeline: [threadEvent("$parent", "$root")],
    });

    await sendPendingImage(blob(), "cat.png");

    const [send] = sendPastedImage.mock.calls[0];
    expect(send.threadRootEventId).toBe("$root");
    expect(send.replyToEventId).toBe("$parent");
  });

  it("carries a reply to the thread root itself", async () => {
    AppState.patch({ threadRootEventId: "$root", replyToEventId: "$root" });

    await sendPendingImage(blob(), "cat.png");

    const [send] = sendPastedImage.mock.calls[0];
    expect(send.threadRootEventId).toBe("$root");
    expect(send.replyToEventId).toBe("$root");
  });

  // The two can be armed at once without the composer showing it: openThread()
  // puts the thread banner where the reply banner was, so a reply armed on the
  // main timeline survives the swap invisibly. Folding it in would send a
  // threaded reply pointing at an event the thread doesn't contain.
  it("drops a reply armed outside the open thread", async () => {
    AppState.patch({
      threadRootEventId: "$root",
      replyToEventId: "$elsewhere",
      currentTimeline: [threadEvent("$elsewhere", null)],
    });

    await sendPendingImage(blob(), "cat.png");

    const [send] = sendPastedImage.mock.calls[0];
    expect(send.threadRootEventId).toBe("$root");
    expect(send.replyToEventId).toBeUndefined();
  });

  // The thread's own replies load separately from `currentTimeline`, so an
  // unknown parent proves nothing either way — and only one of the two readings
  // can misattribute the reply.
  it("drops a reply whose parent is not in the loaded timeline", async () => {
    AppState.patch({ threadRootEventId: "$root", replyToEventId: "$unknown" });

    await sendPendingImage(blob(), "cat.png");

    expect(sendPastedImage.mock.calls[0][0].replyToEventId).toBeUndefined();
  });

  it("keeps a reply armed with no thread open", async () => {
    AppState.set("replyToEventId", "$parent");

    await sendPendingImage(blob(), "cat.png");

    expect(sendPastedImage.mock.calls[0][0].replyToEventId).toBe("$parent");
  });

  // Before these paths carried the reply at all, leaving the banner up was
  // merely untidy. Now the attachment really is a reply, so a banner left
  // standing makes every message after it one too.
  it("disarms the reply once a picked file has consumed it", async () => {
    AppState.set("replyToEventId", "$parent");

    await handleFilePick(new File(["hi"], "notes.txt", { type: "text/plain" }));

    expect(sendFile.mock.calls[0][0].replyToEventId).toBe("$parent");
    expect(cancelReply).toHaveBeenCalledTimes(1);
  });

  it("keeps the reply armed when the attachment fails", async () => {
    AppState.set("replyToEventId", "$parent");
    sendFile.mockRejectedValueOnce(new Error("boom"));

    await handleFilePick(new File(["hi"], "notes.txt", { type: "text/plain" }));

    expect(cancelReply).not.toHaveBeenCalled();
  });

  it("leaves the thread root off when no thread is open", async () => {
    await sendPendingImage(blob(), "cat.png");

    expect(sendPastedImage.mock.calls[0][0].threadRootEventId).toBeUndefined();
  });
});

// #84: captions skipped `prepareOutgoingBody` entirely — the one compose path
// that did. The autocomplete popup still fires with an attachment staged, so the
// user picks `:party:` from a list, sees it in the field, and sends the literal
// text.
describe("image captions expand emoji like any other message (#84)", () => {
  it("replaces a unicode shortcode with its glyph", async () => {
    await sendPendingImage(blob(), "cat.png", "look :smile:");

    const [send] = sendPastedImage.mock.calls[0];
    expect(send.caption).toBe("look 😄");
    expect(send.formattedCaption).toBeUndefined();
  });

  it("puts a custom emoji in the formatted caption and leaves the plain one alone", async () => {
    _shortcodeToMxc.set("party", "mxc://example.org/party");

    await sendPendingImage(blob(), "cat.png", "look :party:");

    const [send] = sendPastedImage.mock.calls[0];
    // The plain body keeps the shortcode — that is the MSC2545 fallback for
    // clients that can't render the image.
    expect(send.caption).toBe("look :party:");
    expect(send.formattedCaption).toContain("data-mx-emoticon");
    expect(send.formattedCaption).toContain("mxc://example.org/party");
  });

  // What comes back on failure is what the user typed, not what we resolved —
  // restoring the expanded body would silently rewrite their text.
  it("restores the caption as typed when the send fails", async () => {
    sendPastedImage.mockRejectedValueOnce(new Error("boom"));

    await sendPendingImage(blob(), "cat.png", "look :smile:");

    expect(setValue).toHaveBeenCalledWith("look :smile:");
  });
});

// #112: an attachment used to appear only when the sync loop echoed it back,
// which on Android could be never, until the room was reopened.
describe("a sent attachment paints at once (#112)", () => {
  const echo = (id: string): TimelineEvent =>
    ({ event_id: id, sender: "@me:x", msg_type: "m.image" }) as TimelineEvent;

  it("paints a sent image from the event the send returned", async () => {
    const event = echo("$img");
    sendPastedImage.mockResolvedValueOnce({ event_id: "$img", echo: event });

    await sendPendingImage(blob(), "cat.png");

    expect(showSentEvent).toHaveBeenCalledWith("!room:x", event);
  });

  it("paints a sent file and video the same way", async () => {
    const f = echo("$f");
    sendFile.mockResolvedValueOnce({ event_id: "$f", echo: f });
    await handleFilePick(new File(["hello"], "notes.txt", { type: "text/plain" }));
    expect(showSentEvent).toHaveBeenLastCalledWith("!room:x", f);

    const v = echo("$v");
    sendVideo.mockResolvedValueOnce({ event_id: "$v", echo: v });
    const restore = stubVideoProbe();
    try {
      await handleFilePick(new File(["v"], "clip.mp4", { type: "video/mp4" }));
    } finally {
      restore();
    }
    expect(showSentEvent).toHaveBeenLastCalledWith("!room:x", v);
  });

  it("paints into the room it was sent to, even if the user has moved on", async () => {
    // `showSentEvent` decides whether that room is on screen; the send must
    // not re-read the current room after the await and misfile it.
    const event = echo("$img");
    sendPastedImage.mockImplementationOnce(async () => {
      AppState.set("currentRoomId", "!elsewhere:x");
      return { event_id: "$img", echo: event };
    });

    await sendPendingImage(blob(), "cat.png");

    expect(showSentEvent).toHaveBeenCalledWith("!room:x", event);
  });

  it("leaves it to sync when the backend had no echo to give", async () => {
    await sendPendingImage(blob(), "cat.png");
    expect(showSentEvent).not.toHaveBeenCalled();
    expect(rowApi.succeed).toHaveBeenCalled();
  });

  it("does not report a sent attachment as failed when painting it throws", async () => {
    // A restore here would put the image back in the composer to be sent twice.
    sendPastedImage.mockResolvedValueOnce({ event_id: "$img", echo: echo("$img") });
    showSentEvent.mockImplementationOnce(() => {
      throw new Error("render blew up");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await sendPendingImage(blob(), "cat.png");

    expect(rowApi.succeed).toHaveBeenCalled();
    expect(rowApi.fail).not.toHaveBeenCalled();
    expect(restoreStagedAttachments).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("paints nothing when the send fails", async () => {
    sendPastedImage.mockRejectedValueOnce(new Error("boom"));
    await sendPendingImage(blob(), "cat.png");
    expect(showSentEvent).not.toHaveBeenCalled();
  });
});

// #83: a blob the webview could not type carries an empty MIME string, which
// reaches `mime_type.parse()` in media.rs as "" and fails the whole upload.
describe("untyped attachments still upload (#83)", () => {
  it("falls back to a generic MIME type", async () => {
    await handleFilePick(new File(["hi"], "mystery.bin", { type: "" }));

    expect(sendFile.mock.calls[0][0].mimeType).toBe("application/octet-stream");
  });

  it("names a pasted SVG with an extension, not a MIME subtype", async () => {
    const b = new Blob(["<svg/>"], { type: "image/svg+xml" });
    Object.defineProperty(b, "arrayBuffer", { value: async () => new Uint8Array([60]).buffer });

    await sendPendingImage(b, null);

    expect(sendPastedImage.mock.calls[0][0].filename).toMatch(/^pasted-image-\d+\.svg$/);
  });
});

// #83: the picker, a paste and a drop all end here, so the routing rule is
// asserted once rather than per entry point.
describe("attachFiles", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);

  // Every file waits in the tray now, not just the first image: a PDF next to
  // a screenshot used to upload the moment it was attached.
  it("stages every file, in order, and sends nothing", async () => {
    const onStaged = vi.fn();
    const img = new File(["x"], "cat.png", { type: "image/png" });
    const pdf = new File(["%PDF"], "notes.pdf", { type: "application/pdf" });
    const img2 = new File(["y"], "dog.jpg", { type: "image/jpeg" });

    await attachFiles([pdf, img, img2], { onStaged });

    expect(stageAttachment.mock.calls.map(([f, n]) => [(f as File).name, n])).toEqual([
      ["notes.pdf", "notes.pdf"],
      ["cat.png", "cat.png"],
      ["dog.jpg", "dog.jpg"],
    ]);
    expect(onStaged).toHaveBeenCalledTimes(1);
    expect(sendFile).not.toHaveBeenCalled();
    expect(sendPastedImage).not.toHaveBeenCalled();
    expect(sendVideo).not.toHaveBeenCalled();
  });

  it("recognises an untyped image by its bytes before staging it", async () => {
    const untyped = new File([PNG], "shot", { type: "" });

    await attachFiles([untyped]);

    const [file] = stageAttachment.mock.calls[0];
    expect(file.type).toBe("image/png");
  });

  it("stages a nameless file with no name, for the send to name", async () => {
    await attachFiles([new File(["hi"], "", { type: "text/plain" })]);
    expect(stageAttachment.mock.calls[0][1]).toBeNull();
  });

  it("does nothing for an empty list", async () => {
    const onStaged = vi.fn();
    await attachFiles([], { onStaged });
    expect(stageAttachment).not.toHaveBeenCalled();
    expect(onStaged).not.toHaveBeenCalled();
  });
});

describe("sendStagedAttachments", () => {
  const txt = (name = "notes.txt") => new File(["hi"], name, { type: "text/plain" });

  it("sends each attachment in order as the event its type calls for", async () => {
    const restore = stubVideoProbe();
    const order: string[] = [];
    sendPastedImage.mockImplementationOnce(async (s) => (order.push(s.filename), { event_id: "$i", echo: null }));
    sendFile.mockImplementationOnce(async (s) => (order.push(s.filename), { event_id: "$f", echo: null }));
    sendVideo.mockImplementationOnce(async (s) => (order.push(s.filename), { event_id: "$v", echo: null }));
    try {
      await sendStagedAttachments([
        staged(txt("a.txt"), "a.txt"),
        staged(new File(["v"], "b.mp4", { type: "video/mp4" }), "b.mp4"),
        staged(blob(), "c.png"),
      ]);
    } finally {
      restore();
    }
    expect(order).toEqual(["a.txt", "b.mp4", "c.png"]);
  });

  // MSC2530 captions are allowed on any media type, so the typed text goes on
  // whatever was staged first — here a file, not an image.
  it("captions the first attachment only, whatever its type", async () => {
    await sendStagedAttachments([staged(txt(), "notes.txt"), staged(blob(), "cat.png")], "  the notes :smile: ");

    expect(sendFile.mock.calls[0][0].caption).toBe("the notes 😄");
    expect(sendPastedImage.mock.calls[0][0].caption).toBeUndefined();
  });

  it("carries a formatted caption on a video", async () => {
    _shortcodeToMxc.set("party", "mxc://e/party");
    const restore = stubVideoProbe();
    try {
      await sendStagedAttachments([staged(new File(["v"], "clip.mp4", { type: "video/mp4" }), "clip.mp4")], ":party:");
    } finally {
      restore();
    }
    expect(sendVideo.mock.calls[0][0].caption).toBe(":party:");
    expect(sendVideo.mock.calls[0][0].formattedCaption).toContain("data-mx-emoticon");
  });

  it("replies with the first attachment only, and disarms the reply once", async () => {
    AppState.set("replyToEventId", "$parent");

    await sendStagedAttachments([staged(blob(), "a.png"), staged(txt(), "b.txt")]);

    expect(sendPastedImage.mock.calls[0][0].replyToEventId).toBe("$parent");
    expect(sendFile.mock.calls[0][0].replyToEventId).toBeUndefined();
    expect(cancelReply).toHaveBeenCalledTimes(1);
  });

  it("sends every attachment into the open thread", async () => {
    AppState.set("threadRootEventId", "$root");

    await sendStagedAttachments([staged(blob(), "a.png"), staged(txt(), "b.txt")]);

    expect(sendPastedImage.mock.calls[0][0].threadRootEventId).toBe("$root");
    expect(sendFile.mock.calls[0][0].threadRootEventId).toBe("$root");
  });

  it("sends the whole batch to the room it was submitted in", async () => {
    sendPastedImage.mockImplementationOnce(async () => {
      AppState.set("currentRoomId", "!elsewhere:x");
      return { event_id: "$i", echo: null };
    });

    await sendStagedAttachments([staged(blob(), "a.png"), staged(txt(), "b.txt")]);

    expect(sendFile.mock.calls[0][0].roomId).toBe("!room:x");
  });

  it("keeps going past a failure and puts only the failures back", async () => {
    const a = staged(blob(), "a.png");
    const b = staged(txt("b.txt"), "b.txt");
    const c = staged(txt("c.txt"), "c.txt");
    sendFile.mockRejectedValueOnce(new Error("boom"));

    await sendStagedAttachments([a, b, c], "caption");

    expect(sendFile).toHaveBeenCalledTimes(2);
    expect(restoreStagedAttachments).toHaveBeenCalledWith([b]);
    // The captioned one went out, so the caption is not restored.
    expect(setValue).not.toHaveBeenCalled();
  });

  it("restores the caption with the first attachment when that one fails", async () => {
    sendPastedImage.mockRejectedValueOnce(new Error("boom"));
    const a = staged(blob(), "a.png");

    await sendStagedAttachments([a, staged(txt(), "b.txt")], "look");

    expect(restoreStagedAttachments).toHaveBeenCalledWith([a]);
    expect(setValue).toHaveBeenCalledWith("look");
  });

  it("puts everything back when there is no room to send to", async () => {
    AppState.set("currentRoomId", null);
    const items = [staged(blob(), "a.png"), staged(txt(), "b.txt")];

    await sendStagedAttachments(items, "hi");

    expect(sendPastedImage).not.toHaveBeenCalled();
    expect(restoreStagedAttachments).toHaveBeenCalledWith(items);
    expect(setValue).toHaveBeenCalledWith("hi");
  });

  it("names a nameless non-image file rather than uploading it as ''", async () => {
    await sendStagedAttachments([staged(new File(["hi"], "", { type: "text/plain" }), null)]);

    expect(sendFile.mock.calls[0][0].filename).toMatch(/^attachment-\d+$/);
  });
});

// #78 and #84 were fixed on the same path; this pins them together, since a
// regression in how the send is assembled could keep either half and lose the
// other.
describe("a captioned image sent into a thread (#78 + #84)", () => {
  it("carries the thread root and the expanded caption in one send", async () => {
    AppState.set("threadRootEventId", "$root");
    _shortcodeToMxc.set("party", "mxc://e/party");

    await sendPendingImage(blob(), "cat.png", ":party: see [docs](https://e.com) :smile:");

    const [send] = sendPastedImage.mock.calls[0];
    expect(send.threadRootEventId).toBe("$root");
    expect(send.caption).toBe(":party: see [docs](https://e.com) 😄");
    expect(send.formattedCaption).toContain('<img data-mx-emoticon src="mxc://e/party"');
    expect(send.formattedCaption).toContain('<a href="https://e.com">docs</a>');
  });
});

describe("readCopiedFiles", () => {
  it("returns the read files and reports each entry that could not be read", async () => {
    const f = new File(["x"], "a.txt", { type: "text/plain" });
    readClipboardFiles.mockResolvedValueOnce({ files: [f], errors: ["Can't attach dir: folders can't be attached"] });
    const got = await readCopiedFiles();
    expect(got).toEqual({ files: [f], listed: true });
    expect(showError).toHaveBeenCalledWith("Can't attach dir: folders can't be attached");
  });

  it("says a list was there even when nothing in it could attach", async () => {
    readClipboardFiles.mockResolvedValueOnce({ files: [], errors: ["x.pdf is not a local file"] });
    expect(await readCopiedFiles()).toEqual({ files: [], listed: true });
  });

  it("reads an ordinary clipboard, or a failed read, as no list", async () => {
    expect(await readCopiedFiles()).toEqual({ files: [], listed: false });
    readClipboardFiles.mockRejectedValueOnce(new Error("boom"));
    expect(await readCopiedFiles()).toEqual({ files: [], listed: false });
  });
});
