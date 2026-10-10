import { describe, it, expect } from "vitest";
import { isLegalMove } from "./evaluation";
import { coreExercises } from "../data/exercises";

describe("isLegalMove", () => {
  it("validates solution moves on core FENs", () => {
    for (const ex of coreExercises) {
      expect(isLegalMove(ex.fen, ex.solutionSan)).toBe(true);
    }
  });

  it("rejects illegal SAN", () => {
    const ex = coreExercises[0]!;
    expect(isLegalMove(ex.fen, "Ke8")).toBe(false);
  });
});
