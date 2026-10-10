import { describe, expect, it } from "vitest";
import { validateUpload, mimeFromFilename } from "./mime.mjs";

describe("scoresheet mime", () => {
  it("accepts png", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(validateUpload({ filename: "x.png", mimeType: "image/png", byteSize: png.length, buffer: png })).toBe("image/png");
  });

  it("rejects unknown", () => {
    expect(() => validateUpload({ filename: "x.txt", byteSize: 3, buffer: Buffer.from("abc") })).toThrow(/unsupported/);
  });

  it("maps extensions", () => {
    expect(mimeFromFilename("a.pdf")).toBe("application/pdf");
  });
});
