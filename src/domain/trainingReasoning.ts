import { Chess } from "chess.js";
import type {
  CctCapture,
  ReasoningMove,
  TrainingReasoningV2,
} from "../types/learning";

export type ReasoningCategory = "checks" | "captures" | "threats";

export function moveFromSquares(
  fen: string,
  from: string,
  to: string,
  promotion = "q",
): ReasoningMove | null {
  try {
    const game = new Chess(fen);
    const move = game.move({ from, to, promotion });
    return move ? { uci: `${move.from}${move.to}${move.promotion ?? ""}`, san: move.san } : null;
  } catch {
    return null;
  }
}

export function positionAfterMove(fen: string, move: ReasoningMove): string | null {
  try {
    const game = new Chess(fen);
    const played = game.move({
      from: move.uci.slice(0, 2),
      to: move.uci.slice(2, 4),
      promotion: move.uci.slice(4) || "q",
    });
    return played ? game.fen() : null;
  } catch {
    return null;
  }
}

export function isCheckmateAfterMove(fen: string, move: ReasoningMove): boolean {
  const next = positionAfterMove(fen, move);
  return next ? new Chess(next).isCheckmate() : false;
}

export function addUniqueMove<T extends ReasoningMove>(moves: T[], move: T): T[] {
  return moves.some((item) => item.uci === move.uci) ? moves : [...moves, move];
}

export function categoryForMove(fen: string, move: ReasoningMove) {
  const game = new Chess(fen);
  const played = game.move({
    from: move.uci.slice(0, 2),
    to: move.uci.slice(2, 4),
    promotion: move.uci.slice(4) || "q",
  });
  if (!played) return null;
  return {
    check: game.inCheck(),
    capture: played.isCapture(),
    promotion: played.isPromotion(),
    castle: played.isKingsideCastle() || played.isQueensideCastle(),
    checkmate: game.isCheckmate(),
  };
}

export function legacyCctFromReasoning(value: TrainingReasoningV2): CctCapture {
  const list = (moves: ReasoningMove[], none: string) =>
    moves.length ? moves.map((move) => move.san).join(", ") : none;
  return {
    checksConsidered: list(value.checks.moves, "none_seen"),
    capturesConsidered: list(value.captures.moves, "none_seen"),
    threatsConsidered: value.threats.moves.length
      ? value.threats.moves.map((move) => move.note ? `${move.san}: ${move.note}` : move.san).join(", ")
      : "none_seen",
    firstCandidate: value.candidate.san,
    opponentForcedResponse:
      value.predictedReply.status === "move_selected"
        ? value.predictedReply.move.san
        : value.predictedReply.status,
  };
}

export function isTrainingReasoningV2(value: unknown): value is TrainingReasoningV2 {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<TrainingReasoningV2>;
  return item.version === "training-reasoning-v2" && !!item.candidate && !!item.predictedReply;
}
