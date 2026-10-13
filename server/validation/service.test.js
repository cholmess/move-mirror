import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createValidationStore, parseEventsJsonl } from "./store.mjs";
import { createValidationService } from "./service.mjs";
import { verifyValidationLedger } from "./verify.mjs";
import { classifyGameInterventionExposure } from "../../shared/validation/classify.js";
import { DOSE_PROTOCOL_ID, REQUIRED_EVAL_CRITERION } from "../../shared/transfer/intervention.js";
import { COACH_DOSE_PROTOCOL_ID } from "../../shared/coach/constants.js";

function attempt(i, day, status = "verified_best", session = "s1") {
  return {
    type: "training_attempt_recorded",
    source: "training",
    observedAt: `2026-10-0${day}T10:0${i % 10}:00.000Z`,
    payload: {
      attemptId: `a-${i}`,
      exerciseId: `ex-${i}`,
      evaluationStatus: status,
      evalCriterionVersion: REQUIRED_EVAL_CRITERION,
      lessonVersion: "cct-refutation-v1",
    },
    idempotencyKey: `training-attempt:a-${i}`,
  };
}

describe("validation ledger service", () => {
  let root;
  let service;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "validation-ledger-"));
    const store = createValidationStore(root);
    service = createValidationService(store);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("records idempotent events", async () => {
    const input = {
      type: "lesson_completed",
      source: "lesson",
      payload: { lessonVersion: "cct-refutation-v1" },
      idempotencyKey: "lesson-completed:cct-refutation-v1",
    };
    const a = await service.recordDomainEvent(input);
    const b = await service.recordDomainEvent(input);
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(a.event.eventId).toBe(b.event.eventId);
    expect(service.listEvents().length).toBe(1);
  });

  it("rebuilds state from jsonl", async () => {
    await service.recordDomainEvent({
      type: "lesson_completed",
      source: "lesson",
      payload: { lessonVersion: "cct-refutation-v1" },
    });
    await service.rebuildFromEvents();
    expect(service.readState().interventionQualification.lessonCompletedAt).toBeTruthy();
  });

  it("tolerates incomplete trailing jsonl line", () => {
    const store = createValidationStore(root);
    store.ensure();
    const file = store.dirs.events;
    const good = JSON.stringify({ schemaVersion: "validation-event-v1", eventId: "1", idempotencyKey: "k1" });
    appendFileSync(file, `${good}\n{ incomplete\n`);
    const parsed = parseEventsJsonl(readFileSync(file, "utf8"));
    expect(parsed.length).toBe(1);
  });

  it("does not qualify with eleven exercises", async () => {
    for (let i = 1; i <= 11; i += 1) {
      await service.recordDomainEvent(attempt(i, 1));
    }
    await service.recordDomainEvent({
      type: "lesson_completed",
      source: "lesson",
      payload: { lessonVersion: "cct-refutation-v1" },
    });
    expect(service.publicStatus().qualificationReached).toBe(false);
  });

  it("does not count unverified as success", async () => {
    for (let i = 1; i <= 12; i += 1) {
      await service.recordDomainEvent(attempt(i, i <= 6 ? 1 : 2, i <= 7 ? "unverified" : "verified_best", i <= 6 ? "s1" : "s2"));
    }
    await service.recordDomainEvent({
      type: "training_session_started",
      source: "training",
      payload: { sessionId: "s1", lessonVersion: "cct-refutation-v1" },
    });
    await service.recordDomainEvent({
      type: "training_session_started",
      source: "training",
      payload: { sessionId: "s2", lessonVersion: "cct-refutation-v1" },
    });
    await service.recordDomainEvent({
      type: "lesson_completed",
      source: "lesson",
      payload: { lessonVersion: "cct-refutation-v1" },
    });
    expect(service.publicStatus().verifiedSuccesses.done).toBeLessThan(8);
    expect(service.publicStatus().qualificationReached).toBe(false);
  });

  it("qualifies at dose threshold with two days", async () => {
    await service.recordDomainEvent({
      type: "lesson_completed",
      source: "lesson",
      observedAt: "2026-10-01T08:00:00.000Z",
      payload: { lessonVersion: "cct-refutation-v1" },
    });
    await service.recordDomainEvent({
      type: "training_session_started",
      source: "training",
      observedAt: "2026-10-01T08:01:00.000Z",
      payload: { sessionId: "s1", lessonVersion: "cct-refutation-v1" },
    });
    await service.recordDomainEvent({
      type: "training_session_started",
      source: "training",
      observedAt: "2026-10-02T08:01:00.000Z",
      payload: { sessionId: "s2", lessonVersion: "cct-refutation-v1" },
    });
    for (let i = 1; i <= 12; i += 1) {
      await service.recordDomainEvent(attempt(i, i <= 6 ? 1 : 2, "verified_best", i <= 6 ? "s1" : "s2"));
    }
    const status = service.publicStatus();
    expect(status.qualificationReached).toBe(true);
    expect(service.listEvents().some((e) => e.type === "intervention_qualified")).toBe(true);
  });

  it("sparring and defense events stay dose ineligible", async () => {
    await service.recordSparringCompleted({ id: "11111111-1111-4111-8111-111111111111", termination: "resignation" });
    await service.recordDefenseCompleted({ sessionId: "d1", exerciseId: "ex1" });
    const events = service.listEvents();
    expect(events.every((e) => e.doseEligible === false)).toBe(true);
    expect(service.publicStatus().exercises.done).toBe(0);
  });

  it("migration does not invent qualifiedAt", async () => {
    await service.migrateFromClient({
      pedagogyEvents: [],
      attempts: [],
      progress: { lessonCompletedAt: null },
      interventionQualification: { qualified: false, qualifiedAt: null },
    });
    expect(service.readState().interventionQualification.qualifiedAt).toBeNull();
  });

  it("game import event is not training dose", async () => {
    await service.recordGameImported({ id: "game-1", startedAt: "2026-10-10T12:00:00.000Z" });
    expect(service.publicStatus().exercises.done).toBe(0);
  });

  it("classifies games pre and post qualification", () => {
    const q = "2026-10-05T12:00:00.000Z";
    expect(classifyGameInterventionExposure({ pgn: '[UTCDate "2026.10.04"]\n[UTCTime "12:00:00"]' }, q)).toBe(
      "pre_intervention",
    );
    expect(classifyGameInterventionExposure({ pgn: '[UTCDate "2026.10.06"]\n[UTCTime "12:00:00"]' }, q)).toBe(
      "post_intervention",
    );
  });

  it("verify passes on fresh ledger", () => {
    const report = verifyValidationLedger(service);
    expect(report.ok).toBe(true);
  });

  it("coach dose v2 coexists without rewriting v1 cohort qualification", async () => {
    await service.recordDomainEvent({
      type: "lesson_completed",
      source: "lesson",
      observedAt: "2026-10-01T08:00:00.000Z",
      payload: { lessonVersion: "cct-refutation-v1" },
    });
    await service.recordDomainEvent({
      type: "training_session_started",
      source: "training",
      observedAt: "2026-10-01T08:01:00.000Z",
      payload: { sessionId: "s1", lessonVersion: "cct-refutation-v1" },
    });
    await service.recordDomainEvent({
      type: "training_session_started",
      source: "training",
      observedAt: "2026-10-02T08:01:00.000Z",
      payload: { sessionId: "s2", lessonVersion: "cct-refutation-v1" },
    });
    for (let i = 1; i <= 12; i += 1) {
      await service.recordDomainEvent(attempt(i, i <= 6 ? 1 : 2, "verified_best", i <= 6 ? "s1" : "s2"));
    }
    const v1QualifiedAt = service.readState().interventionQualification.qualifiedAt;
    expect(v1QualifiedAt).toBeTruthy();
    expect(service.readState().interventionQualification.protocolId).toBe(DOSE_PROTOCOL_ID);

    await service.recordDomainEvent({
      type: "coach_session_completed",
      source: "coach",
      observedAt: "2026-10-10T10:00:00.000Z",
      payload: {
        sessionId: "coach-1",
        protocolId: "candidate-refutation-teaching-v2",
        contrastCompleted: true,
        exitRuleRecorded: true,
      },
      idempotencyKey: "coach-session-completed:coach-1",
    });
    await service.recordDomainEvent({
      type: "coach_holdout_recorded",
      source: "coach",
      observedAt: "2026-10-10T10:05:00.000Z",
      payload: {
        sessionId: "coach-1",
        contentId: "holdout-1",
        firstAttempt: true,
        success: true,
        hintLevel: 0,
        historicalExposureUncertain: true,
        countsForProtectedGeneralization: false,
      },
      idempotencyKey: "coach-holdout:coach-1",
    });
    await service.rebuildFromEvents();

    const state = service.readState();
    expect(state.interventionQualification.qualifiedAt).toBe(v1QualifiedAt);
    expect(state.interventionQualification.protocolId).toBe(DOSE_PROTOCOL_ID);
    expect(state.coachInterventionQualification.protocolId).toBe(COACH_DOSE_PROTOCOL_ID);
    expect(state.coachInterventionQualification.qualified).toBe(false);
    expect(state.coachInterventionQualification.missingRequirements).toContain("retention_independent");
  });
});
