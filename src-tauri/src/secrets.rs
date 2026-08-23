//! At-rest secret storage backed by the OS keyring.
//!
//! Two secrets live here:
//!
//!  - the **store-encryption key** — a random 256-bit value passed to matrix-sdk
//!    as the SQLite store passphrase. matrix-sdk uses it (via
//!    `matrix-sdk-store-encryption`) to encrypt the sensitive values in the
//!    state, crypto and event-cache stores at rest: E2EE room keys, cross-signing
//!    secrets, cached event bodies, account data, etc.
//!
//!  - the **session** — the Matrix access token plus the ids needed to restore a
//!    login. This previously lived in the WebView's `localStorage`, i.e. in
//!    plaintext on disk and readable by any JS in the page. It now lives only in
//!    the keyring and never crosses into the frontend.
//!
//! On desktop (Linux/macOS/Windows) and iOS these are stored in the OS keyring
//! via the `keyring` crate. Android has no Secret Service and the `keyring` crate
//! doesn't support it, so there we fall back to files in the app-private data
//! dir, which the OS sandbox already isolates per-app.
//!
//! Every public function takes the resolved app data dir. Desktop ignores it
//! (the keyring is global); the Android fallback uses it as the file location.

use crate::matrix::client::SessionInfo;
use std::path::Path;

/// The user-facing message shown when secure storage can't be reached. It has to
/// be actionable because it surfaces on the login screen — Quark refuses to start
/// an encrypted session rather than silently storing secrets in the clear.
pub fn unavailable_message() -> String {
    "Secure storage is unavailable. Quark keeps your login and the key that \
     encrypts its local database in your operating system's keyring (GNOME \
     Keyring / KWallet on Linux, Keychain on macOS, Credential Manager on \
     Windows). Make sure a keyring / Secret Service is running and unlocked, \
     then try again."
        .to_string()
}

/// Generate a fresh 256-bit key, hex-encoded into an opaque passphrase string.
/// The value is high-entropy random; matrix-sdk runs it through its own KDF.
fn generate_key() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// ─── Desktop / iOS: OS keyring ──────────────────────────────────────────────

#[cfg(not(target_os = "android"))]
mod imp {
    use super::{generate_key, unavailable_message, SessionInfo};
    use keyring::{Entry, Error as KeyringError};
    use std::path::Path;

    const SERVICE: &str = "quark";
    const STORE_KEY_ACCOUNT: &str = "store-encryption-key";
    const SESSION_ACCOUNT: &str = "session";

    /// Stable 64-bit FNV-1a hash of the data dir, hex-encoded. The keyring is
    /// global per OS user, so two Quark installs (e.g. a Flatpak whose data dir
    /// is redirected to `~/.var/app/...` and a native build under
    /// `~/.local/share/...`) would otherwise share one session + one store key
    /// while keeping *separate* on-disk stores — logging into one clobbers the
    /// other's session and forces a re-sync. Tagging each entry with its data
    /// dir binds the keyring secret to the store it actually belongs to. (A hash
    /// rather than the raw path keeps the home directory out of the keyring UI.)
    #[cfg(not(target_os = "ios"))]
    fn dir_tag(data_dir: &Path) -> String {
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for b in data_dir.to_string_lossy().as_bytes() {
            hash ^= u64::from(*b);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        format!("{hash:016x}")
    }

    /// iOS keeps the app data dir under a per-install randomized container UUID
    /// (`/var/mobile/Containers/Data/Application/<UUID>/…`), so the path changes
    /// on every reinstall. Hashing it would mint a brand-new keyring account each
    /// time and orphan the session that's still sitting in the Keychain — Keychain
    /// entries survive app reinstalls, so the login *should* persist. The
    /// multi-install disambiguation the hash provides on desktop is moot here:
    /// there's only ever one Quark install per device and the Keychain is already
    /// app-scoped. A constant tag keeps the account name stable across reinstalls.
    #[cfg(target_os = "ios")]
    fn dir_tag(_data_dir: &Path) -> String {
        "ios".to_string()
    }

    fn store_key_account(data_dir: &Path) -> String {
        format!("{STORE_KEY_ACCOUNT}:{}", dir_tag(data_dir))
    }

    fn session_account(data_dir: &Path) -> String {
        format!("{SESSION_ACCOUNT}:{}", dir_tag(data_dir))
    }

    fn entry(account: &str) -> Result<Entry, String> {
        Entry::new(SERVICE, account).map_err(|e| format!("keyring init failed: {e}"))
    }

    /// Map a keyring error to a user-facing string, translating the
    /// "backend isn't reachable" variants into the actionable guidance message.
    fn map_err(e: KeyringError) -> String {
        match e {
            KeyringError::NoStorageAccess(_) | KeyringError::PlatformFailure(_) => {
                unavailable_message()
            }
            // Some backends (notably Windows Credential Manager, ~2560-byte
            // blob cap) reject an over-long value. The store key is tiny; only a
            // pathologically long access token could trip this — surface it
            // clearly instead of as an opaque "keyring error".
            KeyringError::TooLong(what, max) => format!(
                "Secure storage rejected the {what}: it exceeds this platform's {max}-byte limit. \
                 This usually means the homeserver issued an unusually large access token."
            ),
            other => format!("keyring error: {other}"),
        }
    }

    /// True if the keyring backend is reachable. A missing entry counts as
    /// available; only hard backend failures count as unavailable.
    pub fn is_available(_data_dir: &Path) -> bool {
        match Entry::new(SERVICE, "__probe__") {
            Ok(e) => !matches!(
                e.get_password(),
                Err(KeyringError::NoStorageAccess(_)) | Err(KeyringError::PlatformFailure(_))
            ),
            Err(_) => false,
        }
    }

    pub fn get_or_create_store_key(data_dir: &Path) -> Result<String, String> {
        let e = entry(&store_key_account(data_dir))?;
        match e.get_password() {
            Ok(k) => Ok(k),
            Err(KeyringError::NoEntry) => {
                let key = generate_key();
                e.set_password(&key).map_err(map_err)?;
                Ok(key)
            }
            Err(err) => Err(map_err(err)),
        }
    }

    pub fn get_store_key(data_dir: &Path) -> Result<Option<String>, String> {
        match entry(&store_key_account(data_dir))?.get_password() {
            Ok(k) => Ok(Some(k)),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(err) => Err(map_err(err)),
        }
    }

    pub fn delete_store_key(data_dir: &Path) -> Result<(), String> {
        delete(&store_key_account(data_dir))
    }

    pub fn save_session(data_dir: &Path, session: &SessionInfo) -> Result<(), String> {
        let json = serde_json::to_string(session).map_err(|e| e.to_string())?;
        entry(&session_account(data_dir))?.set_password(&json).map_err(map_err)
    }

    pub fn load_session(data_dir: &Path) -> Result<Option<SessionInfo>, String> {
        match entry(&session_account(data_dir))?.get_password() {
            Ok(json) => serde_json::from_str(&json)
                .map(Some)
                .map_err(|e| format!("corrupt stored session: {e}")),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(err) => Err(map_err(err)),
        }
    }

    pub fn clear_session(data_dir: &Path) -> Result<(), String> {
        delete(&session_account(data_dir))
    }

    fn delete(account: &str) -> Result<(), String> {
        match entry(account)?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(err) => Err(map_err(err)),
        }
    }

    #[cfg(test)]
    mod tests {
        use super::{dir_tag, session_account, store_key_account};
        use std::path::Path;

        #[test]
        fn dir_tag_is_stable_and_path_specific() {
            let a = Path::new("/home/u/.local/share/tel.quark.app");
            // Deterministic: the same path must hash identically across runs, or
            // every launch would mint a new account name and lose the session.
            assert_eq!(dir_tag(a), dir_tag(a));
            // Distinct installs (e.g. Flatpak redirect) get distinct tags.
            assert_ne!(
                dir_tag(a),
                dir_tag(Path::new("/home/u/.var/app/tel.quark.app/data"))
            );
            // Account names carry the tag and stay distinct per secret.
            assert_ne!(store_key_account(a), session_account(a));
        }
    }
}

// ─── Android: app-private files ─────────────────────────────────────────────
//
// Android sandboxes each app's internal storage, so a file under the app data
// dir is only readable by Quark (and root). There's no Secret Service to use and
// the `keyring` crate has no Android backend, so this is the pragmatic fallback.

#[cfg(target_os = "android")]
mod imp {
    use super::{generate_key, SessionInfo};
    use std::path::{Path, PathBuf};

    fn store_key_path(data_dir: &Path) -> PathBuf {
        data_dir.join("store.key")
    }
    fn session_path(data_dir: &Path) -> PathBuf {
        data_dir.join("session.json")
    }

    pub fn is_available(_data_dir: &Path) -> bool {
        true
    }

    pub fn get_or_create_store_key(data_dir: &Path) -> Result<String, String> {
        if let Some(k) = get_store_key(data_dir)? {
            return Ok(k);
        }
        let key = generate_key();
        std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
        std::fs::write(store_key_path(data_dir), &key).map_err(|e| e.to_string())?;
        Ok(key)
    }

    pub fn get_store_key(data_dir: &Path) -> Result<Option<String>, String> {
        match std::fs::read_to_string(store_key_path(data_dir)) {
            Ok(k) => Ok(Some(k)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn delete_store_key(data_dir: &Path) -> Result<(), String> {
        ignore_missing(std::fs::remove_file(store_key_path(data_dir)))
    }

    pub fn save_session(data_dir: &Path, session: &SessionInfo) -> Result<(), String> {
        let json = serde_json::to_string(session).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
        std::fs::write(session_path(data_dir), json).map_err(|e| e.to_string())
    }

    pub fn load_session(data_dir: &Path) -> Result<Option<SessionInfo>, String> {
        match std::fs::read_to_string(session_path(data_dir)) {
            Ok(json) => serde_json::from_str(&json)
                .map(Some)
                .map_err(|e| format!("corrupt stored session: {e}")),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn clear_session(data_dir: &Path) -> Result<(), String> {
        ignore_missing(std::fs::remove_file(session_path(data_dir)))
    }

    fn ignore_missing(r: std::io::Result<()>) -> Result<(), String> {
        match r {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

// ─── iOS: the notification service extension's copy ─────────────────────────
//
// The NSE runs in its own process and cannot read the app's keychain — the
// `keyring` crate cannot set a keychain access group, and nothing above does.
// So the app writes the little the extension needs into the shared app-group
// container instead. It makes one authenticated GET and renders the result;
// anything more than a homeserver and a token would be storing a secret the
// extension has no use for.
//
// This is a second copy of the access token, in a container the extension can
// read. That is the point, and it is also why logout has to delete it: a token
// left behind in a shared container after the session ends is a real leak.

mod nse {
    use std::path::{Path, PathBuf};

    /// Sets a file's data-protection class. Implemented in `main.mm`, because
    /// only Foundation can do it.
    type Protector = unsafe extern "C" fn(*const std::os::raw::c_char) -> bool;

    /// Both of these are *handed to* Rust rather than looked up in ObjC, and
    /// that is not a style choice. `crate-type` includes `cdylib`, which links
    /// on its own with no `main.mm` anywhere near it — so a Rust `extern "C"`
    /// block naming these symbols fails the build outright, on the cdylib,
    /// before the staticlib the app actually uses is ever reached. Passing them
    /// in from `main()` means Rust references no ObjC symbol by name at all,
    /// and is the same direction the APNs token already travels.
    static APP_GROUP: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    static PROTECTOR: std::sync::OnceLock<Protector> = std::sync::OnceLock::new();

    /// Called once from `main()`, before Tauri starts.
    ///
    /// # Safety
    /// `path` must be null or a valid NUL-terminated C string, and `protect` a
    /// function that stays valid for the life of the process.
    #[no_mangle]
    pub unsafe extern "C" fn quark_register_app_group(
        path: *const std::os::raw::c_char,
        protect: Option<Protector>,
    ) {
        if let Some(protect) = protect {
            let _ = PROTECTOR.set(protect);
        }
        if path.is_null() {
            // The entitlement is missing or unprovisioned. A signing problem,
            // not a runtime one, and it costs notification detail rather than
            // the session — so it is reported where it bites, not here.
            return;
        }
        if let Ok(path) = std::ffi::CStr::from_ptr(path).to_str() {
            let _ = APP_GROUP.set(PathBuf::from(path));
        }
    }

    const CREDENTIALS: &str = "nse-credentials.json";
    const DISPLAY: &str = "nse-display.json";

    #[derive(serde::Serialize)]
    struct Credentials<'a> {
        homeserver_url: &'a str,
        access_token: &'a str,
    }

    /// The two privacy flags `notifications::format_notification` applies.
    ///
    /// A separate file from the credentials because the two have different
    /// sources and change at different times: credentials come from the keyring
    /// when a session appears, these from Settings whenever the user edits them.
    /// Merging them would mean a keyring read on every Settings save.
    #[derive(serde::Serialize)]
    struct Display {
        show_body: bool,
        show_sender: bool,
    }

    /// The shared container, or `None` when the app-group entitlement is
    /// missing or unprovisioned — a signing problem, not a runtime one.
    fn container() -> Option<&'static Path> {
        let path = APP_GROUP.get().map(PathBuf::as_path);
        if path.is_none() {
            tracing::warn!(
                "App group container unavailable; the notification extension \
                 cannot be given credentials"
            );
        }
        path
    }

    /// Mark the file readable while the device is locked but after its first
    /// unlock since boot.
    ///
    /// Failing loudly rather than warning is deliberate. A credential file the
    /// extension cannot open on a locked device is worse than no file at all:
    /// pushes arrive precisely when the phone is locked, so the bug would pass
    /// every hand test and fail every real notification.
    fn protect(path: &Path) -> Result<(), String> {
        let protect = PROTECTOR
            .get()
            .ok_or("No file protector registered; main() did not run quark_register_app_group")?;
        let c_path = std::ffi::CString::new(path.as_os_str().as_encoded_bytes())
            .map_err(|e| format!("Credential path is not a valid C string: {e}"))?;
        // SAFETY: c_path is NUL-terminated and outlives the call, and the
        // pointer came from `main()` where it names a function in this binary.
        if unsafe { protect(c_path.as_ptr()) } {
            Ok(())
        } else {
            Err("Could not set the extension credentials' file protection class".to_owned())
        }
    }

    pub fn write(homeserver_url: &str, access_token: &str) -> Result<(), String> {
        let path = container().ok_or("App group container unavailable")?.join(CREDENTIALS);
        let body = serde_json::to_vec(&Credentials { homeserver_url, access_token })
            .map_err(|e| e.to_string())?;
        std::fs::write(&path, body).map_err(|e| e.to_string())?;
        protect(&path)
    }

    pub fn write_display(show_body: bool, show_sender: bool) -> Result<(), String> {
        let path = container().ok_or("App group container unavailable")?.join(DISPLAY);
        let body = serde_json::to_vec(&Display { show_body, show_sender })
            .map_err(|e| e.to_string())?;
        // No protection class: these are two booleans, and a file the extension
        // cannot read on a locked device would silently fall back to *showing*
        // more than the user asked for. The safe default has to be the readable
        // one, so this file is deliberately not protected the way the token is.
        std::fs::write(&path, body).map_err(|e| e.to_string())
    }

    pub fn clear() {
        let Some(dir) = container() else {
            return;
        };
        // The display flags outlive the session on purpose: they are a UI
        // preference, not a secret, and the next login should not briefly leak
        // previews the user turned off.
        remove(&dir.join(CREDENTIALS));
    }

    fn remove(path: &Path) {
        match std::fs::remove_file(path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => tracing::warn!("Could not remove {}: {e}", path.display()),
        }
    }
}

/// Give the iOS notification service extension what it needs to turn a metadata
/// push into a readable notification. A no-op everywhere else.
///
/// Called whenever a session appears rather than only at login: `restore_session`
/// never writes the keyring, so a device that logged in once would otherwise
/// keep whatever token was current the first time this ran.
pub fn write_nse_credentials(homeserver_url: &str, access_token: &str) -> Result<(), String> {
    // A runtime `cfg!` rather than `#[cfg]`: it compiles away just the same, and
    // it leaves `nse` type-checked on every platform. The module has no
    // iOS-specific code left in it — only iOS ever registers an app group.
    if !cfg!(target_os = "ios") {
        return Ok(());
    }
    nse::write(homeserver_url, access_token)
}

/// Tell the extension which of the sender and the message body the user has
/// asked to see. A no-op everywhere else.
///
/// The extension renders notifications the app never gets to see — it runs while
/// the app is suspended or gone — so without this, `show_body = false` would
/// still put message text on the lock screen. Written whenever Settings saves,
/// which is the only thing that changes them.
pub fn write_nse_display(show_body: bool, show_sender: bool) -> Result<(), String> {
    if !cfg!(target_os = "ios") {
        return Ok(());
    }
    nse::write_display(show_body, show_sender)
}

/// Remove the extension's copy of the credentials. A no-op everywhere else.
///
/// Best-effort and infallible by design: this runs on the logout path, which
/// must not fail, and the worst outcome is a stale token the homeserver has
/// already revoked.
pub fn clear_nse_credentials() {
    if !cfg!(target_os = "ios") {
        return;
    }
    nse::clear();
}

// ─── Public API (platform-agnostic) ─────────────────────────────────────────

/// Whether secure storage is reachable. Quark refuses to start an encrypted
/// session if this is false.
pub fn is_available(data_dir: &Path) -> bool {
    imp::is_available(data_dir)
}

/// Fetch the store-encryption key, generating and persisting a fresh one if none
/// exists yet.
pub fn get_or_create_store_key(data_dir: &Path) -> Result<String, String> {
    imp::get_or_create_store_key(data_dir)
}

/// Fetch the existing store-encryption key, or `None` if none is stored.
pub fn get_store_key(data_dir: &Path) -> Result<Option<String>, String> {
    imp::get_store_key(data_dir)
}

/// Remove the store-encryption key (used on logout / fresh login).
pub fn delete_store_key(data_dir: &Path) -> Result<(), String> {
    imp::delete_store_key(data_dir)
}

/// Persist the Matrix session.
pub fn save_session(data_dir: &Path, session: &SessionInfo) -> Result<(), String> {
    imp::save_session(data_dir, session)
}

/// Load the persisted Matrix session, or `None` if none is stored.
pub fn load_session(data_dir: &Path) -> Result<Option<SessionInfo>, String> {
    imp::load_session(data_dir)
}

/// Remove the persisted Matrix session.
pub fn clear_session(data_dir: &Path) -> Result<(), String> {
    imp::clear_session(data_dir)
}

#[cfg(test)]
mod tests {
    use super::generate_key;

    #[test]
    fn generated_key_is_64_hex_chars() {
        let key = generate_key();
        assert_eq!(key.len(), 64, "256 bits → 64 hex chars");
        assert!(key.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn generated_keys_are_unique() {
        // Astronomically unlikely to collide; guards against a constant key.
        assert_ne!(generate_key(), generate_key());
    }
}
