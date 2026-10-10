import { Chess } from "chess.js";
import { SPARRING_PRESSURE_VERSION } from "./constants.js";
import { countSafeReplies, createsNarrowDefense } from "./narrow-defense.js";

function gamePhase(fen) {
  const chess = new Chess(fen);
  const board = chess.board();
  let pieces = 0;
  let queens = 0;
  for (const row of board) {
    for (const p of row) {
      if (!p) continue;
      pieces += 1;
      if (p.type === "q") queens += 1;
    }
  }
  const moveNumber = Number.parseInt(fen.split(" ")[5] ?? "1", 10);
  if (moveNumber <= 12 && pieces >= 28) return "opening";
  if (pieces <= 12 || (queens === 0 && pieces <= 16)) return "endgame";
  return "middlegame";
}

function inferDefensiveResource({ givesCheck, createsForcingCapture, createsMateThreat, attacksHighValuePiece }) {
  if (givesCheck) return "countercheck";
  if (createsForcingCapture) return "capture_attacker";
  if (attacksHighValuePiece) return "defend_target";
  if (createsMateThreat) return "block_or_interpose";
  return null;
}

export function extractPressureFeatures(fen, agentUci, userColor, profileContext = {}) {
  const chess = new Chess(fen);
  const beforeTurn = chess.turn();
  const move = chess.move({
    from: agentUci.slice(0, 2),
    to: agentUci.slice(2, 4),
    promotion: agentUci[4],
  });
  const empty = {
    givesCheck: false,
    createsForcingCapture: false,
    createsMateThreat: false,
    attacksHighValuePiece: false,
    createsNarrowDefense: false,
    safeRepliesCount: null,
    likelyDefensiveResource: null,
    matchesPriorityPattern: false,
    matchesWeakDefenseResource: false,
    repeatsRecentMotif: false,
    phase: gamePhase(fen),
    version: SPARRING_PRESSURE_VERSION,
  };
  if (!move) return empty;

  const givesCheck = chess.inCheck();
  const createsForcingCapture = move.flags.includes("c") || move.flags.includes("e");
  const createsMateThreat = chess.isCheck() && chess.moves().length <= 3;

  const target = move.to;
  const attacked = chess.isAttacked(target, beforeTurn);
  const attacksHighValuePiece = attacked && (move.captured === "q" || move.captured === "r" || move.captured === "n" || move.captured === "b");

  const safeRepliesCount = countSafeReplies(fen, agentUci, userColor);
  const narrow = createsNarrowDefense(fen, agentUci, userColor);

  const likelyDefensiveResource = inferDefensiveResource({
    givesCheck,
    createsForcingCapture,
    createsMateThreat,
    attacksHighValuePiece,
  });

  const priorityPattern = profileContext.patternId ?? "allowed-forcing-reply";
  const matchesPriorityPattern =
    priorityPattern === "allowed-forcing-reply" &&
    (createsForcingCapture || givesCheck) &&
    safeRepliesCount != null &&
    safeRepliesCount <= 4;

  const weakResources = profileContext.defenseResourceNeeds ?? {};
  const matchesWeakDefenseResource =
    likelyDefensiveResource != null &&
    (weakResources[likelyDefensiveResource] ?? 0) >= 0.55;

  const recent = profileContext.recentMotifs ?? [];
  const motifKey = `${givesCheck ? "c" : ""}${createsForcingCapture ? "x" : ""}${narrow ? "n" : ""}`;
  const repeatsRecentMotif = motifKey.length > 0 && recent.slice(-3).includes(motifKey);

  return {
    givesCheck,
    createsForcingCapture,
    createsMateThreat,
    attacksHighValuePiece,
    createsNarrowDefense: narrow,
    safeRepliesCount,
    likelyDefensiveResource,
    matchesPriorityPattern,
    matchesWeakDefenseResource,
    repeatsRecentMotif,
    phase: gamePhase(fen),
    version: SPARRING_PRESSURE_VERSION,
  };
}

export function pressureTargetScore(features, profileContext = {}) {
  let score = 0;
  if (features.matchesPriorityPattern) score += 3.5;
  if (features.matchesWeakDefenseResource) score += 2;
  if (features.createsNarrowDefense) score += 1.5;
  if (features.createsForcingCapture) score += 1.2;
  if (features.givesCheck) score += 0.6;
  if (features.createsMateThreat) score += 1;
  if (features.repeatsRecentMotif) score -= 2.5;

  const uncertainty = profileContext.uncertainty ?? {};
  const resource = features.likelyDefensiveResource;
  if (resource && (uncertainty[resource] ?? 0.5) > 0.45) score += 0.8;

  const spacing = profileContext.daysSinceLastPractice ?? 0;
  if (spacing >= 2) score += 0.4;

  return score;
}
