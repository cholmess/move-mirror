/**
 * Grounded explanation facts. Everything here is derived from the board and engine lines with chess.js,
 * so the template explanation (and any LLM wording) can only talk about verified moves.
 */
import { Chess } from "chess.js";
import { applyUci, describeLine } from "./cards.js";

export const PIECE = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };

/**
 * @param {object} input
 * @param {string} input.fen position before the candidate / played move
 * @param {string|null} input.candidateUci the move that was considered or played
 * @param {string[]} input.punishUci opponent's best line after the candidate (may be empty)
 * @param {string[]} input.bestUci best line from the original position (may be empty)
 */
export function buildFacts({ fen, candidateUci = null, punishUci = [], bestUci = [] }) {
  const chess = new Chess(fen);
  const facts = { side: chess.turn() === "w" ? "white" : "black", candidateSan: null, punish: null, best: null };
  if (candidateUci) {
    const move = applyUci(chess, candidateUci);
    if (move) {
      facts.candidateSan = move.san;
      if (punishUci.length) {
        const line = describeLine(chess.fen(), punishUci);
        const first = new Chess(chess.fen()); const reply = applyUci(first, punishUci[0]);
        facts.punish = { san: line.san, firstSan: reply?.san ?? null,
          firstIsCheck: Boolean(reply?.san.includes("+")), firstIsMate: Boolean(reply?.san.includes("#")),
          firstCaptures: reply?.captured ? PIECE[reply.captured] : null,
          firstCaptureSquare: reply?.captured ? reply.to : null,
          // From the punisher's view; positive = the candidate loses material.
          materialSwing: line.materialSwing, endsInMate: line.mate,
          attackedAfter: reply ? attackedPieces(first, reply.color) : [] };
      }
    }
  }
  if (bestUci.length) {
    const line = describeLine(fen, bestUci);
    facts.best = { san: line.san, firstSan: line.san[0] ?? null, materialSwing: line.materialSwing, endsInMate: line.mate };
  }
  return facts;
}

/** Valuable enemy pieces attacked by `color` in the given position (forks, double attacks). */
function attackedPieces(chess, color) {
  const enemy = color === "w" ? "b" : "w"; const out = [];
  for (const row of chess.board()) for (const piece of row) {
    if (!piece || piece.color !== enemy || piece.type === "p") continue;
    if (chess.isAttacked(piece.square, color)) out.push({ piece: PIECE[piece.type], square: piece.square });
  }
  return out;
}

/** SAN tokens and squares an explanation is allowed to mention. */
export function allowedTokens(facts) {
  const sans = [facts.candidateSan, ...(facts.punish?.san ?? []), ...(facts.best?.san ?? [])].filter(Boolean);
  const tokens = new Set();
  for (const san of sans) {
    tokens.add(san); tokens.add(san.replace(/[+#]$/, ""));
    for (const sq of san.match(/[a-h][1-8]/g) ?? []) tokens.add(sq);
  }
  for (const a of facts.punish?.attackedAfter ?? []) tokens.add(a.square);
  if (facts.punish?.firstCaptureSquare) tokens.add(facts.punish.firstCaptureSquare);
  return tokens;
}

const SAN_OR_SQUARE = /\b(?:O-O(?:-O)?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8][+#]?|[a-h]x[a-h][1-8](?:=[QRBN])?[+#]?|[a-h][1-8](?:=[QRBN])?[+#]?)/g;

/** Rejects text that mentions a move or square that is not part of the verified lines. */
export function verifyExplanation(text, facts) {
  if (typeof text !== "string" || !text.trim()) return { ok: false, reason: "empty" };
  if (text.length > 900) return { ok: false, reason: "too_long" };
  const allowed = allowedTokens(facts);
  const unknown = (text.match(SAN_OR_SQUARE) ?? []).filter(t => !allowed.has(t) && !allowed.has(t.replace(/[+#]$/, "")));
  return unknown.length ? { ok: false, reason: "unverified_move", unknown } : { ok: true };
}
