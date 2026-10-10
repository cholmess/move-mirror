import { looksLikeChessMoveToken, looksLikeMoveNumber, looksLikeResult } from "./notation.mjs";
import { normalizeToken } from "./normalizer.mjs";
import { tokenInRegion } from "./regions.mjs";

export function tokensToMoveRows(tokens, { pageWidth = 1000 } = {}) {
  const moveTokens = tokens.filter((token) => {
    const text = String(token.text ?? "").trim();
    if (!text) return false;
    if (looksLikeMoveNumber(text) || looksLikeResult(text)) return false;
    const norm = normalizeToken(text);
    return !norm.dropped && looksLikeChessMoveToken(text);
  });

  if (!moveTokens.length) return [];

  const xs = moveTokens.map((t) => t.boundingBox?.x ?? 0);
  const median = xs.length ? xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] : pageWidth / 2;
  const hasColumns = moveTokens.some((t) => (t.boundingBox?.x ?? 0) > median + 20)
    && moveTokens.some((t) => (t.boundingBox?.x ?? 0) < median - 20);

  const ordered = [...moveTokens].sort((a, b) => {
    const ay = a.boundingBox?.y ?? a.page * 10_000;
    const by = b.boundingBox?.y ?? b.page * 10_000;
    if (ay !== by) return ay - by;
    return (a.boundingBox?.x ?? 0) - (b.boundingBox?.x ?? 0);
  });

  const rows = [];
  if (hasColumns) {
    for (const token of ordered) {
      const side = (token.boundingBox?.x ?? 0) >= median ? "black" : "white";
      rows.push({ side, token });
    }
  } else {
    for (let i = 0; i < ordered.length; i += 1) {
      rows.push({ side: i % 2 === 0 ? "white" : "black", token: ordered[i] });
    }
  }
  return rows;
}

export function extractMetadataHints(rawText) {
  const lines = String(rawText ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const hints = {};
  for (const line of lines) {
    const white = line.match(/white[:\s]+(.+)/i);
    const black = line.match(/black[:\s]+(.+)/i);
    const blancas = line.match(/blancas[:\s]+(.+)/i);
    const negras = line.match(/negras[:\s]+(.+)/i);
    const event = line.match(/event(?:o)?[:\s]+(.+)/i);
    const round = line.match(/round|ronda[:\s]+(.+)/i);
    const date = line.match(/(\d{4}[./-]\d{2}[./-]\d{2})/);
    const result = line.match(/\b(1-0|0-1|1\/2-1\/2|\*)\b/);
    if (white) hints.whiteName = white[1].trim();
    if (black) hints.blackName = black[1].trim();
    if (blancas) hints.whiteName = blancas[1].trim();
    if (negras) hints.blackName = negras[1].trim();
    if (event) hints.event = event[1].trim();
    if (round) hints.round = round[1].trim();
    if (date) hints.date = date[1].replace(/[./]/g, "-");
    if (result) hints.result = result[1];
  }
  return hints;
}

export function observationToRawMoveTokens(observation, options = {}) {
  const tokens = [];
  for (const page of observation.pages ?? []) {
    for (const token of page.tokens ?? []) {
      const enriched = { ...token, page: page.page };
      if (!tokenInRegion(enriched, options.movesRegion, { width: page.width ?? 1, height: page.height ?? 1 })) continue;
      tokens.push(enriched);
    }
  }
  return tokensToMoveRows(tokens, { pageWidth: observation.pages?.[0]?.width ?? 1000 });
}
