const MAX_BYTES = Number(process.env.PGN_MAX_BYTES ?? 10 * 1024 * 1024);

export function maxPgnBytes() {
  return MAX_BYTES;
}

export function decodePgnBytes(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buffer.length > MAX_BYTES) throw new Error("pgn_too_large");
  const utf8 = buffer.toString("utf8");
  if (!utf8.includes("\uFFFD") && !hasUnexpectedControlChars(utf8)) return stripBom(utf8);
  return stripBom(buffer.toString("latin1"));
}

export function decodePgnText(value) {
  if (typeof value === "string") return stripBom(value.replace(/^\uFEFF/, ""));
  return decodePgnBytes(value);
}

function stripBom(text) {
  return String(text).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

function hasUnexpectedControlChars(text) {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text);
}
