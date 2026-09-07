use matrix_sdk::{
    media::{MediaFormat, MediaRequestParameters, MediaThumbnailSettings},
    ruma::{events::room::MediaSource, MxcUri, UInt},
    Client, Room,
};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tracing::info;

use crate::media_cache::MediaCache;

/// Result of a media download — base64-encoded bytes + mime type.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaDownload {
    /// Base64-encoded file content.
    pub data_base64: String,
    pub mime_type: String,
    pub filename: Option<String>,
}

/// Encode bytes to base64 without an external crate.
fn to_base64(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = if chunk.len() > 1 { chunk[1] as usize } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as usize } else { 0 };

        result.push(CHARS[b0 >> 2] as char);
        result.push(CHARS[((b0 & 3) << 4) | (b1 >> 4)] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((b1 & 0xf) << 2) | (b2 >> 6)] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[b2 & 0x3f] as char);
        } else {
            result.push('=');
        }
    }
    result
}

/// Decode standard base64 to bytes.
pub(crate) fn from_base64(s: &str) -> Result<Vec<u8>, String> {
    const VALS: [i8; 256] = {
        let mut v = [-1i8; 256];
        let chars = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut i = 0usize;
        while i < chars.len() {
            v[chars[i] as usize] = i as i8;
            i += 1;
        }
        v
    };
    let s = s.trim_end_matches('=');
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let a = VALS[bytes[i] as usize];
        if a < 0 { return Err(format!("Invalid base64 char at {i}")); }
        if i + 1 >= bytes.len() { break; }
        let b = VALS[bytes[i + 1] as usize];
        if b < 0 { return Err(format!("Invalid base64 char at {}", i + 1)); }
        out.push(((a as u8) << 2) | ((b as u8) >> 4));
        if i + 2 >= bytes.len() { break; }
        let c = VALS[bytes[i + 2] as usize];
        if c < 0 { return Err(format!("Invalid base64 char at {}", i + 2)); }
        out.push(((b as u8) << 4) | ((c as u8) >> 2));
        if i + 3 >= bytes.len() { break; }
        let d = VALS[bytes[i + 3] as usize];
        if d < 0 { return Err(format!("Invalid base64 char at {}", i + 3)); }
        out.push(((c as u8) << 6) | (d as u8));
        i += 4;
    }
    Ok(out)
}

/// Public interface to decode a base64 string to bytes.
pub fn decode_base64(s: &str) -> Result<Vec<u8>, String> {
    from_base64(s)
}

/// Decide encryption from a room's encryption state, `None` when it could not
/// be read.
///
/// The two ways to be wrong are not symmetric: encrypting in a plaintext room
/// is merely unnecessary, while uploading in the clear to an encrypted room
/// publishes the file to anyone who can reach the media endpoint (#81). So an
/// unreadable state encrypts.
///
/// Split from `room_needs_encryption` only so that direction can be pinned by a
/// test — `Room` needs a live client, this does not.
fn encrypt_for_room_state(is_encrypted: Option<bool>) -> bool {
    is_encrypted.unwrap_or(true)
}

/// Whether attachments sent to `room` must be encrypted before upload.
async fn room_needs_encryption(room: &Room) -> bool {
    encrypt_for_room_state(room.is_encrypted().await.ok())
}

/// Upload a file to the homeserver and return the source to reference it by.
///
/// Returns a `MediaSource` rather than an mxc URL because an encrypted upload
/// produces key material that has to travel into the event beside the URL, and
/// a bare `String` cannot carry it. Taking the `Room` rather than a bool means
/// no caller can forget to ask (#81).
pub async fn upload_media(
    client: &Client,
    room: &Room,
    data: Vec<u8>,
    mime_type: &str,
) -> Result<MediaSource, String> {
    let mime: mime::Mime = mime_type
        .parse()
        .map_err(|e| format!("Invalid MIME type: {e}"))?;

    if room_needs_encryption(room).await {
        let mut cursor = std::io::Cursor::new(data);
        let file = client
            .upload_encrypted_file(&mime, &mut cursor)
            .await
            .map_err(|e| format!("Failed to upload encrypted media: {e}"))?;
        info!(url = %file.url, "Media uploaded (encrypted)");
        return Ok(MediaSource::Encrypted(Box::new(file)));
    }

    let uri = upload_plain(client, &mime, data).await?;
    info!(url = %uri, "Media uploaded");
    Ok(MediaSource::Plain(uri))
}

/// Upload bytes to the homeserver's media repo, unencrypted.
///
/// Shared by the only two callers that do a plain upload — `upload_media`'s
/// non-encrypted branch and `upload_file` — so the call and its error text live
/// in one place. Takes an already-parsed mime: `upload_media` needs one for the
/// encrypted branch as well, and parsing it twice to share this would be a
/// strange trade.
async fn upload_plain(
    client: &Client,
    mime: &mime::Mime,
    data: Vec<u8>,
) -> Result<matrix_sdk::ruma::OwnedMxcUri, String> {
    let response = client
        .media()
        .upload(mime, data, None)
        .await
        .map_err(|e| format!("Failed to upload media: {e}"))?;
    Ok(response.content_uri)
}

/// Download media from an mxc:// URL, consulting the disk cache first.
///
/// If `cache` is `Some`, a cache hit returns the stored bytes without hitting
/// the network. On a cache miss the bytes are fetched and then stored.
pub async fn download_media(
    client: &Client,
    mxc_url: &str,
    allow_thumbnail: bool,
    thumbnail_width: Option<u32>,
    thumbnail_height: Option<u32>,
) -> Result<MediaDownload, String> {
    download_media_with_cache(client, mxc_url, allow_thumbnail, thumbnail_width, thumbnail_height, None, None).await
}

/// Sniff the MIME type of a byte slice from its magic bytes.
/// Returns the detected type, or `"application/octet-stream"` as a fallback.
fn sniff_mime_type(data: &[u8]) -> &'static str {
    match data {
        [0x47, 0x49, 0x46, ..] => "image/gif",          // GIF87a / GIF89a
        [0x52, 0x49, 0x46, 0x46, _, _, _, _, 0x57, 0x45, 0x42, 0x50, ..] => "image/webp", // RIFF....WEBP
        [0x89, 0x50, 0x4e, 0x47, ..] => "image/png",    // PNG
        [0xff, 0xd8, 0xff, ..] => "image/jpeg",         // JPEG
        [0x00, 0x00, 0x00, _, 0x66, 0x74, 0x79, 0x70, ..] => "video/mp4", // ftyp box
        _ => "application/octet-stream",
    }
}

/// Like `download_media` but with an optional cache and optional E2EE encryption info.
///
/// `encryption_info` is a JSON-serialized `EncryptedFile` (from `ruma_events::room`).
/// When provided, the source is treated as E2EE-encrypted and the SDK handles decryption.
pub async fn download_media_with_cache(
    client: &Client,
    mxc_url: &str,
    allow_thumbnail: bool,
    thumbnail_width: Option<u32>,
    thumbnail_height: Option<u32>,
    cache: Option<&MediaCache>,
    encryption_info: Option<&str>,
) -> Result<MediaDownload, String> {
    // Build a cache key that includes thumbnail dimensions so full and thumbnail
    // variants are stored independently.
    let cache_key = if allow_thumbnail {
        let w = thumbnail_width.unwrap_or(320);
        let h = thumbnail_height.unwrap_or(240);
        format!("{mxc_url}?thumb={w}x{h}")
    } else {
        mxc_url.to_string()
    };

    // Cache hit: read file from disk and return base64-encoded bytes.
    if let Some(cache) = cache {
        if let Some(cached) = cache.get(&cache_key) {
            match std::fs::read(&cached.path) {
                Ok(bytes) => {
                    info!(url = %mxc_url, "Media cache hit");
                    return Ok(MediaDownload {
                        data_base64: to_base64(&bytes),
                        mime_type: cached.mime_type,
                        filename: None,
                    });
                }
                Err(e) => {
                    // Stale index entry; fall through to re-download.
                    tracing::warn!("Cache file missing, re-downloading: {e}");
                    let _ = cache.remove(&cache_key);
                }
            }
        }
    }

    // Cache miss (or no cache): fetch from the homeserver.
    let mxc_uri = <&MxcUri>::try_from(mxc_url).map_err(|e| format!("Invalid mxc URI: {e}"))?;

    // Use an encrypted source when key material is available (E2EE rooms); the
    // SDK will authenticate, download, and decrypt the ciphertext automatically.
    let source = if let Some(info_json) = encryption_info {
        use matrix_sdk::ruma::events::room::EncryptedFile;
        let file: EncryptedFile = serde_json::from_str(info_json)
            .map_err(|e| format!("Invalid encryption info: {e}"))?;
        MediaSource::Encrypted(Box::new(file))
    } else {
        MediaSource::Plain(mxc_uri.to_owned())
    };

    let format = if allow_thumbnail {
        let width = thumbnail_width.unwrap_or(320);
        let height = thumbnail_height.unwrap_or(240);
        MediaFormat::Thumbnail(MediaThumbnailSettings::new(
            UInt::try_from(width as u64).unwrap_or(UInt::from(320u32)),
            UInt::try_from(height as u64).unwrap_or(UInt::from(240u32)),
        ))
    } else {
        MediaFormat::File
    };

    let request = MediaRequestParameters { source, format };

    let bytes = client
        .media()
        .get_media_content(&request, true)
        .await
        .map_err(|e| format!("Failed to download media: {e}"))?;

    // Detect the actual MIME type from magic bytes so animated GIF/WEBP
    // data URLs are constructed with the correct type and animate in the UI.
    let mime_type = sniff_mime_type(&bytes).to_string();

    // Store in cache (best-effort; errors are logged but not propagated).
    if let Some(cache) = cache {
        if let Err(e) = cache.put(&cache_key, &bytes, &mime_type) {
            tracing::warn!("Failed to cache media {mxc_url}: {e}");
        } else {
            info!(url = %mxc_url, "Media cached");
        }
    }

    let data_base64 = to_base64(&bytes);
    Ok(MediaDownload {
        data_base64,
        mime_type,
        filename: None,
    })
}

/// Upload a file from disk to the homeserver.
pub async fn upload_file(
    client: &Client,
    file_path: &str,
) -> Result<String, String> {
    let path = Path::new(file_path);

    if !path.exists() {
        return Err(format!("File not found: {file_path}"));
    }

    let data = std::fs::read(path).map_err(|e| format!("Failed to read file: {e}"))?;

    let mime_type = match path.extension().and_then(|e| e.to_str()) {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mp3") => "audio/mpeg",
        Some("ogg") => "audio/ogg",
        Some("pdf") => "application/pdf",
        _ => "application/octet-stream",
    };

    // Deliberately not routed through `upload_media`: that one takes a `Room` in
    // order to ask whether the upload has to be encrypted (#81), and this path
    // has no room to ask about — it is not a room attachment. Only the plain
    // upload leg is shared.
    let mime: mime::Mime = mime_type
        .parse()
        .map_err(|e| format!("Invalid MIME type: {e}"))?;
    let mxc_url = upload_plain(client, &mime, data).await?.to_string();

    info!(url = %mxc_url, "File uploaded");
    Ok(mxc_url)
}

// ── Attachment upload progress ───────────────────────────────────────────────

/// Tauri event carrying real byte progress for an in-flight attachment upload.
/// The frontend correlates events to its composer row via `upload_id`, which it
/// mints and passes to `send_file` / `send_video` / `send_pasted_image`.
pub const EVENT_ATTACHMENT_PROGRESS: &str = "quark://attachment/progress";

/// Payload of [`EVENT_ATTACHMENT_PROGRESS`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentProgress {
    pub upload_id: String,
    /// Bytes handed to the transport so far.
    pub transferred: u64,
    /// Total bytes of the request body (0 until the SDK records it).
    pub total: u64,
}

/// How often progress may be reported when the percentage hasn't moved.
/// Percentage changes are always reported, so this only paces uploads big
/// enough that a single percent takes a while.
const PROGRESS_MIN_INTERVAL: std::time::Duration = std::time::Duration::from_millis(250);

/// Upload a file to the homeserver, reporting real transfer progress.
///
/// matrix-sdk only *streams* — and therefore only measures — a request body
/// when something is subscribed to its send-progress observable before the
/// request is awaited (`subscriber_count() != 0` in its native http client), so
/// the subscribe-then-await ordering here is load-bearing, and `upload_media`
/// deliberately stays subscription-free for callers that don't need progress.
///
/// The observable only advances while the upload future is polled, so the
/// subscriber is drained on a side task that is aborted once the upload
/// resolves.
pub async fn upload_media_with_progress<F>(
    client: &Client,
    room: &Room,
    data: Vec<u8>,
    mime_type: &str,
    on_progress: F,
) -> Result<MediaSource, String>
where
    F: Fn(u64, u64) + Send + 'static,
{
    let mime: mime::Mime = mime_type
        .parse()
        .map_err(|e| format!("Invalid MIME type: {e}"))?;

    // Both upload builders expose the same `subscribe_to_send_progress`, so the
    // encrypted leg reports real bytes exactly as the plain one does — the
    // progress row (#63) does not care which path ran. What it measures on the
    // encrypted leg is the ciphertext, which is what actually goes over the wire.
    if room_needs_encryption(room).await {
        let mut cursor = std::io::Cursor::new(data);
        let request = client.upload_encrypted_file(&mime, &mut cursor);
        let progress = request.subscribe_to_send_progress();
        let pump = spawn_progress_pump(progress, on_progress);

        let result = request.await;
        pump.abort();

        let file = result.map_err(|e| format!("Failed to upload encrypted media: {e}"))?;
        info!(url = %file.url, "Media uploaded (encrypted, with progress)");
        return Ok(MediaSource::Encrypted(Box::new(file)));
    }

    let request = client.media().upload(&mime, data, None);
    let progress = request.subscribe_to_send_progress();
    let pump = spawn_progress_pump(progress, on_progress);

    let response = request.await;
    pump.abort();

    let response = response.map_err(|e| format!("Failed to upload media: {e}"))?;

    info!(url = %response.content_uri, "Media uploaded (with progress)");
    Ok(MediaSource::Plain(response.content_uri))
}

/// Drain a send-progress subscriber onto `on_progress`, paced by
/// `PROGRESS_MIN_INTERVAL`.
///
/// The observable only advances while the upload future is polled, so this runs
/// on a side task that the caller aborts once the upload resolves.
fn spawn_progress_pump<S, F>(mut progress: S, on_progress: F) -> tokio::task::JoinHandle<()>
where
    // Generic over the stream rather than naming eyeball's `Subscriber`: it
    // reaches us only through matrix-sdk, and both upload builders hand back a
    // different concrete type.
    S: futures_util::Stream<Item = matrix_sdk::TransmissionProgress> + Unpin + Send + 'static,
    F: Fn(u64, u64) + Send + 'static,
{
    use futures_util::StreamExt;
    tokio::spawn(async move {
        let mut last_percent = u64::MAX;
        let mut last_emit: Option<std::time::Instant> = None;
        while let Some(p) = progress.next().await {
            let transferred = p.current as u64;
            let total = p.total as u64;
            let percent = (transferred * 100).checked_div(total).unwrap_or(0);
            let stale = last_emit.is_none_or(|t| t.elapsed() >= PROGRESS_MIN_INTERVAL);
            if percent != last_percent || stale {
                last_percent = percent;
                last_emit = Some(std::time::Instant::now());
                on_progress(transferred, total);
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::encrypt_for_room_state;

    /// The fail-safe direction is the whole point, so it is pinned rather than
    /// left to a bare `unwrap_or` someone could later "simplify" the other way.
    ///
    /// The two ways to be wrong are not symmetric: encrypting in a plaintext
    /// room costs nothing a reader would notice, while uploading in the clear
    /// to an encrypted room publishes the file to anyone who can reach the
    /// media endpoint (#81).
    #[test]
    fn test_unreadable_room_state_is_treated_as_encrypted() {
        assert!(
            encrypt_for_room_state(None),
            "a room whose encryption state cannot be read must be encrypted"
        );
    }

    #[test]
    fn test_encrypted_room_encrypts_and_plaintext_room_does_not() {
        assert!(encrypt_for_room_state(Some(true)));
        assert!(!encrypt_for_room_state(Some(false)));
    }
}
