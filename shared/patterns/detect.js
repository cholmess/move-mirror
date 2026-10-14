import { Chess } from "chess.js";
import { createHash } from "node:crypto";
import { LOSS_THRESHOLD } from "./catalog.js";
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export function hash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function positionKey(fen) { return fen.split(" ").slice(0, 4).join(" "); }
export function playUci(chess, uci) {
  try { return chess.move({ from: uci?.slice(0, 2), to: uci?.slice(2, 4), promotion: uci?.[4] }); } catch { return null; }
}
export function positionContext(fen) {
  const chess = new Chess(fen); let lockedPairs = 0; let material = 0;
  for (const row of chess.board()) for (const piece of row) {
    if (!piece) continue;
    material += VALUE[piece.type];
    if (piece.type === "p" && piece.color === "w") {
      const rank = Number(piece.square[1]);
      const ahead = rank < 8 ? chess.get(`${piece.square[0]}${rank + 1}`) : null;
      if (ahead?.type === "p" && ahead.color === "b") lockedPairs++;
    }
  }
  return { closed: lockedPairs >= 2, endgame: material <= 26, inCheck: chess.inCheck(), lockedPairs };
}
/** Observable classifications; no attribution of a cognitive or strategic cause. */
export function classifyDecision({ fen, moveUci }, result) {
  if (!result?.verified || ["illegal", "unverified"].includes(result.status)
    || !result.engineVersion || !result.engineSha256 || result.evalCriterionVersion !== "engine-validated-v2") return null;
  const chess = new Chess(fen); const bestUci = result.best?.firstMoveUci;
  const bestMove = playUci(new Chess(fen), bestUci);
  const played = playUci(chess, moveUci);
  if (!bestMove || !played || result.played?.firstMoveUci !== moveUci) return null;
  const reply = result.opponentReplyUci ? playUci(chess, result.opponentReplyUci) : null;
  if (result.opponentReplyUci && !reply) return null;
  const context = positionContext(fen);
  const bestMate = result.best?.score?.mate;
  const playedMate = result.played?.score?.mate;
  const missedMate = Number.isFinite(bestMate) && bestMate > 0 && !(Number.isFinite(playedMate) && playedMate > 0);
  const loss = result.cpLoss;
  if (!Number.isFinite(loss) && !missedMate) return null;
  const captureOpportunity = Boolean(bestMove.captured && VALUE[bestMove.captured] >= 3);
  const opportunities = ["piece-loss", "forcing-reply"];
  if (captureOpportunity) opportunities.push("missed-capture");
  if (Number.isFinite(bestMate) && bestMate > 0) opportunities.push("missed-mate");
  if (context.closed) opportunities.push("closed-center");
  if (context.endgame) opportunities.push("endgame-decisions");
  let patternId = null;
  if (missedMate) patternId = "missed-mate";
  else if (loss >= LOSS_THRESHOLD) {
    if (reply?.captured && VALUE[reply.captured] >= 3) patternId = "piece-loss";
    else if (captureOpportunity && moveUci !== bestUci) patternId = "missed-capture";
    else if (reply && (reply.san.includes("+") || reply.san.includes("#"))) patternId = "forcing-reply";
    else if (context.closed) patternId = "closed-center";
    else if (context.endgame) patternId = "endgame-decisions";
  }
  return { context, opportunities, patternId, loss: Number.isFinite(loss) ? loss : null,
    referenceUci: bestUci, referenceSan: bestMove.san, referencePv: result.best.pvUci ?? [bestUci],
    replyUci: result.opponentReplyUci ?? null, replySan: reply?.san ?? null,
    engineVersion: result.engineVersion, engineSha256: result.engineSha256, budget: result.evalFinalBudgetId };
}
