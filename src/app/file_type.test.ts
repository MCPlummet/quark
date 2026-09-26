import { describe, it, expect } from "vitest";
import { sniffImageMime, withSniffedType } from "./file_type.js";

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === "string" ? Array.from(p, (c) => c.charCodeAt(0)) : p)),
  );

describe("sniffImageMime", () => {
  it.each([
    ["image/png", bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a])],
    ["image/jpeg", bytes([0xff, 0xd8, 0xff, 0xe0])],
    ["image/gif", bytes("GIF89a")],
    ["image/webp", bytes("RIFF", [0, 0, 0, 0], "WEBP")],
    ["image/bmp", bytes("BM", [0, 0, 0, 0])],
    ["image/tiff", bytes([0x49, 0x49, 0x2a, 0x00])],
    ["image/tiff", bytes([0x4d, 0x4d, 0x00, 0x2a])],
    ["image/avif", bytes([0, 0, 0, 0x1c], "ftypavif")],
    ["image/heic", bytes([0, 0, 0, 0x18], "ftypheic")],
  ])("recognises %s", (mime, head) => {
    expect(sniffImageMime(head)).toBe(mime);
  });

  it("does not call an MP4 an image", () => {
    expect(sniffImageMime(bytes([0, 0, 0, 0x18], "ftypisom"))).toBeUndefined();
  });

  it("returns undefined for text and for too few bytes", () => {
    expect(sniffImageMime(bytes("hello world"))).toBeUndefined();
    expect(sniffImageMime(new Uint8Array([0x89]))).toBeUndefined();
  });
});

describe("withSniffedType", () => {
  const PNG = bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a]);

  it("leaves a typed file alone", async () => {
    const f = new File([PNG], "x.txt", { type: "text/plain" });
    expect(await withSniffedType(f)).toBe(f);
  });

  it("types an untyped or octet-stream image, keeping its name", async () => {
    for (const type of ["", "application/octet-stream"]) {
      const out = await withSniffedType(new File([PNG], "shot", { type }));
      expect(out.type).toBe("image/png");
      expect(out.name).toBe("shot");
    }
  });
});
