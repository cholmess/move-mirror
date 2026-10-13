import { COACH_DOSE_PROTOCOL_ID, COACH_LESSON_SPEC_VERSION, COACH_PATTERN_ID } from "./constants.js";

export function coachEventsFromValidation(events) {
  return events.filter(
    (e) =>
      e.type.startsWith("coach_") ||
      (e.payload?.protocolId === COACH_DOSE_PROTOCOL_ID && e.type === "coach_dose_qualified"),
  );
}

export function calculateCoachDoseQualification(events, previous = null) {
  const ordered = [...events].sort(
    (a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)) || String(a.eventId).localeCompare(String(b.eventId)),
  );
  const completed = ordered.find((e) => e.type === "coach_session_completed");
  const holdout = ordered.find((e) => e.type === "coach_holdout_recorded");
  const retention = ordered.find((e) => e.type === "coach_retention_recorded");
  const qualifiedEvent = ordered.find((e) => e.type === "coach_dose_qualified");

  const flags = {
    contrastCompleted: Boolean(completed?.payload?.contrastCompleted),
    sessionCompleted: Boolean(completed),
    holdoutFirstAttempt: Boolean(holdout?.payload?.firstAttempt),
    retentionWithoutHints: Boolean(
      retention?.payload?.firstAttempt && retention?.payload?.success && retention?.payload?.hintLevel === 0,
    ),
    exitRuleRecorded: Boolean(completed?.payload?.exitRuleRecorded),
  };

  const missing = [];
  if (!flags.contrastCompleted) missing.push("contrast_signal");
  if (!flags.sessionCompleted) missing.push("coach_session_completed");
  if (!flags.holdoutFirstAttempt) missing.push("holdout_first_attempt");
  if (!flags.exitRuleRecorded) missing.push("exit_rule");
  if (!flags.retentionWithoutHints) missing.push("retention_independent");

  const qualifies = missing.length === 0;
  const qualifiedAt =
    previous?.qualifiedAt ??
    qualifiedEvent?.occurredAt ??
    (qualifies ? (retention?.occurredAt ?? completed?.occurredAt ?? null) : null);

  return {
    protocolId: COACH_DOSE_PROTOCOL_ID,
    patternId: COACH_PATTERN_ID,
    lessonSpecVersion: COACH_LESSON_SPEC_VERSION,
    qualified: Boolean(qualifiedAt),
    qualifiedAt: qualifiedAt ?? null,
    flags,
    missingRequirements: qualifiedAt ? [] : missing,
    evidenceEventIds: ordered
      .filter((e) =>
        ["coach_session_completed", "coach_holdout_recorded", "coach_retention_recorded", "coach_dose_qualified"].includes(
          e.type,
        ),
      )
      .map((e) => e.eventId),
  };
}
