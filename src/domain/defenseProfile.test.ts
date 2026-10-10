import { describe, expect, it } from "vitest";
import { buildDefenseProfile } from "./defenseProfile";
import type { DefenseAttempt } from "../types/defense";

function attempt(index: number): DefenseAttempt {
  return {
    attemptId: `a${index}`,
    exerciseId: `e${index}`,
    startedAt: "2026-10-01T00:00:00.000Z",
    confirmedAt: `2026-10-0${(index % 3) + 1}T00:00:00.000Z`,
    moveUci: "e2e4",
    moveSan: "e4",
    perceivedThreat: ["capture"],
    perceivedThreatText: "",
    selectedResource: "move_attacked_piece",
    predictedOpponentReply: "Qxe4",
    defenseReasoning: "evita captura",
    verificationConfirmed: true,
    evaluationStatus: index < 4 ? "incorrect" : "verified_acceptable",
    evaluationId: `v${index}`,
    retryOfAttemptId: null,
    sourceGameId: `g${index % 3}`,
    interventionEventId: `d${index}`,
    doseEligible: false,
    motif: "move_attacked_piece",
    phase: "middlegame",
    orientation: index % 2 ? "white" : "black",
    sessionId: `s${index % 2}`,
  };
}

describe("defensive profile", () => {
  it("keeps claims as low-confidence hypotheses below the minimum sample", () => {
    const profile = buildDefenseProfile([attempt(0), attempt(1), attempt(2), attempt(3)]);
    expect(profile.evidenceEnough).toBe(false);
    expect(profile.hypothesis).toContain("no hay volumen suficiente");
  });

  it("separates observation, hypothesis, and confidence after sufficient variety", () => {
    const profile = buildDefenseProfile([0, 1, 2, 3, 4, 5].map(attempt));
    expect(profile.evidenceEnough).toBe(true);
    expect(profile.observation).toContain("Fallaste");
    expect(profile.hypothesis).toContain("Podrías");
    expect(profile.confidence).toBe("media");
  });
});
