import { createHash } from "node:crypto";

export const INTERVENTION_LOG_VERSION = "intervention-log-v1";
export const DOSE_PROTOCOL_ID = "cct-refutation-dose-v1";
export const EXPOSURE_AUDIT_VERSION = "exposure-audit-v1";
export const VALIDITY_PIPELINE_VERSION = "transfer-validity-pipeline-v0.3.1";
export const TARGET_PATTERN_ID = "cct-opponent-refutation";
export const REQUIRED_EVAL_CRITERION = "engine-validated-v2";

const SUCCESS = new Set(["verified_best", "verified_acceptable"]);
const PERFORMED = new Set(["verified_best", "verified_acceptable", "playable_inexact", "incorrect"]);

function byTime(a, b) {
  return String(a.occurredAt).localeCompare(String(b.occurredAt)) || String(a.id).localeCompare(String(b.id));
}

export function appendPedagogyEvent(events, event) {
  if (!event?.id || !event?.occurredAt || Number.isNaN(Date.parse(event.occurredAt))) {
    throw new Error("invalid_pedagogy_event");
  }
  if (events.some((item) => item.id === event.id)) return events;
  return [...events, event].sort(byTime);
}

export function migratePedagogyEvidence({ attempts = [], lessonCompletedAt = null, lessonVersion = null }) {
  let events = [];
  const incomplete = [];
  if (lessonCompletedAt) {
    events = appendPedagogyEvent(events, {
      id: `migration:lesson-completed:${lessonVersion ?? "unknown"}:${lessonCompletedAt}`,
      occurredAt: lessonCompletedAt,
      eventType: "lesson_completed",
      patternId: TARGET_PATTERN_ID,
      lessonVersion,
      exerciseId: null,
      attemptId: null,
      evaluationStatus: null,
      evalCriterionVersion: null,
      source: "migration",
    });
  } else {
    incomplete.push({ kind: "lesson_completed", reason: "missing_persisted_completion_timestamp" });
  }
  for (const attempt of attempts) {
    if (!attempt.recordedAt || Number.isNaN(Date.parse(attempt.recordedAt))) {
      incomplete.push({ kind: "exercise_confirmed", attemptId: attempt.id ?? null, reason: "missing_timestamp" });
      continue;
    }
    events = appendPedagogyEvent(events, {
      id: `migration:exercise-confirmed:${attempt.id}`,
      occurredAt: attempt.recordedAt,
      eventType: "exercise_confirmed",
      patternId: attempt.patternId,
      lessonVersion: attempt.lessonVersion ?? null,
      exerciseId: attempt.exerciseId ?? null,
      attemptId: attempt.id ?? null,
      evaluationStatus: attempt.evaluationStatus ?? null,
      evalCriterionVersion: attempt.evalCriterionVersion ?? null,
      source: "migration",
    });
  }
  return { events, incomplete };
}

function sessionFor(events, exercise) {
  const starts = events
    .filter((event) => event.eventType === "training_session_started" && event.occurredAt <= exercise.occurredAt)
    .sort(byTime);
  const start = starts.at(-1);
  if (!start) return null;
  const ended = events.some(
    (event) =>
      event.eventType === "training_session_completed" &&
      event.occurredAt >= start.occurredAt &&
      event.occurredAt < exercise.occurredAt
  );
  return ended ? null : start;
}

export function calculateInterventionQualification(events, previous = null, patternId = TARGET_PATTERN_ID) {
  const ordered = [...events].sort(byTime);
  const relevant = ordered.filter((event) => event.patternId === patternId);
  const lessonEvents = relevant.filter((event) => event.eventType === "lesson_completed");
  const qualifying = relevant.filter(
    (event) =>
      event.eventType === "exercise_confirmed" &&
      event.evalCriterionVersion === REQUIRED_EVAL_CRITERION &&
      PERFORMED.has(event.evaluationStatus)
  );

  const evidence = [];
  let lessonCompletedAt = null;
  let confirmedExercises = 0;
  let verifiedSuccesses = 0;
  const sessions = new Map();
  const days = new Set();
  let firstQualifiedAt = null;

  for (const event of relevant) {
    if (event.eventType === "lesson_completed" && !lessonCompletedAt) {
      lessonCompletedAt = event.occurredAt;
      evidence.push(event.id);
    }
    if (qualifying.includes(event)) {
      confirmedExercises += 1;
      if (SUCCESS.has(event.evaluationStatus)) verifiedSuccesses += 1;
      evidence.push(event.id);
      const session = sessionFor(relevant, event);
      if (session) {
        sessions.set(session.id, session);
        days.add(session.occurredAt.slice(0, 10));
        evidence.push(session.id);
      }
    }
    const qualifies =
      Boolean(lessonCompletedAt) &&
      confirmedExercises >= 12 &&
      verifiedSuccesses >= 8 &&
      sessions.size >= 2 &&
      days.size >= 2;
    if (qualifies && !firstQualifiedAt) firstQualifiedAt = event.occurredAt;
  }

  const qualifiedAt = previous?.qualifiedAt ?? firstQualifiedAt;
  const missingRequirements = [];
  if (!lessonCompletedAt) missingRequirements.push("lesson_completed");
  if (confirmedExercises < 12) missingRequirements.push(`confirmed_exercises:${confirmedExercises}/12`);
  if (verifiedSuccesses < 8) missingRequirements.push(`verified_successes:${verifiedSuccesses}/8`);
  if (sessions.size < 2) missingRequirements.push(`distinct_sessions:${sessions.size}/2`);
  if (days.size < 2) missingRequirements.push(`distinct_calendar_days:${days.size}/2`);

  return {
    protocolId: DOSE_PROTOCOL_ID,
    patternId,
    qualified: Boolean(qualifiedAt),
    qualifiedAt: qualifiedAt ?? null,
    lessonCompletedAt,
    confirmedExercises,
    verifiedSuccesses,
    distinctSessions: sessions.size,
    distinctCalendarDays: days.size,
    missingRequirements: qualifiedAt ? [] : missingRequirements,
    evidenceEventIds: [...new Set(evidence)],
  };
}

export function gameStartTime(game) {
  if (game.startTime && !Number.isNaN(Date.parse(game.startTime))) return new Date(game.startTime).toISOString();
  const date = String(game.pgn ?? "").match(/\[UTCDate "(\d{4})\.(\d{2})\.(\d{2})"\]/);
  const time = String(game.pgn ?? "").match(/\[(?:StartTime|UTCTime) "(\d{2}):(\d{2}):(\d{2})"\]/);
  if (!date || !time) return null;
  return `${date[1]}-${date[2]}-${date[3]}T${time[1]}:${time[2]}:${time[3]}.000Z`;
}

export function auditCohortExposure({ cohortId, games, qualification, auditedAt }) {
  const starts = games.map(gameStartTime);
  const known = starts.filter(Boolean).sort();
  const qualifiedAt = qualification?.qualifiedAt ?? null;
  let exposureValidity = "exposure_unknown";
  let before = null;
  let after = null;
  if (qualifiedAt && known.length === games.length) {
    before = known.filter((at) => at <= qualifiedAt).length;
    after = known.filter((at) => at > qualifiedAt).length;
    exposureValidity = before === 0 ? "post_intervention_verified" : after === 0 ? "pre_intervention" : "mixed_exposure";
  }
  const audit = {
    cohortId,
    exposureValidity,
    protocolId: DOSE_PROTOCOL_ID,
    qualifiedAt,
    gamesBeforeQualification: before,
    gamesAfterQualification: after,
    earliestGameAt: known[0] ?? "",
    latestGameAt: known.at(-1) ?? "",
    auditedAt,
    auditVersion: EXPOSURE_AUDIT_VERSION,
  };
  return { ...audit, auditHash: sha256Canonical(audit) };
}

export function contextSummary(games) {
  const nums = (key) => games.map(key).filter(Number.isFinite).sort((a, b) => a - b);
  const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const median = (xs) => xs.length ? (xs[Math.floor((xs.length - 1) / 2)] + xs[Math.ceil((xs.length - 1) / 2)]) / 2 : null;
  const own = nums((g) => Number(g.ratings?.own ?? g.ratingOwn));
  const opp = nums((g) => Number(g.ratings?.opponent ?? g.ratingOpponent));
  const diffs = nums((g) => {
    const a = Number(g.ratings?.own ?? g.ratingOwn);
    const b = Number(g.ratings?.opponent ?? g.ratingOpponent);
    return Number.isFinite(a) && Number.isFinite(b) ? a - b : NaN;
  });
  const total = games.length;
  const outcomes = (value) => total ? games.filter((g) => g.result === value).length / total : null;
  return {
    games: total,
    ownRatingMean: mean(own), ownRatingMedian: median(own),
    opponentRatingMean: mean(opp), opponentRatingMedian: median(opp),
    ratingDifferenceMean: mean(diffs), ratingDifferenceMedian: median(diffs),
    whiteProportion: total ? games.filter((g) => g.color === "white").length / total : null,
    winProportion: outcomes("win"), lossProportion: outcomes("loss"), drawProportion: outcomes("draw"),
    decisionsPerGame: total ? games.reduce((sum, g) => sum + Number(g.ownDecisions ?? 0), 0) / total : null,
  };
}

export const COMPARABILITY_THRESHOLDS = Object.freeze({
  ownRatingMean: 100,
  opponentRatingMean: 100,
  whiteProportion: 0.15,
  resultProportion: 0.2,
  decisionsPerGameRelative: 0.25,
});

export function comparabilityWarning(baseline, cohort) {
  const reasons = [];
  const absolute = (field, threshold) => {
    if (baseline[field] != null && cohort[field] != null && Math.abs(baseline[field] - cohort[field]) > threshold) reasons.push(field);
  };
  absolute("ownRatingMean", COMPARABILITY_THRESHOLDS.ownRatingMean);
  absolute("opponentRatingMean", COMPARABILITY_THRESHOLDS.opponentRatingMean);
  absolute("whiteProportion", COMPARABILITY_THRESHOLDS.whiteProportion);
  for (const field of ["winProportion", "lossProportion", "drawProportion"]) absolute(field, COMPARABILITY_THRESHOLDS.resultProportion);
  if (baseline.decisionsPerGame && cohort.decisionsPerGame &&
      Math.abs(cohort.decisionsPerGame - baseline.decisionsPerGame) / baseline.decisionsPerGame > COMPARABILITY_THRESHOLDS.decisionsPerGameRelative) {
    reasons.push("decisionsPerGame");
  }
  return {
    materialDifference: reasons.length > 0,
    reasons,
    message: reasons.length ? "Las cohortes difieren en contexto competitivo; la comparación debe interpretarse con cautela." : null,
    thresholds: COMPARABILITY_THRESHOLDS,
  };
}

export function sha256Canonical(value) {
  const stable = (v) => Array.isArray(v) ? v.map(stable) : v && typeof v === "object"
    ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, stable(v[key])]))
    : v;
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
