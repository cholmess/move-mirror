import fs from "node:fs";
import path from "node:path";

export const LOCALES_DIR = path.resolve("src/i18n/locales");
export const LANGS = ["en", "es", "de"];
export const TARGET_LANGS = ["es", "de"];
export const PENDING_PREFIX = "⟪pending⟫ ";

/** @typedef {{ fullKey: string; enValue: string; localeValue: string; lang: string }} WhitelistContext */

/**
 * Strict whitelist: exact fullKey and/or exact value only. No namespace wildcards.
 * @returns {string|null} human-readable reason if allowed, else null
 */
export function whitelistAllowanceReason({ fullKey, enValue, localeValue, lang }) {
  if (typeof enValue !== "string" || typeof localeValue !== "string") return "non-string leaf";
  if (enValue !== localeValue) return null;
  const trimmed = enValue.trim();
  if (!trimmed) return "empty string";

  if (fullKey === "common:dash" && trimmed === "—") return "em dash (locale-neutral)";
  if (fullKey === "common:no" && trimmed === "No" && lang === "es") return "Spanish cognate «No»";

  if (fullKey === "games:timeControl.bullet" && trimmed === "Bullet") return "intentional equal pace label (Bullet)";
  if (fullKey === "games:timeControl.blitz" && trimmed === "Blitz") return "intentional equal pace label (Blitz)";

  const chessComKeys = new Set([
    "games:sourceShort.chess_com",
    "import:chesscom",
    "import:source.chess_com",
  ]);
  if (chessComKeys.has(fullKey) && trimmed === "Chess.com") return "brand name Chess.com";

  const lichessKeys = new Set([
    "games:sourceShort.lichess",
    "import:lichess",
    "import:source.lichess",
  ]);
  if (lichessKeys.has(fullKey) && trimmed === "Lichess") return "brand name Lichess";

  const acronymKeys = {
    "technical:hash": "Hash",
    "technical:id": "ID",
    "technical:fen": "FEN",
    "technical:uci": "UCI",
  };
  if (acronymKeys[fullKey] === trimmed) return `acronym ${trimmed}`;

  if (fullKey === "technical:san" && /^SAN\b/i.test(trimmed)) return "notation label SAN";

  if (fullKey === "technical:engineSha" && /SHA/i.test(trimmed)) return "engine SHA label";

  if (trimmed === "MoveMirror" || (trimmed.includes("MoveMirror") && fullKey === "transfer:eyebrow")) {
    return "product name MoveMirror";
  }

  if (trimmed === "Stockfish" || trimmed.includes("Stockfish")) return "engine name Stockfish";

  if (trimmed === "PGN" || trimmed.includes("PGN")) {
    if (/\.pgn|PGN file|Pasted PGN|archivo.*PGN|PGN pegado/i.test(trimmed) && trimmed !== "PGN") {
      return null;
    }
    if (trimmed === "PGN") return "notation PGN";
  }

  if (/^https?:\/\//.test(trimmed)) return "URL";

  if (/^[a-f0-9]{32,}$/i.test(trimmed)) return "hash value";

  if (/^[\d\s./:+\\\-–—]+$/.test(trimmed)) return "numeric or punctuation only";

  if (/^[♔♕♖♗♘][a-h]?[1-8]?x?[a-h]?[1-8]?[+#!?]*$/i.test(trimmed)) return "chess notation sample";

  if (fullKey.startsWith("transfer:syncProgress.") && lang !== "en") {
    return "sync progress server key (Spanish key, localized value)";
  }

  return null;
}

export function isWhitelistedEnglishMatch(enValue, keyPath, lang, fullKey) {
  const reason = whitelistAllowanceReason({
    fullKey: fullKey ?? keyPath,
    enValue,
    localeValue: enValue,
    lang,
  });
  return reason !== null;
}

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

/** Guard: whitelist implementation must not use broad namespace patterns. */
export function assertNoBroadWhitelistPatterns(sourceText) {
  const forbidden = [
    /technical:\*/,
    /common:\*/,
    /import:\*/,
    /keyPath\.startsWith\(\s*["']technical/,
    /SUBSTRINGS\s*=/,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(sourceText)) {
      throw new Error(`Forbidden broad whitelist pattern in i18n-lib: ${pattern}`);
    }
  }
}
