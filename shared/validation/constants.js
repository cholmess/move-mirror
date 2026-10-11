export const VALIDATION_EVENT_SCHEMA = "validation-event-v1";
export const VALIDATION_STATE_SCHEMA = "validation-state-v1";

export const APP_VERSION = "0.6.1";

export const VALIDATION_SOURCES = new Set([
  "lesson",
  "training",
  "defense",
  "sparring",
  "games",
  "transfer",
  "migration",
]);

export const VALIDATION_EVENT_TYPES = new Set([
  "lesson_started",
  "lesson_completed",
  "training_session_started",
  "training_attempt_recorded",
  "training_session_completed",
  "defense_session_completed",
  "sparring_session_completed",
  "game_imported",
  "transfer_cohort_created",
  "transfer_cohort_frozen",
  "intervention_qualified",
  "validation_snapshot_created",
]);

export const EVAL_STATUSES = new Set([
  "verified_best",
  "verified_acceptable",
  "playable_inexact",
  "incorrect",
  "illegal",
  "unverified",
]);
