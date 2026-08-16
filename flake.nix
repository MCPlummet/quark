{
  description = "Quark — a terminal-aesthetic Matrix client (Tauri v2)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, rust-overlay, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        overlays = [ (import rust-overlay) ];
        pkgs = import nixpkgs { inherit system overlays; };

        # ── Android toolchain ────────────────────────────────────────────────
        #
        # A second nixpkgs import, because the Android SDK is unfree and needs
        # its licence accepted. Keeping that config off the main `pkgs` means
        # the desktop package and dev shell are never silently built with
        # unfree allowed — you opt in by entering `nix develop .#android`.
        androidPkgs = import nixpkgs {
          inherit system;
          config = {
            allowUnfree = true;
            android_sdk.accept_license = true;
          };
        };

        # Pinned to exactly what .github/workflows/release.yml installs. A local
        # build that used a different NDK would be a different build — and the
        # Android APK is only ever built by CI at release-tag time, so a local
        # success proving nothing about the release is the failure mode to avoid.
        androidNdkVersion = "26.1.10909125";
        # compileSdk/targetSdk in gen/android/app/build.gradle.kts. Gradle would
        # normally download a missing platform itself; under Nix the SDK is
        # read-only, so anything the build needs has to be composed in here.
        androidPlatformVersion = "36";
        androidBuildToolsVersion = "36.0.0";

        androidComposition = androidPkgs.androidenv.composeAndroidPackages {
          platformVersions = [ androidPlatformVersion "34" ];
          buildToolsVersions = [ androidBuildToolsVersion "34.0.0" ];
          ndkVersions = [ androidNdkVersion ];
          includeNDK = true;
          includeEmulator = false;
          includeSystemImages = false;
        };
        androidSdkRoot = "${androidComposition.androidsdk}/libexec/android-sdk";

        # The installable package (nix/package.nix). Built with nixpkgs'
        # stock rustPlatform — rust-overlay is only for the dev shell.
        quark = pkgs.callPackage ./nix/package.nix { };

        # Rust toolchain — stable + wasm target for Tauri bundler
        rustToolchain = pkgs.rust-bin.stable.latest.default.override {
          extensions = [ "rust-src" "rust-analyzer" "clippy" "rustfmt" ];
        };

        # Same, plus the Android cross targets. Separate so the desktop shell
        # doesn't carry four extra rust-std copies. arm64 is what ships; the
        # x86_64 target is what an emulator needs, and the armv7/x86 pair are
        # there because `tauri android build` targets all four unless told
        # otherwise, and a missing std shows up as a confusing linker error.
        rustToolchainAndroid = rustToolchain.override {
          targets = [
            "aarch64-linux-android"
            "armv7-linux-androideabi"
            "i686-linux-android"
            "x86_64-linux-android"
          ];
        };

        # Tauri v2 Linux system dependencies
        tauriDeps = with pkgs; [
          webkitgtk_4_1
          gtk3
          glib
          glib-networking
          libayatana-appindicator
          librsvg
          openssl
          pkg-config
          patchelf
          sqlite

          # X11 / clipboard / notifications
          xdotool
          xorg.libxcb
          libnotify
          dbus
          fuse

          # GStreamer — required by WebKitGTK for inline video/audio playback
          gst_all_1.gstreamer
          gst_all_1.gst-plugins-base   # appsink, audioconvert, videoscale
          gst_all_1.gst-plugins-good   # autoaudiosink, VP8/VP9
          gst_all_1.gst-plugins-bad    # extra demuxers/parsers (Matroska/.mkv, etc.)
          gst_all_1.gst-libav          # H.264/H.265/AAC via FFmpeg

          # xdg-utils — lets the app open files in the system default player
          xdg-utils
        ];

        # Minimal appimagetool replacement using nixpkgs mksquashfs.
        # The bundled appimagetool inside linuxdeploy-plugin-appimage.AppImage uses
        # a hardcoded ELF interpreter path that doesn't exist on NixOS, so we provide
        # our own. linuxdeploy-plugin-appimage respects the APPIMAGETOOL env var.
        fakeAppimagetool = pkgs.writeShellScript "appimagetool" ''
          set -e
          RUNTIME="$HOME/.cache/tauri/AppRun-x86_64"
          APPDIR="" OUTPUT="" COMP="gzip"
          while [[ $# -gt 0 ]]; do
            case "$1" in
              -n|--no-appstream) shift ;;
              --comp) COMP="$2"; shift 2 ;;
              -*) shift ;;
              *) [[ -z "$APPDIR" ]] && APPDIR="$1" || OUTPUT="$1"; shift ;;
            esac
          done
          [[ -z "$OUTPUT" ]] && OUTPUT="$(basename "$APPDIR" .AppDir)-x86_64.AppImage"
          TMP="$(mktemp).squashfs"
          mksquashfs "$APPDIR" "$TMP" -root-owned -noappend -comp "$COMP" -no-xattrs -noI -noX 2>/dev/null \
            || mksquashfs "$APPDIR" "$TMP" -root-owned -noappend -comp "$COMP"
          cat "$RUNTIME" "$TMP" > "$OUTPUT"
          chmod +x "$OUTPUT"
          rm -f "$TMP"
        '';

        nativeBuildInputs = with pkgs; [
          rustToolchain
          nodejs_22
          nodePackages.pnpm
          cargo-tauri
          pkg-config
          squashfsTools  # provides mksquashfs for fakeAppimagetool

          # Flatpak packaging
          flatpak-builder
          appstream  # provides appstreamcli for metainfo validation

          # adb / fastboot, for driving a connected phone: `adb logcat -s quark`,
          # `adb install`, and the PushDebugReceiver broadcast that exercises the
          # push cold path. Small, and useful without the whole SDK — building an
          # APK needs `nix develop .#android` instead, which brings its own adb
          # from platform-tools (don't enter both shells, or the two adb clients
          # will fight over the server).
          android-tools
        ];

        buildInputs = tauriDeps;
      in
      {
        packages = {
          inherit quark;
          default = quark;
        };

        devShells.default = pkgs.mkShell {
          inherit nativeBuildInputs buildInputs;

          # Required so pkg-config and dynamic linker can find system libs
          shellHook = ''
            export PKG_CONFIG_PATH="${pkgs.lib.makeSearchPathOutput "dev" "lib/pkgconfig" buildInputs}:$PKG_CONFIG_PATH"
            export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath buildInputs}:$LD_LIBRARY_PATH"
            export GIO_MODULE_DIR="${pkgs.glib-networking}/lib/gio/modules"
            export WEBKIT_DISABLE_COMPOSITING_MODE=1
            # GSettings schemas — WebKitGTK's `<input type=file>` chooser (and any
            # GTK file dialog) abort with "No GSettings schemas are installed"
            # without these. A bare nix dev shell doesn't inherit the host's
            # schema path, so add GTK's plus the desktop schemas explicitly.
            export XDG_DATA_DIRS="${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}:${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:$XDG_DATA_DIRS"
            # GStreamer plugin paths — WebKitGTK won't find them on NixOS without this
            export GST_PLUGIN_SYSTEM_PATH="${pkgs.lib.makeSearchPathOutput "lib" "lib/gstreamer-1.0" (with pkgs.gst_all_1; [
              gstreamer gst-plugins-base gst-plugins-good gst-plugins-bad gst-libav
            ])}"
            # Override the bundled appimagetool (NixOS-incompatible ELF interpreter)
            # with our mksquashfs-based wrapper. Also tell linuxdeploy itself to
            # extract-and-run rather than mount via FUSE.
            export APPIMAGETOOL="${fakeAppimagetool}"
            export APPIMAGE_EXTRACT_AND_RUN=1
          '';
        };

        # Everything the default shell has, plus the Android SDK/NDK and a JDK.
        #
        #   nix develop .#android
        #   pnpm tauri android dev        # or `android build --debug`
        #
        # Kept separate because the SDK is a multi-gigabyte unfree download that
        # desktop work has no use for.
        devShells.android = pkgs.mkShell {
          nativeBuildInputs =
            # The SDK ships its own adb under platform-tools; two adb clients on
            # PATH restart each other's server on every version mismatch, so the
            # default shell's `android-tools` is dropped here rather than added to.
            (pkgs.lib.remove pkgs.android-tools
              (pkgs.lib.remove rustToolchain nativeBuildInputs))
            ++ [
              rustToolchainAndroid
              androidComposition.androidsdk
              # AGP 8.x requires 17; a newer JDK fails with an obscure Gradle
              # toolchain error rather than a version complaint.
              pkgs.jdk17
            ];
          buildInputs = buildInputs;

          shellHook = ''
            export PKG_CONFIG_PATH="${pkgs.lib.makeSearchPathOutput "dev" "lib/pkgconfig" buildInputs}:$PKG_CONFIG_PATH"
            export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath buildInputs}:$LD_LIBRARY_PATH"

            export ANDROID_HOME="${androidSdkRoot}"
            export ANDROID_SDK_ROOT="$ANDROID_HOME"
            export JAVA_HOME="${pkgs.jdk17}"
            # `tauri android` reads NDK_HOME; cargo needs it to find the
            # cross-linkers for aarch64-linux-android.
            export NDK_HOME="$ANDROID_HOME/ndk/${androidNdkVersion}"
            if [ ! -d "$NDK_HOME" ]; then
              echo "warning: NDK not at $NDK_HOME — the composed SDK layout changed" >&2
            fi
            export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/build-tools/${androidBuildToolsVersion}:$PATH"

            # AGP downloads aapt2 from Maven as a prebuilt ELF that assumes a
            # standard dynamic loader, so it dies on NixOS. Point it at the one
            # in the composed build-tools, which is already patched.
            export GRADLE_OPTS="-Dorg.gradle.project.android.aapt2FromMavenOverride=$ANDROID_HOME/build-tools/${androidBuildToolsVersion}/aapt2 $GRADLE_OPTS"
            # Gradle writes into the SDK dir for licences and caches; the Nix
            # store is read-only, so give it somewhere of its own.
            export GRADLE_USER_HOME="''${GRADLE_USER_HOME:-$HOME/.gradle}"
          '';
        };
      }
    )
    // {
      # For host flakes that prefer `pkgs.quark` over
      # `inputs.quark.packages.<system>.default`.
      overlays.default = final: prev: {
        quark = final.callPackage ./nix/package.nix { };
      };
    };
}
