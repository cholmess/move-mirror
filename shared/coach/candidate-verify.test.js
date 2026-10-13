import { describe, expect, it } from "vitest";
import { PRACTICE_EXAMPLE, WORKED_EXAMPLE } from "./teaching-public.js";
import { isPreverifiedCandidate, scoreCandidateLineAttempt } from "./candidate-verify.js";

describe("coach candidate verification without engine", () => {
  it("preverified teaching lines keep heuristic success without engine", () => {
    const scored = scoreCandidateLineAttempt({
      candidateUci: WORKED_EXAMPLE.playedMoveUci,
      spec: WORKED_EXAMPLE,
      heuristicSuccess: true,
      engineEvalStatus: null,
    });
    expect(scored.verificationStatus).toBe("preverified");
    expect(scored.success).toBe(true);
    expect(scored.countsForPracticeLearning).toBe(true);
  });

  it("off-script legal candidate stays unverified and does not update learning", () => {
    expect(isPreverifiedCandidate(WORKED_EXAMPLE, "a8b8")).toBe(false);
    const scored = scoreCandidateLineAttempt({
      candidateUci: "a8b8",
      spec: WORKED_EXAMPLE,
      heuristicSuccess: true,
      engineEvalStatus: "unverified",
    });
    expect(scored.verificationStatus).toBe("unverified");
    expect(scored.success).toBe(false);
    expect(scored.countsForPracticeLearning).toBe(false);
  });

  it("off-script candidate can succeed when engine verifies quality", () => {
    const scored = scoreCandidateLineAttempt({
      candidateUci: "a7a6",
      spec: PRACTICE_EXAMPLE,
      heuristicSuccess: true,
      engineEvalStatus: "verified_acceptable",
    });
    expect(scored.success).toBe(true);
    expect(scored.countsForPracticeLearning).toBe(true);
  });
});
