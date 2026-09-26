//! Reading files the user dropped onto the window (#83).
//!
//! A native drop hands the frontend filesystem *paths*, not bytes — Tauri
//! intercepts the OS drop (`dragDropEnabled`, on by default) before the
//! webview's HTML5 `drop` could carry a `File`. So the bytes have to come from
//! here, and a command that reads a path the frontend names is an arbitrary
//! file read unless something else decides which paths are fair game.
//!
//! That something is the asset-protocol scope. On every native drop Tauri adds
//! the dropped paths to it itself (`manager/window.rs`, `DragDropEvent::Drop`),
//! before the event reaches the frontend — so the scope already *is* the list
//! of files the user handed the app, maintained by the one component that saw
//! the drop happen. This module only reads what that scope allows; it adds
//! nothing to it.

use std::path::Path;

use crate::matrix::media::MediaDownload;
use tauri::utils::mime_type::MimeType;

/// Read one dropped file for attaching.
///
/// `allowed` is the scope check, passed in rather than reached for so the
/// policy can be tested without a running app. Refuses anything relative, not
/// in scope, or not a regular file — a dropped folder is in scope (Tauri allows
/// dropped directories recursively) but is not something that can be attached.
pub fn read_dropped_file(
    path: &str,
    allowed: impl Fn(&Path) -> bool,
) -> Result<MediaDownload, String> {
    let path = Path::new(path);
    if !path.is_absolute() {
        return Err("Dropped file path is not absolute".into());
    }
    if !allowed(path) {
        return Err("That file was not dropped onto Quark".into());
    }
    let meta = std::fs::metadata(path).map_err(|e| format!("Cannot read dropped file: {e}"))?;
    if meta.is_dir() {
        return Err("Folders can't be attached".into());
    }
    load_attachment(path).map_err(|e| format!("Cannot read dropped file: {e}"))
}

/// Read a local file the user handed over — by a drop, or by copying it in a
/// file manager (`clipboard_files`) — into the shape the attach path takes.
///
/// No policy lives here: each caller decides first whether `path` is one the
/// user actually handed over, and that it is not a folder.
pub(crate) fn load_attachment(path: &Path) -> Result<MediaDownload, String> {
    let data = std::fs::read(path).map_err(|e| e.to_string())?;

    let filename = path.file_name().map(|n| n.to_string_lossy().into_owned());
    // Content sniffing first, then the extension — the same detection the asset
    // protocol serves these files with. The fallback is octet-stream, not
    // `MimeType::parse`'s HTML default, which suits a web server and would make
    // an unrecognised upload claim to be a web page.
    let mime_type = MimeType::parse_with_fallback(
        &data,
        &path.to_string_lossy(),
        MimeType::OctetStream,
    );

    Ok(MediaDownload {
        data_base64: crate::matrix::media::to_base64(&data),
        mime_type,
        filename,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const PNG_MAGIC: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D];

    fn temp_file(name: &str, bytes: &[u8]) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(name);
        std::fs::File::create(&path).unwrap().write_all(bytes).unwrap();
        (dir, path)
    }

    #[test]
    fn reads_an_allowed_file_with_its_name_and_sniffed_type() {
        let (_dir, path) = temp_file("shot", PNG_MAGIC);
        let got = read_dropped_file(path.to_str().unwrap(), |_| true).unwrap();
        assert_eq!(got.filename.as_deref(), Some("shot"));
        // No extension to go on: the type comes from the bytes.
        assert_eq!(got.mime_type, "image/png");
        assert_eq!(crate::matrix::media::decode_base64(&got.data_base64).unwrap(), PNG_MAGIC);
    }

    #[test]
    fn unknown_content_is_octet_stream_not_html() {
        let (_dir, path) = temp_file("blob.qqq", b"\x00\x01\x02not anything");
        let got = read_dropped_file(path.to_str().unwrap(), |_| true).unwrap();
        assert_eq!(got.mime_type, "application/octet-stream");
    }

    #[test]
    fn refuses_a_path_outside_the_scope() {
        let (_dir, path) = temp_file("secret.txt", b"hunter2");
        let err = read_dropped_file(path.to_str().unwrap(), |_| false).unwrap_err();
        assert!(err.contains("not dropped"), "{err}");
    }

    #[test]
    fn refuses_a_relative_path_before_consulting_the_scope() {
        let err = read_dropped_file("relative/file.txt", |_| panic!("scope consulted")).unwrap_err();
        assert!(err.contains("absolute"), "{err}");
    }

    #[test]
    fn refuses_a_folder() {
        let dir = tempfile::tempdir().unwrap();
        let err = read_dropped_file(dir.path().to_str().unwrap(), |_| true).unwrap_err();
        assert!(err.contains("Folders"), "{err}");
    }
}
