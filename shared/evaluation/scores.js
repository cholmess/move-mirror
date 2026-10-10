const MATE_SCORE = 100_000;

export function toNumeric(cp, mate) {
  if (mate !== null && mate !== undefined) {
    return mate > 0 ? MATE_SCORE - mate : -MATE_SCORE - mate;
  }
  return cp ?? 0;
}

export function cpLossFromNumeric(bestNum, playedNum) {
  return bestNum - playedNum;
}
