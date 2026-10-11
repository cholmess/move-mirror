import { calculateInterventionQualification } from "../transfer/intervention.js";
import { validationEventsToPedagogy } from "./project.js";
import { VALIDATION_STATE_SCHEMA } from "./constants.js";

export function rebuildValidationState(events, { previousQualification = null, timezone = "UTC" } = {}) {
  const ordered = [...events].sort(
    (a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)) || String(a.eventId).localeCompare(String(b.eventId)),
  );
  const pedagogy = validationEventsToPedagogy(ordered);
  const qualification = calculateInterventionQualification(pedagogy, previousQualification);
  const qualifiedEvents = ordered.filter((e) => e.type === "intervention_qualified");
  const snapshotEvents = ordered.filter((e) => e.type === "validation_snapshot_created");
  return {
    schemaVersion: VALIDATION_STATE_SCHEMA,
    rebuiltAt: new Date().toISOString(),
    timezone,
    eventCount: ordered.length,
    lastEventId: ordered.at(-1)?.eventId ?? null,
    interventionQualification: qualification,
    qualifiedAt: qualification.qualifiedAt,
    interventionQualifiedEventCount: qualifiedEvents.length,
    latestSnapshotHash: snapshotEvents.at(-1)?.payload?.snapshotHash ?? null,
    pedagogyEventCount: pedagogy.length,
  };
}
