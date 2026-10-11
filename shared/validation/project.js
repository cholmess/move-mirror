import { REQUIRED_EVAL_CRITERION, TARGET_PATTERN_ID } from "../transfer/intervention.js";

/** Map dose-eligible validation events to intervention-log-v1 pedagogy events for dose calculation. */
export function validationEventsToPedagogy(events) {
  const pedagogy = [];
  for (const event of events) {
    if (!event.doseEligible) continue;
    const at = event.observedAt ?? event.occurredAt;
    const patternId = event.patternId ?? TARGET_PATTERN_ID;
    switch (event.type) {
      case "lesson_started":
        pedagogy.push({
          id: event.idempotencyKey,
          occurredAt: at,
          eventType: "lesson_started",
          patternId,
          lessonVersion: event.payload.lessonVersion,
          exerciseId: null,
          attemptId: null,
          evaluationStatus: null,
          evalCriterionVersion: null,
          source: event.source === "migration" ? "migration" : "app",
        });
        break;
      case "lesson_completed":
        pedagogy.push({
          id: event.idempotencyKey,
          occurredAt: at,
          eventType: "lesson_completed",
          patternId,
          lessonVersion: event.payload.lessonVersion,
          exerciseId: null,
          attemptId: null,
          evaluationStatus: null,
          evalCriterionVersion: null,
          source: event.source === "migration" ? "migration" : "app",
        });
        break;
      case "training_session_started":
        pedagogy.push({
          id: event.idempotencyKey,
          occurredAt: at,
          eventType: "training_session_started",
          patternId,
          lessonVersion: event.payload.lessonVersion ?? null,
          exerciseId: null,
          attemptId: null,
          evaluationStatus: null,
          evalCriterionVersion: null,
          source: event.source === "migration" ? "migration" : "app",
        });
        break;
      case "training_session_completed":
        pedagogy.push({
          id: event.idempotencyKey,
          occurredAt: at,
          eventType: "training_session_completed",
          patternId,
          lessonVersion: event.payload.lessonVersion ?? null,
          exerciseId: null,
          attemptId: null,
          evaluationStatus: null,
          evalCriterionVersion: null,
          source: event.source === "migration" ? "migration" : "app",
        });
        break;
      case "training_attempt_recorded":
        pedagogy.push({
          id: event.idempotencyKey,
          occurredAt: at,
          eventType: "exercise_confirmed",
          patternId,
          lessonVersion: event.payload.lessonVersion ?? null,
          exerciseId: event.payload.exerciseId,
          attemptId: event.payload.attemptId,
          evaluationStatus: event.payload.evaluationStatus,
          evalCriterionVersion: event.payload.evalCriterionVersion ?? REQUIRED_EVAL_CRITERION,
          source: event.source === "migration" ? "migration" : "app",
        });
        break;
      default:
        break;
    }
  }
  return pedagogy.sort(
    (a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)) || String(a.id).localeCompare(String(b.id)),
  );
}
