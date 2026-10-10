import { Chess } from "chess.js";

export function positionHash(fen, movesUci = []) {
  return `${fen}|${movesUci.join(",")}`;
}

export function agentTurnNumber(movesUci, userColor, startingFen) {
  const chess = new Chess(startingFen);
  let agentCount = 0;
  for (const uci of movesUci) {
    const agentToMove =
      (userColor === "white" && chess.turn() === "b") || (userColor === "black" && chess.turn() === "w");
    chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4],
    });
    if (agentToMove) agentCount += 1;
  }
  return agentCount;
}

export function sideToMoveIsAgent(fen, userColor) {
  const turn = fen.split(" ")[1];
  if (userColor === "white") return turn === "b";
  return turn === "w";
}

export function applyUci(fen, uci) {
  const chess = new Chess(fen);
  const move = chess.move({
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci[4],
  });
  if (!move) return null;
  return { san: move.san, uci, fen: chess.fen(), chess };
}

export function detectTermination(chess, { trainingGoalReached = false } = {}) {
  if (trainingGoalReached) {
    return { result: "*", termination: "training_goal_reached" };
  }
  if (chess.isCheckmate()) {
    const winner = chess.turn() === "w" ? "black" : "white";
    return { result: winner === "white" ? "1-0" : "0-1", termination: "checkmate" };
  }
  if (chess.isStalemate()) return { result: "1/2-1/2", termination: "stalemate" };
  if (chess.isInsufficientMaterial()) return { result: "1/2-1/2", termination: "insufficient_material" };
  if (chess.isThreefoldRepetition()) return { result: "1/2-1/2", termination: "threefold_repetition" };
  const halfmove = Number.parseInt(chess.fen().split(" ")[4] ?? "0", 10);
  if (halfmove >= 100) return { result: "1/2-1/2", termination: "fifty_move_rule" };
  return null;
}

export function rebuildChess(startingFen, movesUci) {
  const chess = new Chess(startingFen);
  const san = [];
  for (const uci of movesUci) {
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4],
    });
    if (!move) throw new Error("illegal_move_in_history");
    san.push(move.san);
  }
  return { chess, fen: chess.fen(), san };
}

export function idempotencyKey(sessionId, fen, agentTurnNo) {
  return `${sessionId}|${fen}|agent-${agentTurnNo}`;
}
