import { describe, expect, it } from "vitest";
import { selectDefenseExercise } from "./adaptive.js";

const exercise = (id, gameId, resource, orientation = "white") => ({
  id,
  source: { gameId },
  motif: { resource },
  orientation,
  severity: "marked",
});

describe("defense-adaptive-v1", () => {
  it("does not repeat an exercise or source game in a session", () => {
    const exercises = [
      exercise("a", "g1", "countercheck"),
      exercise("b", "g1", "capture_attacker"),
      exercise("c", "g2", "prophylaxis", "black"),
    ];
    const attempts = [{
      exerciseId: "a",
      sourceGameId: "g1",
      motif: "countercheck",
      orientation: "white",
      evaluationStatus: "incorrect",
      confirmedAt: "2026-10-01T00:00:00.000Z",
    }];
    expect(selectDefenseExercise(exercises, attempts, ["a"]).exercise.id).toBe("c");
  });

  it("avoids a third consecutive motif and color", () => {
    const exercises = [
      exercise("a", "g1", "countercheck"),
      exercise("b", "g2", "countercheck"),
      exercise("c", "g3", "capture_attacker", "black"),
    ];
    const attempts = ["x", "y"].map((id) => ({
      exerciseId: id,
      sourceGameId: id,
      motif: "countercheck",
      orientation: "white",
      evaluationStatus: "incorrect",
      confirmedAt: "2026-10-01T00:00:00.000Z",
    }));
    expect(selectDefenseExercise(exercises, attempts).exercise.id).toBe("c");
  });

  it("never selects an archived exercise", () => {
    const archived = {
      ...exercise("archived", "g1", "countercheck"),
      lifecycle: "archived_not_selected",
    };
    const active = {
      ...exercise("active", "g2", "prophylaxis"),
      lifecycle: "active",
    };
    expect(selectDefenseExercise([archived, active], []).exercise.id).toBe("active");
  });
});
