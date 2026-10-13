import { randomUUID } from "node:crypto";
import {
  INTERVENTION_LOG_VERSION,
  DOSE_PROTOCOL_ID,
  REQUIRED_EVAL_CRITERION,
  TARGET_PATTERN_ID,
} from "../transfer/intervention.js";
import { COACH_DOSE_PROTOCOL_ID } from "../coach/constants.js";
import {
  APP_VERSION,
  EVAL_STATUSES,
  VALIDATION_EVENT_SCHEMA,
  VALIDATION_EVENT_TYPES,
  VALIDATION_SOURCES,
} from "./constants.js";

function assertEnum(value, allowed, field) {
  if (!allowed.has(value)) throw new Error(`validation_invalid_${field}:${value}`);
}

export function idempotencyKeyFor(type, parts) {
  switch (type) {
    case "training_attempt_recorded":
      return `training-attempt:${parts.attemptId}`;
    case "lesson_completed":
      return `lesson-completed:${parts.lessonVersion}`;
    case "lesson_started":
      return `lesson-started:${parts.lessonVersion}`;
    case "training_session_started":
      return `training-session-started:${parts.sessionId}`;
    case "training_session_completed":
      return `training-session-completed:${parts.sessionId}`;
    case "sparring_session_completed":
      return `sparring-completed:${parts.sessionId}`;
    case "defense_session_completed":
      return `defense-completed:${parts.sessionId ?? parts.exerciseId}`;
    case "game_imported":
      return `game-imported:${parts.gameId}`;
    case "transfer_cohort_created":
      return `cohort-created:${parts.cohortId}`;
    case "transfer_cohort_frozen":
      return `cohort-frozen:${parts.cohortId}`;
    case "intervention_qualified":
      return `intervention-qualified:${DOSE_PROTOCOL_ID}`;
    case "validation_snapshot_created":
      return `validation-snapshot:${parts.snapshotHash}`;
    case "coach_session_completed":
      return `coach-session-completed:${parts.sessionId}`;
    case "coach_holdout_recorded":
      return `coach-holdout:${parts.sessionId}`;
    case "coach_retention_recorded":
      return `coach-retention:${parts.sessionId}`;
    case "coach_dose_qualified":
      return `coach-dose-qualified:${COACH_DOSE_PROTOCOL_ID}`;
    default:
      throw new Error(`validation_unknown_type:${type}`);
  }
}

export function validatePayload(type, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("validation_invalid_payload");
  }
  switch (type) {
    case "lesson_started":
    case "lesson_completed":
      if (typeof payload.lessonVersion !== "string") throw new Error("validation_invalid_payload");
      return payload;
    case "training_session_started":
    case "training_session_completed":
      if (typeof payload.sessionId !== "string") throw new Error("validation_invalid_payload");
      return payload;
    case "training_attempt_recorded":
      if (typeof payload.attemptId !== "string" || typeof payload.exerciseId !== "string") {
        throw new Error("validation_invalid_payload");
      }
      assertEnum(payload.evaluationStatus, EVAL_STATUSES, "evaluationStatus");
      if (payload.evalCriterionVersion !== REQUIRED_EVAL_CRITERION) {
        throw new Error("validation_invalid_eval_criterion");
      }
      return payload;
    case "defense_session_completed":
      if (typeof payload.exerciseId !== "string") throw new Error("validation_invalid_payload");
      return payload;
    case "sparring_session_completed":
      if (typeof payload.sessionId !== "string") throw new Error("validation_invalid_payload");
      return payload;
    case "game_imported":
      if (typeof payload.gameId !== "string") throw new Error("validation_invalid_payload");
      return payload;
    case "transfer_cohort_created":
    case "transfer_cohort_frozen":
      if (typeof payload.cohortId !== "string") throw new Error("validation_invalid_payload");
      return payload;
    case "intervention_qualified":
      if (typeof payload.qualifiedAt !== "string" || typeof payload.snapshotHash !== "string") {
        throw new Error("validation_invalid_payload");
      }
      return payload;
    case "validation_snapshot_created":
      if (typeof payload.snapshotHash !== "string" || typeof payload.snapshotPath !== "string") {
        throw new Error("validation_invalid_payload");
      }
      return payload;
    case "coach_session_completed":
      if (typeof payload.sessionId !== "string" || typeof payload.protocolId !== "string") {
        throw new Error("validation_invalid_payload");
      }
      return payload;
    case "coach_holdout_recorded":
    case "coach_retention_recorded":
      if (typeof payload.sessionId !== "string" || typeof payload.contentId !== "string") {
        throw new Error("validation_invalid_payload");
      }
      return payload;
    case "coach_dose_qualified":
      if (typeof payload.qualifiedAt !== "string" || payload.protocolId !== COACH_DOSE_PROTOCOL_ID) {
        throw new Error("validation_invalid_payload");
      }
      return payload;
    default:
      throw new Error(`validation_unknown_type:${type}`);
  }
}

export function doseFlagsFor(type) {
  if (
    type === "defense_session_completed" ||
    type === "sparring_session_completed" ||
    type === "game_imported" ||
    type.startsWith("transfer_")
  ) {
    return { doseEligible: false, transferEligible: false };
  }
  if (type === "intervention_qualified" || type === "validation_snapshot_created") {
    return { doseEligible: false, transferEligible: false };
  }
  if (type.startsWith("coach_")) {
    return { doseEligible: false, transferEligible: type === "coach_dose_qualified" };
  }
  return { doseEligible: true, transferEligible: false };
}

export function buildValidationEvent(input, serverTimes) {
  const type = input.type;
  assertEnum(type, VALIDATION_EVENT_TYPES, "type");
  assertEnum(input.source, VALIDATION_SOURCES, "source");
  const payload = validatePayload(type, input.payload);
  const idempotencyKey = input.idempotencyKey ?? idempotencyKeyFor(type, payload);
  const flags = doseFlagsFor(type);
  return {
    schemaVersion: VALIDATION_EVENT_SCHEMA,
    eventId: input.eventId ?? randomUUID(),
    idempotencyKey,
    occurredAt: serverTimes.occurredAt,
    observedAt: input.observedAt ?? null,
    receivedAt: serverTimes.receivedAt,
    type,
    appVersion: APP_VERSION,
    interventionVersion: INTERVENTION_LOG_VERSION,
    patternId: input.patternId ?? TARGET_PATTERN_ID,
    source: input.source,
    sessionId: input.sessionId ?? null,
    exerciseId: input.exerciseId ?? payload.exerciseId ?? null,
    gameId: input.gameId ?? payload.gameId ?? null,
    cohortId: input.cohortId ?? payload.cohortId ?? null,
    doseEligible: flags.doseEligible,
    transferEligible: flags.transferEligible,
    payload,
  };
}

export function pedagogyMirrorToValidationInput(pedagogyEvent) {
  const base = {
    observedAt: pedagogyEvent.occurredAt,
    patternId: pedagogyEvent.patternId ?? TARGET_PATTERN_ID,
    source: pedagogyEvent.source === "migration" ? "migration" : "training",
  };
  switch (pedagogyEvent.eventType) {
    case "lesson_started":
      return {
        ...base,
        type: "lesson_started",
        source: "lesson",
        payload: { lessonVersion: pedagogyEvent.lessonVersion },
        idempotencyKey: idempotencyKeyFor("lesson_started", { lessonVersion: pedagogyEvent.lessonVersion }),
      };
    case "lesson_completed":
      return {
        ...base,
        type: "lesson_completed",
        source: "lesson",
        payload: { lessonVersion: pedagogyEvent.lessonVersion },
        idempotencyKey: idempotencyKeyFor("lesson_completed", { lessonVersion: pedagogyEvent.lessonVersion }),
      };
    case "training_session_started": {
      const match = String(pedagogyEvent.id).match(/^training-session:(.+):started$/);
      const sessionId = match?.[1] ?? pedagogyEvent.id;
      return {
        ...base,
        type: "training_session_started",
        source: "training",
        sessionId,
        payload: { sessionId, lessonVersion: pedagogyEvent.lessonVersion ?? null },
        idempotencyKey: idempotencyKeyFor("training_session_started", { sessionId }),
      };
    }
    case "training_session_completed":
      return {
        ...base,
        type: "training_session_completed",
        source: "training",
        payload: { sessionId: pedagogyEvent.id },
        idempotencyKey: `training-session-completed:${pedagogyEvent.id}`,
      };
    case "exercise_confirmed":
      return {
        ...base,
        type: "training_attempt_recorded",
        source: "training",
        exerciseId: pedagogyEvent.exerciseId,
        sessionId: null,
        payload: {
          attemptId: pedagogyEvent.attemptId,
          exerciseId: pedagogyEvent.exerciseId,
          evaluationStatus: pedagogyEvent.evaluationStatus,
          evalCriterionVersion: pedagogyEvent.evalCriterionVersion,
          lessonVersion: pedagogyEvent.lessonVersion,
        },
        idempotencyKey: idempotencyKeyFor("training_attempt_recorded", { attemptId: pedagogyEvent.attemptId }),
      };
    default:
      return null;
  }
}
