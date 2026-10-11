import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VALIDATION_EVENT_SCHEMA, VALIDATION_EVENT_TYPES } from "../../shared/validation/constants.js";
import { validatePayload } from "../../shared/validation/events.js";
import { rebuildValidationState } from "../../shared/validation/rebuild.js";
import { sha256Canonical } from "../../shared/transfer/intervention.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function verifyValidationLedger(service, options = {}) {
  const errors = [];
  const events = service.listEvents();
  const state = service.readState();
  const ids = new Set();
  const keys = new Set();

  for (const [index, event] of events.entries()) {
    if (event.schemaVersion !== VALIDATION_EVENT_SCHEMA) {
      errors.push(`event ${index}: unknown schema ${event.schemaVersion}`);
    }
    if (!VALIDATION_EVENT_TYPES.has(event.type)) errors.push(`event ${index}: unknown type ${event.type}`);
    if (ids.has(event.eventId)) errors.push(`duplicate eventId ${event.eventId}`);
    ids.add(event.eventId);
    if (keys.has(event.idempotencyKey)) errors.push(`duplicate idempotencyKey ${event.idempotencyKey}`);
    keys.add(event.idempotencyKey);
    try {
      validatePayload(event.type, event.payload);
    } catch (err) {
      errors.push(`event ${index}: ${err.message}`);
    }
    if (event.type === "defense_session_completed" || event.type === "sparring_session_completed") {
      if (event.doseEligible !== false) errors.push(`event ${index}: ${event.type} must be doseEligible=false`);
    }
  }

  const qualified = events.filter((e) => e.type === "intervention_qualified");
  if (qualified.length > 1) errors.push("multiple intervention_qualified events");
  if (qualified.length === 1) {
    const snapHash = qualified[0].payload.snapshotHash;
    const snapshot = service.getSnapshot(snapHash);
    if (!snapshot) errors.push("intervention_qualified missing snapshot file");
    else if (snapshot.snapshotHash !== snapHash) errors.push("snapshot hash mismatch");
    else if (sha256Canonical({ ...snapshot, snapshotHash: undefined }) !== snapHash) {
      errors.push("snapshot canonical hash invalid");
    }
  }

  const rebuilt = rebuildValidationState(events, {
    previousQualification: state?.interventionQualification?.qualifiedAt ? state.interventionQualification : null,
  });
  const a = JSON.stringify(rebuilt.interventionQualification ?? null);
  const b = JSON.stringify(state.interventionQualification ?? null);
  if (a !== b) errors.push("state.json is not consistent with events.jsonl rebuild");

  if (options.sparringRoot) {
    const sparringSessions = fs.existsSync(path.join(options.sparringRoot, "sessions"))
      ? fs.readdirSync(path.join(options.sparringRoot, "sessions")).filter((f) => f.endsWith(".json"))
      : [];
    if (options.gamesRoot) {
      const gameIds = fs.existsSync(path.join(options.gamesRoot, "canonical"))
        ? fs.readdirSync(path.join(options.gamesRoot, "canonical")).map((f) => f.replace(/\.json$/, ""))
        : [];
      for (const sessionFile of sparringSessions) {
        const sessionId = sessionFile.replace(/\.json$/, "");
        if (gameIds.includes(sessionId)) errors.push(`sparring session ${sessionId} appears in games library`);
      }
    }
  }

  const frozenCohort = path.join(ROOT, "data/transfer/cohorts/transfer-20261010-2/frozen.json");
  if (options.frozenHash && fs.existsSync(frozenCohort)) {
    const hash = sha256Canonical(JSON.parse(fs.readFileSync(frozenCohort, "utf8")));
    if (hash !== options.frozenHash) errors.push("frozen cohort transfer-20261010-2 changed");
  }

  return { ok: errors.length === 0, errors, eventCount: events.length };
}
