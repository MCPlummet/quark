// Media IPC calls

import { invoke } from "./invoke.js";
import type { MediaDownload, UrlPreview } from "./types.js";

export type { MediaDownload, UrlPreview };

// ─── Cache Stats ─────────────────────────────────────────────────────────────

export interface CacheStats {
  total_size_bytes: number;
  entry_count: number;
  max_size_bytes: number;
  usage_percent: number;
}

/** Get media cache statistics. */
export async function getCacheStats(): Promise<CacheStats> {
  return invoke<CacheStats>("get_cache_stats");
}

/** Clear all entries from the media cache. */
export async function clearMediaCache(): Promise<void> {
  return invoke<void>("clear_media_cache");
}

/** Set the maximum media cache size in megabytes. */
export async function setCacheSizeLimit(limitMb: number): Promise<void> {
  return invoke<void>("set_cache_size_limit", { sizeMb: limitMb });
}

/** On-disk size (bytes) of the event-cache SQLite store (search persistence). */
export async function getEventCacheSize(): Promise<number> {
  return invoke<number>("get_event_cache_size");
}

/** Global event-cache diagnostics: how much is cached + on-disk store size. */
export interface EventCacheDiagnostics {
  store_main_bytes: number;
  store_wal_bytes: number;
  store_total_bytes: number;
  rooms_total: number;
  rooms_with_cached_events: number;
  total_cached_events: number;
}

/** On-demand snapshot of event-cache contents (events/rooms) and store size. */
export async function getEventCacheDiagnostics(): Promise<EventCacheDiagnostics> {
  return invoke<EventCacheDiagnostics>("get_event_cache_diagnostics");
}

/** Per-room event-cache footprint. `estimated_bytes` sums raw JSON sizes. */
export interface RoomCacheDiagnostics {
  cached_events: number;
  estimated_bytes: number;
  oldest_ts: number | null;
  newest_ts: number | null;
}

/** Event-cache footprint for a single room (for the `:debug cache` viewer). */
export async function getRoomCacheDiagnostics(roomId: string): Promise<RoomCacheDiagnostics> {
  return invoke<RoomCacheDiagnostics>("get_room_cache_diagnostics", { roomId });
}

/** Clear the event-cache store (search persistence). Safe & rebuildable. */
export async function clearEventCache(): Promise<void> {
  return invoke<void>("clear_event_cache");
}

/**
 * Download media from an mxc:// URL.
 * Returns a MediaDownload containing base64-encoded content and MIME type.
 * Pass `encryptionInfo` (JSON-serialized EncryptedFile) for E2EE media so the
 * backend can decrypt the content before returning it.
 * Matches the Rust `download_media` command.
 */
export async function downloadMedia(mxcUrl: string, encryptionInfo?: string | null): Promise<MediaDownload> {
  return invoke<MediaDownload>("download_media", {
    mxcUrl,
    thumbnail: false,
    thumbnailWidth: null,
    thumbnailHeight: null,
    encryptionInfo: encryptionInfo ?? null,
  });
}

/**
 * Download a thumbnail for an mxc:// URL.
 * Returns a MediaDownload with the thumbnail's base64 content.
 * Matches the Rust `download_media` command with thumbnail=true.
 */
export async function getThumbnail(
  mxcUrl: string,
  width: number,
  height: number,
): Promise<MediaDownload> {
  return invoke<MediaDownload>("download_media", {
    mxcUrl,
    thumbnail: true,
    thumbnailWidth: width,
    thumbnailHeight: height,
  });
}

/**
 * Upload a file from disk and return its mxc:// URL.
 * Matches the Rust `upload_media` command.
 */
export async function uploadMedia(filePath: string): Promise<string> {
  return invoke<string>("upload_media", { filePath });
}

/**
 * Upload base64-encoded file bytes and send as an m.file event.
 * Used for the file picker attach flow.
 */
export async function sendFile(
  roomId: string,
  dataBase64: string,
  mimeType: string,
  filename: string,
  fileSize?: number,
): Promise<string> {
  return invoke<string>("send_file", { roomId, dataBase64, mimeType, filename, fileSize: fileSize ?? null });
}

/**
 * Upload base64-encoded video bytes and send as an m.video event so it renders
 * as a playable embed. width/height/durationMs are probed client-side from the
 * file and let the timeline reserve the correct aspect ratio before download.
 */
export async function sendVideo(
  roomId: string,
  dataBase64: string,
  mimeType: string,
  filename: string,
  width?: number,
  height?: number,
  durationMs?: number,
  fileSize?: number,
): Promise<string> {
  return invoke<string>("send_video", {
    roomId,
    dataBase64,
    mimeType,
    filename,
    width: width ?? null,
    height: height ?? null,
    durationMs: durationMs ?? null,
    fileSize: fileSize ?? null,
  });
}

/**
 * Download media to a temp file on disk and return the absolute path.
 *
 * `mimeType` should be the event's declared mimetype (`info.mimetype`); the
 * backend uses it to pick a correct file extension (the sniffed download mime
 * can't recognise webm/mkv), which Tauri's asset protocol relies on to serve
 * the right Content-Type for inline `<video>` streaming.
 */
export async function saveMediaToTemp(
  mxcUrl: string,
  encryptionInfo?: string | null,
  filename?: string | null,
  mimeType?: string | null,
): Promise<string> {
  return invoke<string>("save_media_to_temp", {
    mxcUrl,
    encryptionInfo: encryptionInfo ?? null,
    filename: filename ?? null,
    mimeType: mimeType ?? null,
  });
}

/**
 * Download a video to a temp file and return a loopback HTTP URL
 * (`http://127.0.0.1:<port>/<token>/<name>`) that streams it with Range
 * support — the seekable transport for inline `<video>` playback. `mimeType`
 * is the event's declared mimetype, used to pick the correct file extension.
 */
export async function serveMedia(
  mxcUrl: string,
  encryptionInfo?: string | null,
  mimeType?: string | null,
  filename?: string | null,
): Promise<string> {
  return invoke<string>("serve_media", {
    mxcUrl,
    encryptionInfo: encryptionInfo ?? null,
    mimeType: mimeType ?? null,
    filename: filename ?? null,
  });
}

/**
 * Download media from the homeserver and save it via the OS native save dialog
 * (XDG desktop portal on Linux, native picker on macOS/Windows). The backend
 * shows the dialog and writes the file; the user picks the destination there, so
 * the frontend never supplies — or even sees — a filesystem path. Returns the
 * written path, or `null` if the user cancelled.
 */
export async function saveMediaWithDialog(
  mxcUrl: string,
  suggestedFilename?: string,
  encryptionInfo?: string | null,
): Promise<string | null> {
  return invoke<string | null>("save_media_with_dialog", {
    mxcUrl,
    suggestedFilename: suggestedFilename ?? null,
    encryptionInfo: encryptionInfo ?? null,
  });
}

/**
 * The backend's compile-time OS ("linux", "macos", "windows", "ios", "android").
 * Used to choose the inline-video transport (loopback server on Linux, asset
 * protocol elsewhere).
 */
export async function getPlatform(): Promise<string> {
  return invoke<string>("get_platform");
}

/**
 * Download a video/audio file and open it in the system's default media player
 * (xdg-open on Linux, open on macOS). Uses a direct process spawn rather than
 * plugin:shell|open, which only handles http/https URLs in Tauri's scope.
 */
export async function openMediaExternally(
  mxcUrl: string,
  encryptionInfo?: string | null,
  filename?: string | null,
): Promise<void> {
  return invoke<void>("open_media_externally", {
    mxcUrl,
    encryptionInfo: encryptionInfo ?? null,
    filename: filename ?? null,
  });
}

/**
 * Upload base64-encoded image bytes and send as an m.image event.
 * Used for clipboard paste and picked images. `caption` becomes the MSC2530
 * caption (event body); `replyToEventId` sends the image as a reply.
 */
export async function sendPastedImage(
  roomId: string,
  dataBase64: string,
  mimeType: string,
  filename: string,
  caption?: string,
  replyToEventId?: string,
): Promise<string> {
  return invoke<string>("send_pasted_image", {
    roomId,
    dataBase64,
    mimeType,
    filename,
    caption: caption ?? null,
    replyToEventId: replyToEventId ?? null,
  });
}

// ─── URL Preview ─────────────────────────────────────────────────────────────

/**
 * Fetch OpenGraph-like metadata for a URL from the homeserver preview API.
 * Returns null if the homeserver returns no preview data.
 */
export async function getUrlPreview(url: string): Promise<UrlPreview | null> {
  return invoke<UrlPreview | null>("get_url_preview", { url });
}
