import { describe, expect, it } from "vitest";
import { createInitialState, recordAttempt } from "./persistence";
import { exercises } from "../data/exercises";
import type { AttemptRecord } from "../types/learning";
function attempt(assisted: boolean): Omit<AttemptRecord, "id" | "recordedAt"> {
  const ex = exercises[0];
  return { practiceMode: "direct", assisted, exerciseId: ex.id, patternId: ex.patternId, skillIds: ex.skillIds, fen: ex.fen,
    cct: { checksConsidered: "", capturesConsidered: "", threatsConsidered: "", firstCandidate: ex.solutionSan, opponentForcedResponse: "" },
    chosenMoveSan: ex.solutionSan, reasoning: "", timeUsedSeconds: 10, evaluationStatus: "verified_best", evalLossCp: 0, engineVersion: "fixture", engineSha256: null,
    evalVerified: true, observableReason: null, opponentReplySan: null, reflectionPrompt: null, attemptNumber: 1, foundOpponentForcedResponse: false,
    lessonVersion: "cct-refutation-v1", evalCriterionVersion: "engine-validated-v2" };
}
describe("direct practice evidence", () => {
  it("records practice without qualifying the historical structured intervention", () => {
    const before = createInitialState(); const after = recordAttempt(before, attempt(false));
    expect(after.attempts).toHaveLength(1);
    expect(after.pedagogyEvents).toEqual(before.pedagogyEvents);
    expect(after.interventionQualification).toEqual(before.interventionQualification);
    expect(after.progress.exercisesCompleted).toContain(exercises[0].id);
  });
  it("keeps assisted retries out of mastery and independent completion", () => {
    const before = createInitialState(); const after = recordAttempt(before, attempt(true));
    expect(after.skills).toEqual(before.skills);
    expect(after.progress.exercisesCompleted).toEqual(before.progress.exercisesCompleted);
    expect(after.attempts[0].assisted).toBe(true);
  });
  it("preserves the entire skill profile when the direct evaluation is unavailable", () => {
    const before=createInitialState();
    const after=recordAttempt(before,{...attempt(false),evaluationStatus:"unverified",evalVerified:false,evalError:"engine_unavailable"});
    expect(after.skills).toEqual(before.skills);
    expect(after.progress.exercisesCompleted).toEqual(before.progress.exercisesCompleted);
    expect(after.attempts[0].evalError).toBe("engine_unavailable");
  });

});
