/** Working hypotheses from observed decisions, never a diagnosis of the player. */
export function decisionCoaching({ result, prediction, replyResult, predictedSan, rootFen, candidateFen, referenceFen }) {
  if (!prediction || !result.verified || ['illegal', 'unverified'].includes(result.status)) return null;
  const successful = ['verified_best', 'verified_acceptable'].includes(result.status);
  const replyVerified = Boolean(replyResult?.verified && replyResult.engineVersion && replyResult.engineSha256 && replyResult.evalCriterionVersion === 'engine-validated-v2' && ['verified_best', 'verified_acceptable', 'incorrect', 'playable_inexact'].includes(replyResult.status));
  const anticipated = replyVerified && ['verified_best', 'verified_acceptable'].includes(replyResult.status);
  const intervention = successful ? 'reinforce'
    : prediction.replyUci === null ? 'search'
    : !replyVerified ? 'uncertain'
    : anticipated ? 'evaluate' : 'compare';
  return { version: 'decision-coaching-v1', intervention, hypothesis: successful || !replyVerified ? null : anticipated ? 'consequences' : 'reply-search',
    confidence: 'single_observation', predictedSan, replyVerified,
    rootFen, candidateFen, referenceFen,
    replyEngineVersion: replyVerified ? replyResult.engineVersion : null,
    replyEngineSha256: replyVerified ? replyResult.engineSha256 : null };
}
