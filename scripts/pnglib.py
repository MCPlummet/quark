"""Minimal dependency-free PNG read/write for the icon pipeline.

The repo has no Pillow/numpy dependency and the icon scripts must run from a
bare `python3`, so this is a small hand-rolled codec. It handles exactly what
the icon sources need: 8-bit gray / gray+alpha / RGB / RGBA, no interlacing.

Shared by scripts/gen-master-icon.py and scripts/gen-ios-icons.py.
"""

import struct
import zlib


def load_png(path):
    """Read an 8-bit PNG. Returns (width, height, rgba_bytes)."""
    data = open(path, "rb").read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", f"not a PNG: {path}"
    pos, idat = 8, b""
    w = h = col = None
    while pos < len(data):
        ln = struct.unpack(">I", data[pos : pos + 4])[0]
        typ = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + ln]
        if typ == b"IHDR":
            w, h = struct.unpack(">II", chunk[:8])
            assert chunk[8] == 8, f"only 8-bit PNGs supported: {path}"
            assert chunk[12] == 0, f"interlaced PNGs unsupported: {path}"
            col = chunk[9]
        elif typ == b"IDAT":
            idat += chunk
        elif typ == b"IEND":
            break
        pos += 12 + ln
    raw = zlib.decompress(idat)
    ch = {0: 1, 2: 3, 4: 2, 6: 4}[col]
    bpp, stride = ch, w * ch
    out = bytearray()
    prev = bytearray(stride)
    i = 0

    def paeth(a, b, c):
        p = a + b - c
        pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
        return a if pa <= pb and pa <= pc else (b if pb <= pc else c)

    for _ in range(h):
        ft = raw[i]
        i += 1
        line = bytearray(raw[i : i + stride])
        i += stride
        if ft:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                b = prev[x]
                c = prev[x - bpp] if x >= bpp else 0
                if ft == 1:
                    line[x] = (line[x] + a) & 255
                elif ft == 2:
                    line[x] = (line[x] + b) & 255
                elif ft == 3:
                    line[x] = (line[x] + ((a + b) >> 1)) & 255
                elif ft == 4:
                    line[x] = (line[x] + paeth(a, b, c)) & 255
        out += line
        prev = line
    rgba = bytearray(w * h * 4)
    for i in range(w * h):
        o = i * ch
        if ch == 4:
            rgba[i * 4 : i * 4 + 4] = out[o : o + 4]
        elif ch == 3:
            rgba[i * 4 : i * 4 + 3] = out[o : o + 3]
            rgba[i * 4 + 3] = 255
        else:  # gray (+alpha)
            g = out[o]
            rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = g
            rgba[i * 4 + 3] = out[o + 1] if ch == 2 else 255
    return w, h, bytes(rgba)


def _chunk(typ, body):
    return (
        struct.pack(">I", len(body))
        + typ
        + body
        + struct.pack(">I", zlib.crc32(typ + body) & 0xFFFFFFFF)
    )


def write_png(path, w, h, pixels, alpha=False):
    """Write an 8-bit PNG. `pixels` is packed RGB, or RGBA when alpha=True."""
    ch = 4 if alpha else 3
    assert len(pixels) == w * h * ch, "pixel buffer size does not match w*h*channels"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6 if alpha else 2, 0, 0, 0)
    stride = w * ch
    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter: none — the sources are flat pixel art
        raw += pixels[y * stride : (y + 1) * stride]
    open(path, "wb").write(
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + _chunk(b"IEND", b"")
    )
