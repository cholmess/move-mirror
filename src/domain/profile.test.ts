import { describe, it, expect } from "vitest";
import { createInitialSkills, updateSkillsFromAttempt } from "./profile";
import type { AttemptRecord } from "../types/learning";

function mockAttempt(
  status: AttemptRecord["evaluationStatus"]
): AttemptRecord {
  return {
    id: "x",
    exerciseId: "ex",
    patternId: "cct-opponent-refutation",
    skillIds: ["cct-opponent-refutation"],
    fen: "fen",
    cct: {
      checksConsidered: "a",
      capturesConsidered: "b",
      threatsConsidered: "c",
      firstCandidate: "d",
      opponentForcedResponse: "e",
    },
    chosenMoveSan: "e4",
    reasoning: "reasoning text here",
    timeUsedSeconds: 5,
    evaluationStatus: status,
    evalLossCp: null,
    engineVersion: null,
    engineSha256: null,
    evalVerified: status !== "unverified",
    observableReason: null,
    opponentReplySan: null,
    reflectionPrompt: null,
    attemptNumber: 1,
    foundOpponentForcedResponse: false,
    recordedAt: new Date().toISOString(),
    lessonVersion: "v1",
    evalCriterionVersion: "engine-validated-v2",
  };
}

describe("profile alpha/beta v0.2", () => {
  it("unverified does not change alpha/beta", () => {
    const before = createInitialSkills();
    const sid = "cct-opponent-refutation";
    const after = updateSkillsFromAttempt(before, mockAttempt("unverified"));
    expect(after[sid]!.alpha).toBe(before[sid]!.alpha);
    expect(after[sid]!.beta).toBe(before[sid]!.beta);
  });

  it("verified_best increments alpha", () => {
    const before = createInitialSkills();
    const sid = "cct-opponent-refutation";
    const after = updateSkillsFromAttempt(before, mockAttempt("verified_best"));
    expect(after[sid]!.alpha).toBe(before[sid]!.alpha + 1);
  });

  it("playable_inexact partial update", () => {
    const before = createInitialSkills();
    const sid = "cct-opponent-refutation";
    const after = updateSkillsFromAttempt(before, mockAttempt("playable_inexact"));
    expect(after[sid]!.alpha).toBe(before[sid]!.alpha + 0.5);
    expect(after[sid]!.beta).toBe(before[sid]!.beta + 0.5);
  });
});
