//! Reading files copied in a file manager off the OS clipboard.
//!
//! Copying files in Dolphin or Nautilus does not put their bytes on the
//! clipboard. It puts a list of `file://` URIs there (`text/uri-list`, and on
//! GNOME also `x-special/gnome-copied-files`), for the pasting app to open. A
//! webview is not that app: WebKitGTK hands the page only the list's text
//! flavour, and a page cannot read a path. Drag-and-drop does not have this
//! problem, because Tauri turns a native drop into paths for `local_files`.
//!
//! So the backend reads the clipboard itself. The frontend never names a path
//! here — the command takes no arguments, and the only paths it opens are the
//! ones the OS clipboard lists — so it cannot be steered at an arbitrary file
//! by anything the webview sends. The one way a page could influence it is by
//! writing a URI list to the clipboard itself (a `copy` event's `setData`), and
//! that is refused twice over: a list Quark's own process is serving is ignored
//! (`commands::read_clipboard_files` asks GDK who owns the selection), and so is
//! any selection carrying [`WEBKIT_PAGE_DATA`], the type WebKit adds to
//! everything a page writes — which also covers a clipboard manager re-serving
//! a page's list after Quark lets go of it.
//!
//! The list is parsed here rather than through a clipboard crate's file-list
//! getter: entries are `\r\n`-terminated (RFC 2483, and what Qt and GTK both
//! write), may carry `#` comments, and a copy out of a network location lists
//! `smb://` or `sftp://` URIs that have no local file behind them.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::matrix::media::MediaDownload;

/// Total bytes one paste may read. A paste lands in memory twice over (the
/// bytes, then base64 for IPC) before it is uploaded, and a homeserver's own
/// upload limit is usually well under this.
pub const MAX_TOTAL_BYTES: u64 = 100 * 1024 * 1024;

/// Largest URI list read off the clipboard. Thousands of paths fit in far less;
/// a source offering more is not a file manager.
#[cfg(target_os = "linux")]
const MAX_LIST_BYTES: u64 = 1024 * 1024;

/// The type WebKitGTK adds beside every flavour a web page writes to the
/// clipboard. No file manager offers it, so a list that carries it came out of
/// a webview — possibly Quark's own — and is not the user's copy.
pub const WEBKIT_PAGE_DATA: &str = "org.webkitgtk.WebKit.custom-pasteboard-data";

/// What a paste of copied files produced: the files that could be read, and a
/// readable reason for each listed entry that could not.
#[derive(Debug, Default, Serialize)]
pub struct ClipboardFiles {
    pub files: Vec<MediaDownload>,
    pub errors: Vec<String>,
}

/// The two clipboard formats a file manager lists copied files in.
#[derive(Debug, PartialEq, Eq)]
pub enum CopiedList {
    /// `text/uri-list` (RFC 2483): one URI per line, `#` lines are comments.
    UriList(Vec<u8>),
    /// `x-special/gnome-copied-files`: `copy` or `cut`, then one URI per line.
    GnomeCopiedFiles(Vec<u8>),
}

/// The entries of a copied-files list, each either a local path or the reason
/// it isn't one.
pub fn parse_copied_list(list: &CopiedList) -> Vec<Result<PathBuf, String>> {
    match list {
        CopiedList::UriList(bytes) => parse_uri_list(bytes),
        CopiedList::GnomeCopiedFiles(bytes) => {
            let text = String::from_utf8_lossy(bytes);
            // The first line is the operation. Cut or copy is the file
            // manager's business; attaching reads the file either way.
            let rest = match text.split_once('\n') {
                Some((op, rest)) if matches!(op.trim(), "copy" | "cut") => rest,
                Some(_) => &text,
                None if matches!(text.trim(), "copy" | "cut") => "",
                None => &text,
            };
            parse_uri_list(rest.as_bytes())
        }
    }
}

/// Parse a `text/uri-list` into local paths.
///
/// Lines end in `\r\n` by the RFC and `\n` in practice elsewhere; both are
/// accepted. Blank lines and `#` comments are skipped silently. A URI that is
/// not `file:`, or names a file on another host, is reported rather than
/// dropped — the user copied it, so they should hear why it didn't attach.
pub fn parse_uri_list(bytes: &[u8]) -> Vec<Result<PathBuf, String>> {
    String::from_utf8_lossy(bytes)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(file_uri_to_path)
        .collect()
}

/// One `file:` URI as a local path, percent-decoded.
fn file_uri_to_path(uri: &str) -> Result<PathBuf, String> {
    let url = url::Url::parse(uri).map_err(|_| format!("{uri} is not a file"))?;
    if url.scheme() != "file" {
        return Err(format!("{} is not a local file", display_name(uri)));
    }
    let path = url
        .to_file_path()
        .map_err(|_| format!("{} is on another computer", display_name(uri)))?;
    if !path.is_absolute() {
        return Err(format!("{uri} is not a local file"));
    }
    Ok(path)
}

/// The last segment of a URI, for naming it in an error.
fn display_name(uri: &str) -> String {
    let tail = uri.trim_end_matches(['/', '\r']).rsplit('/').next().unwrap_or(uri);
    let decoded = percent_encoding::percent_decode_str(tail).decode_utf8_lossy();
    if decoded.is_empty() { uri.to_owned() } else { decoded.into_owned() }
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

/// Read every listed file, skipping — and reporting — folders, unreadable
/// entries, and anything that would take the paste past `max_total` bytes.
///
/// A bad entry never sinks the rest: a copy of three files and a folder still
/// attaches the three.
pub fn read_listed_files(entries: Vec<Result<PathBuf, String>>, max_total: u64) -> ClipboardFiles {
    let mut out = ClipboardFiles::default();
    let mut total: u64 = 0;
    for entry in entries {
        let path = match entry {
            Ok(path) => path,
            Err(reason) => {
                out.errors.push(reason);
                continue;
            }
        };
        let name = file_name(&path);
        let meta = match std::fs::metadata(&path) {
            Ok(meta) => meta,
            Err(e) => {
                out.errors.push(format!("Can't attach {name}: {e}"));
                continue;
            }
        };
        if meta.is_dir() {
            out.errors.push(format!("Can't attach {name}: folders can't be attached"));
            continue;
        }
        if !meta.is_file() {
            out.errors.push(format!("Can't attach {name}: not a regular file"));
            continue;
        }
        if total.saturating_add(meta.len()) > max_total {
            out.errors.push(format!(
                "Can't attach {name}: a paste is limited to {} MB in total",
                max_total / (1024 * 1024)
            ));
            continue;
        }
        match crate::local_files::load_attachment(&path) {
            Ok(file) => {
                total = total.saturating_add(meta.len());
                out.files.push(file);
            }
            Err(e) => out.errors.push(format!("Can't attach {name}: {e}")),
        }
    }
    out
}

/// Read the files a file manager put on the OS clipboard. Empty when the
/// clipboard holds no file list — which is every ordinary text paste.
pub fn read_clipboard_files() -> Result<ClipboardFiles, String> {
    match read_os_clipboard()? {
        Some(list) => Ok(read_listed_files(parse_copied_list(&list), MAX_TOTAL_BYTES)),
        None => Ok(ClipboardFiles::default()),
    }
}

/// Only Linux is handled: that is where WebKitGTK shows a copied file to the
/// page as text alone. Elsewhere, and on mobile, a paste gets no file list.
#[cfg(not(target_os = "linux"))]
fn read_os_clipboard() -> Result<Option<CopiedList>, String> {
    Ok(None)
}

#[cfg(target_os = "linux")]
fn read_os_clipboard() -> Result<Option<CopiedList>, String> {
    // A Wayland session is read over the data-control protocol, which lets a
    // client read the selection without holding keyboard focus the way the
    // core protocol demands. Compositors without it (Mutter, for one) fall back
    // to X11, where XWayland mirrors the Wayland clipboard.
    if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        match linux::read_wayland() {
            Ok(list) => return Ok(list),
            Err(linux::WaylandError::Unavailable(why)) => {
                tracing::debug!("Wayland clipboard unavailable ({why}); trying X11");
            }
            Err(linux::WaylandError::Failed(e)) => return Err(e),
        }
    }
    if std::env::var_os("DISPLAY").is_some() {
        return linux::read_x11();
    }
    Ok(None)
}

#[cfg(target_os = "linux")]
mod linux {
    use std::io::Read;
    use std::time::Duration;

    use super::{CopiedList, MAX_LIST_BYTES, WEBKIT_PAGE_DATA};

    const URI_LIST: &str = "text/uri-list";
    const GNOME_COPIED_FILES: &str = "x-special/gnome-copied-files";

    pub enum WaylandError {
        /// No usable Wayland clipboard — try X11 instead.
        Unavailable(String),
        /// The clipboard was reachable and reading it failed.
        Failed(String),
    }

    pub fn read_wayland() -> Result<Option<CopiedList>, WaylandError> {
        use wl_clipboard_rs::paste::{get_contents, get_mime_types, ClipboardType, Error, MimeType, Seat};

        let types = match get_mime_types(ClipboardType::Regular, Seat::Unspecified) {
            Ok(types) => types,
            Err(Error::ClipboardEmpty | Error::NoSeats | Error::NoMimeType) => return Ok(None),
            Err(e @ (Error::MissingProtocol { .. } | Error::WaylandConnection(_) | Error::SocketOpenError(_))) => {
                return Err(WaylandError::Unavailable(e.to_string()));
            }
            Err(e) => return Err(WaylandError::Failed(format!("Can't read the clipboard: {e}"))),
        };

        if types.contains(WEBKIT_PAGE_DATA) {
            tracing::debug!("Clipboard was written by a web page; not reading it as copied files");
            return Ok(None);
        }

        let (mime, wrap): (&str, fn(Vec<u8>) -> CopiedList) = if types.contains(URI_LIST) {
            (URI_LIST, CopiedList::UriList)
        } else if types.contains(GNOME_COPIED_FILES) {
            (GNOME_COPIED_FILES, CopiedList::GnomeCopiedFiles)
        } else {
            return Ok(None);
        };

        match get_contents(ClipboardType::Regular, Seat::Unspecified, MimeType::Specific(mime)) {
            Ok((pipe, _)) => {
                let mut bytes = Vec::new();
                pipe.take(MAX_LIST_BYTES)
                    .read_to_end(&mut bytes)
                    .map_err(|e| WaylandError::Failed(format!("Can't read the clipboard: {e}")))?;
                Ok(Some(wrap(bytes)))
            }
            // The selection changed between listing its types and reading it.
            Err(Error::ClipboardEmpty | Error::NoSeats | Error::NoMimeType) => Ok(None),
            Err(e) => Err(WaylandError::Failed(format!("Can't read the clipboard: {e}"))),
        }
    }

    pub fn read_x11() -> Result<Option<CopiedList>, String> {
        let clipboard = x11_clipboard::Clipboard::new()
            .map_err(|e| format!("Can't reach the X11 clipboard: {e}"))?;
        let load = |target: &str| -> Result<Vec<u8>, String> {
            let atoms = &clipboard.getter.atoms;
            let target = clipboard
                .getter
                .get_atom(target)
                .map_err(|e| format!("Can't read the clipboard: {e}"))?;
            match clipboard.load(atoms.clipboard, target, atoms.property, Duration::from_secs(2)) {
                Ok(mut bytes) => {
                    bytes.truncate(MAX_LIST_BYTES as usize);
                    Ok(bytes)
                }
                // The owner offered the target under a different type: not a
                // file list we understand.
                Err(x11_clipboard::error::Error::UnexpectedType(_)) => Ok(Vec::new()),
                Err(e) => Err(format!("Can't read the clipboard: {e}")),
            }
        };

        // A selection owner that lacks the target answers with no property,
        // which `load` returns as an empty value — so an ordinary text copy
        // costs two quick round trips, not a timeout.
        if !load(WEBKIT_PAGE_DATA)?.is_empty() {
            tracing::debug!("Clipboard was written by a web page; not reading it as copied files");
            return Ok(None);
        }
        let list = load(URI_LIST)?;
        if !list.is_empty() {
            return Ok(Some(CopiedList::UriList(list)));
        }
        let gnome = load(GNOME_COPIED_FILES)?;
        if !gnome.is_empty() {
            return Ok(Some(CopiedList::GnomeCopiedFiles(gnome)));
        }
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn paths(list: &[Result<PathBuf, String>]) -> Vec<String> {
        list.iter()
            .map(|r| match r {
                Ok(p) => p.display().to_string(),
                Err(e) => format!("ERR {e}"),
            })
            .collect()
    }

    #[test]
    fn crlf_terminated_list_has_no_stray_carriage_returns() {
        // What Dolphin (Qt) and Nautilus (GTK) both write.
        let got = parse_uri_list(b"file:///home/u/a.png\r\nfile:///home/u/b.pdf\r\n");
        assert_eq!(paths(&got), ["/home/u/a.png", "/home/u/b.pdf"]);
    }

    #[test]
    fn lf_terminated_list_and_no_trailing_newline() {
        let got = parse_uri_list(b"file:///a\nfile:///b");
        assert_eq!(paths(&got), ["/a", "/b"]);
    }

    #[test]
    fn percent_escapes_are_decoded() {
        let got = parse_uri_list(b"file:///home/u/My%20Pictures/caf%C3%A9%20%231.png\r\n");
        assert_eq!(paths(&got), ["/home/u/My Pictures/café #1.png"]);
    }

    #[test]
    fn localhost_is_local() {
        let got = parse_uri_list(b"file://localhost/etc/hosts\r\n");
        assert_eq!(paths(&got), ["/etc/hosts"]);
    }

    #[test]
    fn comments_and_blank_lines_are_skipped() {
        let got = parse_uri_list(b"# copied by a thing\r\n\r\nfile:///a\r\n  \r\n");
        assert_eq!(paths(&got), ["/a"]);
    }

    #[test]
    fn non_file_uris_are_reported_not_dropped() {
        let got = parse_uri_list(b"smb://nas/share/doc.pdf\r\nfile:///a\r\nhttps://e.com/x\r\n");
        assert_eq!(got.len(), 3);
        assert!(got[0].as_ref().unwrap_err().contains("doc.pdf is not a local file"));
        assert_eq!(got[1].as_ref().unwrap(), Path::new("/a"));
        assert!(got[2].as_ref().unwrap_err().contains("not a local file"));
    }

    #[test]
    fn a_file_on_another_host_is_reported() {
        let got = parse_uri_list(b"file://otherbox/home/u/a.png\r\n");
        assert!(got[0].as_ref().unwrap_err().contains("another computer"), "{got:?}");
    }

    #[test]
    fn a_bare_path_is_not_a_uri() {
        let got = parse_uri_list(b"/home/u/a.png\n");
        assert!(got[0].is_err());
    }

    #[test]
    fn gnome_copied_files_drops_the_operation_line() {
        for op in ["copy", "cut"] {
            let bytes = format!("{op}\nfile:///home/u/a.png\nfile:///home/u/b.png").into_bytes();
            let got = parse_copied_list(&CopiedList::GnomeCopiedFiles(bytes));
            assert_eq!(paths(&got), ["/home/u/a.png", "/home/u/b.png"], "{op}");
        }
        assert!(parse_copied_list(&CopiedList::GnomeCopiedFiles(b"copy".to_vec())).is_empty());
    }

    fn write(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
        let path = dir.join(name);
        std::fs::File::create(&path).unwrap().write_all(bytes).unwrap();
        path
    }

    #[test]
    fn reads_files_and_reports_the_rest_without_stopping() {
        let dir = tempfile::tempdir().unwrap();
        let a = write(dir.path(), "a.txt", b"hello");
        let folder = dir.path().join("folder");
        std::fs::create_dir(&folder).unwrap();
        let missing = dir.path().join("gone.txt");
        let b = write(dir.path(), "b.bin", b"\x00\x01");

        let got = read_listed_files(
            vec![Ok(a), Ok(folder), Err("x is not a local file".into()), Ok(missing), Ok(b)],
            MAX_TOTAL_BYTES,
        );
        let names: Vec<_> = got.files.iter().map(|f| f.filename.clone().unwrap()).collect();
        assert_eq!(names, ["a.txt", "b.bin"]);
        assert_eq!(got.files[0].mime_type, "text/plain");
        assert_eq!(got.errors.len(), 3, "{:?}", got.errors);
        assert!(got.errors[0].contains("folder"), "{:?}", got.errors);
        assert!(got.errors[1].contains("not a local file"));
        assert!(got.errors[2].contains("gone.txt"));
    }

    #[test]
    fn stops_reading_at_the_size_cap_but_keeps_what_fits() {
        let dir = tempfile::tempdir().unwrap();
        let small = write(dir.path(), "small", &[1; 10]);
        let big = write(dir.path(), "big", &[2; 20]);
        let tiny = write(dir.path(), "tiny", &[3; 5]);

        let got = read_listed_files(vec![Ok(small), Ok(big), Ok(tiny)], 16);
        let names: Vec<_> = got.files.iter().map(|f| f.filename.clone().unwrap()).collect();
        // `big` would take the total to 30 > 16; `tiny` still fits after it.
        assert_eq!(names, ["small", "tiny"]);
        assert_eq!(got.errors.len(), 1);
        assert!(got.errors[0].contains("big") && got.errors[0].contains("limited"), "{:?}", got.errors);
    }
}
