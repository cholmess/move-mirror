import { describe, expect, it } from "vitest";
import { getExercise } from "../data/exercises";
import { buildReferenceReplay, matchesReference } from "./referenceReplay";
import { Chess } from "chess.js";
const exercise = getExercise("ex-183971526340-m42")!;
describe("reference explanation for the reported position", () => {
  it("shows the check, queen block and queen capture as distinct board frames", () => {
    const replay = buildReferenceReplay(exercise);
    expect(replay.idea).toBe("checkWinQueen");
    expect(replay.frames.slice(1,4).map(f=>f.san)).toEqual(["Rb1+","Qf1","Rxf1+"]);
    expect(new Chess(replay.frames[2].fen).get("f1")?.type).toBe("q");
    expect(new Chess(replay.frames[3].fen).get("f1")?.type).toBe("r");
  });
  it("recognizes the user's reference move without claiming a fresh engine evaluation", () => {
    expect(matchesReference(exercise,"Rb1+")).toBe(true);
    expect(matchesReference(exercise,"d4")).toBe(false);
  });
});
