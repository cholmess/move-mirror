import { COACH_LESSON_SPEC_VERSION } from "./constants.js";
import { lessonHomePayload } from "./teaching-public.js";

export function buildCoachHome({ sessions = [], evidence = null }) {
  const payload = lessonHomePayload(evidence ?? defaultEvidence());
  const retentionDue = sessions.find(
    (s) =>
      (s.status === "retention_due" || s.status === "awaiting_retention") &&
      s.retentionDueAt &&
      Date.parse(s.retentionDueAt) <= Date.now() &&
      !s.retentionCompleted,
  );
  if (retentionDue) {
    return {
      ...payload,
      primaryAction: "start_retention",
      sessionId: retentionDue.id,
      phase: "retention",
    };
  }
  const active = sessions.find(
    (s) => s.status === "in_progress" && s.phase !== "retention_complete",
  );
  if (active) {
    return {
      ...payload,
      primaryAction: "resume_session",
      sessionId: active.id,
      phase: active.phase,
    };
  }
  return {
    ...payload,
    primaryAction: "start_session",
    sessionId: null,
    phase: "signal",
  };
}

function defaultEvidence() {
  return {
    discoveryPositions: 85,
    validationGames: 36,
    validationGamesTotal: 50,
    noteKey: "coach:evidenceNote",
  };
}

export function coachDoseQualified(session) {
  if (!session?.events) return { qualified: false, missing: ["no_session"] };
  const flags = {
    contrastCompleted: session.events.some((e) => e.type === "coach_contrast_safe"),
    workedExampleCompleted: session.events.some((e) => e.type === "coach_worked_completed"),
    practiceIndependentSuccess: session.events.some(
      (e) =>
        e.type === "coach_practice_attempt" &&
        e.firstAttempt &&
        e.success &&
        e.countsForPracticeLearning !== false &&
        (e.hintLevel ?? 0) === 0,
    ),
    holdoutFirstAttemptCompleted: session.events.some(
      (e) => e.type === "coach_holdout_attempt" && e.firstAttempt,
    ),
    exitRuleRecorded: session.events.some((e) => e.type === "coach_exit_rule"),
    retentionIndependentSuccess: session.events.some(
      (e) => e.type === "coach_retention_attempt" && e.firstAttempt && (e.hintLevel ?? 0) === 0,
    ),
  };
  const missing = Object.entries(flags)
    .filter(([, ok]) => !ok)
    .map(([key]) => key);
  return { qualified: missing.length === 0, missing, flags };
}
