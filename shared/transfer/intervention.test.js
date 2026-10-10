import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  appendPedagogyEvent,
  auditCohortExposure,
  calculateInterventionQualification,
  comparabilityWarning,
  contextSummary,
  migratePedagogyEvidence,
  sha256Canonical,
} from "./intervention.js";

const base = {
  patternId: "cct-opponent-refutation",
  lessonVersion: "cct-refutation-v1",
  exerciseId: null,
  attemptId: null,
  evaluationStatus: null,
  evalCriterionVersion: null,
  source: "app",
};
const event = (id, occurredAt, eventType, extra = {}) => ({ ...base, id, occurredAt, eventType, ...extra });

function completeDose(lastStatus = "playable_inexact") {
  const events = [event("lesson", "2026-10-01T08:00:00.000Z", "lesson_completed")];
  for (let session = 1; session <= 2; session += 1) {
    const day = `0${session}`;
    events.push(event(`s${session}`, `2026-10-${day}T09:00:00.000Z`, "training_session_started"));
    for (let i = 0; i < 6; i += 1) {
      const n = (session - 1) * 6 + i;
      events.push(event(`a${n}`, `2026-10-${day}T09:${String(i + 1).padStart(2, "0")}:00.000Z`, "exercise_confirmed", {
        exerciseId: `ex-${n}`,
        attemptId: `attempt-${n}`,
        evaluationStatus: n === 11 ? lastStatus : n < 8 ? "verified_best" : "playable_inexact",
        evalCriterionVersion: "engine-validated-v2",
      }));
    }
    events.push(event(`e${session}`, `2026-10-${day}T10:00:00.000Z`, "training_session_completed"));
  }
  return events;
}

describe("intervention dose", () => {
  it("appends events idempotently", () => {
    const item = event("x", "2026-10-01T00:00:00.000Z", "lesson_started");
    expect(appendPedagogyEvent(appendPedagogyEvent([], item), item)).toEqual([item]);
  });

  it("calculates the exact event that completes 12 exercises, 8 successes, two sessions and days", () => {
    const qualification = calculateInterventionQualification(completeDose());
    expect(qualification.qualified).toBe(true);
    expect(qualification.qualifiedAt).toBe("2026-10-02T09:06:00.000Z");
    expect(qualification.confirmedExercises).toBe(12);
    expect(qualification.verifiedSuccesses).toBe(8);
    expect(qualification.distinctSessions).toBe(2);
    expect(qualification.distinctCalendarDays).toBe(2);
  });

  it("does not count unverified and requires distinct sessions and days", () => {
    const unverified = completeDose("unverified");
    expect(calculateInterventionQualification(unverified).confirmedExercises).toBe(11);
    const oneSession = completeDose().filter((item) => !["s2", "e2"].includes(item.id));
    expect(calculateInterventionQualification(oneSession).qualified).toBe(false);
  });

  it("freezes qualifiedAt after qualification", () => {
    const first = calculateInterventionQualification(completeDose());
    const later = [...completeDose(), event("later", "2026-11-01T00:00:00.000Z", "exercise_confirmed", {
      evaluationStatus: "verified_best", evalCriterionVersion: "engine-validated-v2",
    })];
    expect(calculateInterventionQualification(later, first).qualifiedAt).toBe(first.qualifiedAt);
  });

  it("migrates only stored timestamps and does not invent sessions", () => {
    const migration = migratePedagogyEvidence({
      attempts: [{ id: "a", recordedAt: "", patternId: base.patternId }],
      lessonCompletedAt: null,
    });
    expect(migration.events).toEqual([]);
    expect(migration.incomplete).toHaveLength(2);
    expect(calculateInterventionQualification(migration.events).distinctSessions).toBe(0);
  });
});

describe("exposure and comparability", () => {
  const game = (id, at) => ({ gameId: id, startTime: at });
  it("classifies fully post, mixed, and unknown exposure", () => {
    const q = { qualifiedAt: "2026-10-02T00:00:00.000Z" };
    expect(auditCohortExposure({ cohortId: "a", games: [game("1", "2026-10-03T00:00:00Z")], qualification: q, auditedAt: "x" }).exposureValidity).toBe("post_intervention_verified");
    expect(auditCohortExposure({ cohortId: "a", games: [game("1", "2026-10-01T00:00:00Z"), game("2", "2026-10-03T00:00:00Z")], qualification: q, auditedAt: "x" }).exposureValidity).toBe("mixed_exposure");
    expect(auditCohortExposure({ cohortId: "a", games: [], qualification: null, auditedAt: "x" }).exposureValidity).toBe("exposure_unknown");
  });

  it("uses an independent audit hash and preserves the frozen metrics hash", () => {
    const metricsFile = new URL("../../data/transfer/cohorts/transfer-20261010-2/metrics.json", import.meta.url);
    const before = createHash("sha256").update(readFileSync(metricsFile)).digest("hex");
    const audit = auditCohortExposure({ cohortId: "a", games: [], qualification: null, auditedAt: "x" });
    expect(audit.auditHash).toBe(sha256Canonical({ ...audit, auditHash: undefined }));
    expect(createHash("sha256").update(readFileSync(metricsFile)).digest("hex")).toBe(before);
  });

  it("raises an explicit warning from testable composition thresholds", () => {
    const baseline = contextSummary([{ color: "white", result: "win", ratingOwn: 1000, ratingOpponent: 1000, ownDecisions: 20 }]);
    const cohort = contextSummary([{ color: "black", result: "loss", ratingOwn: 1200, ratingOpponent: 1200, ownDecisions: 40 }]);
    expect(comparabilityWarning(baseline, cohort).materialDifference).toBe(true);
  });

  it("does not use prohibited causal claims in the transfer UI", () => {
    const source = readFileSync(new URL("../../src/components/TransferView.tsx", import.meta.url), "utf8");
    for (const claim of ["La lección mejoró tu juego", "Transferencia confirmada", "Después del entrenamiento", "Dominaste esta debilidad"]) {
      expect(source).not.toContain(claim);
    }
  });
});
