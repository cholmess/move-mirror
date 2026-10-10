import { describe, it, expect } from "vitest";
import { selectNextExercise } from "./adaptive";
import { createInitialState, recordAttempt } from "../storage/persistence";

describe("selectNextExercise", () => {
  it("returns exercise from bank", () => {
    const state = createInitialState();
    const { exercise } = selectNextExercise(state);
    expect(exercise.id).toMatch(/^ex-/);
  });

  it("does not treat unverified as success for rate", () => {
    let state = createInitialState();
    const exId = state.progress.currentExerciseId!;
    state = recordAttempt(state, {
      exerciseId: exId,
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
      chosenMoveSan: "h3",
      reasoning: "long enough reasoning",
      timeUsedSeconds: 1,
      evaluationStatus: "unverified",
      evalLossCp: null,
      engineVersion: null,
      engineSha256: null,
      evalVerified: false,
      observableReason: null,
      opponentReplySan: null,
      reflectionPrompt: null,
      attemptNumber: 1,
      foundOpponentForcedResponse: false,
      lessonVersion: "v1",
      evalCriterionVersion: "engine-validated-v2",
    });
    const again = selectNextExercise(state);
    expect(again.exercise.id).toBeTruthy();
    expect(state.progress.exercisesCompleted).not.toContain(exId);
  });
});
