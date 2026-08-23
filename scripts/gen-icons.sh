#!/usr/bin/env bash
# Regenerate every app icon from the native 32x32 art. One command, right order.
#
#   src-tauri/icons/quarklogo32.png          <- the only hand-edited file
#     -> icon.png                (master, 81.25% content)
#     -> android-foreground.png  (62.5% content, fits Android's 66.67% safe zone)
#     -> `tauri icon`            (desktop, Windows tiles, Android mipmaps, iOS)
#     -> gen-ios-icons.py        (iOS, black-composited, nearest, no alpha)
#
# Two things about `tauri icon` drive the ordering here:
#   * It REWRITES icon.png with a bilinear resample of its own input, softening
#     the pixel grid — so the master is regenerated afterwards to restore it.
#     Without that, every run degrades the master a little more.
#   * Because src-tauri/gen/{android,apple} exist, it writes the mobile icons
#     STRAIGHT INTO THE GEN TREES and never touches src-tauri/icons/{android,ios}.
#     So icons/android/ is refreshed FROM the gen tree (not the other way round —
#     copying icons/android/ into gen/ overwrites the icons tauri just generated
#     with stale ones), and gen-ios-icons.py runs last to replace tauri's
#     white-background bilinear iOS set in both iOS locations.
#
# Padding is set by the two scale factors below (see gen-master-icon.py).
set -euo pipefail

MASTER_SCALE=13   # 13*32 = 416 of 512 = 81.25% content
FG_SCALE=10       # 10*32 = 320 of 512 = 62.50% content

cd "$(dirname "$0")/.."
ICONS=src-tauri/icons

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

step "1/5  master + Android foreground (from ${ICONS}/quarklogo32.png)"
python3 scripts/gen-master-icon.py --scale "$MASTER_SCALE" --output "$ICONS/icon.png"
python3 scripts/gen-master-icon.py --scale "$FG_SCALE"     --output "$ICONS/android-foreground.png"

step "2/5  tauri icon (desktop, Windows tiles, Android, iOS)"
pnpm tauri icon "$ICONS/app-icon.json"

step "3/5  restore the master that tauri icon just resampled"
python3 scripts/gen-master-icon.py --scale "$MASTER_SCALE" --output "$ICONS/icon.png"

step "4/5  refresh the icons/android record from the gen tree"
# tauri icon wrote the real Android mipmaps into gen/android; mirror them back
# into src-tauri/icons/android/, which is the tracked record of that output.
RES=src-tauri/gen/android/app/src/main/res
for d in mipmap-hdpi mipmap-mdpi mipmap-xhdpi mipmap-xxhdpi mipmap-xxxhdpi mipmap-anydpi-v26; do
  cp -R "$RES/$d/." "$ICONS/android/$d/"
done
cp "$RES/values/ic_launcher_background.xml" "$ICONS/android/values/"
echo "  copied $RES/ -> $ICONS/android/"

step "5/5  iOS set (must be last — step 2 overwrote it)"
python3 scripts/gen-ios-icons.py

step "verify"
fail=0
for d in mipmap-hdpi mipmap-mdpi mipmap-xhdpi mipmap-xxhdpi mipmap-xxxhdpi mipmap-anydpi-v26; do
  diff -rq "$ICONS/android/$d" "src-tauri/gen/android/app/src/main/res/$d" || fail=1
done
diff -rq "$ICONS/ios" src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset \
  --exclude=Contents.json || fail=1
if [ "$fail" -ne 0 ]; then echo "FAIL: tracked icon locations are out of sync." >&2; exit 1; fi
echo "  Android and iOS gen trees are in sync."
echo
echo "Done. Review with: git status --short src-tauri/icons src-tauri/gen"
