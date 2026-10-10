export const BAND_NEAR_50 = [35, 65];
export const BAND_NEAR_120 = [105, 135];

export function inBand(cpLoss, [lo, hi]) {
  return cpLoss !== null && cpLoss >= lo && cpLoss <= hi;
}

export function mateStateUnstable(bestScore, playedScore) {
  const bm = bestScore?.mate ?? null;
  const pm = playedScore?.mate ?? null;
  if (bm !== pm) return true;
  if (bm !== null && pm !== null && Math.sign(bm) !== Math.sign(pm)) return true;
  return false;
}

export function analysisIncomplete(analysis) {
  if (!analysis) return true;
  if (!analysis.pvUci || analysis.pvUci.length === 0) return true;
  if (!analysis.score || analysis.score.numeric === undefined) return true;
  if (analysis.nodes !== undefined && analysis.nodes < 500) return true;
  return false;
}

export function isContradictory({ best, playedUci, cpLoss }) {
  if (cpLoss === null) return false;
  if (
    best?.firstMoveUci &&
    playedUci &&
    best.firstMoveUci.toLowerCase() === playedUci.toLowerCase() &&
    cpLoss > 10
  ) {
    return true;
  }
  return false;
}

/**
 * @returns {{ skipEscalation: boolean, inconsistentPrecomputed: boolean }}
 */
export function precomputedEscalationPolicy(playedUci, referenceBestUci, best) {
  if (!referenceBestUci || !playedUci) {
    return { skipEscalation: false, inconsistentPrecomputed: false };
  }
  if (playedUci.toLowerCase() !== referenceBestUci.toLowerCase()) {
    return { skipEscalation: false, inconsistentPrecomputed: false };
  }
  const inconsistent =
    best?.firstMoveUci &&
    best.firstMoveUci.toLowerCase() !== referenceBestUci.toLowerCase();
  return { skipEscalation: !inconsistent, inconsistentPrecomputed: inconsistent };
}

/**
 * @returns {{ escalate: boolean, reason: string | null }}
 */
export function shouldEscalate({
  cpLoss,
  best,
  played,
  playedUci,
  shallowIncomplete,
  referenceBestUci,
}) {
  const pre = precomputedEscalationPolicy(playedUci, referenceBestUci, best);
  if (pre.skipEscalation) {
    return { escalate: false, reason: null };
  }

  if (shallowIncomplete) {
    return { escalate: true, reason: "incomplete_shallow" };
  }

  if (inBand(cpLoss, BAND_NEAR_50)) {
    return { escalate: true, reason: "cp_loss_near_50" };
  }
  if (inBand(cpLoss, BAND_NEAR_120)) {
    return { escalate: true, reason: "cp_loss_near_120" };
  }

  if (mateStateUnstable(best?.score, played?.score)) {
    return { escalate: true, reason: "mate_state_change" };
  }

  if (isContradictory({ best, playedUci, cpLoss })) {
    return { escalate: true, reason: "unstable_contradictory" };
  }

  if (pre.inconsistentPrecomputed) {
    return { escalate: true, reason: "precomputed_inconsistent" };
  }

  return { escalate: false, reason: null };
}
