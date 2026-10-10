import { SPARRING_TARGET_SELECTION_VERSION } from "./constants.js";
import { pressureTargetScore } from "./pressure.js";

const MAX_CONSECUTIVE_SAME_RESOURCE = 3;

export function applyDiversityAdjustment(features, recentResources = []) {
  const resource = features.likelyDefensiveResource;
  if (!resource) return 0;
  const tail = recentResources.slice(-MAX_CONSECUTIVE_SAME_RESOURCE);
  if (tail.length >= MAX_CONSECUTIVE_SAME_RESOURCE && tail.every((r) => r === resource)) {
    return -4;
  }
  if (recentResources.slice(-2).filter((r) => r === resource).length >= 2) {
    return -1.5;
  }
  return 0;
}

export function scoreCandidate(candidate, context) {
  const targetScore = pressureTargetScore(candidate.pressureFeatures, context.profile);
  const diversityAdjustment = applyDiversityAdjustment(
    candidate.pressureFeatures,
    context.recentDefensiveResources ?? [],
  );
  const finalScore =
    targetScore +
    diversityAdjustment -
    Math.max(0, (candidate.rank ?? 1) - 1) * 0.15;
  return { targetScore, diversityAdjustment, finalScore };
}

export function annotateCandidates(candidates, context) {
  return candidates.map((c) => {
    const scored = scoreCandidate(c, context);
    return { ...c, ...scored };
  });
}

export function selectFromCandidates(candidates, { pickTie }) {
  const personalized = candidates.filter((c) => c.qualityEligible && c.finalScore > 0);
  const pool = personalized.length ? personalized : candidates.filter((c) => c.qualityEligible);
  if (!pool.length) {
    const best = candidates.find((c) => c.rank === 1) ?? candidates[0];
    return { chosen: best, fallback: true, version: SPARRING_TARGET_SELECTION_VERSION };
  }
  const chosen = pickTie(pool);
  return { chosen, fallback: false, version: SPARRING_TARGET_SELECTION_VERSION };
}
