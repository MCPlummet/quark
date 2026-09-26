// Recovering the type of an attachment the webview could not type (#83).
//
// Whether an attachment stages as a captionable image or uploads as `m.file`
// is decided on its MIME type, and the webview does not always supply one: a
// clipboard image whose format WebKitGTK does not map (BMP, TIFF, AVIF, HEIC,
// what a screenshot tool or an image editor offers), or a picked file with no
// extension, arrives with `type === ""` or as `application/octet-stream`. Such
// an image used to go out as a bare file — which is how "some copied image
// formats don't paste" as images. The bytes still say what they are.

/** Image formats recognisable from their first bytes. */
export function sniffImageMime(head: Uint8Array): string | undefined {
  const at = (i: number, ...bytes: number[]) => bytes.every((b, k) => head[i + k] === b);
  const ascii = (i: number, s: string) => at(i, ...Array.from(s, (c) => c.charCodeAt(0)));

  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return "image/gif";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  if (ascii(0, "BM")) return "image/bmp";
  if (at(0, 0x49, 0x49, 0x2a, 0x00) || at(0, 0x4d, 0x4d, 0x00, 0x2a)) return "image/tiff";
  if (at(0, 0x00, 0x00, 0x01, 0x00)) return "image/x-icon";
  // ISO-BMFF: `ftyp` at 4, major brand at 8.
  if (ascii(4, "ftyp")) {
    const brand = String.fromCharCode(...head.subarray(8, 12));
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (["heic", "heix", "heim", "heis", "mif1"].includes(brand)) return "image/heic";
  }
  return undefined;
}

/** Whether a type is missing or too generic to route on. */
function isUntyped(type: string): boolean {
  return type === "" || type === "application/octet-stream";
}

/** Read a blob's first bytes. FileReader where `arrayBuffer` is missing. */
async function readHead(blob: Blob, length: number): Promise<Uint8Array> {
  const slice = blob.slice(0, length);
  if (typeof slice.arrayBuffer === "function") {
    return new Uint8Array(await slice.arrayBuffer());
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsArrayBuffer(slice);
  });
}

/**
 * The file as given when it already has a usable type; otherwise, if its bytes
 * are an image, the same file carrying that image type. Anything that still
 * cannot be identified is returned unchanged — it uploads as a file, which is
 * the right answer for bytes nobody can name.
 */
export async function withSniffedType(file: File): Promise<File> {
  if (!isUntyped(file.type)) return file;
  let mime: string | undefined;
  try {
    mime = sniffImageMime(await readHead(file, 16));
  } catch {
    return file;
  }
  if (!mime) return file;
  return new File([file], file.name, { type: mime, lastModified: file.lastModified });
}
