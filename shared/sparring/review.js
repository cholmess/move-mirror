import { SPARRING_REVIEW_VERSION } from "./constants.js";
import { rebuildChess } from "./chess-rules.js";

export function classifyMomentForReview(evalResult, momentContext) {
  const status = evalResult?.status ?? evalResult?.evalFinalStatus ?? "unverified";
  const forcingReplyAllowed =
    momentContext.matchedPriorityPattern &&
    (status === "verified_best" || status === "verified_acceptable");
  const resolved =
    momentContext.agentCreated &&
    (status === "verified_best" || status === "verified_acceptable" || status === "playable_inexact");

  let explanationKey = "sparring.review.neutral";
  if (momentContext.agentCreated && status === "incorrect") {
    explanationKey = "sparring.review.missedForcingReply";
  } else if (momentContext.agentCreated && resolved) {
    explanationKey = "sparring.review.solidDefense";
  } else if (status === "unverified") {
    explanationKey = "sparring.review.unverified";
  }

  return {
    evaluationStatus: status,
    matchedPriorityPattern: Boolean(momentContext.matchedPriorityPattern),
    forcingReplyAllowed,
    defensiveResource: momentContext.defensiveResource ?? null,
    hintUsed: Boolean(momentContext.hintUsed),
    explanationKey,
    explanationParams: momentContext.explanationParams ?? {},
    agentCreated: Boolean(momentContext.agentCreated),
    resolved,
  };
}

export function buildSparringReview(session, evaluatedMoments) {
  const moments = evaluatedMoments.map((m) => ({
    ply: m.ply,
    fenBeforeMove: m.fenBeforeMove,
    playedMoveUci: m.playedMoveUci,
    playedMoveSan: m.playedMoveSan,
    ...classifyMomentForReview(m.evaluation, m),
  }));

  const agentCreated = moments.filter((m) => m.agentCreated);
  const resolved = agentCreated.filter((m) => m.resolved);
  const needsPractice = agentCreated.filter((m) => !m.resolved && m.evaluationStatus === "incorrect");

  return {
    version: SPARRING_REVIEW_VERSION,
    sessionId: session.id,
    completedAt: session.completedAt,
    result: session.result,
    termination: session.termination,
    practicedPatternId: session.profileSnapshot?.patternId ?? "allowed-forcing-reply",
    opportunityCount: agentCreated.length,
    resolvedCount: resolved.length,
    needsPracticeCount: needsPractice.length,
    keyMoments: [...agentCreated]
      .sort((a, b) => (a.evaluationStatus === "incorrect" ? -1 : 1))
      .slice(0, 3),
    moments,
    recommendationKey: needsPractice.length
      ? "sparring.review.recommend.forcingReply"
      : "sparring.review.recommend.continue",
    doseEligible: false,
    transferEligible: false,
  };
}

export function userDecisionPlies(session) {
  const { san } = rebuildChess(session.startingFen, session.movesUci);
  const plies = [];
  for (let i = 0; i < session.movesUci.length; i += 1) {
    const isWhite = i % 2 === 0;
    const isUser = session.userColor === "white" ? isWhite : !isWhite;
    if (!isUser) continue;
    plies.push({
      ply: i + 1,
      moveIndex: i,
      uci: session.movesUci[i],
      san: san[i],
    });
  }
  return plies;
}
