import { migratePedagogyEvidence } from "../transfer/intervention.js";
import { pedagogyMirrorToValidationInput } from "./events.js";

export function migrationInputsFromClientExport(exportBody) {
  const backup = {
    exportedAt: new Date().toISOString(),
    version: exportBody.version ?? null,
    pedagogyEvents: exportBody.pedagogyEvents ?? [],
    interventionQualification: exportBody.interventionQualification ?? null,
    attempts: exportBody.attempts ?? [],
  };
  let events = [];
  const incomplete = [];
  if (Array.isArray(exportBody.pedagogyEvents) && exportBody.pedagogyEvents.length) {
    for (const pedagogyEvent of exportBody.pedagogyEvents) {
      const input = pedagogyMirrorToValidationInput(pedagogyEvent);
      if (input) events.push(input);
      else incomplete.push({ kind: pedagogyEvent.eventType, reason: "unsupported_event" });
    }
  } else if (exportBody.attempts?.length || exportBody.progress?.lessonCompletedAt) {
    const migrated = migratePedagogyEvidence({
      attempts: exportBody.attempts ?? [],
      lessonCompletedAt: exportBody.progress?.lessonCompletedAt ?? null,
      lessonVersion: exportBody.lessonVersion ?? null,
    });
    for (const pedagogyEvent of migrated.events) {
      const input = pedagogyMirrorToValidationInput(pedagogyEvent);
      if (input) events.push(input);
    }
    incomplete.push(...migrated.incomplete);
  }
  return { backup, events, incomplete };
}
