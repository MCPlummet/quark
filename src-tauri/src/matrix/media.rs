use matrix_sdk::{
    media::{MediaFormat, MediaRequestParameters, MediaThumbnailSettings},
    ruma::{events::room::MediaSource, MxcUri, UInt},
    Client,
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

/// Upload a file to the homeserver and return its mxc:// URL.
pub async fn upload_media(
    client: &Client,
    data: Vec<u8>,
    mime_type: &str,
    _filename: Option<&str>,
) -> Result<String, String> {
    let mime: mime::Mime = mime_type
        .parse()
        .map_err(|e| format!("Invalid MIME type: {e}"))?;

    let response = client
        .media()
        .upload(&mime, data, None)
        .await
        .map_err(|e| format!("Failed to upload media: {e}"))?;

    let mxc_url = response.content_uri.to_string();
    info!(url = %mxc_url, "Media uploaded");
    Ok(mxc_url)
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

    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .map(String::from);

    upload_media(client, data, mime_type, filename.as_deref()).await
}
