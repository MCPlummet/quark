# Quark as a Nix package. Consumed by flake.nix (packages.<system>.quark and
# overlays.default) via callPackage; buildable standalone with
# `nix build .#quark`.
#
# Build shape: rustPlatform.buildRustPackage + nixpkgs' cargo-tauri.hook. The
# hook runs `cargo tauri build --bundles deb` (deb is the default bundle type
# on Linux) and its install phase copies the deb staging tree —
# usr/bin/quark, the generated .desktop file and hicolor icons — into $out.
# The frontend is built by tauri's beforeBuildCommand (`pnpm build`) against
# an offline pnpm store prepared by pnpmConfigHook.
{
  lib,
  rustPlatform,
  cargo-tauri,
  fetchPnpmDeps,
  nodejs_22,
  pnpm_10,
  pnpmConfigHook,
  pkg-config,
  wrapGAppsHook3,
  makeWrapper,
  desktop-file-utils,
  jq,
  moreutils,
  glib-networking,
  gsettings-desktop-schemas,
  gst_all_1,
  gtk3,
  librsvg,
  openssl,
  dbus,
  webkitgtk_4_1,
  xdg-utils,
}:

let
  manifest = lib.importJSON ../package.json;

  # Same workaround as flatpak/quark-launch.sh: WebKitGTK's DMABuf/GBM
  # renderer fails on the NVIDIA proprietary driver under Wayland, but
  # AMD/Intel should keep hardware acceleration — so gate the env var on the
  # active GPU instead of setting it unconditionally, and let an explicit
  # user value win.
  nvidiaDmabufWorkaround = ''
    if [ -z "''${WEBKIT_DISABLE_DMABUF_RENDERER+x}" ] && grep -qsi nvidia /sys/class/drm/*/device/uevent 2>/dev/null; then
      export WEBKIT_DISABLE_DMABUF_RENDERER=1
    fi
  '';
in
rustPlatform.buildRustPackage (finalAttrs: {
  pname = "quark";
  version = manifest.version;

  # Only what the build reads — README/docs/spec churn doesn't rebuild the app.
  # src-tauri/ is taken whole (Cargo.*, tauri.conf.json, icons, capabilities,
  # build.rs); target/ is untracked so the flake source never contains it.
  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../index.html
      ../package.json
      ../pnpm-lock.yaml
      ../tsconfig.json
      ../vite.config.ts
      ../src
      ../src-tauri
    ];
  };

  cargoLock.lockFile = ../src-tauri/Cargo.lock;
  cargoRoot = "src-tauri";
  buildAndTestSubdir = finalAttrs.cargoRoot;

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version;
    # The fetcher only reads the manifest + lockfile; narrowing its src keeps
    # unrelated source changes from re-running the (networked) fetch.
    src = lib.fileset.toSource {
      root = ../.;
      fileset = lib.fileset.unions [
        ../package.json
        ../pnpm-lock.yaml
      ];
    };
    pnpm = pnpm_10;
    fetcherVersion = 3;
    # After changing pnpm-lock.yaml: set to lib.fakeHash, rebuild, copy the
    # "got:" hash from the mismatch error.
    hash = "sha256-gInnhvLdGjk4JpM4yCeOuyLPSaTTbtt/3B9lWdkydGw=";
  };

  nativeBuildInputs = [
    cargo-tauri.hook
    nodejs_22
    pnpm_10
    pnpmConfigHook
    pkg-config
    wrapGAppsHook3
    makeWrapper # shell wrapper (wrapProgramShell) — supports --run, see postFixup
    desktop-file-utils
    jq
    moreutils
  ];

  buildInputs = [
    gtk3
    webkitgtk_4_1
    glib-networking # TLS GIO module for the webview
    gsettings-desktop-schemas # GTK file chooser aborts without schemas
    openssl # native-tls for matrix-sdk/reqwest
    dbus # keyring's Secret Service backend
    librsvg
  ]
  # Inline media playback in WebKitGTK (same set as the dev shell): VP8/VP9,
  # Matroska demuxing, H.264/AAC via FFmpeg. wrapGAppsHook3 forwards the
  # resulting GST_PLUGIN_SYSTEM_PATH_1_0 into the wrapper.
  ++ (with gst_all_1; [
    gstreamer
    gst-plugins-base
    gst-plugins-good
    gst-plugins-bad
    gst-libav
  ]);

  # A Nix-installed app can't self-update (read-only store), and updater
  # artifacts would want the signing key at bundle time.
  postPatch = ''
    jq '.bundle.createUpdaterArtifacts = false' src-tauri/tauri.conf.json \
      | sponge src-tauri/tauri.conf.json
  '';

  env.OPENSSL_NO_VENDOR = 1;

  # CI gates `pnpm test` + `cargo test` already; the sandbox lacks the D-Bus
  # session some backend tests expect.
  doCheck = false;

  # Tauri's generated .desktop entry is bare — align it with the curated one
  # shipped for flatpak (flatpak/tel.quark.app.desktop).
  postInstall = ''
    desktop-file-edit \
      --set-comment="A terminal-aesthetic Matrix client" \
      --set-key=Categories --set-value="Network;InstantMessaging;Chat;" \
      --set-key=Keywords --set-value="matrix;chat;messaging;im;" \
      --set-key=StartupWMClass --set-value=quark \
      $out/share/applications/*.desktop
  '';

  # wrapGAppsHook3 wraps with makeBinaryWrapper, which can't run the
  # conditional NVIDIA snippet (`--run` is shell-wrapper-only). So let the
  # hook only collect gappsWrapperArgs (GIO modules, gsettings schemas,
  # GST_PLUGIN_SYSTEM_PATH_1_0, tauri's asset:// gst plugin) and apply them
  # ourselves with the shell wrapper.
  dontWrapGApps = true;

  postFixup = ''
    wrapProgramShell $out/bin/quark \
      "''${gappsWrapperArgs[@]}" \
      --prefix PATH : ${lib.makeBinPath [ xdg-utils ]} \
      --run ${lib.escapeShellArg nvidiaDmabufWorkaround}
  '';

  meta = {
    description = manifest.description;
    homepage = manifest.homepage;
    license = lib.licenses.agpl3Plus;
    mainProgram = "quark";
    platforms = lib.platforms.linux;
  };
})
