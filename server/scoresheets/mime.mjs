import { ALLOWED_MIME, MAX_FILE_BYTES } from "../../shared/scoresheet/constants.mjs";

const EXT_MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

export function mimeFromFilename(name) {
  const ext = String(name ?? "").toLowerCase().match(/\.[^.]+$/)?.[0];
  return ext ? EXT_MIME[ext] ?? null : null;
}

export function validateUpload({ filename, mimeType, byteSize, buffer }) {
  if (byteSize > MAX_FILE_BYTES) throw new Error("scoresheet_too_large");
  const sniffed = sniffMime(buffer);
  const declared = mimeType || mimeFromFilename(filename);
  const resolved = sniffed || declared;
  if (!resolved || !ALLOWED_MIME.has(resolved)) throw new Error("scoresheet_unsupported_format");
  if (declared && sniffed && declared !== sniffed && !(declared === "image/jpeg" && sniffed === "image/jpeg")) {
    throw new Error("scoresheet_mime_mismatch");
  }
  return resolved;
}

function sniffMime(buffer) {
  if (!buffer?.length) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return "image/png";
  if (buffer.slice(0, 4).toString("ascii") === "RIFF" && buffer.slice(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buffer.slice(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  return null;
}
