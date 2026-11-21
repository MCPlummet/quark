import { describe, it, expect } from "vitest";
import { readImageFile } from "./image_file.js";

describe("readImageFile", () => {
  it("refuses a file that is not an image", async () => {
    await expect(readImageFile(new File(["hi"], "notes.txt", { type: "text/plain" }))).rejects.toThrow(/not an image/);
  });

  it("reads an image's bytes as base64 with its type and size", async () => {
    const got = await readImageFile(new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" }));
    expect(got.dataBase64).toBe("AQID");
    expect(got.mimetype).toBe("image/png");
    expect(got.size).toBe(3);
  });
});
