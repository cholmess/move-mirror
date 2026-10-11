import {
  DOSE_PROTOCOL_ID,
  INTERVENTION_LOG_VERSION,
  REQUIRED_EVAL_CRITERION,
  sha256Canonical,
  TARGET_PATTERN_ID,
} from "../transfer/intervention.js";

export function buildQualificationSnapshot({ qualification, pedagogyEvents, qualifiedAt, lessonVersion }) {
  const eligibleAttempts = pedagogyEvents.filter((e) => e.eventType === "exercise_confirmed");
  const body = {
    schemaVersion: "validation-snapshot-v1",
    patternId: TARGET_PATTERN_ID,
    lessonVersion: lessonVersion ?? null,
    protocolId: DOSE_PROTOCOL_ID,
    interventionLogVersion: INTERVENTION_LOG_VERSION,
    evalCriterionVersion: REQUIRED_EVAL_CRITERION,
    qualifiedAt,
    doseRule: {
      lessonCompleted: true,
      confirmedExercises: 12,
      verifiedSuccesses: 8,
      distinctSessions: 2,
      distinctCalendarDays: 2,
    },
    counts: {
      confirmedExercises: qualification.confirmedExercises,
      verifiedSuccesses: qualification.verifiedSuccesses,
      distinctSessions: qualification.distinctSessions,
      distinctCalendarDays: qualification.distinctCalendarDays,
    },
    eligibleExerciseEvents: eligibleAttempts.map((e) => ({
      id: e.id,
      exerciseId: e.exerciseId,
      attemptId: e.attemptId,
      evaluationStatus: e.evaluationStatus,
      occurredAt: e.occurredAt,
    })),
    evidenceEventIds: qualification.evidenceEventIds,
  };
  return { ...body, snapshotHash: sha256Canonical(body) };
}
