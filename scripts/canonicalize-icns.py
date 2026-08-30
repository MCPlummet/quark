#!/usr/bin/env python3
"""Sort the chunks of an .icns file into a stable order.

`tauri icon` emits the icon variants in a nondeterministic order (the chunk
contents are identical run to run, only their sequence moves). That turns every
icon regeneration into a ~190KB binary diff on a file whose content did not
change. Sorting the chunks by type makes the pipeline byte-idempotent.

Safe for the format: readers index .icns by chunk type, not position, and the
file carries no 'TOC ' chunk that would need to agree with the ordering. The
header length is unchanged because the same chunks are simply rewritten in a
different sequence.

Usage: python3 scripts/canonicalize-icns.py src-tauri/icons/icon.icns
"""

import struct
import sys


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: canonicalize-icns.py <file.icns>")
    path = sys.argv[1]
    data = open(path, "rb").read()
    if data[:4] != b"icns":
        sys.exit(f"not an .icns file: {path}")

    total = struct.unpack(">I", data[4:8])[0]
    if total != len(data):
        sys.exit(f"header length {total} != file size {len(data)}: {path}")

    chunks, pos = [], 8
    while pos < total:
        ln = struct.unpack(">I", data[pos + 4 : pos + 8])[0]
        if ln < 8 or pos + ln > total:
            sys.exit(f"corrupt chunk at offset {pos}: {path}")
        chunks.append((data[pos : pos + 4], data[pos : pos + ln]))
        pos += ln

    if b"TOC " in (t for t, _ in chunks):
        sys.exit("file has a TOC chunk; reordering would invalidate it")

    body = b"".join(c for _, c in sorted(chunks, key=lambda c: c[0]))
    out = b"icns" + struct.pack(">I", len(body) + 8) + body
    if len(out) != len(data):
        sys.exit(f"refusing to write: size changed {len(data)} -> {len(out)}")

    if out != data:
        open(path, "wb").write(out)
        print(f"  canonicalized {len(chunks)} chunks in {path}")
    else:
        print(f"  {path} already canonical ({len(chunks)} chunks)")


if __name__ == "__main__":
    main()
