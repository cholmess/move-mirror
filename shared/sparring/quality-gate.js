import { Chess } from "chess.js";
import { SPARRING_QUALITY_GATE_VERSION, STYLE_MAX_LOSS_CP } from "./constants.js";

const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function scoreCp(score) {
  if (!score) return null;
  if (score.mate != null) return score.mate > 0 ? 10_000 - score.mate : -10_000 - score.mate;
  return score.cp ?? null;
}

function hangsMajorPiece(fen, uci, agentColor) {
  try {
    const chess = new Chess(fen);
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4],
    });
    if (!move) return false;
    const opponent = agentColor === "white" ? "b" : "w";
    const moved = chess.get(move.to);
    if (moved && (moved.type === "q" || moved.type === "r")) {
      if (chess.isAttacked(move.to, opponent)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function lossVsBestCp(bestScore, candidateScore, agentColor) {
  const best = scoreCp(bestScore);
  const cand = scoreCp(candidateScore);
  if (best == null || cand == null) return null;
  return best - cand;
}

export function passesQualityGate({
  style,
  rank,
  bestScore,
  candidateScore,
  fen,
  uci,
  agentColor,
}) {
  const maxLoss = STYLE_MAX_LOSS_CP[style] ?? STYLE_MAX_LOSS_CP.balanced;
  const loss = lossVsBestCp(bestScore, candidateScore, agentColor);

  if (rank === 1) {
    return { eligible: true, reason: "engine_best", lossVsBestCp: loss, version: SPARRING_QUALITY_GATE_VERSION };
  }

  if (loss != null && loss > maxLoss) {
    return { eligible: false, reason: "exceeds_style_loss", lossVsBestCp: loss, version: SPARRING_QUALITY_GATE_VERSION };
  }

  const bestMate = bestScore?.mate;
  const candMate = candidateScore?.mate;
  if (bestMate != null && bestMate > 0 && (candMate == null || candMate <= 0)) {
    return { eligible: false, reason: "throws_away_mate", lossVsBestCp: loss, version: SPARRING_QUALITY_GATE_VERSION };
  }

  if (style === "instructional" && candMate != null && candMate < 0) {
    return { eligible: false, reason: "instructional_no_self_mate", lossVsBestCp: loss, version: SPARRING_QUALITY_GATE_VERSION };
  }

  if (hangsMajorPiece(fen, uci, agentColor)) {
    return { eligible: false, reason: "hangs_major_piece", lossVsBestCp: loss, version: SPARRING_QUALITY_GATE_VERSION };
  }

  return { eligible: true, reason: "within_style", lossVsBestCp: loss, version: SPARRING_QUALITY_GATE_VERSION };
}

export { PIECE_VALUES };
