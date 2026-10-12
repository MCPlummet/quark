// Saving a message's media to the device (#124, #125).
//
// The image viewer's save buttons and the message menu's save rows both land
// here. Both used to be absent or broken on mobile: the viewer's button was an
// `<a download>`, which a mobile webview ignores, so tapping it did nothing at
// all. Saving now goes through the backend, which downloads the original from
// the homeserver (decrypting it if need be) and hands it to the platform's own
// save UI — see media_save.rs.

import { getPlatform, saveMediaToPhotos, saveMediaWithDialog } from "../ipc/index.js";
import type { TimelineEvent } from "../ipc/types.js";
import { showError, showSuccess, showToast } from "../ui/NotificationToast.js";

/**
 * Where a save lands. `photos` is the gallery / camera roll and exists only on
 * mobile; `files` is the system save dialog, which every platform has.
 */
export type SaveTarget = "photos" | "files";

/** What the backend needs to fetch a message's media again. */
export interface SavableMedia {
  mxcUrl: string;
  /** The name the file is offered under; the backend sanitises it. */
  filename?: string;
  /** JSON-serialised EncryptedFile for E2EE media. */
  encryptionInfo?: string;
  /**
   * The event's declared `info.mimetype`. The backend prefers it over its byte
   * sniff, which calls a HEIC photo `video/mp4` and would file it as a video.
   */
  mimeType?: string;
}

/** The destinations this platform offers, in the order to show them. */
export function saveTargetsFor(platform: string): SaveTarget[] {
  return platform === "ios" || platform === "android" ? ["photos", "files"] : ["files"];
}

let _targets: SaveTarget[] = ["files"];

/**
 * Look up this platform's destinations once, at startup. Until it answers (or
 * if it fails) only `files` is offered, which every platform can do.
 */
export async function initSaveTargets(): Promise<SaveTarget[]> {
  try {
    _targets = saveTargetsFor(await getPlatform());
  } catch {
    /* keep the safe default */
  }
  return _targets;
}

/** The destinations offered right now — for menus, which are built synchronously. */
export function currentSaveTargets(): SaveTarget[] {
  return _targets;
}

/**
 * The savable media behind a timeline event, or null when it has none.
 *
 * Read from the raw event rather than the rendered message: once an image has
 * been fetched, the message's `mediaUrl` is a blob URL for display, and only
 * the event still holds the `mxc://` the backend can download.
 */
export function savableMediaForEvent(evt: TimelineEvent | undefined): SavableMedia | null {
  const mxcUrl = evt?.media_url;
  if (!evt || !mxcUrl?.startsWith("mxc://")) return null;
  return {
    mxcUrl,
    filename: evt.filename ?? evt.body ?? undefined,
    encryptionInfo: evt.media_encryption_info ?? undefined,
    mimeType: evt.media_mimetype ?? undefined,
  };
}

/**
 * The message menu's save rows (#124), keyed by registry action id: image
 * messages only, and "Save to Photos" only where there is a photo library. An
 * absent handler drops the row (see context_menus.ts).
 */
export function saveMenuHandlers(evt: TimelineEvent | undefined): Record<string, (() => void) | undefined> {
  if (evt?.msg_type !== "m.image") return {};
  const media = savableMediaForEvent(evt);
  if (!media) return {};
  return {
    "save-image-photos": _targets.includes("photos") ? () => void saveMedia(media, "photos") : undefined,
    "save-image-file": _targets.includes("files") ? () => void saveMedia(media, "files") : undefined,
  };
}

/** The confirmation for a finished save, given where the backend says it went. */
export function savedMessage(target: SaveTarget, where: string): string {
  if (target === "photos") return `Saved to ${where || "Photos"}`;
  // Desktop answers with the path written; mobile with the file's name, since
  // the destination there is a document the app never sees as a path.
  return /[\\/]/.test(where) ? `Saved to ${where}` : `Saved ${where || "file"}`;
}

/**
 * Save `media` to `target`, reporting the outcome as a toast. Never throws: a
 * failure is shown to the user, and a cancelled dialog is silent.
 *
 * A "Saving…" toast covers the download, which can take a moment for a large
 * image that isn't cached — without it the button looked dead, which is half
 * of what #125 reported.
 */
export async function saveMedia(media: SavableMedia, target: SaveTarget): Promise<void> {
  // Grouped, so it is ambient: a message toast arriving while the user sits in
  // the save dialog replaces it rather than being thrown away behind it.
  const dismissProgress = showToast("Saving…", "info", 60_000, { group: "save-progress" });
  try {
    const { mxcUrl, filename, encryptionInfo, mimeType } = media;
    const where =
      target === "photos"
        ? await saveMediaToPhotos(mxcUrl, filename, encryptionInfo, mimeType)
        : await saveMediaWithDialog(mxcUrl, filename, encryptionInfo, mimeType);
    if (where === null) {
      dismissProgress(); // cancelled in the dialog
      return;
    }
    showSuccess(savedMessage(target, where));
  } catch (err) {
    console.error("[media] save failed:", err);
    showError(`Couldn't save: ${err instanceof Error ? err.message : String(err)}`, 6000);
  }
}
