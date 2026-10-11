import { describe, expect, it } from "vitest";
import {
  addUniqueMove,
  categoryForMove,
  isCheckmateAfterMove,
  isTrainingReasoningV2,
  legacyCctFromReasoning,
  moveFromSquares,
  positionAfterMove,
} from "./trainingReasoning";
import type { TrainingReasoningV2 } from "../types/learning";

describe("training reasoning moves", () => {
  it.each([
    ["check", "4k3/8/8/8/8/8/4R3/4K3 w - - 0 1", "e2", "e7", "Re7+"],
    ["capture", "4k3/4p3/8/8/8/8/4R3/4K3 w - - 0 1", "e2", "e7", "Rxe7+"],
    ["castle", "4k3/8/8/8/8/8/8/4K2R w K - 0 1", "e1", "g1", "O-O"],
    ["promotion", "4k3/P7/8/8/8/8/8/4K3 w - - 0 1", "a7", "a8", "a8=Q+"],
  ])("generates SAN for %s", (_kind, fen, from, to, san) => {
    expect(moveFromSquares(fen, from, to)?.san).toBe(san);
  });

  it("detects mate and rejects illegal moves", () => {
    const fen = "7k/5K2/6Q1/8/8/8/8/8 w - - 0 1";
    const move = moveFromSquares(fen, "g6", "g7")!;
    expect(move.san).toContain("#");
    expect(isCheckmateAfterMove(fen, move)).toBe(true);
    expect(moveFromSquares(fen, "a1", "a8")).toBeNull();
  });

  it("classifies special moves and deduplicates within a category", () => {
    const fen = "4k3/8/8/8/8/8/4R3/4K3 w - - 0 1";
    const move = moveFromSquares(fen, "e2", "e7")!;
    expect(categoryForMove(fen, move)?.check).toBe(true);
    expect(addUniqueMove(addUniqueMove([], move), move)).toEqual([move]);
    expect(positionAfterMove(fen, move)).toContain("b - -");
  });

  it.each(["none_found", "not_applicable_checkmate"] as const)(
    "serializes predicted reply status %s",
    (status) => {
      const candidate = { uci: "e2e4", san: "e4" };
      const value: TrainingReasoningV2 = {
        version: "training-reasoning-v2",
        checks: { status: "none_seen", moves: [] },
        captures: { status: "none_seen", moves: [] },
        threats: { status: "none_seen", moves: [] },
        candidate,
        predictedReply: { status },
        keptCandidateAfterReply: true,
      };
      expect(isTrainingReasoningV2(JSON.parse(JSON.stringify(value)))).toBe(true);
      expect(legacyCctFromReasoning(value).opponentForcedResponse).toBe(status);
    },
  );

  it("records changing and then keeping the candidate without changing category answers", () => {
    const checks = { status: "none_seen" as const, moves: [] };
    const first = { uci: "e2e4", san: "e4" };
    const second = { uci: "d2d4", san: "d4" };
    const value: TrainingReasoningV2 = {
      version: "training-reasoning-v2",
      checks,
      captures: { status: "none_seen", moves: [] },
      threats: { status: "none_seen", moves: [] },
      candidate: second,
      predictedReply: { status: "none_found" },
      keptCandidateAfterReply: true,
    };
    expect(value.candidate).not.toEqual(first);
    expect(value.checks).toBe(checks);
    expect(isTrainingReasoningV2({ checksConsidered: "legacy text" })).toBe(false);
  });
});
