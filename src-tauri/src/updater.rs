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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoints_are_per_channel() {
        assert_eq!(endpoint_for(UpdateChannel::Stable), "https://quark.tel/updates/stable/latest.json");
        assert_eq!(endpoint_for(UpdateChannel::Beta), "https://quark.tel/updates/beta/latest.json");
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
