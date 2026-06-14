# Desktop Auto-Update (stable/beta) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add in-app desktop auto-update to Quark with two channels (stable/beta), a notify-and-confirm UX, and a per-channel `latest.json` feed served from the existing quark.tel GitHub Pages site.

**Architecture:** The Tauri v2 updater has no `{{channel}}` placeholder and its JS `check()` can't switch endpoints, so all update logic is **Rust-driven**: two thin commands (`update_check`, `update_install`) build the updater with the channel's endpoint at runtime (`app.updater_builder().endpoints(...)`). Channel/auto-check prefs live in a new `[updater]` section of the existing `AppConfig` and ride the existing `get_app_config`/`set_app_config` path — no dedicated prefs commands. A non-modal `UpdateBanner` (StatusBar pattern) surfaces availability; CI assembles per-channel `latest.json` from the signed release artifacts and commits it to `docs/updates/<channel>/` on `main`.

**Tech Stack:** Tauri v2, `tauri-plugin-updater` 2.x (minisign signing), Rust (`commands.rs`/`lib.rs`/`config`), TypeScript (vanilla DOM, Vitest), GitHub Actions, GitHub Pages.

**Spec:** `specs/2026-06-13-desktop-auto-update-design.md`

**Platform note:** Updatable artifacts are Linux **AppImage**, macOS **`.app`** (Apple-Silicon/`aarch64` only), Windows **NSIS** `-setup.exe`. deb/rpm/Flatpak/Android update via their own channels. The new Rust module/plugin is **desktop-gated** so Android/iOS keep compiling; the two commands are defined for all targets (mobile returns an error), mirroring how `set_background_sync` etc. already work.

**⚠️ Release-blocking dependency:** Once `bundle.createUpdaterArtifacts: true` is set (Task 4), a tagged release **fails** unless `TAURI_SIGNING_PRIVATE_KEY` (+ `_PASSWORD`) secrets exist (Task 11). Do **not** push a `v*` tag after merge until those secrets are added. Local `pnpm tauri build` will likewise require the env; normal `cargo test`/`pnpm test`/`pnpm build` are unaffected.

---

## File Structure

**Rust (new):**
- `src-tauri/src/updater.rs` — channel→endpoint mapping, `UpdateInfo`/`UpdateProgress` types, `UpdaterState`, and desktop `check`/`install`. Mobile stub for `UpdaterState`.

**Rust (modified):**
- `src-tauri/Cargo.toml` — add desktop-only `tauri-plugin-updater` dep.
- `src-tauri/src/config/app_config.rs` — `UpdateChannel` enum + `UpdaterConfig` section.
- `src-tauri/src/commands.rs` — `update_check` + `update_install` commands.
- `src-tauri/src/lib.rs` — `mod updater;`, manage `UpdaterState`, register plugin (desktop), register commands.
- `src-tauri/tauri.conf.json` — updater plugin config + `createUpdaterArtifacts`.

**Frontend (new):**
- `src/ipc/updater.ts` — IPC wrappers + types.
- `src/ui/UpdateBanner.ts` — non-modal banner component.
- `src/app/update_check.ts` — startup-check orchestration + dismiss memory.

**Frontend (modified):**
- `src/ipc/index.ts` — re-export updater module.
- `src/ipc/mock.ts` — mock the two commands.
- `src/ipc/app_config.ts` — `UpdaterConfig` TS type + default.
- `src/app/set_options.ts` — `:set update_channel` / `auto_update` routing.
- `src/app/state.ts` — `updateAvailable` state field.
- `src/ui/App.ts` — instantiate + mount `UpdateBanner`.
- `src/main.ts` — wire banner callbacks, progress listener, deferred check.
- `src/ui/SettingsDialog.ts` — "Updates" settings section.
- `src/vim/commands.ts` + `src/app/actions/commands.ts` — `:update` command.
- `src/style/base.css` — `.update-banner` styles.

**CI / docs:**
- `.github/workflows/release.yml` — signing env + `publish-update-feed` job.
- `DESIGN.md` — Auto-update section.

---

## Task 1: `[updater]` config section (Rust)

**Files:**
- Modify: `src-tauri/src/config/app_config.rs`
- Test: `src-tauri/src/config/app_config.rs` (inline `#[cfg(test)]` module — follow existing test convention if present, else add one)

- [ ] **Step 1: Write the failing test**

Add at the bottom of `src-tauri/src/config/app_config.rs`:

```rust
#[cfg(test)]
mod updater_config_tests {
    use super::*;

    #[test]
    fn updater_defaults_are_stable_and_auto() {
        let c = UpdaterConfig::default();
        assert_eq!(c.channel, UpdateChannel::Stable);
        assert!(c.auto_check);
    }

    #[test]
    fn app_config_includes_updater_default() {
        let c = AppConfig::default();
        assert_eq!(c.updater.channel, UpdateChannel::Stable);
    }

    #[test]
    fn missing_updater_section_falls_back_to_default() {
        // A config file written before [updater] existed must still parse.
        let cfg: AppConfig = toml::from_str("[general]\ntheme = \"phosphor\"\n").unwrap();
        assert_eq!(cfg.updater.channel, UpdateChannel::Stable);
        assert!(cfg.updater.auto_check);
    }

    #[test]
    fn channel_round_trips_lowercase() {
        let c = UpdaterConfig { channel: UpdateChannel::Beta, auto_check: false };
        let toml = toml::to_string(&c).unwrap();
        assert!(toml.contains("channel = \"beta\""), "got: {toml}");
        let back: UpdaterConfig = toml::from_str(&toml).unwrap();
        assert_eq!(back, c);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test updater_config_tests`
Expected: FAIL — `cannot find type UpdaterConfig` / `UpdateChannel`.

- [ ] **Step 3: Add the enum, struct, defaults, and AppConfig field**

In `src-tauri/src/config/app_config.rs`, after the `CacheConfig` struct (around line 136, before `// ─── Root config ───`) add:

```rust
/// Desktop auto-update release channel. Serialized lowercase ("stable"/"beta")
/// so it reads naturally in config.toml and matches the feed path segment.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UpdateChannel {
    Stable,
    Beta,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UpdaterConfig {
    /// Which release channel the in-app updater follows.
    #[serde(default = "default_channel")]
    pub channel: UpdateChannel,
    /// Check for an update automatically a few seconds after sync starts.
    #[serde(default = "bool_true")]
    pub auto_check: bool,
}
```

In the `AppConfig` struct (around line 154, after `pub cache: CacheConfig,`) add the field:

```rust
    #[serde(default)]
    pub updater: UpdaterConfig,
```

In the default-helpers block (around line 173, after `fn default_timeline_rooms`) add:

```rust
fn default_channel() -> UpdateChannel { UpdateChannel::Stable }
```

After `impl Default for CacheConfig` (around line 222) add:

```rust
impl Default for UpdaterConfig {
    fn default() -> Self {
        Self { channel: UpdateChannel::Stable, auto_check: true }
    }
}
```

In `impl Default for AppConfig` (around line 233) add `updater` to the struct literal:

```rust
            cache: CacheConfig::default(),
            updater: UpdaterConfig::default(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test updater_config_tests`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/config/app_config.rs
git commit -m "feat(updater): add [updater] config section (channel + auto_check)"
```

---

## Task 2: Updater module — endpoint mapping, types, check/install (Rust)

**Files:**
- Create: `src-tauri/src/updater.rs`
- Test: `src-tauri/src/updater.rs` (inline `#[cfg(test)]`)

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/updater.rs` with only this content first:

```rust
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
```

- [ ] **Step 2: Wire the module so the test compiles, then run it**

In `src-tauri/src/lib.rs`, add `mod updater;` alongside the other top-level `mod` declarations (near the top of the file with `mod commands;`, `mod config;`, etc.).

Run: `cd src-tauri && cargo test --lib endpoints_are_per_channel`
Expected: PASS (1 test). (The desktop impl below is added next; the pure mapping is testable now.)

- [ ] **Step 3: Add the desktop-only dependency**

The desktop impl below references `tauri-plugin-updater`. In `src-tauri/Cargo.toml`, find the existing desktop dependency block:

```toml
[target.'cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))'.dependencies]
rfd = { version = "0.17", default-features = false, features = ["xdg-portal"] }
```

Add the updater under it (same block):

```toml
tauri-plugin-updater = "2"
```

- [ ] **Step 4: Add the desktop impl + mobile stub**

Append to `src-tauri/src/updater.rs`:

```rust
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
```

- [ ] **Step 5: Verify the crate compiles for desktop**

Run: `cd src-tauri && cargo build`
Expected: builds. (`url` is already a dependency; `tauri-plugin-updater` was just added in Step 3.)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/updater.rs src-tauri/src/lib.rs
git commit -m "feat(updater): updater module + dependency — endpoint mapping, check/install, mobile stub"
```

---

## Task 3: Commands and registration (Rust)

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the two commands**

In `src-tauri/src/commands.rs`, after `set_app_config` (around line 1953) add:

```rust
/// Check the user's configured channel for an available update. Returns
/// metadata when one exists (the `Update` itself is stashed in `UpdaterState`
/// for `update_install`), `None` when up to date. Desktop-only.
#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    config_state: State<'_, Mutex<AppConfig>>,
    updater_state: State<'_, crate::updater::UpdaterState>,
) -> Result<Option<crate::updater::UpdateInfo>, String> {
    let channel = {
        let guard = config_state.lock().map_err(|_| "App config lock poisoned")?;
        guard.updater.channel
    };
    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
    {
        crate::updater::check(&app, channel, &updater_state).await
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        let _ = (&app, channel, &updater_state);
        Err("auto-update is desktop-only".into())
    }
}

/// Download + install the pending update (from the last `update_check`), then
/// relaunch the app. Desktop-only.
#[tauri::command]
pub async fn update_install(
    app: AppHandle,
    updater_state: State<'_, crate::updater::UpdaterState>,
) -> Result<(), String> {
    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
    {
        crate::updater::install(&app, &updater_state).await
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        let _ = (&app, &updater_state);
        Err("auto-update is desktop-only".into())
    }
}
```

> `UpdateChannel` derives `Copy`, so reading `guard.updater.channel` copies it and the `std::sync::Mutex` guard is dropped at the end of the inner block — never held across the `.await`.

- [ ] **Step 2: Manage state, register plugin, register commands**

In `src-tauri/src/lib.rs`:

(a) In the `.manage(...)` chain (after line 118, `.manage(notify::NotificationRegistry::default())`) add:

```rust
        .manage(updater::UpdaterState::default())
```

(b) Register the plugin. After the Android `mobile_sync` plugin line (around line 100):

```rust
    // Desktop auto-updater (AppImage / macOS .app / Windows NSIS). Endpoints are
    // set per-channel at runtime in updater.rs; the config endpoint is a fallback.
    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
```

(c) In `tauri::generate_handler![ ... ]`, after the `// App Config` entries (line 224-225) add:

```rust
            // Updater
            commands::update_check,
            commands::update_install,
```

- [ ] **Step 3: Verify build + existing tests**

Run: `cd src-tauri && cargo build && cargo test`
Expected: builds cleanly; all tests pass (including Task 1 & 2 tests).

If the compiler flags any `tauri_plugin_updater::Update` field name (`version` / `current_version` / `body` / `date`), correct it to the crate's actual field name shown in the error and rebuild — the rest of the logic is unaffected.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(updater): register plugin, state, and update_check/update_install commands"
```

---

## Task 4: Tauri config — updater plugin + updater artifacts

**Files:**
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Add the updater plugin config**

Replace the `"plugins"` block (lines 12-16) with:

```json
  "plugins": {
    "shell": {
      "open": true
    },
    "updater": {
      "pubkey": "REPLACE_WITH_UPDATER_PUBLIC_KEY",
      "endpoints": [
        "https://quark.tel/updates/stable/latest.json"
      ],
      "windows": {
        "installMode": "passive"
      }
    }
  },
```

- [ ] **Step 2: Enable updater artifacts in the bundle**

In the `"bundle"` block, add `"createUpdaterArtifacts": true` right after `"active": true,` (line 38):

```json
  "bundle": {
    "active": true,
    "createUpdaterArtifacts": true,
    "publisher": "mcplummet",
```

- [ ] **Step 3: Paste the real public key**

Read the public key generated by the maintainer and substitute it for `REPLACE_WITH_UPDATER_PUBLIC_KEY`:

Run: `cat ~/.tauri/quark-updater.key.pub`
Then set `plugins.updater.pubkey` to that exact base64 string (the key content, **not** a path).

> If the key isn't generated yet: `pnpm tauri signer generate -w ~/.tauri/quark-updater.key` (run in a normal terminal — it prints the private key). The pubkey is the only piece this file needs.

- [ ] **Step 4: Verify config parses**

Run: `cd src-tauri && cargo build`
Expected: builds. (Tauri validates `tauri.conf.json` at build time; a schema/typo error surfaces here.)

> Do **not** run a full `pnpm tauri build` yet — with `createUpdaterArtifacts: true` it now requires `TAURI_SIGNING_PRIVATE_KEY` in the env and will fail without it. That signing is wired in CI in Task 11.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "feat(updater): configure updater plugin, endpoints, and createUpdaterArtifacts"
```

---

## Task 5: Frontend IPC — wrappers, types, index, mock

**Files:**
- Create: `src/ipc/updater.ts`
- Modify: `src/ipc/index.ts`
- Modify: `src/ipc/mock.ts`
- Test: `src/ipc/updater.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/ipc/updater.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { setForceMock } from "./invoke.js";
import { updateCheck, updateInstall } from "./updater.js";

describe("updater IPC (mock mode)", () => {
  beforeEach(() => setForceMock(true));

  it("updateCheck returns null when up to date", async () => {
    await expect(updateCheck()).resolves.toBeNull();
  });

  it("updateInstall resolves without throwing", async () => {
    await expect(updateInstall()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/ipc/updater.test.ts`
Expected: FAIL — cannot resolve `./updater.js`.

- [ ] **Step 3: Create the IPC module**

Create `src/ipc/updater.ts`:

```ts
// Auto-update IPC calls — mirror the Rust updater commands. Desktop-only;
// returns an error on mobile.

import { invoke } from "./invoke.js";

/** Release channel — matches config::app_config::UpdateChannel (lowercase). */
export type UpdateChannel = "stable" | "beta";

/** Available-update metadata — matches updater::UpdateInfo. */
export interface UpdateInfo {
  version: string;
  current_version: string;
  notes: string | null;
  date: string | null;
}

/** Download progress — matches updater::UpdateProgress (event quark://update/progress). */
export interface UpdateProgress {
  chunk_length: number;
  content_length: number | null;
}

/**
 * Check the configured channel's feed. Resolves to the update metadata when one
 * is available, or `null` when already up to date. Matches `update_check`.
 */
export async function updateCheck(): Promise<UpdateInfo | null> {
  return invoke<UpdateInfo | null>("update_check");
}

/**
 * Download + install the pending update (from the last `updateCheck`), then the
 * backend relaunches the app. Matches `update_install`.
 */
export async function updateInstall(): Promise<void> {
  return invoke<void>("update_install");
}
```

- [ ] **Step 4: Re-export from index.ts**

In `src/ipc/index.ts`, after the `// ─── GIF ───` export section, add:

```ts
// ─── Updates ──────────────────────────────────────────────────────────────────
export { updateCheck, updateInstall } from "./updater.js";
export type { UpdateChannel, UpdateInfo, UpdateProgress } from "./updater.js";
```

- [ ] **Step 5: Add mock cases**

In `src/ipc/mock.ts`, inside the `mockInvoke` `switch (cmd)`, add (near the other config/no-op cases):

```ts
    case "update_check":
      // Mock dev mode is always "up to date".
      return null;
    case "update_install":
      return null;
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test src/ipc/updater.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/ipc/updater.ts src/ipc/updater.test.ts src/ipc/index.ts src/ipc/mock.ts
git commit -m "feat(updater): frontend IPC wrappers, types, and mocks"
```

---

## Task 6: Frontend config type + `:set` routing

**Files:**
- Modify: `src/ipc/app_config.ts`
- Modify: `src/ipc/index.ts`
- Modify: `src/app/set_options.ts`
- Test: `src/app/set_options.test.ts` (create if absent; else extend)

- [ ] **Step 1: Write the failing test**

Create or extend `src/app/set_options.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { applySetOptions } from "./set_options.js";
import { DEFAULT_APP_CONFIG } from "../ipc/app_config.js";

describe("applySetOptions — updater", () => {
  it("sets the update channel to beta", () => {
    const out = applySetOptions(DEFAULT_APP_CONFIG, [{ name: "update_channel", value: "beta" }]);
    expect(out.updater.channel).toBe("beta");
  });

  it("ignores an invalid channel value", () => {
    const out = applySetOptions(DEFAULT_APP_CONFIG, [{ name: "update_channel", value: "nightly" }]);
    expect(out.updater.channel).toBe("stable");
  });

  it("toggles auto_update", () => {
    const out = applySetOptions(DEFAULT_APP_CONFIG, [{ name: "auto_update", value: false }]);
    expect(out.updater.auto_check).toBe(false);
  });

  it("preserves the updater section when other options change", () => {
    const base = { ...DEFAULT_APP_CONFIG, updater: { channel: "beta" as const, auto_check: false } };
    const out = applySetOptions(base, [{ name: "theme", value: "amber" }]);
    expect(out.updater).toEqual({ channel: "beta", auto_check: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/app/set_options.test.ts`
Expected: FAIL — `out.updater` is undefined / property missing.

- [ ] **Step 3: Add the TS config type + default**

In `src/ipc/app_config.ts`, after the `CacheConfig` interface (around line 64) add:

```ts
export interface UpdaterConfig {
  /** Release channel the in-app updater follows. */
  channel: "stable" | "beta";
  /** Check for an update automatically shortly after sync starts. */
  auto_check: boolean;
}
```

Add `updater` to the `AppConfig` interface (after `cache: CacheConfig;`):

```ts
  updater: UpdaterConfig;
```

Add to `DEFAULT_APP_CONFIG` (after the `cache: {...}` line):

```ts
  updater: { channel: "stable", auto_check: true },
```

In `src/ipc/index.ts`, add `UpdaterConfig` to the config-type export list (the `export type { AppConfig, GeneralConfig, ... } from "./app_config.js";` line):

```ts
export type { AppConfig, GeneralConfig, SyncConfig, MediaConfig, GifConfig, GifRating, EmojiConfig, CacheConfig, UpdaterConfig } from "./app_config.js";
```

- [ ] **Step 4: Add the clone + switch cases in set_options.ts**

In `src/app/set_options.ts`, in the `updated` clone object (around line 27) add the `updater` section so it isn't dropped:

```ts
    cache: { ...cfg.cache },
    updater: { ...cfg.updater },
```

In the `switch (name)` block, after the existing cases (before `default:`) add:

```ts
      // updater
      case "update_channel": if (value === "stable" || value === "beta") updated.updater.channel = value; break;
      case "auto_update":    if (typeof value === "boolean") updated.updater.auto_check = value; break;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/app/set_options.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/ipc/app_config.ts src/ipc/index.ts src/app/set_options.ts src/app/set_options.test.ts
git commit -m "feat(updater): frontend updater config type + :set update_channel/auto_update"
```

---

## Task 7: UpdateBanner component (UI)

**Files:**
- Create: `src/ui/UpdateBanner.ts`
- Modify: `src/style/base.css`
- Test: `src/ui/UpdateBanner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/ui/UpdateBanner.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { UpdateBanner } from "./UpdateBanner.js";
import type { UpdateInfo } from "../ipc/index.js";

const info: UpdateInfo = { version: "0.15.0", current_version: "0.14.0", notes: null, date: null };

describe("UpdateBanner", () => {
  it("is hidden until show() is called", () => {
    const b = new UpdateBanner();
    expect(b.getElement().classList.contains("update-banner--visible")).toBe(false);
  });

  it("show() reveals the banner and renders the version", () => {
    const b = new UpdateBanner();
    b.show(info);
    expect(b.getElement().classList.contains("update-banner--visible")).toBe(true);
    expect(b.getElement().textContent).toContain("0.15.0");
  });

  it("install button fires onInstall", () => {
    const b = new UpdateBanner();
    const cb = vi.fn();
    b.onInstall(cb);
    b.show(info);
    b.getElement().querySelector<HTMLButtonElement>(".update-banner__install")!.click();
    expect(cb).toHaveBeenCalledOnce();
  });

  it("dismiss button fires onDismiss with the version and hides", () => {
    const b = new UpdateBanner();
    const cb = vi.fn();
    b.onDismiss(cb);
    b.show(info);
    b.getElement().querySelector<HTMLButtonElement>(".update-banner__dismiss")!.click();
    expect(cb).toHaveBeenCalledWith("0.15.0");
    expect(b.getElement().classList.contains("update-banner--visible")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/ui/UpdateBanner.test.ts`
Expected: FAIL — cannot resolve `./UpdateBanner.js`.

- [ ] **Step 3: Implement the component**

Create `src/ui/UpdateBanner.ts`:

```ts
// Non-modal "update available" banner. Follows the StatusBar pattern: a plain
// class that owns a root element, exposes getElement() for mounting, and
// imperative show/hide/progress methods. Not a DialogBase overlay.

import type { UpdateInfo } from "../ipc/index.js";

export class UpdateBanner {
  private _el: HTMLElement;
  private _text: HTMLElement;
  private _progress: HTMLElement;
  private _installBtn: HTMLButtonElement;
  private _dismissBtn: HTMLButtonElement;
  private _version: string | null = null;
  private _onInstall: (() => void) | null = null;
  private _onDismiss: ((version: string) => void) | null = null;

  constructor() {
    this._el = document.createElement("div");
    this._el.className = "update-banner";
    this._el.setAttribute("role", "status");
    this._el.setAttribute("aria-live", "polite");
    this._el.setAttribute("aria-label", "Software update");

    this._text = document.createElement("span");
    this._text.className = "update-banner__text";
    this._el.appendChild(this._text);

    this._progress = document.createElement("span");
    this._progress.className = "update-banner__progress";
    this._progress.setAttribute("aria-hidden", "true");
    this._el.appendChild(this._progress);

    this._installBtn = document.createElement("button");
    this._installBtn.className = "update-banner__install";
    this._installBtn.type = "button";
    this._installBtn.textContent = "Install & restart";
    this._installBtn.addEventListener("click", () => this._onInstall?.());
    this._el.appendChild(this._installBtn);

    this._dismissBtn = document.createElement("button");
    this._dismissBtn.className = "update-banner__dismiss";
    this._dismissBtn.type = "button";
    this._dismissBtn.setAttribute("aria-label", "Dismiss update notice");
    this._dismissBtn.textContent = "Later";
    this._dismissBtn.addEventListener("click", () => {
      const v = this._version;
      this.hide();
      if (v) this._onDismiss?.(v);
    });
    this._el.appendChild(this._dismissBtn);
  }

  getElement(): HTMLElement {
    return this._el;
  }

  /** Register the "Install & restart" handler. */
  onInstall(cb: () => void): void {
    this._onInstall = cb;
  }

  /** Register the "Later" handler (receives the dismissed version). */
  onDismiss(cb: (version: string) => void): void {
    this._onDismiss = cb;
  }

  /** Reveal the banner for an available update. */
  show(info: UpdateInfo): void {
    this._version = info.version;
    this._text.textContent = `Update available — v${info.version}`;
    this._progress.textContent = "";
    this._installBtn.disabled = false;
    this._el.classList.add("update-banner--visible");
  }

  hide(): void {
    this._el.classList.remove("update-banner--visible");
  }

  /** Reflect download progress; `null` total shows an indeterminate state. */
  setProgress(downloaded: number, total: number | null): void {
    this._installBtn.disabled = true;
    if (total && total > 0) {
      const pct = Math.min(100, Math.round((downloaded / total) * 100));
      this._progress.textContent = `Downloading… ${pct}%`;
    } else {
      this._progress.textContent = "Downloading…";
    }
  }
}
```

- [ ] **Step 4: Add styles**

Append to `src/style/base.css`:

```css
/* ── Update banner (non-modal, top-center; hidden until an update is offered) ── */
.update-banner {
  position: fixed;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  display: none;
  align-items: center;
  gap: 0.75rem;
  padding: 0.4rem 0.9rem;
  background: var(--bg-elevated, #1a1a1a);
  color: var(--fg, #e0e0e0);
  border: 1px solid var(--border, #333);
  border-top: none;
  border-radius: 0 0 6px 6px;
  font-family: inherit;
  font-size: 0.85rem;
  z-index: 1000;
}
.update-banner--visible {
  display: flex;
}
.update-banner__text {
  white-space: nowrap;
}
.update-banner__progress:empty {
  display: none;
}
.update-banner__install,
.update-banner__dismiss {
  font-family: inherit;
  font-size: 0.8rem;
  padding: 0.15rem 0.6rem;
  border: 1px solid var(--border, #333);
  background: transparent;
  color: inherit;
  cursor: pointer;
  border-radius: 4px;
}
.update-banner__install {
  border-color: var(--accent, #5ec8f8);
  color: var(--accent, #5ec8f8);
}
.update-banner__install:disabled {
  opacity: 0.5;
  cursor: default;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/ui/UpdateBanner.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/ui/UpdateBanner.ts src/ui/UpdateBanner.test.ts src/style/base.css
git commit -m "feat(updater): UpdateBanner component + styles"
```

---

## Task 8: Mount banner, global state, deferred check + progress wiring

**Files:**
- Modify: `src/app/state.ts`
- Modify: `src/ui/App.ts`
- Create: `src/app/update_check.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Add the state field**

In `src/app/state.ts`, import the type at the top (with the other ipc type imports):

```ts
import type { UpdateInfo } from "../ipc/index.js";
```

In `AppStateSnapshot` (after `textSelectMode: TextSelectMode;`) add:

```ts
  /** Metadata for an available update, or null when none/up to date. */
  updateAvailable: UpdateInfo | null;
```

In the initial state object (where the snapshot is seeded with defaults — find where `textSelectMode` is initialised) add:

```ts
  updateAvailable: null,
```

- [ ] **Step 2: Instantiate + mount the banner**

In `src/ui/App.ts`:

(a) Import at the top with the other component imports:

```ts
import { UpdateBanner } from "./UpdateBanner.js";
```

(b) In `mountApp`, after `const statusBar = new StatusBar();` (line ~121):

```ts
  const updateBanner = new UpdateBanner();
```

(c) After `container.appendChild(statusBar.getElement());` (line ~301):

```ts
  // Update banner (fixed top-center, floats over content; hidden until offered)
  container.appendChild(updateBanner.getElement());
```

(d) In the `AppComponents` interface, after `statusBar: StatusBar;`:

```ts
  updateBanner: UpdateBanner;
```

(e) In the returned object, after `statusBar,`:

```ts
    updateBanner,
```

- [ ] **Step 3: Create the check orchestration**

Create `src/app/update_check.ts`:

```ts
// Startup + manual update-check orchestration. Reads the channel/auto_check
// prefs via the existing app-config IPC, drives the UpdateBanner, and remembers
// the last version the user dismissed so we don't re-nag for it.

import type { AppComponents } from "../ui/App.js";
import { AppState } from "./state.js";
import { getAppConfig, updateCheck } from "../ipc/index.js";
import { showError, showToast } from "../ui/NotificationToast.js";

let _lastDismissed: string | null = null;

/** Auto path: only checks when the user has auto_check enabled. Fire-and-forget. */
export async function maybeCheckForUpdates(components: AppComponents): Promise<void> {
  let autoCheck = true;
  try {
    autoCheck = (await getAppConfig()).updater.auto_check;
  } catch {
    return;
  }
  if (!autoCheck) return;
  await runUpdateCheck(components, false);
}

/**
 * Run a check. `manual` = triggered by `:update` (show "up to date"/errors and
 * re-show a previously dismissed version); auto runs are silent on no-op.
 */
export async function runUpdateCheck(components: AppComponents, manual: boolean): Promise<void> {
  try {
    const info = await updateCheck();
    if (info) {
      AppState.set("updateAvailable", info);
      if (manual || info.version !== _lastDismissed) {
        components.updateBanner.show(info);
      }
    } else if (manual) {
      showToast("You're on the latest version.", "info");
    }
  } catch (e) {
    if (manual) {
      showError(`Update check failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/** Record a dismissal so the auto path won't re-show this version. */
export function rememberDismissed(version: string): void {
  _lastDismissed = version;
}
```

- [ ] **Step 4: Wire banner callbacks, progress listener, and the deferred check in main.ts**

In `src/main.ts`:

(a) Add imports near the top:

```ts
import { maybeCheckForUpdates, runUpdateCheck, rememberDismissed } from "./app/update_check.js";
import { updateInstall } from "./ipc/index.js";
import { showError } from "./ui/NotificationToast.js";
```

(b) After `setComponents(components);` (line 44) add a one-time wiring block:

```ts
// ── Auto-update wiring ────────────────────────────────────────────────────────
components.updateBanner.onInstall(() => {
  void updateInstall().catch((e) => {
    showError(`Update failed: ${e instanceof Error ? e.message : String(e)}`);
  });
});
components.updateBanner.onDismiss((version) => rememberDismissed(version));

// Reflect download progress on the banner.
void import("@tauri-apps/api/event")
  .then((m) =>
    m.listen<{ chunk_length: number; content_length: number | null }>(
      "quark://update/progress",
      (e) => components.updateBanner.setProgress(e.payload.chunk_length, e.payload.content_length),
    ),
  )
  .catch(() => {
    /* not running under Tauri (browser dev) — no progress events */
  });
```

> The progress event reports per-chunk lengths; `setProgress` treats `content_length` as the total. If you prefer a cumulative percentage, accumulate `chunk_length` in the listener before calling `setProgress` — optional polish, not required.

(c) In the **session-restore** path, after `void startSync(components);` (line 80) add:

```ts
      // Background update check — deferred so it doesn't compete with first sync.
      setTimeout(() => void maybeCheckForUpdates(components), 4000);
```

(d) In the **login** path, after `void startSync(components);` (line 97) add the same line:

```ts
      setTimeout(() => void maybeCheckForUpdates(components), 4000);
```

- [ ] **Step 5: Verify build + full frontend test run**

Run: `pnpm build && pnpm test`
Expected: type-checks and all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/state.ts src/ui/App.ts src/app/update_check.ts src/main.ts
git commit -m "feat(updater): mount banner, wire deferred check + install + progress"
```

---

## Task 9: Settings UI — Updates section

**Files:**
- Modify: `src/ui/SettingsDialog.ts`

- [ ] **Step 1: Add the Updates section to the General tab**

In `src/ui/SettingsDialog.ts`, inside `_buildGeneralTab`, after the "Read receipts" section block (around line 261-275) and **before** the save-button `actions` block, add:

```ts
    section.appendChild(this._makeSectionTitle("Updates"));

    section.appendChild(this._makeSelectRow(
      "Release channel",
      draft.updater.channel,
      [
        ["stable", "Stable"],
        ["beta", "Beta (early releases)"],
      ],
      (v) => {
        if (v === "stable" || v === "beta") {
          draft = { ...draft, updater: { ...draft.updater, channel: v } };
        }
      },
    ));

    section.appendChild(this._makeCheckbox(
      "Check for updates automatically",
      draft.updater.auto_check,
      (v) => { draft = { ...draft, updater: { ...draft.updater, auto_check: v } }; },
    ));
```

> `draft` is a `structuredClone(cfg)`, so `draft.updater` already exists. The existing `_makeSaveButton` persists the whole `draft` via `setAppConfig` — no extra save logic needed.

- [ ] **Step 2: Verify build**

Run: `pnpm build`
Expected: type-checks cleanly.

- [ ] **Step 3: Commit**

```bash
git add src/ui/SettingsDialog.ts
git commit -m "feat(updater): add channel + auto-check controls to settings"
```

---

## Task 10: `:update` command

**Files:**
- Modify: `src/vim/commands.ts`
- Modify: `src/app/actions/commands.ts`

- [ ] **Step 1: Register the command name**

In `src/vim/commands.ts`, add `"update"` to the `KNOWN_COMMANDS` array (after `"version"`):

```ts
  "version",
  "update",
```

- [ ] **Step 2: Add the dispatch case**

In `src/app/actions/commands.ts`:

(a) Add the import near the top (with the other `./` action imports):

```ts
import { runUpdateCheck } from "../update_check.js";
```

(b) In the `executeCommand` switch, after the `case "version":` block (line ~171), add:

```ts
    case "update": {
      showToast("Checking for updates…", "info");
      await runUpdateCheck(getComponents(), true);
      break;
    }
```

> `getComponents()` is already imported from `./context.js`. `runUpdateCheck(..., true)` is the manual path: it shows "up to date", surfaces errors, and re-shows a dismissed banner; if an update is available the banner's "Install & restart" drives `update_install`.

- [ ] **Step 3: Verify build**

Run: `pnpm build`
Expected: type-checks cleanly.

- [ ] **Step 4: Manual smoke (mock mode)**

Run: `pnpm dev`, then in the app type `:update`.
Expected: a "Checking for updates…" toast followed by "You're on the latest version." (mock returns null).

- [ ] **Step 5: Commit**

```bash
git add src/vim/commands.ts src/app/actions/commands.ts
git commit -m "feat(updater): add :update command for manual checks"
```

---

## Task 11: Release pipeline — signing + per-channel feed

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Pass the signing env to tauri-action**

In the `build-tauri` job's "Build and upload Tauri bundles" step (around line 217), add the two signing vars to the existing `env:` block:

```yaml
      - name: Build and upload Tauri bundles
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          releaseId: ${{ needs.create-release.outputs.release_id }}
          tagName: ${{ needs.create-release.outputs.tag }}
```

- [ ] **Step 2: Add the publish-update-feed job**

Insert this job **before** `publish-release` (after the `build-android` job ends, around line 419):

```yaml
  # ─── Assemble + publish the per-channel update feed ─────────────────────────
  # Reads the signed updater artifacts' .sig files from the (draft) release,
  # builds latest.json per the Tauri static-manifest schema, and commits it to
  # docs/updates/<channel>/ on main (served by Pages at quark.tel). A final tag
  # (v1.2.3) updates BOTH stable and beta; a pre-release (v1.2.3-beta.N) updates
  # beta only. Commit carries [skip ci] so it doesn't bounce ci.yml.
  publish-update-feed:
    name: Publish update feed
    if: ${{ github.event_name == 'push' }}
    needs: [create-release, build-tauri]
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
        with:
          ref: main
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Assemble per-channel latest.json
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAG: ${{ needs.create-release.outputs.tag }}
          REPO: ${{ github.repository }}
        run: |
          set -euo pipefail
          VERSION="${TAG#v}"
          if [[ "$TAG" == *-beta.* ]]; then CHANNELS=(beta); else CHANNELS=(stable beta); fi

          workdir="$(mktemp -d)"
          # Pull only the small signature files from the draft release.
          gh release download "$TAG" --repo "$REPO" --dir "$workdir" --pattern '*.sig'

          assets="$(gh release view "$TAG" --repo "$REPO" --json assets --jq '.assets[].name')"
          pick() { printf '%s\n' "$assets" | grep -E "$1" | head -n1; }
          APPIMAGE="$(pick '\.AppImage$')"
          MACAPP="$(pick '\.app\.tar\.gz$')"
          NSIS="$(pick '\-setup\.exe$')"

          for f in "$APPIMAGE" "$MACAPP" "$NSIS"; do
            if [[ -z "$f" || ! -f "$workdir/${f}.sig" ]]; then
              echo "ERROR: missing artifact or signature for '$f' — is TAURI_SIGNING_PRIVATE_KEY set?" >&2
              exit 1
            fi
          done

          base="https://github.com/${REPO}/releases/download/${TAG}"
          jq -n \
            --arg version "$VERSION" \
            --arg date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
            --arg lin_url "$base/$APPIMAGE"  --arg lin_sig "$(cat "$workdir/${APPIMAGE}.sig")" \
            --arg mac_url "$base/$MACAPP"    --arg mac_sig "$(cat "$workdir/${MACAPP}.sig")" \
            --arg win_url "$base/$NSIS"      --arg win_sig "$(cat "$workdir/${NSIS}.sig")" \
            '{
               version: $version,
               pub_date: $date,
               platforms: {
                 "linux-x86_64":   { signature: $lin_sig, url: $lin_url },
                 "darwin-aarch64": { signature: $mac_sig, url: $mac_url },
                 "windows-x86_64": { signature: $win_sig, url: $win_url }
               }
             }' > /tmp/latest.json

          for ch in "${CHANNELS[@]}"; do
            mkdir -p "docs/updates/$ch"
            cp /tmp/latest.json "docs/updates/$ch/latest.json"
          done

      - name: Commit feed to main
        env:
          TAG: ${{ needs.create-release.outputs.tag }}
        run: |
          set -euo pipefail
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add docs/updates
          if git diff --cached --quiet; then
            echo "no feed changes to commit"
            exit 0
          fi
          git commit -m "chore(updates): publish ${TAG} update feed [skip ci]"
          git push origin main
```

- [ ] **Step 3: Gate publishing on the feed**

Update the `publish-release` job's `needs:` (line 424) to include the new job:

```yaml
    needs: [create-release, build-tauri, build-flatpak, build-android, publish-update-feed]
```

- [ ] **Step 4: Validate the workflow YAML**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml')); print('valid YAML')"`
Expected: `valid YAML`. (If `actionlint` is installed, run it too: `actionlint .github/workflows/release.yml`.)

- [ ] **Step 5: Add the GitHub secrets (one-time, maintainer)**

These must exist before the next `v*` tag, or the signed build fails:

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/quark-updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD   # paste the key password at the prompt
```

Verify: `gh secret list` shows both.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(updater): sign updater artifacts + publish per-channel feed to Pages"
```

---

## Task 12: Docs, version bump, and full verification

**Files:**
- Modify: `DESIGN.md`
- Version files (via version-bump skill)

- [ ] **Step 1: Document the feature in DESIGN.md**

Add an "Auto-update" section to `DESIGN.md` covering: the two channels (stable/beta) and how a release feeds them (final tag → both; `-beta.N` → beta only); the `[updater]` config keys (`channel`, `auto_check`); the `:update` command and `:set update_channel`/`auto_update`; the feed URLs (`https://quark.tel/updates/<channel>/latest.json`); and the platform scope (AppImage / macOS aarch64 / Windows NSIS; deb/rpm/Flatpak update via their own channels). Note macOS auto-update is best-effort until notarization is configured.

- [ ] **Step 2: Run the full test + build gate**

Run:
```bash
cd src-tauri && cargo test && cd ..
pnpm build && pnpm test
```
Expected: all Rust tests pass; frontend type-checks and all Vitest suites pass.

- [ ] **Step 3: Bump the version**

This branch adds a user-visible feature → **minor** bump. Use the version-bump skill (updates package.json, Cargo.toml, tauri.conf.json, README badge, Cargo.lock, iOS Info.plist in lockstep):

Invoke the `version-bump` skill (e.g. from `0.14.0` → `0.15.0`).

- [ ] **Step 4: Commit docs + version**

```bash
git add DESIGN.md package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json README.md src-tauri/gen/apple/*/Info.plist 2>/dev/null
git commit -m "docs(updater): document auto-update + bump version to 0.15.0"
```

- [ ] **Step 5: Final review checklist (before opening a PR)**

- [ ] Public key pasted into `tauri.conf.json` (`pubkey` is not the placeholder).
- [ ] `TAURI_SIGNING_PRIVATE_KEY` + `_PASSWORD` secrets added (`gh secret list`).
- [ ] Private key + password backed up offline.
- [ ] `cargo test` + `pnpm test` green.

---

## Self-Review notes (author)

- **Spec coverage:** channels (Task 2/11), Rust-driven endpoint switch (Task 2/3), notify+confirm UX (Task 7/8), config prefs via existing path (Task 1/6/9), `:update` (Task 10), Pages feed on `docs/updates/` (Task 11), signing (Task 4/11), macOS aarch64-only + best-effort caveat (Task 12 docs), AppImage-only Linux (Task 11 picks `.AppImage`). DESIGN.md updated (Task 12).
- **Simplification vs. spec:** the spec listed 5 commands; the plan uses **2** (`update_check`, `update_install`) because channel/auto_check ride the existing `get_app_config`/`set_app_config`. Reflected throughout.
- **Capability omitted on purpose:** the spec mentioned adding `updater:default` to `capabilities/default.json`. It's **not** in the plan because capabilities only gate webview→plugin `invoke()` calls, and we never call the updater plugin's JS commands — the updater is driven entirely from our own Rust commands (`app.updater_builder()`), which capabilities don't gate. Adding it would be dead config. If a future change calls the JS plugin directly, add `updater:default` then.
- **Verify-at-compile risks flagged inline:** `tauri_plugin_updater::Update` field names (Task 3 Step 3) and `app.restart()` (core Tauri v2 `AppHandle::restart`).
