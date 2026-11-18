import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsvLine, keepPuzzle, validatePuzzle, compactPuzzle, expandPuzzle } from "./puzzles.js";
import { cardFromPuzzle, cardsFromRow, presentCard, checkStep, describeLine } from "./cards.js";
import { gradeAnswer, newCardState, scheduleCard, isDue, DAY_MS } from "./srs.js";
import { buildDailySession } from "./session.js";
import { isoWeek, weeklyMetrics, streakDays } from "./metrics.js";
import { buildFacts, verifyExplanation } from "./explain.js";

const csv = fs.readFileSync(new URL("../../fixtures/puzzles/sample.csv", import.meta.url), "utf8").trim().split("\n");
const puzzles = csv.map(parseCsvLine).filter(Boolean);
const NOW = Date.parse("2026-11-18T10:00:00Z");

describe("lichess puzzle bank", () => {
  it("parses, filters by rating and validates every move", () => {
    expect(puzzles).toHaveLength(5);
    expect(puzzles.every(validatePuzzle)).toBe(true);
    expect(puzzles.filter(p => keepPuzzle(p, { minPlays: 0 })).map(p => p.id)).toEqual(["mmfx01", "mmfx02", "mmfx03", "mmfx04"]);
    expect(validatePuzzle({ ...puzzles[0], moves: ["a7a6", "d1d9"] })).toBe(false);
    expect(expandPuzzle(compactPuzzle(puzzles[3]))).toEqual({ id: "mmfx04", fen: puzzles[3].fen, moves: puzzles[3].moves, rating: 1100, themes: puzzles[3].themes });
  });
});

describe("drill cards", () => {
  it("frames a refutation: candidate already played, solver moves the punishing side", () => {
    const card = { ...cardFromPuzzle(puzzles[1]), kind: "refutation", candidateUci: "d1h5", solution: ["f6h5"] };
    const view = presentCard(card);
    expect(view.candidateSan).toBe("Qh5");
    expect(view.solverColor).toBe("black");
    expect(view.orientation).toBe("white");
    expect(checkStep(view.fen, card.solution, 0, "f6h5")).toMatchObject({ ok: true, exact: true });
    expect(checkStep(view.fen, card.solution, 0, "b8c6")).toMatchObject({ ok: false });
  });
  it("accepts any mating move as correct", () => {
    const fen = "6k1/p4ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1";
    expect(checkStep(fen, ["d1d8"], 0, "d1d8")).toMatchObject({ ok: true });
    expect(checkStep(fen, ["d1e1"], 0, "d1d8")).toMatchObject({ ok: true, mate: true });
  });
  it("builds refutation and find-move cards from an analysed own mistake", () => {
    const row = { patternId: "piece-loss", gameId: "g1", moveNumber: 3, exerciseId: "x",
      fen: "rnbqkb1r/pppp1ppp/5n2/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 2 3", moveUci: "d1h5", replyUci: "f6h5", referenceUci: "g1f3" };
    const cards = cardsFromRow(row);
    expect(cards.map(c => c.kind)).toEqual(["refutation", "find-move"]);
    expect(cards[0].solution).toEqual(["f6h5"]);
    expect(cardsFromRow({ ...row, patternId: null })).toEqual([]);
    // A quiet reply is not a refutation drill.
    expect(cardsFromRow({ ...row, moveUci: "g1f3", replyUci: "b8c6", referenceUci: "f1c4" }).map(c => c.kind)).toEqual(["find-move"]);
  });
  it("describes material swing of a line from the mover's view", () => {
    expect(describeLine("6k1/5ppp/8/8/3n4/8/5PP1/2R3K1 b - - 0 1", ["d4e2", "g1f1", "e2c1"])).toMatchObject({ san: ["Ne2+", "Kf1", "Nxc1"], materialSwing: 5 });
  });
});

describe("spaced repetition", () => {
  it("grades from behaviour and schedules intervals", () => {
    expect(gradeAnswer({ correct: false })).toBe("again");
    expect(gradeAnswer({ correct: true, revealed: true })).toBe("again");
    expect(gradeAnswer({ correct: true, elapsedMs: 40000, limitMs: 30000 })).toBe("hard");
    expect(gradeAnswer({ correct: true, elapsedMs: 5000, limitMs: 30000 })).toBe("easy");
    let s = newCardState(NOW);
    s = scheduleCard(s, "good", NOW); expect(s.intervalDays).toBe(1);
    s = scheduleCard(s, "good", NOW); expect(s.intervalDays).toBe(3);
    s = scheduleCard(s, "good", NOW); expect(s.intervalDays).toBe(Math.round(3 * 2.3));
    const lapsed = scheduleCard(s, "again", NOW);
    expect(lapsed).toMatchObject({ intervalDays: 0, lapses: 1 });
    expect(isDue(lapsed, NOW)).toBe(false);
    expect(isDue(lapsed, NOW + DAY_MS)).toBe(true);
  });
});

describe("daily session", () => {
  it("puts due own reviews first, caps new items, prefers recurrent patterns", () => {
    const due = (id, source) => ({ id, source, kind: "refutation", patternId: "piece-loss", state: { ...newCardState(NOW - DAY_MS) } });
    const fresh = (id, patternId, kind = "refutation") => ({ id, source: "own", kind, patternId });
    const puzzle = (id, patternId, rating) => ({ id, source: "puzzle", kind: "refutation", patternId, rating });
    const result = buildDailySession({
      cards: [due("p-due", "puzzle"), due("o-due", "own"), fresh("o1", "piece-loss"), fresh("o2", "closed-center"), fresh("o3", "piece-loss", "find-move")],
      puzzles: [puzzle("z1", "missed-mate", 2400), puzzle("z2", "piece-loss", 1250), puzzle("z3", "piece-loss", 1300)],
      patternWeights: { "piece-loss": 50, "closed-center": 1 }, rating: 1300, now: NOW, seed: "t",
      options: { size: 6, maxNewOwn: 2, maxNewPuzzles: 2 },
    });
    expect(result.cardIds).toHaveLength(6);
    expect(result.cardIds.slice(0, 2)).toEqual(["o-due", "p-due"]);
    expect(result.cardIds).toContain("o1");
    expect(result.cardIds).not.toContain("o2");
    expect(result.cardIds).not.toContain("z1");
  });
});

describe("weekly metrics", () => {
  it("computes ISO weeks and per-100 rates by control", () => {
    expect(isoWeek("2026-01-01T12:00:00Z")).toBe("2026-W01");
    expect(isoWeek("2026-11-18T12:00:00Z")).toBe("2026-W47");
    expect(isoWeek("2027-01-01T12:00:00Z")).toBe("2026-W53");
    const games = [{ id: "a", startedAt: "2026-11-16T10:00:00Z", rating: 1240, control: "10+0" }, { id: "b", startedAt: "2026-11-17T10:00:00Z", rating: 1255, control: "15+10" }];
    const rows = [...Array(50)].map((_, i) => ({ gameId: i < 25 ? "a" : "b", patternId: i === 0 || i === 30 ? "piece-loss" : i === 1 ? "forcing-reply" : null }));
    const log = [{ kind: "answer", at: "2026-11-17T08:00:00Z", correct: true, elapsedMs: 20000 }, { kind: "answer", at: "2026-11-18T08:00:00Z", correct: false, elapsedMs: 40000 }];
    const [week] = weeklyMetrics({ rows, games, log, reports: [{ at: "2026-11-17T09:00:00Z", cause: "not_seen" }] });
    expect(week).toMatchObject({ week: "2026-W47", games: 2, decisions: 50, pieceLossPer100: 4, errorsPer100: 6, ratingEnd: 1255, accuracy: 50, trainingDays: 2, reports: { not_seen: 1 } });
    expect(week.byControl["10+0"]).toMatchObject({ games: 1, pieceLossPer100: 4 });
    expect(streakDays(log, NOW)).toBe(2);
  });
});

describe("grounded explanations", () => {
  it("derives facts from the board and rejects invented moves", () => {
    const facts = buildFacts({ fen: "rnbqkb1r/pppp1ppp/5n2/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 2 3", candidateUci: "d1h5", punishUci: ["f6h5"], bestUci: ["g1f3", "b8c6"] });
    expect(facts).toMatchObject({ side: "white", candidateSan: "Qh5", punish: { firstSan: "Nxh5", firstCaptures: "queen", materialSwing: 9 }, best: { firstSan: "Nf3" } });
    expect(verifyExplanation("Qh5 leaves the queen on h5 where Nxh5 simply takes it. Nf3 develops instead.", facts).ok).toBe(true);
    expect(verifyExplanation("After Qh5 Black should play Bc5 and then Nxh5.", facts)).toMatchObject({ ok: false, unknown: ["Bc5"] });
  });
});
