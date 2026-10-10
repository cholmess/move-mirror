import { Chess } from "chess.js";
import { analysisIncomplete, isContradictory, mateStateUnstable } from "../evaluation/escalation.js";
import {
  CONFIRM_BAND,
  CONFIRM_POLICY_ID,
  DETECTOR,
  DETECTOR_ID,
  ENDGAME_MAX_MATERIAL,
  OPENING_MAX_PLY,
  PHASE_PROXY_ID,
  PIECE_VALUE,
} from "./constants.js";

const MATERIAL = { p: 1, n: 3, b: 3, r: 5, q: 9 };

export function totalMaterial(fen) {
  const board = String(fen).split(" ")[0] ?? "";
  let total = 0;
  for (const ch of board) {
    const value = MATERIAL[ch.toLowerCase()];
    if (value) total += value;
  }
  return total;
}

/** Same phase function for baseline and transfer. */
export function phaseProxy(fen, ply) {
  if (ply <= OPENING_MAX_PLY) return "opening_proxy";
  if (totalMaterial(fen) <= ENDGAME_MAX_MATERIAL) return "endgame_proxy";
  return "middlegame_proxy";
}

export function phaseProxyMeta() {
  return {
    id: PHASE_PROXY_ID,
    opening: `ply <= ${OPENING_MAX_PLY}`,
    endgame: `material <= ${ENDGAME_MAX_MATERIAL} (Q9 R5 B3 N3 P1)`,
    else: "middlegame_proxy",
  };
}

export function severityBand(loss) {
  if (loss >= 800) return "grave";
  if (loss >= 300) return "marcada";
  return "notable";
}

function applyUci(chess, uci) {
  if (!uci || uci.length < 4) return null;
  try {
    return chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
  } catch {
    return null;
  }
}

/**
 * Classifies the principal opponent reply (pv[1] of the played line).
 * Mate, check and capture are separate flags. A mate is also a check.
 */
export function classifyPrincipalReply(fenBefore, playedUci, replyUci) {
  if (!replyUci) {
    return { forcing: false, pieceCapture: false, kind: "none", reason: "no_reply" };
  }
  let chess;
  try {
    chess = new Chess(fenBefore);
  } catch {
    return { forcing: false, pieceCapture: false, kind: "none", reason: "bad_fen" };
  }
  if (!applyUci(chess, playedUci)) {
    return { forcing: false, pieceCapture: false, kind: "none", reason: "illegal_played" };
  }
  const reply = applyUci(chess, replyUci);
  if (!reply) {
    return { forcing: false, pieceCapture: false, kind: "none", reason: "illegal_reply" };
  }
  const isMate = chess.isCheckmate();
  const isCheck = isMate || chess.inCheck() || reply.san.includes("+") || reply.san.includes("#");
  const isCapture = Boolean(reply.captured);
  const capturedValue = reply.captured ? PIECE_VALUE[reply.captured] ?? 0 : 0;
  const pieceCapture = isCapture && capturedValue >= DETECTOR.pieceValueMin;
  let kind = "quiet";
  if (isMate) kind = "mate";
  else if (isCheck) kind = "check";
  else if (isCapture) kind = "capture";
  return {
    forcing: isCapture || isCheck || isMate,
    isMate,
    isCheck,
    isCapture,
    capturedValue,
    pieceCapture,
    kind,
    san: reply.san,
    reason: null,
  };
}

export function assertDetectorUntuned(detector = DETECTOR, cohortId = null) {
  if (!detector || detector.id !== DETECTOR.id) {
    throw new Error("detector_mismatch");
  }
  if (detector.lossThreshold !== DETECTOR.lossThreshold) {
    throw new Error("detector_mutated");
  }
  if (detector.pieceValueMin !== DETECTOR.pieceValueMin) {
    throw new Error("detector_mutated");
  }
  if (detector.adjustable) {
    throw new Error("detector_must_not_be_fit");
  }
  if (detector.fitCohortId) {
    if (!cohortId || detector.fitCohortId === cohortId) {
      throw new Error("cohort_used_to_fit_itself");
    }
    throw new Error("detector_must_not_be_fit");
  }
}

export function detectEvent({ cpLoss, fenBefore, playedUci, replyUci, detector = DETECTOR, cohortId = null }) {
  assertDetectorUntuned(detector, cohortId);
  const reply = classifyPrincipalReply(fenBefore, playedUci, replyUci);
  const loss = cpLoss === null || cpLoss === undefined ? null : Number(cpLoss);
  const lossOk = loss !== null && Number.isFinite(loss) && loss >= detector.lossThreshold;
  const event = Boolean(lossOk && reply.forcing);
  return {
    detectorId: DETECTOR_ID,
    event,
    pieceCaptureSubgroup: Boolean(event && reply.pieceCapture),
    loss,
    severity: event ? severityBand(loss) : null,
    reply,
  };
}

/** Deep confirmation used for every cohort. Not the exercise 50 cp band. */
export function needsDeepConfirmation({ cpLoss, best, played, playedUci }) {
  if (analysisIncomplete(best) || analysisIncomplete(played)) {
    return { confirm: true, reason: "incomplete_shallow", policyId: CONFIRM_POLICY_ID };
  }
  if (cpLoss !== null && cpLoss !== undefined && cpLoss >= CONFIRM_BAND[0] && cpLoss <= CONFIRM_BAND[1]) {
    return { confirm: true, reason: "near_threshold_120", policyId: CONFIRM_POLICY_ID };
  }
  if (mateStateUnstable(best?.score, played?.score)) {
    return { confirm: true, reason: "mate_state_change", policyId: CONFIRM_POLICY_ID };
  }
  if (isContradictory({ best, playedUci, cpLoss })) {
    return { confirm: true, reason: "unstable_contradictory", policyId: CONFIRM_POLICY_ID };
  }
  return { confirm: false, reason: null, policyId: CONFIRM_POLICY_ID };
}
