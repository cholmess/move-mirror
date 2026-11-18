/**
 * Drill cards. Two task kinds:
 *  - "refutation": a candidate move is shown already played; the solver moves for the OTHER side and must
 *    find its strongest reply. This trains the blunder check ("what does my opponent do now?").
 *  - "find-move": the solver finds the move for the side to move.
 * Sources: "own" (positions from the player's analysed games) and "puzzle" (Lichess bank).
 */
import { Chess } from "chess.js";
import { createHash } from "node:crypto";
import { PATTERN_THEMES } from "./puzzles.js";

export const LIMIT_MS = { refutation: 30_000, "find-move": 45_000 };
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export function cardId(parts) { return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 24); }

export function applyUci(chess, uci) {
  try { return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch { return null; }
}

/** Cards from one analysed decision of the player's own games (rows produced by the pattern detector). */
export function cardsFromRow(row) {
  if (!row?.patternId || !row.fen || !row.moveUci) return [];
  const cards = [];
  const base = { source: "own", patternId: row.patternId, gameId: row.gameId, moveNumber: row.moveNumber, origin: row.exerciseId ?? null,
    context: { playedUci: row.moveUci, replyUci: row.replyUci ?? null, bestPv: row.referencePv ?? (row.referenceUci ? [row.referenceUci] : []) } };
  const after = new Chess(row.fen);
  const played = applyUci(after, row.moveUci);
  if (played && row.replyUci) {
    const probe = new Chess(after.fen());
    const reply = applyUci(probe, row.replyUci);
    // Only meaningful when the reply actually punishes: capture, check or mate.
    if (reply && (reply.captured || reply.san.includes("+") || reply.san.includes("#"))) {
      cards.push({ ...base, id: cardId(["own-ref", row.fen, row.moveUci]), kind: "refutation", fen: row.fen,
        candidateUci: row.moveUci, solution: [row.replyUci], allowEngineAlternatives: true });
    }
  }
  if (row.referenceUci && row.referenceUci !== row.moveUci) {
    cards.push({ ...base, id: cardId(["own-find", row.fen]), kind: "find-move", fen: row.fen,
      candidateUci: null, solution: [row.referenceUci], allowEngineAlternatives: true });
  }
  return cards;
}

/** One card per Lichess puzzle. Two thirds are framed as refutation drills (the core weakness). */
export function cardFromPuzzle(p) {
  const id = cardId(["puzzle", p.id]);
  const kind = parseInt(id.slice(0, 2), 16) % 3 === 2 ? "find-move" : "refutation";
  const patternId = Object.entries(PATTERN_THEMES).find(([, list]) => list.some(t => p.themes.includes(t)))?.[0] ?? null;
  if (kind === "refutation") {
    return { id, source: "puzzle", puzzleId: p.id, kind, patternId, themes: p.themes, rating: p.rating,
      fen: p.fen, candidateUci: p.moves[0], solution: p.moves.slice(1), allowEngineAlternatives: false };
  }
  const chess = new Chess(p.fen); applyUci(chess, p.moves[0]);
  return { id, source: "puzzle", puzzleId: p.id, kind, patternId, themes: p.themes, rating: p.rating,
    fen: chess.fen(), candidateUci: null, lastMoveUci: p.moves[0], solution: p.moves.slice(1), allowEngineAlternatives: false };
}

/** Position the solver sees, and whose pieces they move. */
export function presentCard(card) {
  const chess = new Chess(card.fen);
  let candidate = null;
  if (card.candidateUci) candidate = applyUci(chess, card.candidateUci);
  const solverColor = chess.turn() === "w" ? "white" : "black";
  // Refutation: board stays oriented to the side that considered the candidate.
  const orientation = card.kind === "refutation" ? (solverColor === "white" ? "black" : "white") : solverColor;
  const last = card.candidateUci ?? card.lastMoveUci ?? null;
  return { fen: chess.fen(), solverColor, orientation, candidateSan: candidate?.san ?? null,
    lastMove: last ? { from: last.slice(0, 2), to: last.slice(2, 4) } : null, steps: Math.ceil(card.solution.length / 2) };
}

/** Exact check against the stored line. A different move that mates also counts (Lichess rule). */
export function checkStep(fen, solution, stepIndex, moveUci) {
  const expected = solution[stepIndex * 2];
  if (!expected) return { ok: false, reason: "no_step" };
  const chess = new Chess(fen);
  const move = applyUci(chess, moveUci);
  if (!move) return { ok: false, reason: "illegal" };
  if (moveUci === expected) return { ok: true, exact: true };
  if (chess.isCheckmate()) return { ok: true, exact: false, mate: true };
  return { ok: false, reason: "different" };
}

/** Lines in SAN for feedback, plus a simple material balance of the solution line from the solver's view. */
export function describeLine(fen, ucis) {
  const chess = new Chess(fen); const san = []; let balance = 0; const solver = chess.turn();
  for (const uci of ucis) {
    const mover = chess.turn(); const move = applyUci(chess, uci);
    if (!move) break;
    san.push(move.san);
    if (move.captured) balance += (mover === solver ? 1 : -1) * VALUE[move.captured];
  }
  return { san, materialSwing: balance, mate: chess.isCheckmate() };
}
