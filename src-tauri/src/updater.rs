//! Desktop auto-update: channel→endpoint mapping plus check/install built on
//! tauri-plugin-updater. Channel switching is Rust-driven because the JS
//! `check()` API cannot override the endpoint and there is no `{{channel}}`
//! placeholder — so each check builds the updater with the channel's endpoint.
//!
//! Desktop-only (AppImage/macOS/NSIS). On mobile `UpdaterState` is an empty
//! stub and the commands in `commands.rs` return an error.

use crate::config::app_config::UpdateChannel;
use serde::{Deserialize, Serialize};

/// Base URL of the per-channel update feed (GitHub Pages, custom domain).
const FEED_BASE: &str = "https://quark.tel/updates";

/// Resolve the static `latest.json` URL for a channel.
pub fn endpoint_for(channel: UpdateChannel) -> String {
    let slug = match channel {
        UpdateChannel::Stable => "stable",
        UpdateChannel::Beta => "beta",
    };
    format!("{FEED_BASE}/{slug}/latest.json")
}

/// Metadata about an available update, returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

/// Download-progress payload for the `quark://update/progress` event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateProgress {
    pub chunk_length: usize,
    pub content_length: Option<u64>,
}

/// Filename a packaging drops beside the binary to declare the install
/// read-only. Needed wherever no environment variable reaches every launch
/// path: a macOS `.app` opened from Finder or the Dock never goes through a
/// shell wrapper, so the Nix darwin build marks the bundle itself.
const IMMUTABLE_MARKER: &str = ".quark-immutable";

/// True when the running binary lives in a read-only, store-managed install
/// that the updater cannot write to — Flatpak, Snap, or the Nix store (#28).
/// AppImage stays updatable: it is the one Linux packaging the Tauri updater
/// supports. `QUARK_IMMUTABLE_INSTALL` force-enables this for packagings
/// without an auto-detectable marker (the Nix Linux wrapper sets it); the
/// [`IMMUTABLE_MARKER`] file covers the ones a wrapper cannot reach.
pub fn immutable_install() -> bool {
    let exe = std::env::current_exe().ok();
    immutable_install_from(
        std::env::var_os("QUARK_IMMUTABLE_INSTALL").is_some(),
        std::env::var_os("FLATPAK_ID").is_some()
            || std::path::Path::new("/.flatpak-info").exists(),
        std::env::var_os("SNAP").is_some(),
        exe.as_deref(),
        exe.as_deref()
            .and_then(|p| p.parent())
            .is_some_and(|dir| dir.join(IMMUTABLE_MARKER).exists()),
    )
}

/// Pure core of [`immutable_install`], split out for tests.
fn immutable_install_from(
    forced: bool,
    flatpak: bool,
    snap: bool,
    exe: Option<&std::path::Path>,
    marker: bool,
) -> bool {
    forced || flatpak || snap || marker || exe.is_some_and(|p| p.starts_with("/nix/store"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoints_are_per_channel() {
        assert_eq!(endpoint_for(UpdateChannel::Stable), "https://quark.tel/updates/stable/latest.json");
        assert_eq!(endpoint_for(UpdateChannel::Beta), "https://quark.tel/updates/beta/latest.json");
    }

    #[test]
    fn immutable_install_detects_store_managed_packagings() {
        use std::path::Path;
        assert!(immutable_install_from(true, false, false, None, false), "env override");
        assert!(immutable_install_from(false, true, false, None, false), "flatpak");
        assert!(immutable_install_from(false, false, true, None, false), "snap");
        assert!(
            immutable_install_from(false, false, false, Some(Path::new("/nix/store/abc-quark-0.17.1/bin/quark")), false),
            "nix store exe"
        );
    }

    /// nix-darwin rsyncs the .app out of the store into /Applications/Nix Apps,
    /// so neither the wrapper env var nor the /nix/store path check survives —
    /// the marker file inside the bundle is the only signal left.
    #[test]
    fn immutable_install_detects_a_marked_bundle_outside_the_store() {
        use std::path::Path;
        let relocated = Path::new("/Applications/Nix Apps/Quark.app/Contents/MacOS/Quark");
        assert!(
            !immutable_install_from(false, false, false, Some(relocated), false),
            "unmarked copy is updatable"
        );
        assert!(
            immutable_install_from(false, false, false, Some(relocated), true),
            "marked bundle is immutable"
        );
    }

    #[test]
    fn immutable_install_stays_off_for_normal_installs() {
        use std::path::Path;
        assert!(!immutable_install_from(false, false, false, Some(Path::new("/usr/bin/quark")), false));
        assert!(!immutable_install_from(false, false, false, None, false));
    }
}

// ─── Desktop implementation ───────────────────────────────────────────────────
#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
mod imp {
    use super::{endpoint_for, UpdateInfo, UpdateProgress};
    use crate::config::app_config::UpdateChannel;
    use tauri::{AppHandle, Emitter};
    use tauri_plugin_updater::UpdaterExt;

    /// Holds the `Update` returned by the most recent successful check so a
    /// subsequent `install` can apply it without re-querying.
    #[derive(Default)]
    pub struct UpdaterState {
        pub pending: tokio::sync::Mutex<Option<tauri_plugin_updater::Update>>,
    }

    /// Check the channel's feed. On success stashes the `Update` and returns its
    /// metadata; returns `Ok(None)` when already up to date.
    pub async fn check(
        app: &AppHandle,
        channel: UpdateChannel,
        state: &UpdaterState,
    ) -> Result<Option<UpdateInfo>, String> {
        let url = endpoint_for(channel)
            .parse::<url::Url>()
            .map_err(|e| format!("bad updater endpoint: {e}"))?;

        let updater = app
            .updater_builder()
            .endpoints(vec![url])
            .map_err(|e| format!("updater endpoints: {e}"))?
            .build()
            .map_err(|e| format!("updater build: {e}"))?;

        match updater.check().await {
            Ok(Some(update)) => {
                let info = UpdateInfo {
                    version: update.version.clone(),
                    current_version: update.current_version.clone(),
                    notes: update.body.clone(),
                    date: update.date.map(|d| d.to_string()),
                };
                *state.pending.lock().await = Some(update);
                Ok(Some(info))
            }
            Ok(None) => {
                *state.pending.lock().await = None;
                Ok(None)
            }
            Err(e) => Err(format!("update check failed: {e}")),
        }
    }

    /// Download + install the stashed update (emitting progress), then relaunch.
    pub async fn install(app: &AppHandle, state: &UpdaterState) -> Result<(), String> {
        let update = state
            .pending
            .lock()
            .await
            .take()
            .ok_or_else(|| "no pending update — run a check first".to_string())?;

        let app_for_progress = app.clone();
        update
            .download_and_install(
                move |chunk_length, content_length| {
                    let _ = app_for_progress.emit(
                        "quark://update/progress",
                        UpdateProgress { chunk_length, content_length },
                    );
                },
                || {},
            )
            .await
            .map_err(|e| format!("update install failed: {e}"))?;

        // Relaunch into the freshly-installed version. `restart()` diverges.
        app.restart();
    }
}

#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
pub use imp::{check, install, UpdaterState};

// ─── Mobile stub ──────────────────────────────────────────────────────────────
// `UpdaterState` must exist on every target so `lib.rs` can `.manage()` it and
// `commands.rs` can take it as `State<'_, UpdaterState>`. Mobile carries no
// updater plugin, so the commands short-circuit to an error before using it.
#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
#[derive(Default)]
pub struct UpdaterState;
