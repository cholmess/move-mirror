import { describe, expect, it } from "vitest";
import {
  hypothesisEvidenceSummary,
  realGameEvidenceGate,
  reconcileRealGameHypotheses,
} from "./real-game-evidence.js";

function hypothesis(overrides = {}) {
  return {
    id: "h1",
    patternId: "piece-loss",
    category: "reply_search",
    alternatives: [{ category: "consequence_evaluation", statement: "La consecuencia pudo evaluarse mal." }],
    confidence: "low",
    status: "tentative",
    createdAt: "2026-10-20T08:00:00Z",
    updatedAt: "2026-10-20T08:00:00Z",
    observations: [
      { id: "reflection", source: "practice", direction: "support", at: "2026-10-20T08:00:00Z" },
      { id: "probe", source: "practice_probe", direction: "support", measurability: "direct", at: "2026-10-20T09:00:00Z" },
      { id: "holdout", source: "holdout", direction: "inconclusive", at: "2026-10-20T10:00:00Z" },
    ],
    ...overrides,
  };
}

function record(gameId, startedAt, overrides = {}) {
  return {
    gameId,
    exerciseId: `${gameId}-position`,
    patternId: "piece-loss",
    fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
    moveNumber: 12,
    gameStartedAt: startedAt,
    gameEndedAt: startedAt,
    datePrecision: "exact",
    replyUci: "d8d4",
    replySan: "Qxd4+",
    referencePv: ["g1f3", "b8c6", "f1b5"],
    loss: 240,
    engineVersion: "fixture",
    engineSha256: "hash",
    ...overrides,
  };
}

describe("real-game hypothesis evidence", () => {
  it("waits for a direct probe and a later blind holdout", () => {
    expect(realGameEvidenceGate(hypothesis()).eligible).toBe(true);
    expect(realGameEvidenceGate(hypothesis({ observations: [] }))).toMatchObject({ eligible: false, reason: "direct_probe_required" });
    expect(realGameEvidenceGate(hypothesis({ observations: hypothesis().observations.slice(0, 2) }))).toMatchObject({ eligible: false, reason: "blind_holdout_required" });
    expect(realGameEvidenceGate(hypothesis({ category: "strategic_planning" }))).toMatchObject({ eligible: false, reason: "cause_not_directly_observable" });
  });

  it("requires two distinct later games before supporting a cause", () => {
    const first = reconcileRealGameHypotheses([hypothesis()], [record("g1", "2026-10-21T10:00:00Z")], []);
    expect(first[0].status).toBe("tentative");
    expect(hypothesisEvidenceSummary(first[0]).realGameSupports).toBe(1);

    const second = reconcileRealGameHypotheses(first, [
      record("g1", "2026-10-21T10:00:00Z"),
      record("g2", "2026-10-22T10:00:00Z"),
    ], []);
    expect(second[0]).toMatchObject({ status: "supported", confidence: "medium" });
    expect(hypothesisEvidenceSummary(second[0])).toMatchObject({ directProbeSupports: 1, realGameSupports: 2 });
  });

  it("excludes prior, imprecisely dated, and exposed positions and remains idempotent", () => {
    const h = hypothesis();
    const rows = [
      record("before", "2026-10-20T09:30:00Z"),
      record("imprecise", "2026-10-21T10:00:00Z", { datePrecision: "day" }),
      record("exposed", "2026-10-21T11:00:00Z"),
      record("fresh", "2026-10-21T12:00:00Z"),
      record("fresh", "2026-10-21T12:00:00Z", { exerciseId: "fresh-second", loss: 500 }),
    ];
    const exposures = [{ positionKey: rows[2].fen.split(" ").slice(0, 4).join(" ") }];
    // Give the fresh rows a different position key from the exposed row.
    rows[3].fen = rows[4].fen = "rnbqkbnr/pppp1ppp/8/4p3/3PP3/8/PPP2PPP/RNBQKBNR b KQkq - 0 2";
    const once = reconcileRealGameHypotheses([h], rows, exposures);
    const twice = reconcileRealGameHypotheses(once, rows, exposures);
    expect(once[0].observations.filter((row) => row.source === "real_game")).toHaveLength(1);
    expect(twice[0].observations).toEqual(once[0].observations);
  });

  it("can contradict the primary cause when a named alternative has the exclusive signature", () => {
    const consequence = (id, at) => record(id, at, { replySan: "Qe7", replyUci: "d8e7", loss: 260, referencePv: ["g1f3"] });
    const updated = reconcileRealGameHypotheses([hypothesis()], [
      consequence("g1", "2026-10-21T10:00:00Z"),
      consequence("g2", "2026-10-22T10:00:00Z"),
    ], []);
    expect(updated[0]).toMatchObject({ status: "contradicted", confidence: "low" });
    expect(hypothesisEvidenceSummary(updated[0]).realGameContradictions).toBe(2);
  });

  it("withdraws support when its source games leave the valid corpus", () => {
    const supported = reconcileRealGameHypotheses([hypothesis()], [
      record("g1", "2026-10-21T10:00:00Z"),
      record("g2", "2026-10-22T10:00:00Z"),
    ], []);
    expect(supported[0].status).toBe("supported");
    const rebuilt = reconcileRealGameHypotheses(supported, [], []);
    expect(rebuilt[0].status).toBe("tentative");
    expect(hypothesisEvidenceSummary(rebuilt[0]).realGameSupports).toBe(0);
  });
});
