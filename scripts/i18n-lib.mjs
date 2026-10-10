import fs from "node:fs";
import path from "node:path";

export const LOCALES_DIR = path.resolve("src/i18n/locales");
export const LANGS = ["en", "es", "de"];
export const TARGET_LANGS = ["es", "de"];
export const PENDING_PREFIX = "⟪pending⟫ ";

/** Brand, chess notation, and technical tokens allowed to match English in es/de. */
export const WHITELIST_SUBSTRINGS = [
  "MoveMirror",
  "Chess.com",
  "Lichess",
  "Stockfish",
  "PGN",
  "SAN",
  "FEN",
  "UCI",
  "JSON",
  "Chess.js",
  "♔",
  "♕",
  "♖",
  "♗",
  "♘",
  "http://",
  "https://",
  "src/contracts/future.ts",
];

/** Exact English values that may be reused in es/de (field labels, sync keys, etc.). */
export const WHITELIST_EXACT = new Set([
  "MoveMirror",
  "Chess.com",
  "Lichess",
  "PGN",
  "SAN",
  "FEN",
  "UCI",
  "JSON",
  "Bullet",
  "Blitz",
  "Rapid",
  "Classical",
  "ID",
  "Hash",
  "Pattern id",
  "Protocol id",
  "Policy id",
  "Analysis fingerprint",
  "Motif classifier",
  "α / β",
]);

export function listNamespaces() {
  return fs.readdirSync(path.join(LOCALES_DIR, "en")).filter((f) => f.endsWith(".json"));
}

export function loadLocale(lang, file) {
  return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, lang, file), "utf8"));
}

export function saveLocale(lang, file, data) {
  fs.writeFileSync(path.join(LOCALES_DIR, lang, file), `${JSON.stringify(data, null, 2)}\n`);
}

export function flattenLeaves(obj, prefix = "") {
  const out = [];
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out.push(...flattenLeaves(value, full));
    } else {
      out.push([full, value]);
    }
  }
  return out;
}

export function setByPath(obj, dotPath, value) {
  const parts = dotPath.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p];
  }
  cur[parts.at(-1)] = value;
}

export function getByPath(obj, dotPath) {
  return dotPath.split(".").reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), obj);
}

export function isPendingValue(value) {
  return typeof value === "string" && value.startsWith(PENDING_PREFIX);
}

export function isWhitelistedEnglishMatch(enValue, keyPath) {
  if (typeof enValue !== "string") return true;
  const trimmed = enValue.trim();
  if (!trimmed) return true;
  if (trimmed === "—" && keyPath.endsWith("dash")) return true;
  if (trimmed === "No" && keyPath.endsWith("no")) return true;
  if (WHITELIST_EXACT.has(trimmed)) return true;
  for (const token of WHITELIST_SUBSTRINGS) {
    if (trimmed.includes(token)) return true;
  }
  if (/^[\d\s./:+\\-]+$/.test(trimmed)) return true;
  if (/^[♔♕♖♗♘][a-h]?[1-8]?/.test(trimmed)) return true;
  if (keyPath.startsWith("technical.") && /id|sha|uci|fen|san|hash/i.test(keyPath)) return true;
  if (keyPath.includes("syncProgress.") && !keyPath.endsWith(".value")) return true;
  return false;
}
