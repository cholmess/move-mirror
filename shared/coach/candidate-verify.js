import { uciSetHas } from "./moves.js";

const ENGINE_SUCCESS = new Set(["verified_best", "verified_acceptable"]);

export function preverifiedCandidateUcis(spec) {
  return [spec.playedMoveUci, spec.referenceCandidateUci, spec.safeContrastCandidateUci].filter(Boolean);
}

export function isPreverifiedCandidate(spec, candidateUci) {
  return uciSetHas(preverifiedCandidateUcis(spec), candidateUci);
}

export function isPreverifiedHoldoutCandidate(holdoutSecrets, candidateUci) {
  if (uciSetHas(holdoutSecrets.acceptableCandidates ?? [], candidateUci)) return true;
  return Object.prototype.hasOwnProperty.call(holdoutSecrets.refutationsByCandidate ?? {}, candidateUci);
}

/**
 * Off-script candidates need engine proof; without it they stay legal but unverified and must not update learning channels.
 */
export function scoreCandidateLineAttempt({
  candidateUci,
  spec,
  heuristicSuccess,
  engineEvalStatus = null,
}) {
  if (isPreverifiedCandidate(spec, candidateUci)) {
    return {
      verificationStatus: "preverified",
      success: heuristicSuccess,
      countsForPracticeLearning: true,
    };
  }
  if (!engineEvalStatus || engineEvalStatus === "unverified") {
    return {
      verificationStatus: "unverified",
      success: false,
      countsForPracticeLearning: false,
    };
  }
  const engineOk = ENGINE_SUCCESS.has(engineEvalStatus);
  return {
    verificationStatus: engineEvalStatus,
    success: engineOk && heuristicSuccess,
    countsForPracticeLearning: engineOk && heuristicSuccess,
  };
}

export function holdoutGeneralizationEvidence({ holdoutAttempt }) {
  if (!holdoutAttempt) {
    return {
      holdoutFirstAttemptSuccess: null,
      exposureUncertainty: false,
      protectedGeneralizationEligible: null,
    };
  }
  const exposureUncertainty = holdoutAttempt.historicalExposureUncertain !== false;
  const protectedGeneralizationEligible =
    !exposureUncertainty &&
    Boolean(holdoutAttempt.success) &&
    holdoutAttempt.countsForProtectedGeneralization !== false;
  return {
    holdoutFirstAttemptSuccess: holdoutAttempt.firstAttempt ? Boolean(holdoutAttempt.success) : null,
    holdoutContentId: holdoutAttempt.contentId ?? null,
    exposureUncertainty,
    protectedGeneralizationEligible,
  };
}
