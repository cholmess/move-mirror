import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EvalCache } from "./cache.js";
import { EvalMetrics } from "./metrics.js";
import { runEvaluation } from "./evaluator.mjs";
import { BUDGET_SHALLOW, BUDGET_DEEP } from "../shared/evaluation/budgets.js";

describe("runEvaluation pipeline", () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-eval-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function mockEngine(shallowCpLoss, deepCpLoss) {
    let shallowCalls = 0;
    let deepCalls = 0;
    return {
      engineVersion: "Mock",
      engineSha256: "mockhash",
      evaluatePair: vi.fn(async (_fen, _uci, budget) => {
        if (budget.id === BUDGET_SHALLOW.id) {
          shallowCalls += 1;
          const cpLoss = shallowCpLoss;
          return mkPair(cpLoss);
        }
        deepCalls += 1;
        return mkPair(deepCpLoss ?? shallowCpLoss);
      }),
      get shallowCalls() {
        return shallowCalls;
      },
      get deepCalls() {
        return deepCalls;
      },
    };
  }

  function mkPair(cpLoss) {
    return {
      best: {
        firstMoveUci: "e2e4",
        score: { cp: 100, mate: null, numeric: 100 },
        pvUci: ["e2e4", "e7e5"],
        nodes: 80_000,
      },
      played: {
        firstMoveUci: "d2d4",
        score: { cp: 100 - cpLoss, mate: null, numeric: 100 - cpLoss },
        pvUci: ["d2d4"],
        nodes: 80_000,
      },
      cpLoss,
      opponentReplyUci: "e7e5",
    };
  }

  it("cache hit avoids second engine evaluation", async () => {
    const cache = new EvalCache(dir);
    const metrics = new EvalMetrics(path.join(dir, "m.json"));
    const engine = mockEngine(10);

    const args = {
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      playedUci: "d2d4",
      referenceBestUci: null,
      engine,
      cache,
      metrics,
      signal: undefined,
    };

    await runEvaluation(args);
    await runEvaluation(args);
    expect(engine.evaluatePair).toHaveBeenCalledTimes(1);
  });

  it("49 cp escalates and uses deep for final classification", async () => {
    const cache = new EvalCache(dir);
    const metrics = new EvalMetrics(path.join(dir, "m2.json"));
    const engine = mockEngine(49, 48);

    const r = await runEvaluation({
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      playedUci: "d2d4",
      referenceBestUci: null,
      engine,
      cache,
      metrics,
    });

    expect(r.evalEscalated).toBe(true);
    expect(r.evalFinalBudgetId).toBe(BUDGET_DEEP.id);
    expect(r.status).toBe("verified_acceptable");
    expect(engine.evaluatePair).toHaveBeenCalledTimes(2);
  });

  it("final status uses deep layer when escalated", async () => {
    const cache = new EvalCache(dir);
    const metrics = new EvalMetrics(path.join(dir, "m3.json"));
    const engine = mockEngine(51, 130);

    const r = await runEvaluation({
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      playedUci: "d2d4",
      referenceBestUci: null,
      engine,
      cache,
      metrics,
    });

    expect(r.evalEscalated).toBe(true);
    expect(r.status).toBe("incorrect");
  });
});
