import { describe, it, expect } from "vitest";
import { mapLegacyResult, migrateV1ToV2, migrateV3ToV4 } from "./migration";
import { rebuildSkillsFromAttempts } from "../domain/profile";
import type { AppStateV1 } from "../types/learning";
import type { AppStateV3 } from "../types/learning";

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

describe("migration v3 → v4", () => {
  it("is non-destructive and initializes versioned Defense Lab state", () => {
    const v3 = {
      version: 3,
      username: "cholmess21",
      attempts: [],
      skills: {},
      progress: { exercisesCompleted: ["existing"] },
      pedagogyEvents: [],
      interventionQualification: { qualified: true },
      updatedAt: "2026-01-01",
    } as unknown as AppStateV3;
    const v4 = migrateV3ToV4(v3);
    expect(v4.attempts).toEqual(v3.attempts);
    expect(v4.progress).toEqual(v3.progress);
    expect(v4.interventionQualification).toEqual(v3.interventionQualification);
    expect(v4.defenseLab).toMatchObject({
      version: "defense-lab-state-v1",
      attempts: [],
    });
  });
});
