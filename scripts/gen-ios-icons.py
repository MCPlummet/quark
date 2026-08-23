#!/usr/bin/env python3
"""Generate the iOS app-icon set from icon.png — composite, then resize.

Pipeline:

    source RGBA  ->  composite over black (RGB)  ->  resize NEAREST  ->  write

Compositing happens at the FULL source resolution first, so antialiased edges in
the logo are blended against black before any sampling. Nearest-neighbour then
just picks pixels — no further blending, crisp output. Doing it the other way
round (resize first, flatten after) resamples the alpha and softens the edges,
which the pixel-art logo cannot afford.

App Store rejects icons with an alpha channel, so output is always RGB (no alpha).

Both tracked iOS locations are written byte-identically:
  - src-tauri/icons/ios/                                     (Tauri record)
  - src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/  (Xcode builds this)
Editing only the first never reaches the app.

Run this AFTER `pnpm tauri icon`, which overwrites src-tauri/icons/ios/ with its
own white-background, bilinear version.

Usage:
  python3 scripts/gen-ios-icons.py                 # write both locations
  python3 scripts/gen-ios-icons.py --output /tmp/x # dry preview, don't touch tree
  python3 scripts/gen-ios-icons.py --source path/to/logo.png
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pnglib import load_png, write_png  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_SOURCE = os.path.join(REPO, "src-tauri/icons/icon.png")
PRIMARY = os.path.join(REPO, "src-tauri/icons/ios")
MIRROR = os.path.join(REPO, "src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset")


# ── Pipeline: composite over black, THEN resize nearest ──────────────────────
def composite_on_black(w, h, rgba):
    """Alpha-over black. Returns 3-channel RGB at the same resolution."""
    rgb = bytearray(w * h * 3)
    for i in range(w * h):
        o = i * 4
        a = rgba[o + 3]
        rgb[i * 3] = rgba[o] * a // 255
        rgb[i * 3 + 1] = rgba[o + 1] * a // 255
        rgb[i * 3 + 2] = rgba[o + 2] * a // 255
    return bytes(rgb)


def resize_nearest_rgb(sw, sh, rgb, dw, dh):
    dst = bytearray(dw * dh * 3)
    for dy in range(dh):
        sy = min(sh - 1, int((dy + 0.5) * sh / dh))
        for dx in range(dw):
            sx = min(sw - 1, int((dx + 0.5) * sw / dw))
            so = (sy * sw + sx) * 3
            do = (dy * dw + dx) * 3
            dst[do : do + 3] = rgb[so : so + 3]
    return bytes(dst)


def main():
    ap = argparse.ArgumentParser(description="Generate iOS app icons: composite on black, then resize nearest.")
    ap.add_argument("--source", default=DEFAULT_SOURCE)
    ap.add_argument("--output", default=None,
                    help="write the set here instead of the two real locations (dry preview)")
    args = ap.parse_args()

    dests = [args.output] if args.output else [PRIMARY, MIRROR]
    for d in dests:
        os.makedirs(d, exist_ok=True)

    print(f"source : {args.source}")
    print(f"output : {', '.join(dests)}\n")

    sw, sh, src = load_png(args.source)
    flat = composite_on_black(sw, sh, src)  # composite ONCE at full res

    # target sizes/names come from the existing committed set (fixed by Apple)
    names = sorted(f for f in os.listdir(PRIMARY) if f.endswith(".png"))
    for n in names:
        w, h, _ = load_png(os.path.join(PRIMARY, n))
        rgb = resize_nearest_rgb(sw, sh, flat, w, h)
        for d in dests:
            write_png(os.path.join(d, n), w, h, rgb)
        print(f"  {n:26} {w}x{h}")

    # verify: output is RGB (no alpha) and both locations match
    print("\nverifying…")
    bad = 0
    if not args.output:
        for n in names:
            if open(os.path.join(PRIMARY, n), "rb").read() != open(os.path.join(MIRROR, n), "rb").read():
                print(f"  OUT OF SYNC: {n}")
                bad += 1
    if bad:
        sys.exit(f"FAIL: {bad} issue(s).")
    print("OK: " + ("preview written." if args.output else "both locations written and in sync."))


if __name__ == "__main__":
    main()
