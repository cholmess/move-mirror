import { SPARRING_POLICY_VERSION } from "./constants.js";
import { passesQualityGate } from "./quality-gate.js";
import { extractPressureFeatures } from "./pressure.js";
import { annotateCandidates, selectFromCandidates } from "./target-selection.js";
import { pickDeterministicTie } from "./determinism.js";

export function buildCandidatesFromMultiPv({
  fen,
  agentColor,
  userColor,
  multiPvLines,
  style,
  profileContext,
  recentDefensiveResources,
  recentMotifs,
}) {
  const bestScore = multiPvLines[0]?.score ?? null;
  const raw = multiPvLines.map((line, index) => {
    const uci = line.firstMoveUci ?? line.pvUci?.[0];
    const gate = passesQualityGate({
      style,
      rank: line.multipv ?? index + 1,
      bestScore,
      candidateScore: line.score,
      fen,
      uci,
      agentColor,
    });
    const pressureFeatures = extractPressureFeatures(fen, uci, userColor, {
      ...profileContext,
      recentMotifs,
    });
    return {
      uci,
      san: line.san ?? null,
      rank: line.multipv ?? index + 1,
      scoreFromAgentPerspective: line.score,
      lossVsBestCp: gate.lossVsBestCp,
      mateChange: {
        best: bestScore?.mate ?? null,
        candidate: line.score?.mate ?? null,
      },
      pv: line.pvUci ?? [],
      qualityEligible: gate.eligible,
      qualityReason: gate.reason,
      pressureFeatures,
      targetScore: 0,
      diversityAdjustment: 0,
      finalScore: 0,
    };
  });

  const annotated = annotateCandidates(raw, {
    profile: profileContext,
    recentDefensiveResources,
  });

  return annotated;
}

export function chooseAgentMove(context) {
  const {
    fen,
    agentColor,
    userColor,
    multiPvLines,
    style,
    profileSnapshot,
    seed,
    turnKey,
    recentDefensiveResources = [],
    recentMotifs = [],
  } = context;

  const profileContext = {
    patternId: profileSnapshot?.patternId ?? "allowed-forcing-reply",
    defenseResourceNeeds: profileSnapshot?.defenseResourceNeeds ?? {},
    uncertainty: profileSnapshot?.uncertainty ?? {},
    daysSinceLastPractice: profileSnapshot?.daysSinceLastPractice ?? 0,
  };

  const candidates = buildCandidatesFromMultiPv({
    fen,
    agentColor,
    userColor,
    multiPvLines,
    style,
    profileContext,
    recentDefensiveResources,
    recentMotifs,
  });

  const { chosen, fallback } = selectFromCandidates(candidates, {
    pickTie: (pool) => pickDeterministicTie(pool, seed, turnKey),
  });

  return {
    policyVersion: SPARRING_POLICY_VERSION,
    chosen,
    candidates,
    fallbackToBest: fallback,
  };
}
