import { Chess } from "chess.js";

export const DEFENSE_VERSIONS = Object.freeze({
  detector: "defense-opportunity-v1",
  exercise: "defense-exercise-v1",
  motif: "defense-motif-v1",
  adaptive: "defense-adaptive-v1",
  state: "defense-lab-state-v1",
});

export const DEFENSIVE_RESOURCES = Object.freeze([
  "countercheck",
  "capture_attacker",
  "move_attacked_piece",
  "defend_target",
  "block_or_interpose",
  "trade_attackers",
  "queen_trade",
  "create_escape_square",
  "remove_defender",
  "counterattack",
  "simplify",
  "prophylaxis",
  "unknown",
]);

export function stableDefenseExerciseId(
  gameId,
  ply,
  detectorVersion = DEFENSE_VERSIONS.detector,
) {
  if (detectorVersion !== DEFENSE_VERSIONS.detector) {
    throw new Error(`unsupported_defense_detector:${detectorVersion}`);
  }
  return `def-${gameId}-${ply}`;
}

export function uciFromSan(fen, san) {
  try {
    const chess = new Chess(fen);
    const move = chess.move(san);
    return move ? `${move.from}${move.to}${move.promotion ?? ""}` : null;
  } catch {
    return null;
  }
}

export function sanLineFromUci(fen, line) {
  const chess = new Chess(fen);
  const san = [];
  for (const uci of line ?? []) {
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4],
    });
    if (!move) break;
    san.push(move.san);
  }
  return san;
}

export function isPositionDefendable({ bestScore, alternatives = [] }) {
  if (!bestScore) return { accepted: false, reason: "missing_best_evaluation" };
  if (bestScore.mate !== null && bestScore.mate !== undefined) {
    if (bestScore.mate < 0) {
      const escape = alternatives.some((candidate) =>
        candidate?.score?.mate == null || candidate.score.mate > 0
      );
      return escape
        ? { accepted: true, reason: "recommended_defense_avoids_mate" }
        : { accepted: false, reason: "mate_inevitable_under_verified_alternatives" };
    }
    return { accepted: true, reason: "winning_or_mating_defense_available" };
  }
  if (typeof bestScore.cp !== "number") {
    return { accepted: false, reason: "inconsistent_best_evaluation" };
  }
  return bestScore.cp >= -250
    ? { accepted: true, reason: "best_defense_at_least_minus_250_cp" }
    : { accepted: false, reason: "position_already_completely_lost" };
}

export function detectDefenseOpportunity(input) {
  const reasons = [];
  try {
    const chess = new Chess(input.fen);
    if (chess.isGameOver()) reasons.push("position_finished");
  } catch {
    return { accepted: false, reasons: ["invalid_fen"] };
  }

  if (!uciFromSan(input.fen, input.playedSan)) reasons.push("illegal_played_move");
  if (!uciFromSan(input.fen, input.referenceSan)) reasons.push("illegal_reference_move");
  if (input.activeCohort) reasons.push("active_transfer_cohort");

  const defendable = isPositionDefendable({
    bestScore: input.bestScore,
    alternatives: input.alternatives,
  });
  if (!defendable.accepted) reasons.push(defendable.reason);
  else reasons.push(defendable.reason);

  const mateImproved =
    input.bestScore?.mate != null &&
    (input.playedScore?.mate == null ||
      (input.bestScore.mate > 0 && input.playedScore?.mate < 0));
  if (!(typeof input.cpLoss === "number" && input.cpLoss >= 120) && !mateImproved) {
    reasons.push("loss_below_120_cp");
  }
  if (!input.forcingConsequence) reasons.push("no_immediate_forcing_consequence");
  if (!input.explainableResource) reasons.push("no_concrete_defensive_resource");

  const exclusions = new Set([
    "position_finished",
    "invalid_fen",
    "illegal_played_move",
    "illegal_reference_move",
    "active_transfer_cohort",
    "position_already_completely_lost",
    "mate_inevitable_under_verified_alternatives",
    "missing_best_evaluation",
    "inconsistent_best_evaluation",
    "loss_below_120_cp",
    "no_immediate_forcing_consequence",
    "no_concrete_defensive_resource",
  ]);
  return {
    accepted: !reasons.some((reason) => exclusions.has(reason)),
    reasons,
  };
}

export function classifyDefensiveMotif({ fen, defenseSan, actualLineSan = [], motifs = [] }) {
  const evidence = [];
  let resource = "unknown";
  let confidence = "low";
  const firstReply = actualLineSan[1] ?? "";

  if (/[+#]$/.test(defenseSan)) {
    resource = "countercheck";
    confidence = "high";
    evidence.push("La defensa da jaque y obliga al rival a responder.");
  } else if (/^Q?x/.test(defenseSan) && /^Q?x/.test(firstReply)) {
    resource = defenseSan.startsWith("Q") ? "queen_trade" : "trade_attackers";
    confidence = "medium";
    evidence.push("La defensa inicia un cambio que reduce las piezas atacantes.");
  } else if (/x/.test(defenseSan)) {
    resource = motifs.includes("allowed_piece_capture")
      ? "capture_attacker"
      : "remove_defender";
    confidence = "medium";
    evidence.push("La defensa usa una captura para alterar la amenaza.");
  } else if (/^K/.test(defenseSan)) {
    resource = "create_escape_square";
    confidence = "medium";
    evidence.push("La defensa recoloca el rey frente a la continuación forzante.");
  } else if (motifs.includes("allowed_piece_capture") && firstReply.includes("x")) {
    resource = "move_attacked_piece";
    confidence = "medium";
    evidence.push("La línea real muestra una captura inmediata que la defensa evita.");
  } else if (motifs.includes("missed_forcing_move")) {
    resource = "counterattack";
    confidence = "medium";
    evidence.push("La defensa crea una obligación antes de que el rival ejecute su idea.");
  } else {
    resource = "prophylaxis";
    evidence.push("La defensa reduce la continuación rival sin una táctica única observable.");
  }

  if (!uciFromSan(fen, defenseSan)) {
    return {
      resource: "unknown",
      confidence: "low",
      evidence: ["No fue posible reconstruir legalmente el recurso propuesto."],
      classifierVersion: DEFENSE_VERSIONS.motif,
    };
  }
  return { resource, confidence, evidence, classifierVersion: DEFENSE_VERSIONS.motif };
}

export function threatFromLine(line = []) {
  const reply = line[1] ?? "";
  if (reply.endsWith("#")) {
    return { type: "mate", description: "El rival disponía de una amenaza de mate.", confidence: "high" };
  }
  if (reply.endsWith("+")) {
    return { type: "check", description: "El rival podía responder con un jaque forzante.", confidence: "high" };
  }
  if (reply.includes("x")) {
    return { type: "capture", description: "El rival podía capturar de inmediato, ganando material o tiempo.", confidence: "high" };
  }
  return {
    type: "positional",
    description: "La respuesta rival mantenía una presión concreta que exigía precisión.",
    confidence: "low",
  };
}

export function limitOnePerGame(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.source.gameId)) return false;
    seen.add(candidate.source.gameId);
    return true;
  });
}
