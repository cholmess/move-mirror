import { Chess } from "chess.js";

const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

function materialBalance(chess, forColor) {
  const board = chess.board();
  let score = 0;
  for (const row of board) {
    for (const piece of row) {
      if (!piece) continue;
      const v = PIECE_VALUES[piece.type] ?? 0;
      score += piece.color === forColor ? v : -v;
    }
  }
  return score;
}

function isReplyAcceptable(fenAfterAgent, userColor) {
  const chess = new Chess(fenAfterAgent);
  if (chess.turn() !== userColor[0]) return false;
  if (chess.isCheckmate()) return false;

  const moves = chess.moves({ verbose: true });
  let acceptable = 0;
  for (const m of moves) {
    const trial = new Chess(fenAfterAgent);
    trial.move(m);
    if (trial.isCheckmate()) continue;
    const before = materialBalance(new Chess(fenAfterAgent), userColor[0]);
    const after = materialBalance(trial, userColor[0]);
    if (after >= before - 2) acceptable += 1;
  }
  return acceptable > 0;
}

/**
 * Count user replies that keep material within a small swing (reproducible heuristic).
 */
export function countSafeReplies(fen, agentUci, userColor) {
  const chess = new Chess(fen);
  const move = chess.move({
    from: agentUci.slice(0, 2),
    to: agentUci.slice(2, 4),
    promotion: agentUci[4],
  });
  if (!move) return null;
  const fenAfter = chess.fen();
  const trial = new Chess(fenAfter);
  const replies = trial.moves({ verbose: true });
  let safe = 0;
  for (const r of replies) {
    const c2 = new Chess(fenAfter);
    c2.move(r);
    if (c2.isCheckmate()) continue;
    const before = materialBalance(new Chess(fenAfter), userColor[0]);
    const after = materialBalance(c2, userColor[0]);
    if (after >= before - 3) safe += 1;
  }
  return safe;
}

export function createsNarrowDefense(fen, agentUci, userColor, threshold = 2) {
  const safe = countSafeReplies(fen, agentUci, userColor);
  if (safe == null) return false;
  return safe <= threshold && safe >= 1;
}

export { isReplyAcceptable };
