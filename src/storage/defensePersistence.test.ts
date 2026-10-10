import { describe, expect, it } from "vitest";
import { createInitialState, exportAttempts, importState, recordDefenseAttempt } from "./persistence";
import type { DefenseAttempt } from "../types/defense";

const attempt: DefenseAttempt = {
  attemptId: "def-a1",
  exerciseId: "def-e1",
  startedAt: "2026-10-10T10:00:00.000Z",
  confirmedAt: "2026-10-10T10:01:00.000Z",
  moveUci: "e2e4",
  moveSan: "e4",
  perceivedThreat: ["capture"],
  perceivedThreatText: "captura",
  selectedResource: "counterattack",
  predictedOpponentReply: "e5",
  defenseReasoning: "control",
  verificationConfirmed: true,
  evaluationStatus: "verified_acceptable",
  evaluationId: "eval-1",
  retryOfAttemptId: null,
  sourceGameId: "game-1",
  interventionEventId: "defense-attempt:def-a1",
  doseEligible: false,
  motif: "counterattack",
  phase: "opening",
  orientation: "white",
  sessionId: "session-1",
};

describe("Defense Lab persistence separation", () => {
  it("persists and exports attempts without changing dose or training alpha/beta", () => {
    const before = createInitialState();
    const after = recordDefenseAttempt(before, attempt, null, null);
    expect(after.interventionQualification).toEqual(before.interventionQualification);
    expect(after.skills).toEqual(before.skills);
    expect(after.pedagogyEvents).toEqual(before.pedagogyEvents);
    expect(after.defenseLab.attempts[0]?.doseEligible).toBe(false);

    const imported = importState(exportAttempts(after));
    expect(imported.defenseLab.attempts).toEqual([attempt]);
  });

  it("preserves attempts whose exercise is later archived", () => {
    const archivedAttempt = {
      ...attempt,
      attemptId: "archived-attempt",
      exerciseId: "def-28e6d974-b922-11f1-9e49-30204801000f-46",
    };
    const state = recordDefenseAttempt(createInitialState(), archivedAttempt, null, null);
    const imported = importState(exportAttempts(state));
    expect(imported.defenseLab.attempts[0]).toMatchObject({
      attemptId: "archived-attempt",
      exerciseId: archivedAttempt.exerciseId,
      evaluationId: "eval-1",
    });
  });
});
