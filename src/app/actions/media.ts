// Media actions: pasting/picking files, the message hover-action event
// handlers (react/reply/thread/profile/file/video), and file saving.

import { AppState } from "../state.js";

import {
  serveMedia,
  saveMediaToTemp,
  getPlatform,
  getAppConfig,
  saveMediaWithDialog,
  openMediaExternally,
  sendPastedImage,
  sendFile,
  sendVideo,
} from "../../ipc/index.js";
import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauri } from "../../ipc/mock.js";

// Imported straight from ipc/media.js rather than ipc/index.js: the barrel
// re-exports by name and isn't ours to extend here.
import {
  listenAttachmentProgress,
  newUploadId,
  type AttachmentProgressPayload,
} from "../../ipc/media.js";
import type { AttachmentProgressHandle } from "../../ui/AttachmentProgress.js";

import { showError, showSuccess } from "../../ui/NotificationToast.js";

import { getComponents } from "./context.js";
import { openQuickReactPicker } from "./reactions.js";
import { startReply, cancelReply } from "./messages.js";
import { openThread } from "./threads.js";
import { openProfileForUser } from "./profile.js";

// Inline-video transport is platform-dependent (see the `get_platform` command):
// on Linux/WebKitGTK the asset protocol can't feed a `<video>`, so we stream from
// the loopback HTTP server; elsewhere the asset protocol works natively and
// avoids loading `http://127.0.0.1` (and its ATS/loopback restrictions). Cached
// after the first lookup.
let _platform: Promise<string> | null = null;
function platformOnce(): Promise<string> {
  if (!_platform) {
    _platform = getPlatform();
    // Don't cache a failed lookup — evict so the next video retries. (Otherwise
    // a one-off IPC failure would wrongly pin the transport for the whole
    // session: on Linux that means always falling back to the external player.)
    _platform.catch(() => {
      _platform = null;
    });
  }
  return _platform;
}

/** Thrown by the reader when the user cancels an attachment before it is sent. */
class AttachmentCancelled extends Error {
  constructor() {
    super("Attachment cancelled");
    this.name = "AttachmentCancelled";
  }
}

/** A base64 read in flight, with the handle needed to abort it. */
interface BlobRead {
  promise: Promise<string>;
  cancel(): void;
}

/**
 * Encode a blob's bytes as base64 for the media IPC commands, reporting read
 * progress and staying cancellable.
 *
 * `FileReader` first, deliberately: it encodes natively instead of in a
 * per-byte JS loop, which for a multi-megabyte pick on an Android WebView is
 * the difference between a composer that can paint a progress row and one
 * frozen solid — the dead air issue #63 is actually about. The manual path
 * remains as a fallback, chunked so it neither blocks in one long tick nor
 * blows the argument limit of `String.fromCharCode`.
 */
function readBlobAsBase64(blob: Blob, onProgress?: (loaded: number, total: number) => void): BlobRead {
  if (typeof FileReader !== "undefined") {
    const reader = new FileReader();
    let cancelled = false;
    // Assigned synchronously by the executor below, before `new Promise` returns.
    let cancel!: () => void;
    const promise = new Promise<string>((resolve, reject) => {
      // Cancelling rejects from here rather than leaning on an `abort` event:
      // `abort()` on a reader that already reached DONE dispatches nothing, and
      // it can throw in its own right. Either way `onabort` never ran, while
      // `onload`/`onerror` bail out on `cancelled` — leaving this promise
      // pending forever. `runAttachment` then never returned: the row stayed on
      // screen for good, the blob stayed pinned, and `sendPendingImage` never
      // reached the `restore()` that puts a cancelled image back in the
      // composer, so the staged image was simply lost.
      cancel = () => {
        if (cancelled) return;
        cancelled = true;
        reject(new AttachmentCancelled());
        try {
          reader.abort();
        } catch {
          /* nothing left to abort */
        }
      };
      reader.onload = () => {
        if (cancelled) return;
        const result = String(reader.result ?? "");
        const comma = result.indexOf(",");
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => {
        if (cancelled) return;
        reject(reader.error ?? new Error("Failed to read file"));
      };
      // No `onabort` handler: `abort()` is reached only through `cancel()`
      // above, which has already settled the promise by the time it fires.
      reader.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(e.loaded, e.total);
      };
      reader.readAsDataURL(blob);
    });
    return { promise, cancel };
  }

  let cancelled = false;
  const promise = (async () => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const CHUNK = 8192;
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i += CHUNK) {
      if (cancelled) throw new AttachmentCancelled();
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      onProgress?.(Math.min(i + CHUNK, bytes.byteLength), bytes.byteLength);
      // Yield so the composer can repaint between chunks.
      if (i + CHUNK < bytes.byteLength) await new Promise((r) => setTimeout(r, 0));
    }
    return btoa(binary);
  })();
  return { promise, cancel: () => { cancelled = true; } };
}

/**
 * Run one attachment end to end behind an inline composer progress row (#63):
 * read → upload → send, then a tick or a readable error. Returns true when the
 * event was sent.
 *
 * Every phase the user experiences as one wait is covered, because on a phone
 * any of them can dominate: reading the picked file out of the WebView,
 * handing the bytes across IPC, the upload itself (real byte progress, from
 * matrix-sdk's send-progress observable), and finally sending the event.
 */
async function runAttachment(
  blob: Blob,
  filename: string,
  roomId: string,
  send: (dataBase64: string, uploadId: string) => Promise<unknown>,
): Promise<boolean> {
  const total = blob.size;

  let read: BlobRead | null = null;
  let row: AttachmentProgressHandle | null = null;
  try {
    row = getComponents().input.startAttachmentProgress(
      filename,
      () => read?.cancel(),
      roomId,
    );
  } catch {
    // A composer that can't show the row (not mounted yet) must not block the
    // send; the send still reports through the toast fallback below.
    row = null;
  }

  const uploadId = newUploadId();
  let unlisten: (() => void) | null = null;

  try {
    row?.setPhase("reading");
    read = readBlobAsBase64(blob, (loaded) => row?.setProgress(loaded, total));
    const dataBase64 = await read.promise;

    // Past this point nothing local can call the upload back, so the cancel
    // affordance goes away rather than lying about what it would do.
    row?.setCancellable(false);
    row?.setPhase("uploading");
    row?.setIndeterminate();

    unlisten = await listenAttachmentProgress((p: AttachmentProgressPayload) => {
      if (p.upload_id !== uploadId) return;
      if (p.total > 0 && p.transferred >= p.total) {
        // Bytes are all out; what is left is the homeserver's reply and the
        // timeline event, neither of which has a byte count.
        row?.setPhase("sending");
        return;
      }
      row?.setProgress(p.transferred, p.total);
    });

    await send(dataBase64, uploadId);
    row?.succeed();
    return true;
  } catch (err) {
    if (err instanceof AttachmentCancelled) {
      row?.dismiss();
      return false;
    }
    const message = err instanceof Error ? err.message : String(err);
    // The row is the error surface: it clears the spinner and stays put with
    // the reason, so a failed attachment can never look like one still going.
    if (row) row.fail(message);
    else showError(`Failed to attach ${filename}: ${message}`);
    return false;
  } finally {
    unlisten?.();
  }
}

/**
 * Send a staged image (pasted or picked) as an m.image event, with an optional
 * MSC2530 caption. If a reply is armed it sends as that reply and clears the
 * reply state on success. On failure the staged image (and caption) are
 * restored to the composer so nothing the user prepared is lost.
 */
export async function sendPendingImage(
  blob: Blob,
  filename: string | null,
  caption?: string,
): Promise<void> {
  const roomId = AppState.get("currentRoomId");
  if (!roomId) return;

  const ext = blob.type.split("/")[1] ?? "png";
  const name = filename ?? `pasted-image-${Date.now()}.${ext}`;
  const cap = caption?.trim() || undefined;
  const replyToEventId = AppState.get("replyToEventId") ?? undefined;

  const restore = () => {
    const { input } = getComponents();
    input.showImagePreview(blob, filename ?? undefined);
    // Don't clobber anything typed since the send started.
    if (cap && input.getValue().trim().length === 0) input.setValue(cap);
  };

  const sent = await runAttachment(blob, name, roomId, (dataBase64, uploadId) =>
    sendPastedImage(roomId, dataBase64, blob.type, name, cap, replyToEventId, uploadId),
  );

  if (sent) {
    if (replyToEventId) cancelReply();
  } else {
    restore();
  }
}

/**
 * Handle a non-image file selected from the file picker: videos are sent as
 * m.video, everything else as m.file. (Picked images stage in the composer
 * preview instead — see the onFilePick wiring in keyboard.ts.)
 */
export async function handleFilePick(file: File): Promise<void> {
  const roomId = AppState.get("currentRoomId");
  if (!roomId) return;

  const isVideo = file.type.startsWith("video/");

  await runAttachment(file, file.name, roomId, async (dataBase64, uploadId) => {
    if (isVideo) {
      // Send as m.video (not m.file) so it renders as a playable embed. Probe
      // dimensions/duration up front so the timeline can reserve the right
      // aspect ratio before the video is downloaded.
      const meta = await probeVideoMetadata(file);
      return sendVideo(
        roomId,
        dataBase64,
        file.type,
        file.name,
        meta?.width,
        meta?.height,
        meta?.durationMs,
        file.size,
        uploadId,
      );
    }
    return sendFile(
      roomId,
      dataBase64,
      file.type || "application/octet-stream",
      file.name,
      file.size,
      uploadId,
    );
  });
}

/**
 * Wire the hover action bar buttons (react / reply) that bubble custom events
 * from message elements. Must be called once after components are set.
 */
export function setupMessageActionHandlers(): void {
  document.addEventListener("quark:msg-react" as keyof DocumentEventMap, (e: Event) => {
    const { eventId } = (e as CustomEvent<{ eventId: string }>).detail;
    if (eventId) openQuickReactPicker(eventId);
  });

  document.addEventListener("quark:msg-reply" as keyof DocumentEventMap, (e: Event) => {
    const { eventId } = (e as CustomEvent<{ eventId: string }>).detail;
    if (!eventId) return;
    const events = AppState.get("currentTimeline");
    const evt = events.find((ev) => ev.event_id === eventId);
    if (evt) {
      const { input } = getComponents();
      startReply(eventId, evt.sender, evt.body.slice(0, 80));
      input.focus();
    }
  });

  document.addEventListener("quark:open-thread" as keyof DocumentEventMap, (e: Event) => {
    const { eventId } = (e as CustomEvent<{ eventId: string }>).detail;
    if (eventId) void openThread(eventId);
  });

  document.addEventListener("quark:open-profile" as keyof DocumentEventMap, (e: Event) => {
    const { userId } = (e as CustomEvent<{ userId: string }>).detail;
    if (!userId) return;
    void openProfileForUser(userId);
  });

  document.addEventListener("quark:open-file" as keyof DocumentEventMap, (e: Event) => {
    const { mxcUrl, filename, encryptionInfo } =
      (e as CustomEvent<{ mxcUrl?: string; filename?: string; encryptionInfo?: string }>).detail;
    if (!mxcUrl) return;
    void saveFileWithDialog(mxcUrl, filename, encryptionInfo).catch((err) => {
      console.error("[file] save failed:", err);
      showError(`Failed to save file: ${err instanceof Error ? err.message : String(err)}`);
    });
  });

  document.addEventListener("quark:open-video" as keyof DocumentEventMap, (e: Event) => {
    const { mxcUrl, filename, mimeType, encryptionInfo } =
      (e as CustomEvent<{ mxcUrl?: string; filename?: string; mimeType?: string; encryptionInfo?: string }>).detail;
    if (!mxcUrl) return;

    // Determine the message element so we can swap in the inline player.
    const target = e.target as HTMLElement | null;
    const msgEl = target?.closest<HTMLElement>("[data-message-id]");
    const eventId = msgEl?.dataset.messageId;

    // Mark the affordance as loading so CSS can show a progress animation.
    const affordanceEl = target?.closest<HTMLElement>(".message__video-affordance");
    affordanceEl?.classList.add("message__video-affordance--loading");
    const stopLoading = () => affordanceEl?.classList.remove("message__video-affordance--loading");

    const openExternally = () => _openVideoExternally(mxcUrl, encryptionInfo, filename);

    // Browser/mock mode can't stream local files via the asset protocol, and we
    // need the message element to swap in the player — fall back to external.
    if (!eventId || !isTauri()) {
      void openExternally().finally(stopLoading);
      return;
    }

    const { timeline } = getComponents();

    // Respect the "Play videos inline" setting; when off, go straight to the
    // external player. Read fresh (cheap, in-memory) so toggling takes effect
    // immediately. Otherwise resolve the inline-video URL per platform: Linux
    // streams via the loopback HTTP server (seekable; WebKitGTK can't feed the
    // asset protocol to <video>); macOS/Windows/iOS use the asset protocol
    // natively. On any error — including a codec WebKit can't decode — fall back
    // to the external player.
    void getAppConfig()
      .then((cfg) => {
        if (!cfg.media.inline_video) return openExternally().finally(stopLoading);
        return platformOnce()
          .then((platform) =>
            platform === "linux"
              ? serveMedia(mxcUrl, encryptionInfo, mimeType, filename)
              : saveMediaToTemp(mxcUrl, encryptionInfo, filename, mimeType).then(convertFileSrc),
          )
          .then((url) => {
            stopLoading();
            timeline.showInlineVideo(eventId, url, (err) => {
              if (err) console.warn("[video] inline playback failed, opening externally:", err);
              void openExternally();
            });
          });
      })
      .catch((err) => {
        stopLoading();
        console.error("[video] inline playback failed:", err);
        void openExternally();
      });
  });
}

/**
 * Probe a video file's intrinsic dimensions and duration via a detached
 * <video> element. Best-effort: resolves to undefined if metadata can't be
 * read (unsupported codec, etc.) so the send still goes through without info.
 */
function probeVideoMetadata(
  file: File,
): Promise<{ width: number; height: number; durationMs: number } | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    let settled = false;
    const finish = (result: { width: number; height: number; durationMs: number } | undefined) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(result);
    };
    video.onloadedmetadata = () => {
      const durationMs = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0;
      finish({ width: video.videoWidth, height: video.videoHeight, durationMs });
    };
    video.onerror = () => finish(undefined);
    // Guard against metadata that never fires (e.g. codec the webview can't parse).
    setTimeout(() => finish(undefined), 3000);
    video.src = url;
  });
}

async function _openVideoExternally(mxcUrl: string, encryptionInfo?: string, filename?: string): Promise<void> {
  try {
    await openMediaExternally(mxcUrl, encryptionInfo, filename);
  } catch (err) {
    showError(`Failed to open video: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Download the file from the homeserver and save it via the OS native save
 * dialog. The backend opens the dialog (XDG portal on Linux, native picker
 * elsewhere) and writes to the path the user picks — the frontend never handles
 * a filesystem path, so this can't become an arbitrary-write vector.
 */
async function saveFileWithDialog(
  mxcUrl: string,
  filename?: string,
  encryptionInfo?: string,
): Promise<void> {
  const writtenPath = await saveMediaWithDialog(mxcUrl, filename, encryptionInfo);
  if (writtenPath === null) return; // user cancelled
  showSuccess(`Saved to ${writtenPath}`);
}
