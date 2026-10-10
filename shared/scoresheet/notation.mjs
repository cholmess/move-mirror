const EN_PIECES = { k: "K", q: "Q", r: "R", b: "B", n: "N", p: "" };
const ES_PIECES = { k: "R", q: "D", r: "T", b: "A", n: "C", p: "" };
const DE_PIECES = { k: "K", q: "D", r: "T", b: "L", n: "S", p: "" };

export function pieceMapForLocale(locale) {
  if (locale === "es") return ES_PIECES;
  if (locale === "de") return DE_PIECES;
  return EN_PIECES;
}

export function normalizeCastling(text) {
  let value = String(text ?? "").trim();
  value = value.replace(/[oO]/g, "0");
  value = value.replace(/×/g, "x");
  if (/^0-0-0\+?$/.test(value)) return value.replace("+", "") + (value.endsWith("+") ? "+" : "");
  if (/^0-0\+?$/.test(value)) return value;
  return value;
}

export function stripAnnotations(text) {
  return String(text ?? "")
    .replace(/[!?]+$/g, "")
    .replace(/[+#]$/g, (m) => m)
    .trim();
}

export function sanToLocaleDisplay(san, locale) {
  const normalized = normalizeCastling(san);
  if (/^0-0(-0)?\+?#?$/.test(normalized.replace(/#/g, "+"))) {
    return normalized.replace(/#/g, "");
  }
  const map = pieceMapForLocale(locale);
  const match = /^([KQRBN])?([a-h]?(?:[1-8])?x?[a-h][1-8](?:=[QRBN])?)([+#])?$/.exec(san);
  if (!match) return san;
  const piece = match[1];
  const suffix = match[3] ?? "";
  const body = match[2];
  if (!piece) return `${body}${suffix}`;
  const lower = piece.toLowerCase();
  const letter = map[lower] ?? piece;
  if (!letter) return `${body}${suffix}`;
  return `${letter}${body}${suffix}`;
}

export function localeTokenVariants(token, locale) {
  const raw = String(token ?? "").trim();
  if (!raw) return [];
  const variants = new Set([raw, normalizeCastling(raw), stripAnnotations(raw)]);
  const cleaned = stripAnnotations(normalizeCastling(raw));
  variants.add(cleaned);
  const map = pieceMapForLocale(locale);
  const inv = Object.fromEntries(Object.entries(map).filter(([, v]) => v).map(([k, v]) => [v, k.toUpperCase()]));
  if (cleaned[0] && inv[cleaned[0]]) {
    variants.add(`${inv[cleaned[0]]}${cleaned.slice(1)}`);
  }
  for (const [loc, en] of Object.entries(inv)) {
    if (cleaned.startsWith(loc)) {
      variants.add(`${en}${cleaned.slice(loc.length)}`);
    }
  }
  return [...variants].filter(Boolean);
}

export function looksLikeResult(text) {
  return /^(1-0|0-1|1\/2-1\/2|\*|-)$/.test(String(text ?? "").trim());
}

export function looksLikeMoveNumber(text) {
  return /^\d+\.+$/.test(String(text ?? "").trim()) || /^\d+\.$/.test(String(text ?? "").trim());
}

export function looksLikeChessMoveToken(text) {
  const value = normalizeCastling(stripAnnotations(String(text ?? "").trim()));
  if (!value || looksLikeMoveNumber(value) || looksLikeResult(value)) return false;
  if (/^(White|Black|Blancas|Negras|Event|Ronda|Round):?$/i.test(value)) return false;
  if (/^0-0(-0)?\+?#?$/.test(value)) return true;
  if (/^([KQRBNTRDLASC])?([a-h]?x?[a-h][1-8](=[QRBNTRDLASC])?)([+#])?$/i.test(value)) return true;
  if (/^[a-h]x?[a-h][1-8](=[QRBNTRDLASC])?[+#]?$/i.test(value)) return true;
  return false;
}
