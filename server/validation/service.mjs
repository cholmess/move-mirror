import { randomUUID } from "node:crypto";
import {
  buildValidationEvent,
  pedagogyMirrorToValidationInput,
  validatePayload,
} from "../../shared/validation/events.js";
import { rebuildValidationState } from "../../shared/validation/rebuild.js";
import { buildQualificationSnapshot } from "../../shared/validation/snapshot.js";
import { migrationInputsFromClientExport } from "../../shared/validation/migrate.js";
import { validationEventsToPedagogy } from "../../shared/validation/project.js";
import { DOSE_PROTOCOL_ID } from "../../shared/transfer/intervention.js";

export function createValidationService(store) {
  const timezone = process.env.VALIDATION_TIMEZONE ?? "UTC";

  function findByIdempotency(events, key) {
    return events.find((event) => event.idempotencyKey === key) ?? null;
  }

  async function persistRebuild(events, previousQualification = null) {
    const prev =
      previousQualification ??
      (store.readState()?.interventionQualification?.qualifiedAt
        ? store.readState().interventionQualification
        : null);
    const rebuilt = rebuildValidationState(events, { previousQualification: prev, timezone });
    await store.writeState(rebuilt);
    return rebuilt;
  }

  async function appendValidated(input) {
    store.ensure();
    const events = store.readEvents();
    const idempotencyKey = input.idempotencyKey;
    const existing = idempotencyKey ? findByIdempotency(events, idempotencyKey) : null;
    if (existing) return { event: existing, created: false };

    const receivedAt = new Date().toISOString();
    const event = buildValidationEvent(input, { occurredAt: receivedAt, receivedAt });
    await store.appendEventLine(event);
    const all = [...events, event];
    const rebuilt = await persistRebuild(all);
    await maybeQualify(all, rebuilt);
    return { event, created: true };
  }

  async function maybeQualify(events, rebuilt) {
    const q = rebuilt.interventionQualification;
    if (!q?.qualifiedAt) return null;
    if (events.some((e) => e.type === "intervention_qualified")) return null;

    const pedagogy = validationEventsToPedagogy(events);
    const snapshot = buildQualificationSnapshot({
      qualification: q,
      pedagogyEvents: pedagogy,
      qualifiedAt: q.qualifiedAt,
      lessonVersion: pedagogy.find((e) => e.eventType === "lesson_completed")?.lessonVersion ?? null,
    });
    const snapshotPath = store.saveSnapshot(snapshot);
    const qualifiedAt = q.qualifiedAt;
    await appendValidated({
      type: "intervention_qualified",
      source: "training",
      patternId: q.patternId,
      payload: { qualifiedAt, snapshotHash: snapshot.snapshotHash, protocolId: DOSE_PROTOCOL_ID },
      idempotencyKey: `intervention-qualified:${DOSE_PROTOCOL_ID}`,
    });
    await appendValidated({
      type: "validation_snapshot_created",
      source: "training",
      payload: { snapshotHash: snapshot.snapshotHash, snapshotPath },
      idempotencyKey: `validation-snapshot:${snapshot.snapshotHash}`,
    });
    return snapshot;
  }

  function publicStatus() {
    const state = store.readState();
    const q = state?.interventionQualification;
    const lessonCompleted = Boolean(q?.lessonCompletedAt);
    const exercises = q?.confirmedExercises ?? 0;
    const successes = q?.verifiedSuccesses ?? 0;
    const sessions = q?.distinctSessions ?? 0;
    const days = q?.distinctCalendarDays ?? 0;
    const qualified = Boolean(q?.qualified);
    let nextAction = null;
    if (!qualified) {
      if (!lessonCompleted) nextAction = "complete_lesson";
      else if (exercises < 12) nextAction = "more_exercises";
      else if (successes < 8) nextAction = "more_verified_successes";
      else if (sessions < 2) nextAction = "more_sessions";
      else if (days < 2) nextAction = "more_days";
      else nextAction = "continue_training";
    }
    return {
      lessonCompleted,
      exercises: { done: exercises, required: 12 },
      verifiedSuccesses: { done: successes, required: 8 },
      sessions: { done: sessions, required: 2 },
      days: { done: days, required: 2 },
      qualificationReached: qualified,
      qualificationReachedAt: qualified ? q.qualifiedAt : null,
      nextAction,
      exercisesRemaining: Math.max(0, 12 - exercises),
      canonicalSource: "server",
    };
  }

  return {
    store,
    timezone,
    publicStatus,
    listEvents() {
      return store.readEvents();
    },
    readState() {
      return store.readState();
    },
    exportBundle() {
      return store.exportBundle();
    },
    async recordDomainEvent(input) {
      return appendValidated(input);
    },
    async recordPedagogyMirror(pedagogyEvent) {
      const mapped = pedagogyMirrorToValidationInput(pedagogyEvent);
      if (!mapped) return null;
      return appendValidated(mapped);
    },
    async syncPedagogyBatch(pedagogyEvents = []) {
      const results = [];
      for (const pedagogyEvent of pedagogyEvents) {
        results.push(await recordPedagogyMirror(pedagogyEvent));
      }
      return results;
    },
    async migrateFromClient(exportBody) {
      store.ensure();
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const { backup, events, incomplete } = migrationInputsFromClientExport(exportBody);
      store.saveMigrationBackup(`backup-${stamp}.json`, backup);
      const imported = [];
      for (const input of events) {
        imported.push(await appendValidated({ ...input, source: input.source ?? "migration" }));
      }
      await persistRebuild(store.readEvents());
      const rebuilt = store.readState();
      return { imported: imported.length, incomplete, qualification: rebuilt.interventionQualification };
    },
    async rebuildFromEvents() {
      const events = store.readEvents();
      const rebuilt = await persistRebuild(events);
      return rebuilt;
    },
    getSnapshot(hash) {
      return store.readSnapshot(hash);
    },
    async recordGameImported(game) {
      return appendValidated({
        type: "game_imported",
        source: "games",
        gameId: game.id,
        payload: { gameId: game.id, startTime: game.startedAt ?? game.startTime ?? null },
      });
    },
    async recordCohortCreated(cohort) {
      return appendValidated({
        type: "transfer_cohort_created",
        source: "transfer",
        cohortId: cohort.id,
        payload: { cohortId: cohort.id, createdAt: cohort.createdAt ?? cohort.syncedAt },
      });
    },
    async recordCohortFrozen(cohortId, frozenAt) {
      return appendValidated({
        type: "transfer_cohort_frozen",
        source: "transfer",
        cohortId,
        payload: { cohortId, frozenAt },
      });
    },
    async recordSparringCompleted(session) {
      return appendValidated({
        type: "sparring_session_completed",
        source: "sparring",
        sessionId: session.id,
        payload: { sessionId: session.id, termination: session.termination, result: session.result },
      });
    },
    async recordDefenseCompleted({ sessionId, exerciseId }) {
      return appendValidated({
        type: "defense_session_completed",
        source: "defense",
        sessionId,
        exerciseId,
        payload: { sessionId, exerciseId },
      });
    },
  };
}
