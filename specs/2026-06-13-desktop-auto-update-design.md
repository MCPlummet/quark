# Desktop auto-update with stable/beta channels — Design

**Status:** Approved (2026-06-13)
**Scope:** Desktop only (Linux AppImage, macOS, Windows). Mobile and Flatpak out of scope.

> Spec lives in top-level `specs/` — **not** `docs/`, because `docs/` is the GitHub Pages
> publish root (`main` → `/docs`, served at quark.tel) and we don't want design docs on the
> public site.

## Goal

Let desktop users receive in-app updates with a **notify-and-confirm** UX, across two
release channels — **stable** and **beta** — built on the existing tag-triggered GitHub
release pipeline.

## Background / grounding

Verified against the Tauri v2 docs, `tauri-plugin-updater` 2.x, and `tauri-action`
(June 2026). The facts that shape this design:

- `bundle.createUpdaterArtifacts: true` makes the bundler emit the updatable artifact
  **plus a detached `.sig`** per platform:
  - Linux AppImage → `*.AppImage` + `*.AppImage.sig` (used directly; no tar.gz with `true`)
  - macOS → `*.app.tar.gz` + `*.app.tar.gz.sig`
  - Windows NSIS → `*-setup.exe` + `*-setup.exe.sig`
- The updater signature is **minisign/Ed25519**, generated from a Tauri-specific keypair,
  and is **independent of Apple notarization** — updates verify even on an unsigned macOS
  build (the replaced `.app` can still face Gatekeeper; see Risks).
- The updater endpoint supports placeholders `{{current_version}}`, `{{target}}`,
  `{{arch}}` — but there is **no `{{channel}}` placeholder**.
- The **JS `check()` API cannot override the endpoint URL** at runtime; only the Rust
  `app.updater_builder().endpoints(vec![Url])` can, and runtime endpoints **override** the
  config. ⇒ Channel switching must be **Rust-driven**.
- `latest.json` schema is fixed (the `url` fields point at the **GitHub Release** download;
  only this small JSON is hosted on Pages):
  ```json
  {
    "version": "0.15.0",
    "notes": "…",
    "pub_date": "2026-06-13T00:00:00Z",
    "platforms": {
      "linux-x86_64":   { "signature": "<contents of .AppImage.sig>",  "url": "https://github.com/mcplummet/quark/releases/download/v0.15.0/Quark_0.15.0_amd64.AppImage" },
      "darwin-aarch64": { "signature": "<contents of .app.tar.gz.sig>", "url": "https://github.com/mcplummet/quark/releases/download/v0.15.0/Quark_aarch64.app.tar.gz" },
      "windows-x86_64": { "signature": "<contents of -setup.exe.sig>",  "url": "https://github.com/mcplummet/quark/releases/download/v0.15.0/Quark_0.15.0_x64-setup.exe" }
    }
  }
  ```
  Platform keys are strict `{os}-{arch}` (`linux-x86_64`, `darwin-aarch64`, etc.).

## Chosen approach

**Static per-channel `latest.json` on the existing GitHub Pages site
(`main` → `/docs`, custom domain quark.tel) + runtime endpoint switching in Rust.**

Considered but rejected: (B) a dedicated `gh-pages` branch — would force migrating the
existing quark.tel site off `main`; (C) a dynamic update server (Cloudflare Worker) — more
flexible (rollouts, header channels) but a service to run; overkill now.

## Platform matrix

| Platform | Self-updating artifact | Not covered (update elsewhere) |
|---|---|---|
| Linux | AppImage (`*.AppImage` + `.sig`) | deb/rpm → package manager; **Flatpak → Flathub** |
| macOS | `*.app.tar.gz` + `.sig` (**Apple Silicon / `aarch64` only**) | Intel Macs → not covered |
| Windows | NSIS `*-setup.exe` + `.sig` | MSI kept for direct download only |

deb/rpm/MSI bundles continue to build for direct download; they're simply not wired into
the updater. Android and Flatpak are out of scope.

## Channel model

Driven entirely by **tag shape** on the existing `v*` pipeline:

- `vX.Y.Z` (final, no pre-release segment) → publishes to **both** `stable/latest.json`
  **and** `beta/latest.json`.
- `vX.Y.Z-beta.N` (SemVer pre-release) → publishes to **`beta/latest.json` only**.

So a **stable** user only ever sees finalized versions; a **beta** user always rides the
newest of *either* type. SemVer ordering (`0.15.0-beta.3 < 0.15.0`) means beta testers roll
cleanly forward onto a final release when it ships.

**No auto-downgrade:** switching beta→stable does not downgrade an already-newer install; it
takes effect once stable ≥ the installed version. (The updater rejects downgrades by
default; we keep that.)

## Architecture

```
Frontend (UpdateBanner, :update command, settings toggle)
   │  invoke (Tauri IPC)
   ▼
commands.rs:  update_check / update_install / update_get_prefs
              / update_set_channel / update_set_auto_check
   │
   ▼
updater.rs:   channel → endpoint URL
              app.updater_builder().endpoints(vec![url]).build().check()
              stash pending Update in managed state
              install: update.download_and_install(progress…) → app.restart()
   │  https
   ▼
quark.tel (Pages, main:/docs):  /updates/stable/latest.json   /updates/beta/latest.json
   (binaries themselves stay on GitHub Releases; Pages hosts only the small JSON)
```

We deliberately **do not** use the `@tauri-apps/plugin-updater` JS API (it can't switch
endpoints) — no new npm dependency. All update logic is Rust, surfaced through our own IPC
commands following the existing `commands.rs → ipc/index.ts → ipc/mock.ts` contract.

## Components

### Rust

- **`src-tauri/src/updater.rs`** (new):
  - `UpdateChannel { Stable, Beta }`; channel → endpoint URL
    (`https://quark.tel/updates/<channel>/latest.json`).
  - `check(app, channel) -> Option<UpdateMeta { version, notes, pub_date }>`: builds the
    updater with the channel endpoint, runs `check()`, stashes the resulting `Update` in
    managed state, returns metadata to the frontend.
  - `install(app)`: takes the stashed `Update`, runs `download_and_install` emitting
    `update://progress` Tauri events, then `app.restart()`.
  - Managed state `UpdaterState { pending: tokio::Mutex<Option<Update>> }`.
- **`commands.rs`**: `update_check`, `update_install`, `update_get_prefs`,
  `update_set_channel`, `update_set_auto_check`. Registered in `lib.rs`. Plugin init
  `tauri_plugin_updater::Builder::new().build()`.
- **Config**: new `[updater]` section on `config::app_config::AppConfig`:
  - `channel: UpdateChannel` (default `stable`)
  - `auto_check: bool` (default `true`)

  Loaded in `.setup()` exactly like the other sections; persisted to the existing
  `config.toml`. No separate file.
- **`Cargo.toml`**: add `tauri-plugin-updater = "2"`.
- **Relaunch**: use core `AppHandle::restart()` from Rust — no `tauri-plugin-process`
  needed. Capability: add `updater:default` to `capabilities/default.json` (harmless even
  though we drive from Rust; keeps the door open for JS calls).

### Frontend

- **IPC**: wrappers in `ipc/index.ts`; types in `ipc/types.ts` (`UpdateChannel`,
  `UpdateInfo`, `UpdatePrefs`); mocks in `ipc/mock.ts`.
- **UI**: `UpdateBanner` — terminal-aesthetic, dismissible, `[Install & restart] [Later]`,
  with a progress line during download (driven by `update://progress`). A channel toggle in
  the settings surface.
- **Command**: `:update` in `vim/commands.ts` (manual check / install);
  `:set update-channel beta|stable`.
- **Startup hook**: a deferred, non-blocking `update_check` after sync starts, only when
  `auto_check` is on. Remembers the last-dismissed version so it doesn't re-nag.

## Update UX flow (notify + confirm)

1. Launch → sync starts → a few seconds later, background `update_check(channel)`.
2. Update available → banner: `update available — v0.15.0 · [Install & restart] [Later]`.
3. "Install & restart" → `update_install` streams progress → applies → `app.restart()`.
4. "Later" → dismissed for that version; still reachable via `:update`.

## CI / release pipeline changes

- **`tauri.conf.json`**:
  - `bundle.createUpdaterArtifacts: true`
  - `plugins.updater.pubkey: "<base64 public key>"`
  - `plugins.updater.endpoints: ["https://quark.tel/updates/stable/latest.json"]`
    (fallback only; the Rust runtime endpoint overrides per channel)
  - `plugins.updater.windows.installMode: "passive"`
- **`release.yml`**:
  - Pass `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (new repo
    secrets) into the `tauri-action` step so the bundler signs and emits `.sig` files.
  - macOS stays on the existing `macos-latest` runner (Apple Silicon) — no special target.
    It produces the `aarch64` `*.app.tar.gz` + `.sig`, listed under `darwin-aarch64` only.
    Intel Macs are not targeted (the only mac-side change is the global updater-artifact +
    signing flags).
  - **New job `publish-update-feed`** (after the desktop build job; uses
    `needs: [create-release, build-tauri]`): determines the channel from the tag
    (`-beta.` pre-release ⇒ beta only; else both stable+beta), downloads only the `.sig`
    assets from the release, reads their contents + the artifacts' release download URLs,
    assembles each `latest.json`, then commits `docs/updates/<channel>/latest.json` to
    **main** with a `[skip ci]` message (main is unprotected; default `GITHUB_TOKEN` with
    `contents: write` can push). Pages rebuilds and serves it ~a minute later. The commit
    only **adds** under `docs/updates/`; it never touches the existing site or CNAME config.
- **Jekyll note**: legacy Pages runs Jekyll, which copies `.json` static files through
  verbatim, so `docs/updates/**/latest.json` serves as-is. If we ever want to bypass Jekyll
  entirely, add `docs/.nojekyll` — but only once we're sure no Jekyll-templated landing
  site depends on it (currently `/docs` is empty).
- **One-time**: add the two signing secrets. (Pages already enabled; no gh-pages branch.)

## Signing key (one-time, owner-held)

```bash
pnpm tauri signer generate -w ~/.tauri/quark-updater.key   # run in your OWN terminal, not via `!`
```

- Public key → `tauri.conf.json` `plugins.updater.pubkey`.
- Private key → GitHub secret `TAURI_SIGNING_PRIVATE_KEY`
  (`gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/quark-updater.key`).
- Password → GitHub secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- **Back up the private key + password offline.** Loss = no future updates to installed
  clients (forced reinstall only). This is the single irreversible piece.

## Risks / known limitations

- **macOS is currently unsigned/un-notarized.** The updater's own signature verifies, but
  the replaced `.app` can hit Gatekeeper quarantine, and there are known mac updater edge
  cases (non-relocatable bundles, cross-device link). macOS auto-update therefore ships as
  **best-effort**, becoming reliable once Apple notarization secrets (already supported by
  the pipeline) are configured. Documented, not blocking.
- **Arch coverage:** Linux/Windows are x86_64-only; macOS is Apple-Silicon-only
  (`aarch64`). Intel Macs and ARM Windows/Linux are not covered.
- **Pages rebuild latency:** the JSON goes live a minute or two after a release publishes
  (binaries are instant on Releases). Acceptable.
- No downgrade across channel switch (intentional).

## Testing

- Rust unit tests: tag→channel routing, endpoint URL construction, `[updater]` prefs
  (de)serialization, `latest.json` assembly.
- Frontend (Vitest): `UpdateBanner` render/dismiss, `:update` command, mock IPC update flow.
- Manual: a throwaway scratch tag to exercise a real download+apply on Linux AppImage (most
  reliable platform) before trusting the flow.

## Out of scope (future)

Delta updates, staged/percentage rollouts, in-app changelog rendering, Flatpak/Android
auto-update, ARM Windows/Linux, Intel/universal macOS builds.

## Docs

`DESIGN.md` gains an "Auto-update" section (channels, the `[updater]` config keys, the
`:update` command, the quark.tel feed URLs) as part of implementation.
