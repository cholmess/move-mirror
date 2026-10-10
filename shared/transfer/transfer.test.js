import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DETECTOR, FINGERPRINT } from "./constants.js";
import { detectEvent, needsDeepConfirmation, phaseProxy } from "./detector.js";
import {
  baselineManifestFromRows,
  decisionsFromPgn,
  isAfterCutoff,
  parseGamesCsv,
  selectTransferGames,
} from "./selection.js";
import { bootstrapDifference, classifyComparison, compareMetrics, measureDecisions } from "./measure.js";
import {
  combineChannels,
  decidePedagogy,
  examplesForCohort,
  freezeCohort,
  promoteExerciseCandidate,
  remeasureFrozen,
  summarizeTraining,
} from "./pedagogy.js";
import { analyzePending, runTransferScenario, scriptedAnalyzeOne } from "./pipeline.js";

const LONG_PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[White "cholmess21"]
[Black "opp"]
[Result "1-0"]
[ECO "C60"]
[Opening "Ruy Lopez"]
[TimeControl "600"]
[WhiteElo "1230"]
[BlackElo "1240"]
[Termination "opp won on time"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 11. Nbd2 Bb7 1-0`;

const SHORT_PGN = `[Result "1-0"]
[White "cholmess21"]
[Black "opp"]
[TimeControl "600"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 1-0`;

const EARLY_PGN = `[Result "0-1"]
[White "cholmess21"]
[Black "opp"]
[TimeControl "600"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 0-1`;

const baseline = {
  cohortId: "baseline-fase2-200",
  gameIds: ["baseline-1"],
  urls: ["https://www.chess.com/game/live/1"],
  cutoff: { endTime: 1000, gameId: "m", endUtc: "2026-01-01T00:00:00.000Z" },
};

function raw(overrides = {}) {
  return {
    uuid: "g-new",
    url: "https://www.chess.com/game/live/999",
    time_control: "600",
    time_class: "rapid",
    rules: "chess",
    end_time: 5000,
    rated: true,
    white: { username: "cholmess21", rating: 1230, result: "win" },
    black: { username: "opp", rating: 1240, result: "timeout" },
    pgn: LONG_PGN,
    ...overrides,
  };
}

function reasons(result) {
  return result.excluded.map((row) => row.reason);
}

describe("transfer selection", () => {
  it("accepts only time_control 600 and standard rapid chess after the cutoff", () => {
    const result = selectTransferGames({
      rawGames: [
        raw(),
        raw({ uuid: "blitz", url: "https://www.chess.com/game/live/2", time_control: "180" }),
        raw({ uuid: "plus", url: "https://www.chess.com/game/live/3", time_control: "600+0" }),
        raw({ uuid: "num", url: "https://www.chess.com/game/live/4", time_control: 600 }),
        raw({ uuid: "960", url: "https://www.chess.com/game/live/5", rules: "chess960" }),
        raw({ uuid: "bullet", url: "https://www.chess.com/game/live/6", time_class: "bullet" }),
        raw({ uuid: "daily", url: "https://www.chess.com/game/live/7", time_class: "daily" }),
      ],
      baseline,
      cohortId: "transfer-test",
      syncedAt: "2026-10-10T00:00:00.000Z",
    });
    expect(result.included.map((game) => game.gameId)).toEqual(["g-new"]);
    expect(reasons(result)).toEqual(
      expect.arrayContaining([
        "time_control_not_600",
        "not_standard_chess",
        "not_rapid",
      ])
    );
    expect(result.included[0].timeControl).toBe("600");
    expect(result.included[0].weaknessInference).toBeNull();
    expect(result.included[0].pgn).toContain("1. e4");
    expect(result.included[0].opening.eco).toBe("C60");
    expect(result.included[0].ratings.own).toBe(1230);
    expect(result.included[0].ownDecisions).toBe(11);
  });

  it("deduplicates by game id and url and skips games already stored", () => {
    const first = selectTransferGames({
      rawGames: [
        raw(),
        raw(),
        raw({ uuid: "other", url: "https://www.chess.com/game/live/999" }),
      ],
      baseline,
      cohortId: "transfer-test",
      syncedAt: "2026-10-10T00:00:00.000Z",
    });
    expect(first.included).toHaveLength(1);
    expect(reasons(first)).toEqual(expect.arrayContaining(["duplicate_game_id", "duplicate_url"]));

    const second = selectTransferGames({
      rawGames: [raw(), raw(), raw({ uuid: "other", url: "https://www.chess.com/game/live/999" })],
      baseline,
      cohortId: "transfer-test",
      syncedAt: "2026-10-10T01:00:00.000Z",
      knownIds: first.knownIds,
      knownUrls: first.knownUrls,
      recordedExclusions: first.recordedExclusions,
    });
    expect(second.included).toHaveLength(0);
    expect(second.excluded).toHaveLength(0);
  });

  it("keeps the baseline cutoff from the pair (end_time, game_id) and rejects baseline ids", () => {
    expect(isAfterCutoff(1000, "a", baseline.cutoff)).toBe(false);
    expect(isAfterCutoff(1000, "z", baseline.cutoff)).toBe(true);
    expect(isAfterCutoff(1001, "a", baseline.cutoff)).toBe(true);
    const result = selectTransferGames({
      rawGames: [
        raw({ uuid: "a", url: "https://www.chess.com/game/live/10", end_time: 1000 }),
        raw({ uuid: "z", url: "https://www.chess.com/game/live/11", end_time: 1000 }),
        raw({ uuid: "baseline-1", url: "https://www.chess.com/game/live/12", end_time: 9000 }),
      ],
      baseline,
      cohortId: "transfer-test",
      syncedAt: "2026-10-10T00:00:00.000Z",
    });
    expect(result.included.map((game) => game.gameId)).toEqual(["z"]);
    expect(reasons(result)).toEqual(
      expect.arrayContaining(["not_after_baseline_cutoff", "already_in_baseline"])
    );
  });

  it("excludes 0–8 plies and early resign or abandon, and keeps a short timeout", () => {
    const result = selectTransferGames({
      rawGames: [
        raw({ uuid: "short", url: "https://www.chess.com/game/live/20", pgn: SHORT_PGN }),
        raw({
          uuid: "resign",
          url: "https://www.chess.com/game/live/21",
          pgn: EARLY_PGN,
          white: { username: "cholmess21", rating: 1200, result: "resigned" },
          black: { username: "opp", rating: 1200, result: "win" },
        }),
        raw({
          uuid: "abandon",
          url: "https://www.chess.com/game/live/22",
          pgn: EARLY_PGN,
          white: { username: "cholmess21", rating: 1200, result: "win" },
          black: { username: "opp", rating: 1200, result: "abandoned" },
        }),
        raw({
          uuid: "timeout",
          url: "https://www.chess.com/game/live/23",
          pgn: EARLY_PGN,
          white: { username: "cholmess21", rating: 1200, result: "timeout" },
          black: { username: "opp", rating: 1200, result: "win" },
        }),
        raw({ uuid: "bad", url: "https://www.chess.com/game/live/24", pgn: "1. e4 e5 2. e4" }),
      ],
      baseline,
      cohortId: "transfer-test",
      syncedAt: "2026-10-10T00:00:00.000Z",
    });
    expect(result.included.map((game) => game.gameId)).toEqual(["timeout"]);
    expect(result.included[0].weaknessInference).toBeNull();
    expect(result.included[0].termination.white).toBe("timeout");
    expect(reasons(result)).toEqual(
      expect.arrayContaining(["too_few_plies", "early_resign_or_abandon", "unparseable_pgn"])
    );
    const early = result.excluded.find((row) => row.reason === "early_resign_or_abandon");
    expect(early.detail).toMatch(/debilidad/i);
    expect(early.weaknessInference).toBeNull();
  });
});

describe("detector allowed-forcing-reply-transfer-v1", () => {
  it("flags capture, check and mate, and separates piece captures", () => {
    const mate = detectEvent({
      cpLoss: 800,
      fenBefore: "rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2",
      playedUci: "g2g4",
      replyUci: "d8h4",
      cohortId: "transfer-test",
    });
    expect(mate.event).toBe(true);
    expect(mate.reply.kind).toBe("mate");
    expect(mate.pieceCaptureSubgroup).toBe(false);

    const check = detectEvent({
      cpLoss: 200,
      fenBefore: "4k2r/8/8/8/8/8/8/4K3 w - - 0 1",
      playedUci: "e1d1",
      replyUci: "h8h1",
      cohortId: "transfer-test",
    });
    expect(check.event).toBe(true);
    expect(check.reply.isCheck).toBe(true);
    expect(check.reply.isMate).toBe(false);
    expect(check.pieceCaptureSubgroup).toBe(false);

    const piece = detectEvent({
      cpLoss: 220,
      fenBefore: "rnbqkb1r/pppp1ppp/8/4p3/4n2Q/8/PPPP1PPP/RNB1KBNR b KQkq - 0 4",
      playedUci: "a7a6",
      replyUci: "h4e4",
      cohortId: "transfer-test",
    });
    expect(piece.event).toBe(true);
    expect(piece.reply.isCapture).toBe(true);
    expect(piece.pieceCaptureSubgroup).toBe(true);
    expect(piece.reply.capturedValue).toBeGreaterThanOrEqual(3);

    const pawn = detectEvent({
      cpLoss: 180,
      fenBefore: "rnbqkbnr/ppp2ppp/8/3pp3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3",
      playedUci: "a2a3",
      replyUci: "d5e4",
      cohortId: "transfer-test",
    });
    expect(pawn.event).toBe(true);
    expect(pawn.pieceCaptureSubgroup).toBe(false);

    const quiet = detectEvent({
      cpLoss: 400,
      fenBefore: "rnbqkbnr/ppp2ppp/8/3pp3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3",
      playedUci: "a2a3",
      replyUci: "b8c6",
      cohortId: "transfer-test",
    });
    expect(quiet.event).toBe(false);

    const small = detectEvent({
      cpLoss: 40,
      fenBefore: "rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2",
      playedUci: "g2g4",
      replyUci: "d8h4",
      cohortId: "transfer-test",
    });
    expect(small.event).toBe(false);
  });

  it("does not fit the detector on the cohort it evaluates", () => {
    expect(() =>
      detectEvent({
        cpLoss: 200,
        fenBefore: "4k2r/8/8/8/8/8/8/4K3 w - - 0 1",
        playedUci: "e1d1",
        replyUci: "h8h1",
        detector: { ...DETECTOR, fitCohortId: "transfer-test" },
        cohortId: "transfer-test",
      })
    ).toThrow(/cohort_used_to_fit_itself/);
    expect(() =>
      measureDecisions([{ analysisComplete: true, event: true, gameId: "g", phaseProxy: "opening_proxy", color: "white", severity: "notable", pieceCaptureSubgroup: false }], {
        cohortId: "transfer-test",
        detector: { ...DETECTOR, lossThreshold: 80, fitCohortId: null },
      })
    ).toThrow(/detector_mutated/);
    expect(DETECTOR.fitCohortId).toBeNull();
    expect(DETECTOR.lossThreshold).toBe(120);
  });

  it("confirms borderline alerts with the same policy for every cohort", () => {
    expect(needsDeepConfirmation({ cpLoss: 50, best: rich(), played: rich(), playedUci: "d2d4" }).confirm).toBe(false);
    expect(needsDeepConfirmation({ cpLoss: 120, best: rich(), played: rich(), playedUci: "d2d4" }).reason).toBe(
      "near_threshold_120"
    );
    expect(needsDeepConfirmation({ cpLoss: 400, best: rich(), played: rich(), playedUci: "d2d4" }).confirm).toBe(false);
    const fingerprint = FINGERPRINT;
    expect(fingerprint.includes("baseline")).toBe(false);
    expect(fingerprint.includes("transfer-analysis-v1")).toBe(true);
    expect(fingerprint).toBe(FINGERPRINT);
  });
});

function rich() {
  return {
    score: { cp: 10, mate: null, numeric: 10 },
    pvUci: ["e2e4", "e7e5"],
    firstMoveUci: "e2e4",
    nodes: 80_000,
  };
}

describe("transfer metrics", () => {
  it("uses own decisions as the denominator and keeps phase, color and severity", () => {
    const rows = [
      row("a", true, "white", "opening_proxy", "notable", false),
      row("a", true, "white", "opening_proxy", "grave", true),
      row("a", false, "white", "middlegame_proxy", null, false),
      row("b", false, "black", "endgame_proxy", null, false),
      row("c", true, "black", "middlegame_proxy", "marcada", false),
    ];
    const metrics = measureDecisions(rows, { cohortId: "transfer-test" });
    expect(metrics.decisions).toBe(5);
    expect(metrics.events).toBe(3);
    expect(metrics.eventsPer100).toBe(60);
    expect(metrics.gamesAnalyzed).toBe(3);
    expect(metrics.gamesAffected).toBe(2);
    expect(metrics.pieceCaptureEvents).toBe(1);
    expect(metrics.byColor.white.decisions).toBe(3);
    expect(metrics.byColor.black.events).toBe(1);
    expect(metrics.byPhase.opening_proxy.events).toBe(2);
    expect(metrics.severity).toEqual({ notable: 1, marcada: 1, grave: 1 });
    expect(metrics.analysisFingerprint).toBe(FINGERPRINT);
  });

  it("bootstraps at game level and is deterministic", () => {
    const baselineGames = [
      { id: "a", events: 10, decisions: 10 },
      { id: "b", events: 0, decisions: 10 },
    ];
    const transferGames = [{ id: "c", events: 1, decisions: 10 }];
    const once = bootstrapDifference(baselineGames, transferGames, { iterations: 300 });
    const twice = bootstrapDifference(baselineGames, transferGames, { iterations: 300 });
    expect(twice).toEqual(once);
    expect(once.unit).toBe("game");
    expect(once.absolute.high).toBeGreaterThan(once.absolute.low);

    const fixed = bootstrapDifference(
      [{ id: "a", events: 5, decisions: 10 }],
      [{ id: "b", events: 1, decisions: 10 }],
      { iterations: 50 }
    );
    expect(fixed.absolute.low).toBeCloseTo(-40);
    expect(fixed.absolute.high).toBeCloseTo(-40);
  });

  it("guards sample size before saying an improvement was observed", () => {
    expect(classifyComparison(fakeComparison({ games: 9, decisions: 1000, upper: -1 })).label).toBe(
      "Datos insuficientes"
    );
    expect(classifyComparison(fakeComparison({ games: 12, decisions: 299, upper: -1 })).label).toBe(
      "Datos insuficientes"
    );
    expect(classifyComparison(fakeComparison({ games: 12, decisions: 400, upper: -1 })).label).toBe(
      "Señal temprana"
    );
    expect(classifyComparison(fakeComparison({ games: 40, decisions: 1200, upper: -0.2 })).label).toBe(
      "Mejora observada"
    );
    expect(classifyComparison(fakeComparison({ games: 40, decisions: 1200, upper: 0.4 })).label).toBe(
      "Sin reducción clara"
    );
    expect(classifyComparison(fakeComparison({ games: 40, decisions: 1200, upper: -1, provisional: true })).status).not.toBe(
      "observed_improvement"
    );
  });

  it("compares baseline and transfer only when the fingerprint matches", () => {
    const base = clusters("baseline-fase2-200", 40, 40, 8);
    const next = clusters("transfer-a", 40, 40, 2);
    const comparison = compareMetrics(base, next);
    expect(comparison.absoluteDifference).toBeCloseTo(-15);
    expect(comparison.relativeDifference).toBeCloseTo(-0.75);
    expect(comparison.status).toBe("observed_improvement");
    expect(comparison.notMeaning).toMatch(/causado/);
    expect(comparison.baseline.analysisFingerprint).toBe(comparison.transfer.analysisFingerprint);
    expect(() => compareMetrics(base, { ...next, analysisFingerprint: "other" })).toThrow(/mixed_analysis_config/);
  });
});

describe("channels, pedagogy and freeze", () => {
  it("keeps exercise alpha/beta apart from real-game evidence", () => {
    const skills = { alpha: 3, beta: 2 };
    const before = JSON.stringify(skills);
    const comparison = compareMetrics(clusters("baseline-fase2-200", 40, 40, 8), clusters("transfer-a", 40, 40, 2));
    const combined = combineChannels({
      exerciseSkills: skills,
      training: { verified_best: 4, verified_acceptable: 1, incorrect: 0, attempts: 5, mastery: 0.8 },
      comparison,
      syncedAt: "2026-10-10T00:00:00.000Z",
    });
    expect(JSON.stringify(skills)).toBe(before);
    expect(combined.transferWritesAlpha).toBe(false);
    expect(combined.transfer.writesExerciseAlphaBeta).toBe(false);
    expect(combined.pedagogy.updatesExerciseAlphaBeta).toBe(false);
    expect(combined.narrative.join(" ")).toMatch(/disminuye también en partidas nuevas/);
  });

  it("chooses a versioned teaching action and does not teach a new pattern", () => {
    const strong = { verified_best: 4, verified_acceptable: 1, incorrect: 0, attempts: 5, mastery: 0.82, nextReviewAt: "2026-10-12T00:00:00.000Z" };
    const weak = { verified_best: 0, verified_acceptable: 0, incorrect: 4, attempts: 4, mastery: 0.3 };
    const observed = compareMetrics(clusters("baseline-fase2-200", 40, 40, 8), clusters("transfer-a", 40, 40, 2));
    const flat = compareMetrics(clusters("baseline-fase2-200", 40, 40, 4), clusters("transfer-b", 40, 40, 8));
    const small = classifyComparison(fakeComparison({ games: 4, decisions: 40, upper: -1 }));

    expect(decidePedagogy({ training: weak, comparison: observed }).action).toBe("return_to_basics");
    expect(decidePedagogy({ training: strong, comparison: observed }).action).toBe("space_practice");
    expect(decidePedagogy({ training: strong, comparison: observed, previousAction: "space_practice" }).action).toBe(
      "propose_next_pattern"
    );
    expect(decidePedagogy({ training: strong, comparison: flat }).action).toBe("increase_difficulty");
    const keep = decidePedagogy({
      training: { verified_best: 3, incorrect: 0, attempts: 3, mastery: 0.6 },
      comparison: { ...observed, ...small, transfer: observed.transfer },
    });
    expect(keep.action).toBe("continue_cct");
    expect(keep.policyId).toBe("pedagogy-adapt-v1");
    expect(keep.teachNewPattern).toBe(false);
    expect(decidePedagogy({ training: strong, comparison: observed }).explanation).toMatch(/no una mejora causada/);
    expect(summarizeTraining(strong).nextReviewAt).toBe("2026-10-12T00:00:00.000Z");
  });

  it("freezes a cohort before exercise candidates and then refuses to remeasure it", () => {
    const metrics = measureDecisions([row("a", true, "white", "opening_proxy", "notable", false)], {
      cohortId: "transfer-test",
    });
    const open = { id: "transfer-test", frozen: false, pendingDecisions: 0 };
    const frozen = freezeCohort(open, metrics, "2026-10-10T00:00:00.000Z");
    const snapshot = JSON.stringify(frozen.metrics);
    expect(() => examplesForCohort(open, [])).toThrow(/examples_locked/);
    const examples = examplesForCohort(frozen, [row("a", true, "white", "opening_proxy", "notable", true)]);
    expect(examples).toHaveLength(1);
    const candidate = promoteExerciseCandidate({
      cohort: frozen,
      decision: {
        ...row("a", true, "white", "opening_proxy", "notable", true),
        loss: 220,
        fenBefore: "8/8/8/8/8/8/8/8 w - - 0 1",
        moveUci: "a2a3",
        reply: { forcing: true },
        key: "a:1",
      },
      existing: [],
    });
    expect(candidate.excludedFromCohortRemeasurement).toBe(true);
    expect(candidate.autoAddedToTrainer).toBe(false);
    expect(JSON.stringify(frozen.metrics)).toBe(snapshot);
    expect(() => promoteExerciseCandidate({ cohort: open, decision: { event: true, loss: 200, reply: { forcing: true } } })).toThrow(
      /cohort_not_frozen/
    );
    expect(() => remeasureFrozen()).toThrow(/cohort_frozen/);
    expect(() => freezeCohort(frozen, metrics, "later")).toThrow(/cohort_frozen/);
  });
});

describe("end to end transfer loop", () => {
  it("syncs, filters, analyzes, measures, updates the profile and recommends", async () => {
    const training = { verified_best: 1, incorrect: 0, attempts: 1, mastery: 0.55 };
    const analyzeOne = scriptedAnalyzeOne();
    const first = await runTransferScenario({
      rawGames: [
        raw(),
        raw({ uuid: "blitz", url: "https://www.chess.com/game/live/50", time_control: "180" }),
        raw({ uuid: "short", url: "https://www.chess.com/game/live/51", pgn: SHORT_PGN }),
      ],
      baseline,
      baselineDecisions: syntheticBaseline(),
      analyzeOne,
      training,
      cohortId: "transfer-e2e",
    });
    expect(first.selected.included).toHaveLength(1);
    expect(first.selected.excluded.map((row) => row.reason)).toEqual(
      expect.arrayContaining(["time_control_not_600", "too_few_plies"])
    );
    expect(first.transferMetrics.decisions).toBe(11);
    expect(first.transferMetrics.analysisFingerprint).toBe(first.baselineMetrics.analysisFingerprint);
    expect(first.comparison.label).toBe("Datos insuficientes");
    expect(first.channel.writesExerciseAlphaBeta).toBe(false);
    expect(first.pedagogy.action).toBe("continue_cct");
    expect(first.pedagogy.updatesExerciseAlphaBeta).toBe(false);

    const second = await runTransferScenario({
      rawGames: [raw(), raw({ uuid: "blitz", url: "https://www.chess.com/game/live/50", time_control: "180" })],
      baseline,
      baselineDecisions: syntheticBaseline(),
      analyzeOne,
      training,
      cohortId: "transfer-e2e",
      knownIds: first.selected.knownIds,
      knownUrls: first.selected.knownUrls,
      recordedExclusions: first.selected.recordedExclusions,
    });
    expect(second.selected.included).toHaveLength(0);
    expect(second.selected.excluded).toHaveLength(0);
  });

  it("resumes analysis from a checkpoint without repeating finished decisions", async () => {
    const decisions = decisionsFromPgn(LONG_PGN, {
      gameId: "g-new",
      url: "https://www.chess.com/game/live/999",
      cohortId: "transfer-e2e",
      color: "white",
    }).decisions;
    const seen = [];
    const analyzeOne = async (decision) => {
      seen.push(decision.key);
      return scriptedAnalyzeOne()(decision);
    };
    const done = new Map();
    const controller = new AbortController();
    await expect(
      analyzePending({
        decisions,
        done,
        analyzeOne,
        cohortId: "transfer-e2e",
        signal: controller.signal,
        onCheckpoint: () => controller.abort(),
      })
    ).rejects.toThrow(/aborted/);
    expect(done.size).toBe(1);
    await analyzePending({
      decisions,
      done,
      analyzeOne,
      cohortId: "transfer-e2e",
    });
    expect(done.size).toBe(decisions.length);
    expect(seen).toHaveLength(decisions.length);
    expect(new Set(seen).size).toBe(decisions.length);
  });
});

describe("baseline manifest", () => {
  it("reads the cutoff from rows and does not hardcode it in the detector", () => {
    const csv = "game_id,url,end_time,end_utc,time_control\n" +
      Array.from({ length: 200 }, (_, i) => {
        const id = `id-${String(i).padStart(3, "0")}`;
        return `${id},https://www.chess.com/game/live/${i},${1_000 + i},2026-01-01T00:00:00Z,600`;
      }).join("\n");
    const rows = parseGamesCsv(csv);
    const manifest = baselineManifestFromRows(rows, { path: "games.csv", sha256: "abc" });
    expect(manifest.gameCount).toBe(200);
    expect(manifest.cutoff.gameId).toBe("id-199");
    expect(manifest.cutoff.endTime).toBe(1199);
    expect(manifest.immutable).toBe(true);
    const source = readFileSync(new URL("./constants.js", import.meta.url), "utf8");
    expect(source.includes("1791014756")).toBe(false);
  });

  it("matches the frozen fase 2 games when they are on disk", () => {
    let csv;
    let manifest;
    try {
      csv = readFileSync(new URL("../../data/fase-2/output/games.csv", import.meta.url), "utf8");
      manifest = JSON.parse(readFileSync(new URL("../../data/transfer/baseline-manifest.json", import.meta.url), "utf8"));
    } catch {
      return;
    }
    const built = baselineManifestFromRows(parseGamesCsv(csv), {
      path: manifest.source,
      sha256: manifest.sourceSha256,
    });
    expect(built.cutoff).toEqual(manifest.cutoff);
    expect(built.gameIds).toEqual(manifest.gameIds);
    expect(manifest.gameCount).toBe(200);
  });
});

function row(gameId, event, color, phaseProxyName, severity, piece) {
  return {
    gameId,
    analysisComplete: true,
    event,
    color,
    phaseProxy: phaseProxyName,
    severity,
    pieceCaptureSubgroup: piece,
    excludedFromMeasurement: false,
  };
}

function fakeComparison({ games, decisions, upper, provisional = false }) {
  return {
    provisional,
    transfer: { gamesAnalyzed: games, decisions, events: 1 },
    baseline: { gamesAnalyzed: 200, decisions: 7000 },
    interval: { high: upper, low: upper - 1 },
  };
}

function clusters(cohortId, games, decisionsEach, eventsEach) {
  const gameClusters = Array.from({ length: games }, (_, index) => ({
    id: `${cohortId}-${index}`,
    events: eventsEach,
    decisions: decisionsEach,
  }));
  const decisions = games * decisionsEach;
  const events = games * eventsEach;
  return {
    cohortId,
    detectorId: DETECTOR.id,
    analysisFingerprint: FINGERPRINT,
    gamesAnalyzed: games,
    gamesAffected: eventsEach > 0 ? games : 0,
    decisions,
    events,
    eventsPer100: (100 * events) / decisions,
    pieceCaptureEvents: 0,
    pieceCapturePer100: 0,
    byPhase: {},
    byColor: {},
    severity: { notable: events, marcada: 0, grave: 0 },
    gameClusters,
  };
}

function syntheticBaseline() {
  return Array.from({ length: 12 }, (_, index) => ({
    key: `b-${index}:1`,
    gameId: `b-${index}`,
    url: `https://www.chess.com/game/live/b${index}`,
    cohortId: "baseline-fase2-200",
    ply: 1,
    moveNumber: 1,
    color: "white",
    fenBefore: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    moveSan: "e4",
    moveUci: "e2e4",
    phaseProxy: phaseProxy("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", 1),
  }));
}
