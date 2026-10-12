//! Saving downloaded media somewhere the user can find it again (#124, #125).
//!
//! Two destinations, because on a phone they are different places:
//!
//! - **Files** — a system "save as" dialog. Desktop already had one (`rfd`, in
//!   `commands.rs`); mobile gets the platform's own: the Storage Access
//!   Framework's create-document picker on Android, and
//!   `UIDocumentPickerViewController` in export mode on iOS.
//! - **Photos** — the gallery / camera roll. Android inserts into `MediaStore`
//!   under `Pictures/Quark`; iOS adds an asset through `PHPhotoLibrary`, asking
//!   for add-only access. Desktop has no equivalent, and the frontend does not
//!   offer it there.
//!
//! Both mobile paths work from a file, not bytes: the media is staged to a temp
//! directory under the name the user will see, handed to the native side by
//! path, and the directory is removed once the native side is done with it.
//!
//! Like `apns.rs`, the iOS bridge is compiled on every platform so CI
//! type-checks it — iOS is not in CI at all — and only the call site is gated.

use std::collections::HashMap;
use std::ffi::{c_char, CStr, CString};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

/// Where a save lands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SaveTarget {
    /// The gallery / camera roll (mobile only).
    Photos,
    /// A location the user picks in the system file dialog.
    Files,
}

impl SaveTarget {
    /// The code `main.mm` switches on.
    fn code(self) -> u8 {
        match self {
            SaveTarget::Photos => 0,
            SaveTarget::Files => 1,
        }
    }
}

/// `Ok(Some(where))` once saved — a short description of where it went, for the
/// confirmation toast; `Ok(None)` when the user cancelled the dialog.
pub type SaveResult = Result<Option<String>, String>;

// ─── Naming ──────────────────────────────────────────────────────────────────

/// Extension for an image or video mimetype, for a name that arrived without one.
fn ext_for_mime(mime: &str) -> Option<&'static str> {
    Some(match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/heic" => "heic",
        "image/heif" => "heif",
        "image/avif" => "avif",
        "image/bmp" => "bmp",
        "image/svg+xml" => "svg",
        "video/mp4" => "mp4",
        "video/quicktime" => "mov",
        "video/webm" => "webm",
        _ => return None,
    })
}

/// The name the saved file is offered under.
///
/// The suggestion is the event's `filename` (or body), which the *sender*
/// chose — so it is reduced to a bare file name before it goes near a path:
/// no directories, no `..`, no leading dot, no control characters. A name with
/// no extension gets one from the mimetype, because both the Photos import and
/// the Files app decide what a file is from it.
pub fn export_filename(suggested: Option<&str>, mime: &str) -> String {
    let base = suggested
        .unwrap_or_default()
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default();
    let mut name: String = base
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect::<String>()
        .trim()
        .trim_start_matches('.')
        .to_string();
    if name.is_empty() {
        name = if mime.starts_with("video/") { "video" } else { "image" }.to_string();
    }
    // Long enough for any real filename, short enough for every filesystem.
    if name.chars().count() > 120 {
        let ext = Path::new(&name)
            .extension()
            .and_then(|e| e.to_str())
            .filter(|e| e.len() <= 8)
            .map(str::to_string);
        name = name.chars().take(100).collect::<String>().trim_end().to_string();
        if let Some(ext) = ext {
            if !name.ends_with(&format!(".{ext}")) {
                name = format!("{name}.{ext}");
            }
        }
    }
    if Path::new(&name).extension().is_none() {
        if let Some(ext) = ext_for_mime(mime) {
            name = format!("{name}.{ext}");
        }
    }
    name
}

// ─── Staging ─────────────────────────────────────────────────────────────────

/// A file written for the native side to read, removed (with its private
/// directory) when dropped.
pub struct StagedFile {
    dir: PathBuf,
    path: PathBuf,
}

impl StagedFile {
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for StagedFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

static STAGE_SEQ: AtomicU64 = AtomicU64::new(0);

/// Write `bytes` to `<root>/quark-save-<pid>-<n>/<name>`.
///
/// A directory per save rather than a shared one: the exported file keeps the
/// user's name exactly (the iOS export dialog and the Android picker both start
/// from it), and two saves of same-named images can never collide.
pub fn stage_in(root: &Path, bytes: &[u8], name: &str) -> Result<StagedFile, String> {
    let n = STAGE_SEQ.fetch_add(1, Ordering::Relaxed);
    let dir = root.join(format!("quark-save-{}-{n}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to prepare the file: {e}"))?;
    let staged = StagedFile { path: dir.join(name), dir };
    std::fs::write(&staged.path, bytes).map_err(|e| format!("Failed to prepare the file: {e}"))?;
    Ok(staged)
}

/// [`stage_in`] the system temp directory.
pub fn stage(bytes: &[u8], name: &str) -> Result<StagedFile, String> {
    stage_in(&std::env::temp_dir(), bytes, name)
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

/// Hand a staged file to the platform's save UI. Mobile only; desktop saves to
/// Files through `rfd` in `commands.rs` and has no Photos.
#[allow(unused_variables)]
pub async fn save_staged(
    app: &tauri::AppHandle,
    staged: &StagedFile,
    mime: &str,
    target: SaveTarget,
) -> SaveResult {
    #[cfg(target_os = "android")]
    {
        android::save(app, staged.path(), mime, target).await
    }
    #[cfg(target_os = "ios")]
    {
        ios_save(staged.path(), mime, target).await
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        Err("Saving to Photos isn't available on this platform".to_string())
    }
}

// ─── Android ─────────────────────────────────────────────────────────────────

#[cfg(target_os = "android")]
pub use android::init;

#[cfg(target_os = "android")]
mod android {
    use super::{SaveResult, SaveTarget};
    use std::path::Path;
    use tauri::{
        plugin::{Builder, PluginHandle, TauriPlugin},
        AppHandle, Manager, Wry,
    };

    /// Managed handle to the Kotlin `MediaSavePlugin`.
    pub struct MediaSaveHandle(PluginHandle<Wry>);

    pub fn init() -> TauriPlugin<Wry> {
        Builder::<Wry>::new("quark-media-save")
            .setup(|app, api| {
                let handle = api.register_android_plugin("tel.quark.app", "MediaSavePlugin")?;
                app.manage(MediaSaveHandle(handle));
                Ok(())
            })
            .build()
    }

    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Args<'a> {
        path: &'a str,
        mime_type: &'a str,
        display_name: &'a str,
    }

    #[derive(serde::Deserialize)]
    struct Saved {
        saved: bool,
        #[serde(default)]
        location: Option<String>,
    }

    pub async fn save(app: &AppHandle, path: &Path, mime: &str, target: SaveTarget) -> SaveResult {
        let handle = app
            .try_state::<MediaSaveHandle>()
            .ok_or("media save plugin not registered")?;
        let args = Args {
            path: &path.to_string_lossy(),
            mime_type: mime,
            display_name: &path.file_name().map(|n| n.to_string_lossy()).unwrap_or_default(),
        };
        let command = match target {
            SaveTarget::Photos => "saveToGallery",
            SaveTarget::Files => "saveToFile",
        };
        // The async variant: saveToFile waits on the user in a system picker,
        // and the blocking one would hold a runtime worker for all of it.
        let saved: Saved = handle
            .0
            .run_mobile_plugin_async(command, args)
            .await
            .map_err(|e| e.to_string())?;
        Ok(saved.saved.then(|| saved.location.unwrap_or_default()))
    }
}

// ─── iOS ─────────────────────────────────────────────────────────────────────
//
// The save UI is UIKit and Photos, both of which live in `main.mm`. Rust can't
// name an ObjC symbol (the cdylib link runs with no main.mm present — see
// `bindings.h`), so main.mm hands over a function pointer at startup, and the
// answer comes back through `quark_media_save_finished` with the request id
// Rust minted.

/// `save(path, mime, target, request)`, implemented in `main.mm`.
type MediaSaver = unsafe extern "C" fn(*const c_char, *const c_char, u8, u64);

static MEDIA_SAVER: OnceLock<MediaSaver> = OnceLock::new();

/// Saves awaiting the native side's answer, by request id.
static PENDING: OnceLock<Mutex<HashMap<u64, tokio::sync::oneshot::Sender<SaveResult>>>> =
    OnceLock::new();
static NEXT_REQUEST: AtomicU64 = AtomicU64::new(1);

fn pending() -> &'static Mutex<HashMap<u64, tokio::sync::oneshot::Sender<SaveResult>>> {
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Called once from `main()`, before Tauri starts.
///
/// # Safety
/// `save` must stay valid for the life of the process.
#[no_mangle]
pub unsafe extern "C" fn quark_register_media_saver(save: Option<MediaSaver>) {
    if let Some(save) = save {
        let _ = MEDIA_SAVER.set(save);
    }
}

/// What the native side reports in `quark_media_save_finished`.
pub const SAVE_STATUS_SAVED: i32 = 0;
pub const SAVE_STATUS_CANCELLED: i32 = 1;
pub const SAVE_STATUS_FAILED: i32 = 2;

/// The native save for `request` has finished. `detail` is where it went on
/// success and the reason on failure; it may be null.
///
/// # Safety
/// `detail` must be null or a valid NUL-terminated string for the duration of
/// the call.
#[no_mangle]
pub unsafe extern "C" fn quark_media_save_finished(request: u64, status: i32, detail: *const c_char) {
    let detail = if detail.is_null() {
        None
    } else {
        // SAFETY: non-null and NUL-terminated per this function's contract.
        Some(unsafe { CStr::from_ptr(detail) }.to_string_lossy().into_owned())
    };
    finish(request, status, detail);
}

/// Resolve a pending save. Unknown ids (a duplicate answer, one for a request
/// whose future was dropped) are ignored.
fn finish(request: u64, status: i32, detail: Option<String>) {
    let Some(tx) = pending().lock().ok().and_then(|mut map| map.remove(&request)) else {
        return;
    };
    let result = match status {
        SAVE_STATUS_SAVED => Ok(Some(detail.unwrap_or_default())),
        SAVE_STATUS_CANCELLED => Ok(None),
        _ => Err(detail.unwrap_or_else(|| "Save failed".to_string())),
    };
    let _ = tx.send(result);
}

/// Register a pending save and return its id with the receiver for its answer.
fn begin() -> (u64, tokio::sync::oneshot::Receiver<SaveResult>) {
    let request = NEXT_REQUEST.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = tokio::sync::oneshot::channel();
    if let Ok(mut map) = pending().lock() {
        map.insert(request, tx);
    }
    (request, rx)
}

/// Run a save through `main.mm` and wait for its answer.
pub async fn ios_save(path: &Path, mime: &str, target: SaveTarget) -> SaveResult {
    let Some(save) = MEDIA_SAVER.get() else {
        return Err("Saving isn't available on this platform".to_string());
    };
    let c_path = CString::new(path.to_string_lossy().as_bytes())
        .map_err(|_| "Invalid file path".to_string())?;
    let c_mime = CString::new(mime).map_err(|_| "Invalid media type".to_string())?;
    let (request, rx) = begin();
    // SAFETY: the pointer came from main(), where it names a function in this
    // binary. It copies what it needs from both strings before returning and
    // hops to the main queue itself.
    unsafe { save(c_path.as_ptr(), c_mime.as_ptr(), target.code(), request) };
    rx.await.unwrap_or_else(|_| Err("Save was interrupted".to_string()))
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_a_plain_filename() {
        assert_eq!(export_filename(Some("cat.png"), "image/png"), "cat.png");
    }

    /// The name is the sender's choice, so it must never steer the write.
    #[test]
    fn strips_directories_and_traversal() {
        assert_eq!(export_filename(Some("../../etc/passwd.png"), "image/png"), "passwd.png");
        assert_eq!(export_filename(Some("C:\\Users\\x\\cat.jpg"), "image/jpeg"), "cat.jpg");
        assert_eq!(export_filename(Some(".."), "image/png"), "image.png");
    }

    #[test]
    fn hides_nothing_behind_a_leading_dot() {
        assert_eq!(export_filename(Some(".hidden.png"), "image/png"), "hidden.png");
    }

    #[test]
    fn drops_control_and_reserved_characters() {
        assert_eq!(export_filename(Some("a\u{0}b\n<c>?.gif"), "image/gif"), "abc.gif");
    }

    #[test]
    fn adds_an_extension_from_the_mimetype_when_missing() {
        assert_eq!(export_filename(Some("photo"), "image/jpeg"), "photo.jpg");
        assert_eq!(export_filename(None, "image/webp"), "image.webp");
        assert_eq!(export_filename(Some(""), "video/mp4"), "video.mp4");
    }

    #[test]
    fn leaves_an_unknown_type_without_inventing_an_extension() {
        assert_eq!(export_filename(Some("blob"), "application/octet-stream"), "blob");
    }

    #[test]
    fn shortens_an_absurd_name_but_keeps_its_extension() {
        let long = format!("{}.png", "a".repeat(300));
        let name = export_filename(Some(&long), "image/png");
        assert!(name.chars().count() <= 120, "{name}");
        assert!(name.ends_with(".png"), "{name}");
    }

    #[test]
    fn a_staged_file_carries_the_name_and_is_removed_on_drop() {
        let root = tempfile::tempdir().unwrap();
        let staged = stage_in(root.path(), b"bytes", "cat.png").unwrap();
        assert_eq!(staged.path().file_name().unwrap(), "cat.png");
        assert_eq!(std::fs::read(staged.path()).unwrap(), b"bytes");
        let dir = staged.path().parent().unwrap().to_path_buf();
        drop(staged);
        assert!(!dir.exists());
    }

    #[test]
    fn two_saves_of_the_same_name_do_not_collide() {
        let root = tempfile::tempdir().unwrap();
        let a = stage_in(root.path(), b"a", "cat.png").unwrap();
        let b = stage_in(root.path(), b"b", "cat.png").unwrap();
        assert_ne!(a.path(), b.path());
        assert_eq!(std::fs::read(a.path()).unwrap(), b"a");
    }

    #[tokio::test]
    async fn the_native_answer_resolves_the_matching_save() {
        let (saved, saved_rx) = begin();
        let (cancelled, cancelled_rx) = begin();
        let (failed, failed_rx) = begin();
        finish(failed, SAVE_STATUS_FAILED, Some("Photos access denied".into()));
        finish(cancelled, SAVE_STATUS_CANCELLED, None);
        finish(saved, SAVE_STATUS_SAVED, Some("Photos".into()));
        assert_eq!(saved_rx.await.unwrap(), Ok(Some("Photos".into())));
        assert_eq!(cancelled_rx.await.unwrap(), Ok(None));
        assert_eq!(failed_rx.await.unwrap(), Err("Photos access denied".into()));
    }

    #[test]
    fn a_stray_or_repeated_answer_is_ignored() {
        finish(u64::MAX, SAVE_STATUS_SAVED, None);
        let (request, mut rx) = begin();
        finish(request, SAVE_STATUS_CANCELLED, None);
        finish(request, SAVE_STATUS_SAVED, None);
        assert_eq!(rx.try_recv().unwrap(), Ok(None));
    }
}
