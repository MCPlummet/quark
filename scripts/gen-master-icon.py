#!/usr/bin/env python3
"""Build src-tauri/icons/icon.png — the padded master every other icon derives from.

The logo is pixel art: quarklogo32.png is the real artwork at its native 32x32
grid, and the 512x512 master is just that grid blown up. So padding is applied
HERE, at the native grid, by integer-upscaling the art and centring it on a
larger transparent canvas:

    32x32 art  --(nearest, integer scale)-->  N*32  --(centre on canvas)-->  canvas

Only integer scales are allowed. A fractional scale (e.g. 512 -> 410 for a flat
80%) resamples the pixel grid and turns every hard block edge into a smear,
which is the one thing this artwork cannot survive. Pick padding by choosing the
scale: the content fraction is scale*32/canvas.

    scale 16 -> 512 of 512 = 100%   (edge to edge, the old master)
    scale 14 -> 448 of 512 =  87.5%
    scale 13 -> 416 of 512 =  81.25%  <- default
    scale 12 -> 384 of 512 =  75%

Downstream consumers (`pnpm tauri icon`, scripts/gen-ios-icons.py) read the
master this writes, so regenerate the master FIRST, then run those.

Usage:
  python3 scripts/gen-master-icon.py                  # write the master at the default scale
  python3 scripts/gen-master-icon.py --scale 12       # more padding
  python3 scripts/gen-master-icon.py --output /tmp/x.png  # dry preview
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pnglib import load_png, write_png  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_SOURCE = os.path.join(REPO, "src-tauri/icons/quarklogo32.png")
DEFAULT_DEST = os.path.join(REPO, "src-tauri/icons/icon.png")


def upscale_and_pad(sw, sh, rgba, scale, canvas):
    """Integer nearest upscale, centred on a transparent canvas. Returns RGBA."""
    aw, ah = sw * scale, sh * scale
    if aw > canvas or ah > canvas:
        sys.exit(f"scale {scale} makes the art {aw}x{ah}, larger than the {canvas}px canvas")
    if (canvas - aw) % 2 or (canvas - ah) % 2:
        sys.exit(f"art {aw}x{ah} cannot be centred on {canvas}px without a half-pixel offset")
    ox, oy = (canvas - aw) // 2, (canvas - ah) // 2
    dst = bytearray(canvas * canvas * 4)  # zero = fully transparent
    for y in range(ah):
        sy = y // scale
        for x in range(aw):
            so = (sy * sw + x // scale) * 4
            do = ((y + oy) * canvas + (x + ox)) * 4
            dst[do : do + 4] = rgba[so : so + 4]
    return bytes(dst), ox, oy


def content_bbox(w, h, rgba, threshold=8):
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        for x in range(w):
            if rgba[(y * w + x) * 4 + 3] > threshold:
                minx, maxx = min(minx, x), max(maxx, x)
                miny, maxy = min(miny, y), max(maxy, y)
    return minx, miny, maxx, maxy


def main():
    ap = argparse.ArgumentParser(description="Build the padded 512px master icon from the 32px native art.")
    ap.add_argument("--source", default=DEFAULT_SOURCE)
    ap.add_argument("--output", default=DEFAULT_DEST)
    ap.add_argument("--scale", type=int, default=13, help="integer upscale of the 32px art (default: 13)")
    ap.add_argument("--canvas", type=int, default=512, help="output canvas size (default: 512)")
    args = ap.parse_args()

    sw, sh, src = load_png(args.source)
    if sw != sh:
        sys.exit(f"source must be square, got {sw}x{sh}")

    out, ox, oy = upscale_and_pad(sw, sh, src, args.scale, args.canvas)
    write_png(args.output, args.canvas, args.canvas, out, alpha=True)

    art = sw * args.scale
    x0, y0, x1, y1 = content_bbox(args.canvas, args.canvas, out)
    print(f"source : {args.source} ({sw}x{sh} native)")
    print(f"output : {args.output}")
    print(f"  scale      {args.scale}x  ->  art {art}x{art} on a {args.canvas}px canvas")
    print(f"  canvas pad {ox}px per side ({100 * art / args.canvas:.2f}% of the canvas)")
    print(f"  visible    bbox ({x0},{y0})-({x1},{y1})"
          f"  margins L{x0} T{y0} R{args.canvas - 1 - x1} B{args.canvas - 1 - y1}"
          f"  = {100 * (x1 - x0 + 1) / args.canvas:.2f}% wide")


if __name__ == "__main__":
    main()
