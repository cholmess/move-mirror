import { NORMALIZER_VERSION } from "./constants.mjs";
import { looksLikeMoveNumber, looksLikeResult, normalizeCastling } from "./notation.mjs";

const CONTEXT_RULES = [
  { id: "castling_o_to_zero", apply: (t) => t.replace(/[oO]/g, "0") },
  { id: "capture_times", apply: (t) => t.replace(/×/g, "x") },
  { id: "plus_confusion", apply: (t) => t.replace(/t$/i, (m) => (/\d/.test(t) ? m : "+")) },
];

const PAIR_RULES = [
  { id: "O_zero", from: "O", to: "0" },
  { id: "I_one", from: "I", to: "1" },
  { id: "l_one", from: "l", to: "1" },
  { id: "S_five", from: "S", to: "5" },
  { id: "B_eight", from: "B", to: "8" },
  { id: "g_nine", from: "g", to: "9" },
];

export function normalizeToken(rawText, { locale = "en" } = {}) {
  const original = String(rawText ?? "").trim();
  if (!original) {
    return { original, normalized: null, rules: [], score: 0, dropped: true, reason: "empty" };
  }
  if (looksLikeMoveNumber(original)) {
    return { original, normalized: null, rules: [{ id: "move_number", score: 1 }], score: 1, dropped: true, reason: "move_number" };
  }
  if (looksLikeResult(original)) {
    return { original, normalized: null, rules: [{ id: "result", score: 1 }], score: 1, dropped: true, reason: "result" };
  }

  let text = original;
  const rules = [];
  for (const rule of CONTEXT_RULES) {
    const next = rule.apply(text);
    if (next !== text) {
      rules.push({ id: rule.id, score: 0.2 });
      text = next;
    }
  }
  text = normalizeCastling(text);
  if (/^5([a-h])/i.test(text)) {
    rules.push({ id: "five_knight", score: 0.2 });
    text = `S${text.slice(1)}`;
  }
  text = text.replace(/[!?]+$/g, "").trim();

  for (const rule of PAIR_RULES) {
    if (!text.includes(rule.from) || !/[0-9a-hx+=#-]/i.test(text)) continue;
    if (rule.id === "S_five" && /^S[a-h]/i.test(text)) continue;
    if (rule.id === "B_eight" && /^B[a-h]/i.test(text)) continue;
    if (rule.id === "g_nine" && (/^[a-h][1-8]$/i.test(text) || /^[NBRQK]g[1-8]/i.test(text) || /[a-h]g[1-8]/i.test(text))) continue;
    const next = text.replaceAll(rule.from, rule.to);
    if (next !== text) {
      rules.push({ id: rule.id, score: 0.15 });
      text = next;
    }
  }

  const normalized = text || null;
  const score = rules.reduce((sum, row) => sum + row.score, normalized ? 0.5 : 0);
  return {
    original,
    normalized,
    rules,
    score,
    dropped: !normalized,
    reason: normalized ? null : "empty_after_normalize",
    version: NORMALIZER_VERSION,
    locale,
  };
}

export function normalizeSequence(tokens, options = {}) {
  return tokens.map((token) => ({
    token,
    ...normalizeToken(typeof token === "string" ? token : token.text, options),
  }));
}
