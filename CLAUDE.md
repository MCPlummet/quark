# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Instructions
`DESIGN.md` is the spec/reference (architecture, UI, Matrix feature support, `quarkrc` + theming syntax, config files). Keep it current when behaviour or config changes. Track work — bugs, features, release QA — in GitHub issues, not in repo files.
When starting on a feature, always create a new git branch if currently on main unless otherwise instructed.
Commit changes as you go when on a feature branch.

Do not assume that existing patterns should always be extended. If something is scaling up and needs more
infrastructure, do not be afraid to propose more abstraction or layers of indirection. Example: you are
adding a panel to the UI and modifying the input manager. You notice that the input manager contains a
switchyard for each navigation key. This worked fine for one or two panels but will grow cumbersome to
maintain as complexity grows. You should propose to add a layer of abstraction to avoid repeated switchyards.

## Versioning

Bump the version **once per branch, when prepping it for merge** — not eagerly mid-feature (per-commit bumps churn the version files and cause cross-file drift). Use the `version-bump` skill, which updates every file that carries the version in lockstep (package.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json, the README badge, the Cargo.lock `quark` entry, the iOS Info.plist, and src-tauri/gen/apple/project.yml — the xcodegen manifest, whose `CFBundleShortVersionString`/`CFBundleVersion` stamp the iOS app) and refuses to run if they're already out of sync.

Rules:
- **Feature** (new user-visible behaviour) → bump **minor** version (e.g. `0.1.0` → `0.2.0`)
- **Bug fix** (corrects existing behaviour without adding features) → bump **patch** version (e.g. `0.1.0` → `0.1.1`)
- If a branch mixes features and fixes, bump to the highest level any commit warrants (one feature ⇒ minor).

## Commands

```bash
pnpm dev          # Vite dev server (port 1450) — frontend only, mock IPC
pnpm build        # tsc + vite build → dist/
pnpm test         # Vitest (single run)
pnpm test:watch   # Vitest (watch mode)
pnpm tauri dev    # Full Tauri app (Rust + frontend, hot-reload)
pnpm tauri build  # Release build (.app / .msi / .deb)
```

Run a single test file: `pnpm test src/ui/Input.test.ts`

Rust backend: `cargo build` / `cargo test` from `src-tauri/`.

**Android** needs a second dev shell — the SDK is a ~2 GB unfree download the
desktop shell has no use for:

```bash
nix develop .#android           # SDK + NDK (pinned to CI's) + JDK 17 + Rust android targets
pnpm tauri android dev          # or: pnpm tauri android build --debug

nix develop .#android-emulator  # the above plus an x86_64 emulator (~800 MB more)
quark-create-avd                # then: emulator -avd quark -gpu swiftshader_indirect
```

The emulator image is API 35 `default` (Google-free) while the build compiles
against 36 — Google publishes no `default` image for 36, and an F-Droid,
UnifiedPush-only app should not be tested on one carrying Play services. API 35
still covers everything push depends on: `shortService` + `onTimeout` (34+),
background foreground-service limits (12+), notification permission (13+).

The default shell carries `adb` alone, which is enough to drive an already
installed build (`adb logcat -s quark`). Don't enter both shells at once — two
`adb` clients on PATH keep restarting each other's server.

**CI** (GitHub Actions): `.github/workflows/ci.yml` gates PRs and `main` with `pnpm test` + `cargo test` (hard) and `clippy` (advisory); `release.yml` builds platform installers on `v*` tags.

## Architecture

Quark is a **Tauri v2 Matrix client** (desktop, plus experimental iOS/Android builds) with a terminal aesthetic and vim-style navigation.

```
Frontend (TypeScript/Vanilla DOM)
    ↕  Tauri IPC (invoke/event)
Rust backend (matrix-sdk 0.9)
```

**Why no React/Vue**: DOM-based components keep the terminal feel without framework overhead. UI components are plain TS classes that manipulate the DOM directly.

**Why Tauri over Electron**: ~10x smaller binary; Rust matrix-sdk gives best-in-class E2EE and Sliding Sync.

**Why not a true TUI**: Custom emoji/stickers must render inline as images — impossible without a browser renderer.

### Frontend (`src/`)

- `main.ts` — bootstrap, login wiring, sync startup
- `app/actions.ts` — IPC dispatcher (all user-initiated operations)
- `app/state.ts` — global app state
- `app/keyboard.ts` — keyboard event routing
- `app/sync.ts` — sync polling loop
- `ipc/` — Tauri invoke wrappers (`index.ts`), shared types (`types.ts`), mock layer (`mock.ts`), toggle (`invoke.ts`)
- `ui/` — DOM components (Timeline, Input, RoomList, SpaceStrip, pickers, modals)
- `vim/` — vim mode state machine (`mode.ts`), keymap resolution (`keybindings.ts`), `:` command parser (`commands.ts`)
- `theme/` — CSS custom property loader; `style/base.css` for monospace terminal base

**Mock/browser dev mode**: `pnpm dev` runs with mock IPC (no Rust process needed). Toggle with `ipc/invoke.ts` `FORCE_MOCK` flag.

### Rust Backend (`src-tauri/src/`)

- `lib.rs` — Tauri builder, plugin init, managed state (`MatrixState`, `CacheState`, `NotificationConfig`)
- `commands.rs` — all `#[tauri::command]` handlers (IPC surface)
- `matrix/` — protocol implementation: `client.rs` (login/sync/session), `timeline.rs` (messages/edits/redactions), `rooms.rs`, `crypto.rs` (E2EE/verification), `emoji.rs` (MSC2545), `stickers.rs`, `reactions.rs`, `spaces.rs`, `threads.rs`, `media.rs`
- `media_cache.rs` — disk-based LRU cache (200MB default)
- `notifications.rs` — system notifications with room muting and privacy flags
- `config/` — TOML theme parser, vimrc-style keybinding parser
- `gif/` — Tenor, Giphy & Klipy API integration

### IPC Contract

Types shared between frontend and backend live in `src/ipc/types.ts`. When adding a new Tauri command: define the handler in `commands.rs`, register it in `lib.rs`, add the invoke wrapper in `src/ipc/index.ts`, add a mock in `src/ipc/mock.ts`, and update types if needed.

## Design Spec

`DESIGN.md` is the authoritative spec — covers UI layout, vim keybinding config syntax (`quarkrc`), Matrix feature support, theming (TOML structure), and config files. Read it before implementing new features.
