import {
  CONFIDENCE_CAP,
  CONFIDENCE_FLOOR,
  CONFIDENCE_PER_INDEPENDENT,
  DOMAIN_PRIOR_ALPHA,
  DOMAIN_PRIOR_BETA,
  PATTERN_LEARNING_VERSION,
  STABLE_MASTERY_MIN,
  STABLE_MIN_INDEPENDENT_ATTEMPTS,
} from "./learning-config.js";
import { affectsDomain } from "../evaluation/classify.js";

export function emptyPatternDomain(patternId, at) {
  const alpha = DOMAIN_PRIOR_ALPHA;
  const beta = DOMAIN_PRIOR_BETA;
  return {
    version: PATTERN_LEARNING_VERSION,
    patternId,
    independentAttempts: 0,
    independentSuccesses: 0,
    independentFailures: 0,
    assistedAttempts: 0,
    alpha,
    beta,
    masteryEstimate: alpha / (alpha + beta),
    confidence: CONFIDENCE_FLOOR,
    lifecycle: "new",
    lastPracticeAt: null,
    nextReviewAt: null,
    history: [{ at, mastery: alpha / (alpha + beta), event: "initialized", reasonKey: "learning:history.initialized" }],
  };
}

function lifecycleFrom(domain) {
  if (domain.independentAttempts === 0 && domain.assistedAttempts === 0) return "new";
  if (domain.independentAttempts < STABLE_MIN_INDEPENDENT_ATTEMPTS) return "learning";
  if (domain.masteryEstimate >= STABLE_MASTERY_MIN && domain.independentSuccesses >= STABLE_MIN_INDEPENDENT_ATTEMPTS) {
    return "stable";
  }
  return "review";
}

function alphaBetaDelta(status) {
  if (!affectsDomain(status)) return null;
  if (status === "verified_best" || status === "verified_acceptable") return { da: 1, db: 0 };
  if (status === "playable_inexact") return { da: 0.25, db: 0.75 };
  if (status === "incorrect") return { da: 0, db: 1 };
  return null;
}

/**
 * @param {ReturnType<typeof emptyPatternDomain>} domain
 * @param {{ countsForDomain: boolean, kind: string, reasonKey: string }} evidence
 * @param {{ status: string, at: string, assisted?: boolean, role?: string }} attempt
 */
export function applyDomainEvidence(domain, evidence, attempt) {
  const next = { ...domain, history: [...domain.history] };
  next.lastPracticeAt = attempt.at;
  if (attempt.role !== "holdout" && attempt.role !== "legacy") {
    if (attempt.assisted) next.assistedAttempts += 1;
    next.history.push({
      at: attempt.at,
      mastery: next.masteryEstimate,
      event: "guided_practice",
      reasonKey: evidence.reasonKey,
    });
    return next;
  }
  if (!evidence.countsForDomain) {
    if (attempt.assisted) next.assistedAttempts += 1;
    next.history.push({
      at: attempt.at,
      mastery: next.masteryEstimate,
      event: evidence.kind,
      reasonKey: evidence.reasonKey,
    });
    return next;
  }
  next.independentAttempts += 1;
  const delta = alphaBetaDelta(attempt.status);
  if (delta) {
    next.alpha += delta.da;
    next.beta += delta.db;
  }
  if (evidence.kind === "independent_success") next.independentSuccesses += 1;
  if (evidence.kind === "independent_failure") next.independentFailures += 1;
  next.masteryEstimate = next.alpha / (next.alpha + next.beta);
  next.confidence = Math.min(
    CONFIDENCE_CAP,
    CONFIDENCE_FLOOR + next.independentAttempts * CONFIDENCE_PER_INDEPENDENT,
  );
  next.lifecycle = lifecycleFrom(next);
  next.history.push({
    at: attempt.at,
    mastery: next.masteryEstimate,
    event: evidence.kind,
    reasonKey: evidence.reasonKey,
  });
  if (next.history.length > 24) next.history = next.history.slice(-24);
  return next;
}
