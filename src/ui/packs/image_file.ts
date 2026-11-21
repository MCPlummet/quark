// Read a picked image for upload to a pack (#12): its bytes as base64, its
// type and size, and its pixel dimensions where the engine can decode it — the
// `info` MSC2545 puts on each image.

export interface ReadImage {
  dataBase64: string;
  mimetype: string;
  size: number;
  w?: number;
  h?: number;
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

async function dimensions(file: File): Promise<{ w?: number; h?: number }> {
  if (typeof createImageBitmap !== "function") return {};
  try {
    const bitmap = await createImageBitmap(file);
    const out = { w: bitmap.width, h: bitmap.height };
    bitmap.close();
    return out;
  } catch {
    return {}; // undecodable here (an exotic format): upload it without dimensions
  }
}

export async function readImageFile(file: File): Promise<ReadImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error(`${file.name} is not an image`);
  }
  const [dataBase64, dims] = await Promise.all([toBase64(file), dimensions(file)]);
  return { dataBase64, mimetype: file.type, size: file.size, ...dims };
}
