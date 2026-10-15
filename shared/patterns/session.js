import { randomUUID } from "node:crypto";
import { positionKey } from "./detect.js";
import {
  GUIDED_DECISIONS_PER_SLOT,
  LEGACY_GUIDED_DECISIONS,
  PATTERN_LEARNING_VERSION,
  SESSION_MAX_POSITIONS,
  SESSION_MIN_POSITIONS,
} from "./learning-config.js";
import { classifyPracticeEvidence, outcomeHeadlineKey, sessionOutcomeKey } from "./evidence.js";
import { applyDomainEvidence, emptyPatternDomain } from "./mastery.js";
import { scheduleNextReview } from "./scheduler.js";

export function planSessionPositions(candidates, exposures, { min = SESSION_MIN_POSITIONS, max = SESSION_MAX_POSITIONS, reserveHoldout = true } = {}) {
  const seenInSession = new Set();
  const sorted = [...candidates].sort((a, b) => {
    const exposed = (r) => (exposures.some((e) => e.positionKey === positionKey(r.fen)) ? 1 : 0);
    return exposed(a) - exposed(b) || (b.loss ?? 0) - (a.loss ?? 0);
  });
  const picked = [];
  for (const row of sorted) {
    const key = positionKey(row.fen);
    if (seenInSession.has(key)) continue;
    seenInSession.add(key);
    picked.push(row);
    if (picked.length >= max + (reserveHoldout ? 1 : 0)) break;
  }
  const holdoutReserve = reserveHoldout && picked.length > min ? 1 : 0;
  const limit = Math.min(max, Math.max(min, picked.length - holdoutReserve));
  return picked.slice(0, limit);
}

export function createPracticeSession(patternId, positionRecordIds, { contentVersion, detectorVersion, at }) {
  return {
    version: PATTERN_LEARNING_VERSION,
    id: randomUUID(),
    patternId,
    startedAt: at,
    endedAt: null,
    durationMs: null,
    status: "in_progress",
    contentVersion,
    detectorVersion,
    positionRecordIds,
    guidedExerciseIds: [],
    holdoutExerciseId: null,
    holdoutRecordId: null,
    hintsUsed: 0,
    revealsUsed: 0,
    retries: 0,
    outcomeKey: null,
    completionKey: null,
    countsAsIndependentEvidence: false,
    evidenceReasonKey: null,
  };
}

export function guidedTargetDecisions(exercise) {
  return exercise.sessionId ? GUIDED_DECISIONS_PER_SLOT : LEGACY_GUIDED_DECISIONS;
}

export function nextGuidedStatus(exercise, session) {
  if (exercise.role === "holdout") return "completed";
  if (!exercise.sessionId || !session) return exercise.decisionCount >= LEGACY_GUIDED_DECISIONS - 1 ? "ready_for_holdout" : "training";
  const lastSlot = exercise.slotIndex >= session.positionRecordIds.length - 1;
  if (lastSlot) return "ready_for_holdout";
  return "ready_for_next_slot";
}

/**
 * Idempotent session completion when holdout attempt is recorded.
 */
export function completePracticeSession({
  session,
  holdoutExercise,
  holdoutAttempt,
  patternDomains,
  at,
  now = Date.now(),
}) {
  const completionKey = `session-complete:${session.id}:${holdoutAttempt.id}`;
  if (session.completionKey === completionKey && session.status === "completed") {
    return { session, domain: patternDomains[session.patternId], duplicate: true };
  }
  const holdoutEvidence = classifyPracticeEvidence({
    role: "holdout",
    assisted: holdoutAttempt.assisted,
    repeated: holdoutAttempt.repeated,
    verified: holdoutAttempt.verified,
    status: holdoutAttempt.status,
    independent: holdoutAttempt.independent,
  });
  const sessionAssisted = session.hintsUsed > 0 || session.revealsUsed > 0;
  const outcomeKey = sessionOutcomeKey({ holdoutEvidence, sessionAssisted, holdoutAttempt });
  const domain =
    patternDomains[session.patternId] ?? emptyPatternDomain(session.patternId, at);
  let updatedDomain = domain;
  if (holdoutEvidence.countsForDomain) {
    updatedDomain = applyDomainEvidence(domain, holdoutEvidence, {
      status: holdoutAttempt.status,
      at: holdoutAttempt.at,
      role: "holdout",
      assisted: holdoutAttempt.assisted,
    });
    updatedDomain.nextReviewAt = scheduleNextReview(updatedDomain, holdoutEvidence, holdoutAttempt.at, now);
  } else if (holdoutEvidence.kind !== "unverified") {
    updatedDomain = applyDomainEvidence(domain, holdoutEvidence, {
      status: holdoutAttempt.status,
      at: holdoutAttempt.at,
      role: "holdout",
      assisted: true,
    });
    updatedDomain.nextReviewAt = scheduleNextReview(updatedDomain, holdoutEvidence, holdoutAttempt.at, now);
  }
  const endedAt = holdoutAttempt.at;
  const durationMs = Math.max(0, Date.parse(endedAt) - Date.parse(session.startedAt));
  const completed = {
    ...session,
    status: "completed",
    endedAt,
    durationMs,
    holdoutExerciseId: holdoutExercise.id,
    holdoutRecordId: holdoutExercise.recordId,
    outcomeKey,
    completionKey,
    countsAsIndependentEvidence: holdoutEvidence.countsForDomain && holdoutEvidence.kind === "independent_success",
    evidenceReasonKey: holdoutEvidence.reasonKey,
  };
  return {
    session: completed,
    domain: updatedDomain,
    duplicate: false,
    result: buildSessionResultDto(completed, holdoutAttempt, holdoutEvidence, updatedDomain),
  };
}

export function buildSessionResultDto(session, holdoutAttempt, holdoutEvidence, domain) {
  return {
    sessionId: session.id,
    patternId: session.patternId,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    durationMs: session.durationMs,
    contentVersion: session.contentVersion,
    detectorVersion: session.detectorVersion,
    positionRecordIds: session.positionRecordIds,
    guidedExerciseIds: session.guidedExerciseIds,
    holdoutExerciseId: session.holdoutExerciseId,
    hintsUsed: session.hintsUsed,
    revealsUsed: session.revealsUsed,
    retries: session.retries,
    holdout: holdoutAttempt
      ? {
          status: holdoutAttempt.status,
          independent: holdoutAttempt.independent,
          assisted: holdoutAttempt.assisted,
          repeated: holdoutAttempt.repeated,
          verified: holdoutAttempt.verified,
        }
      : null,
    outcomeKey: session.outcomeKey,
    outcomeHeadlineKey: outcomeHeadlineKey(session.outcomeKey),
    countsAsIndependentEvidence: session.countsAsIndependentEvidence,
    evidenceReasonKey: session.evidenceReasonKey ?? holdoutEvidence?.reasonKey ?? null,
    domain: {
      masteryEstimate: domain.masteryEstimate,
      confidence: domain.confidence,
      lifecycle: domain.lifecycle,
      nextReviewAt: domain.nextReviewAt,
      independentAttempts: domain.independentAttempts,
      independentSuccesses: domain.independentSuccesses,
      independentFailures: domain.independentFailures,
      assistedAttempts: domain.assistedAttempts,
    },
  };
}
