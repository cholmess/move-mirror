import { describe, expect, it } from "vitest";
import { userDecisionPlies } from "./review.js";
import { chooseAgentMove } from "./policy.js";
import { sanitizeCreateSessionBody } from "./session-create.js";
describe("practice from positions", () => {
  it("reviews the correct player's moves when the initial position has black to move", () => {
    const s = { startingFen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", movesUci: ["e7e5", "g1f3"], userColor: "black" };
    expect(userDecisionPlies(s).map(p => p.uci)).toEqual(["e7e5"]);
    expect(userDecisionPlies({ ...s, userColor: "white" }).map(p => p.uci)).toEqual(["g1f3"]);
  });
  it("allows general practice without claiming a defensive weakness", () => {
    expect(sanitizeCreateSessionBody({ mode: "targeted_position", patternId: "general-practice" }).priorityPatternId).toBe("general-practice");
    const chosen = chooseAgentMove({ fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", agentColor: "black", userColor: "white", style: "balanced", profileSnapshot: { patternId: "general-practice" }, multiPvLines: [{ multipv: 1, firstMoveUci: "e7e5", score: { cp: 30, numeric: 30 }, pvUci: ["e7e5"] }], seed: "a", turnKey: "a" });
    expect(chosen.chosen.uci).toBe("e7e5");
  });
});
