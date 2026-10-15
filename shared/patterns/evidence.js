import { affectsDomain } from "../evaluation/classify.js";

/**
 * @typedef {'independent_success' | 'independent_failure' | 'guided_only' | 'holdout_invalid' | 'unverified'} EvidenceKind
 */

/**
 * Whether a practice attempt may update pattern domain (holdout only, independent, verified).
 * @param {{ role: string, assisted?: boolean, repeated?: boolean, verified?: boolean, status?: string, independent?: boolean }} attempt
 */
export function classifyPracticeEvidence(attempt) {
  if (!attempt.verified || attempt.status === "unverified" || attempt.status === "illegal") {
    return { countsForDomain: false, kind: "unverified", reasonKey: "reason.unverified" };
  }
  if (attempt.role !== "holdout" && attempt.role !== "legacy") {
    return { countsForDomain: false, kind: "guided_only", reasonKey: "reason.guidedNoDomain" };
  }
  if (!attempt.independent || attempt.assisted || attempt.repeated) {
    return { countsForDomain: false, kind: "holdout_invalid", reasonKey: "reason.holdoutNotIndependent" };
  }
  const ok = affectsDomain(attempt.status) && (attempt.status === "verified_best" || attempt.status === "verified_acceptable");
  if (ok) {
    return { countsForDomain: true, kind: "independent_success", reasonKey: "reason.holdoutSuccess" };
  }
  if (attempt.status === "incorrect" || attempt.status === "playable_inexact") {
    return { countsForDomain: true, kind: "independent_failure", reasonKey: "reason.holdoutFailure" };
  }
  return { countsForDomain: false, kind: "unverified", reasonKey: "reason.unverified" };
}

export function sessionOutcomeKey({ holdoutEvidence, sessionAssisted, holdoutAttempt }) {
  if (!holdoutAttempt) return "session_incomplete";
  if (holdoutEvidence.kind === "unverified") return "not_verifiable";
  if (holdoutEvidence.kind === "independent_success") return "holdout_independent_correct";
  if (holdoutEvidence.kind === "independent_failure") return "needs_reinforcement";
  if (sessionAssisted || holdoutEvidence.kind === "holdout_invalid") return "learned_with_help";
  return "learned_with_help";
}

export function outcomeHeadlineKey(outcomeKey) {
  const map = {
    holdout_independent_correct: "learning:outcome.holdoutCorrect.headline",
    learned_with_help: "learning:outcome.learnedWithHelp.headline",
    needs_reinforcement: "learning:outcome.needsReinforcement.headline",
    not_verifiable: "learning:outcome.notVerifiable.headline",
    session_incomplete: "learning:outcome.incomplete.headline",
  };
  return map[outcomeKey] ?? map.session_incomplete;
}
