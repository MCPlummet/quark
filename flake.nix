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

        # The installable package (nix/package.nix). Built with nixpkgs'
        # stock rustPlatform — rust-overlay is only for the dev shell.
        quark = pkgs.callPackage ./nix/package.nix { };

        # Rust toolchain — stable + wasm target for Tauri bundler
        rustToolchain = pkgs.rust-bin.stable.latest.default.override {
          extensions = [ "rust-src" "rust-analyzer" "clippy" "rustfmt" ];
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
