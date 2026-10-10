import { describe, it, expect } from "vitest";
import { mapLegacyResult, migrateV1ToV2 } from "./migration";
import { rebuildSkillsFromAttempts } from "../domain/profile";
import type { AppStateV1 } from "../types/learning";

describe("migration v1 → v2", () => {
  it("correct_alternative → unverified", () => {
    expect(mapLegacyResult("correct_alternative")).toBe("unverified");
  });

  it("correct → verified_best", () => {
    expect(mapLegacyResult("correct")).toBe("verified_best");
  });

  it("rebuilds profile without false successes from alternatives", () => {
    const v1: AppStateV1 = {
      version: 1,
      username: "cholmess21",
      attempts: [
        {
          id: "1",
          exerciseId: "ex-a",
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
          chosenMoveSan: "Qh5",
          reasoning: "test reasoning here",
          timeUsedSeconds: 10,
          result: "correct_alternative",
          attemptNumber: 1,
          foundOpponentForcedResponse: false,
          recordedAt: "2026-01-01T00:00:00.000Z",
          lessonVersion: "v1",
          evalCriterionVersion: "move-match-v1",
        },
      ],
      skills: {} as AppStateV1["skills"],
      progress: {
        lessonCompletedAt: null,
        exercisesCompleted: ["ex-a"],
        currentExerciseId: null,
        lastSelectionReason: null,
        totalSessionMinutes: 0,
      },
      updatedAt: "2026-01-01",
    };

    const v2 = migrateV1ToV2(v1);
    expect(v2.attempts[0]!.evaluationStatus).toBe("unverified");
    expect(v2.progress.exercisesCompleted).not.toContain("ex-a");

    const baseline = rebuildSkillsFromAttempts([]);
    const skillId = "cct-opponent-refutation";
    const after = rebuildSkillsFromAttempts(v2.attempts);
    expect(after[skillId]!.alpha).toBe(baseline[skillId]!.alpha);
    expect(after[skillId]!.beta).toBe(baseline[skillId]!.beta);
  });
});
