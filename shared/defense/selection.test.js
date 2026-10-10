import { describe, expect, it } from "vitest";
import {
  DEFENSE_MINIMUM_QUALITY_SCORE,
  DEFENSE_SELECTION_VERSION,
  deterministicHash,
  selectDefenseExercises,
} from "./selection.js";
import { stableDefenseExerciseId } from "./domain.js";

function exercise(
  id,
  {
    gameId = id,
    color = "white",
    phase = "middlegame",
    resource = "move_attacked_piece",
    opening = "C20",
    threatConfidence = "high",
    motifConfidence = "medium",
    severity = "marked",
    lineLength = 6,
    cacheHit = false,
    lifecycle = "active",
  } = {},
) {
  return {
    id,
    lifecycle,
    source: {
      gameId,
      sourceSet: "phase2_reproducible",
      opening: { eco: opening },
    },
    orientation: color,
    phase,
    motif: { resource, confidence: motifConfidence },
    opponentThreat: { confidence: threatConfidence },
    severity,
    actualPunishmentLineSan: ["a3", "Qxa3"],
    defenseReferenceLineSan: Array.from({ length: lineLength }, (_, index) => `m${index}`),
    evaluation: {
      budgetId: "nodes-500k-v1",
      before: { cp: 0 },
      afterActual: { cp: -200 },
      cacheHit,
    },
  };
}

function signature(result) {
  return result.ranking.map((entry) => ({
    candidateId: entry.candidateId,
    rank: entry.rank,
    finalScore: entry.finalScore,
    selected: entry.selected,
    reason: entry.selectionReason,
  }));
}

describe("defense-selection-v1", () => {
  const candidates = Array.from({ length: 32 }, (_, index) =>
    exercise(`candidate-${String(index).padStart(2, "0")}`, {
      color: index % 2 ? "black" : "white",
      phase: ["opening", "middlegame", "endgame"][index % 3],
      resource: ["countercheck", "move_attacked_piece", "prophylaxis"][index % 3],
      opening: `C${index % 8}`,
      severity: index % 4 === 0 ? "critical" : "marked",
    }),
  );

  it("applies the quota only after scoring the full eligible universe", () => {
    const result = selectDefenseExercises(candidates);
    expect(result.version).toBe(DEFENSE_SELECTION_VERSION);
    expect(result.ranking).toHaveLength(32);
    expect(result.selected).toHaveLength(24);
    expect(result.eligibleNotSelected).toHaveLength(8);
    expect(result.ranking[24].selectionReason).toContain("cuota de 24");
  });

  it("is invariant to reverse and deterministic shuffle order", () => {
    const shuffled = [...candidates].sort((a, b) =>
      deterministicHash(a.id).localeCompare(deterministicHash(b.id)),
    );
    const original = signature(selectDefenseExercises(candidates));
    expect(signature(selectDefenseExercises([...candidates].reverse()))).toEqual(original);
    expect(signature(selectDefenseExercises(shuffled))).toEqual(original);
  });

  it("uses candidateId ascending as the final tie-break", () => {
    const tied = [exercise("z"), exercise("a"), exercise("m")];
    expect(selectDefenseExercises(tied, { limit: 3 }).selected.map((item) => item.id))
      .toEqual(["a", "m", "z"]);
  });

  it("keeps diversity subordinate to quality and enforces the quality floor", () => {
    const high = exercise("high", { severity: "critical" });
    const lowerButDiverse = exercise("diverse", {
      color: "black",
      phase: "endgame",
      resource: "prophylaxis",
      opening: "A00",
      threatConfidence: "medium",
      motifConfidence: "low",
      severity: "notable",
      lineLength: 15,
    });
    const belowFloor = exercise("below", {
      threatConfidence: "low",
      motifConfidence: "low",
      severity: "notable",
      lineLength: 15,
    });
    belowFloor.actualPunishmentLineSan = [];
    belowFloor.evaluation = {
      budgetId: "nodes-80k-v1",
      before: null,
      afterActual: null,
    };
    const result = selectDefenseExercises([lowerButDiverse, belowFloor, high], { limit: 1 });
    expect(result.selected[0].id).toBe("high");
    expect(result.rejectedLowQuality.map((item) => item.id)).toContain("below");
    expect(DEFENSE_MINIMUM_QUALITY_SCORE).toBe(55);
  });

  it("is insensitive to cache-hit metadata", () => {
    const fresh = candidates.map((item) => ({ ...item, evaluation: { ...item.evaluation, cacheHit: false } }));
    const cached = candidates.map((item) => ({ ...item, evaluation: { ...item.evaluation, cacheHit: true } }));
    expect(signature(selectDefenseExercises(cached))).toEqual(signature(selectDefenseExercises(fresh)));
  });

  it("enforces one position per source game", () => {
    const result = selectDefenseExercises([
      exercise("a", { gameId: "same" }),
      exercise("b", { gameId: "same" }),
      exercise("c", { gameId: "other" }),
    ]);
    expect(result.selected.map((item) => item.source.gameId)).toEqual(["same", "other"]);
    expect(result.duplicateGame).toHaveLength(1);
  });

  it("produces stable hashes that exclude generatedAt when the caller omits it", () => {
    const content = { selected: signature(selectDefenseExercises(candidates)) };
    const first = { generatedAt: "2026-01-01", ...content };
    const second = { generatedAt: "2030-01-01", ...content };
    const hashWithoutGeneratedAt = ({ generatedAt: _generatedAt, ...value }) =>
      deterministicHash(value);
    expect(hashWithoutGeneratedAt(first)).toBe(hashWithoutGeneratedAt(second));
  });

  it("keeps exercise ids stable across ranking changes", () => {
    expect(stableDefenseExerciseId("game-1", 17, "defense-opportunity-v1"))
      .toBe("def-game-1-17");
  });
});
