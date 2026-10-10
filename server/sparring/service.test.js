import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Chess } from "chess.js";
import { createSparringStore } from "./store.mjs";
import { createSparringService } from "./service.mjs";
import { clockPublicDto, pauseClock, startClock } from "../../shared/sparring/clock.js";

const TEST_EPOCH = "epoch-test-1111-4111-8111-111111111111";

const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

function mockEngine() {
  return {
    engineSha256: "mock-sha",
    analyseMultiPv: async (fen) => {
      const chess = new Chess(fen);
      const move = chess.moves({ verbose: true })[0];
      const uci = move ? `${move.from}${move.to}${move.promotion ?? ""}` : "a7a6";
      return {
        lines: [{ multipv: 1, score: { cp: 30, mate: null, numeric: 30 }, firstMoveUci: uci, pvUci: [uci] }],
      };
    },
  };
}

describe("sparring service closure", () => {
  let root;
  let store;
  let service;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "sparring-svc-"));
    store = createSparringStore(root);
    store.ensure();
    service = createSparringService({
      store,
      engine: mockEngine(),
      engineAvailable: true,
      queue: { enqueue: async (fn) => fn({ signal: undefined }) },
      evaluate: async () => ({ status: "unverified", evalFinalStatus: "unverified" }),
      defenseDatasetFile: null,
      cacheRoot: store.dirs.cache,
      monotonicEpochId: TEST_EPOCH,
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("resumes same session with identical state", async () => {
    const created = service.createSession({
      mode: "targeted_position",
      userColor: "white",
      startingFen: fen,
      patternId: "cct-opponent-refutation",
    });
    await service.agentMove(created.sessionId);
    const afterAgent = service.getSession(created.sessionId);
    const reloaded = service.getSession(created.sessionId);
    expect(reloaded.fen).toBe(afterAgent.fen);
    expect(reloaded.moveHistory).toEqual(afterAgent.moveHistory);
    expect(reloaded.agentTurnNumber).toBe(1);
    expect(reloaded.userColor).toBe("white");
    expect(reloaded.style).toBe("balanced");
    expect(reloaded.practicePatternId).toBe("allowed-forcing-reply");
  });

  it("agent idempotency does not duplicate moves", async () => {
    const created = service.createSession({
      mode: "targeted_position",
      userColor: "white",
      startingFen: fen,
    });
    const a = await service.agentMove(created.sessionId);
    const b = await service.agentMove(created.sessionId);
    expect(b.moveUci).toBe(a.moveUci);
    const internal = store.readSession(created.sessionId);
    expect(internal.movesUci.length).toBe(1);
    expect(internal.decisions.length).toBe(1);
  });

  it("review runs once", async () => {
    const created = service.createSession({
      mode: "targeted_position",
      userColor: "white",
      startingFen: fen,
    });
    await service.agentMove(created.sessionId);
    await service.applyPlayerMove(created.sessionId, { moveUci: "g1f3" });
    const internal = store.readSession(created.sessionId);
    internal.status = "completed";
    internal.result = "*";
    store.saveSession(internal);
    const r1 = await service.runReview(created.sessionId);
    const r2 = await service.runReview(created.sessionId);
    expect(r1.sessionId).toBe(r2.sessionId);
    expect(r1.moments.length).toBe(r2.moments.length);
  });

  it("engine pause does not consume user clock while waiting", () => {
    const t0 = performance.now();
    let clock = startClock(
      {
        mode: "10+0",
        whiteRemainingMs: 600_000,
        blackRemainingMs: 600_000,
        activeColor: null,
        status: "paused",
      },
      "white",
      TEST_EPOCH,
      t0 - 5000,
    );
    clock = pauseClock(clock, { reason: "engine_wait", currentEpochId: TEST_EPOCH, nowMono: t0 });
    expect(clock.activeColor).toBeNull();
    expect(clock.whiteRemainingMs).toBeLessThan(600_000);
    const before = clock.whiteRemainingMs;
    clock = pauseClock(clock, { reason: "engine_wait", currentEpochId: TEST_EPOCH, nowMono: t0 + 1000 });
    expect(clock.whiteRemainingMs).toBe(before);
  });

  it("timeout declared blocks further moves", async () => {
    const created = service.createSession({
      mode: "full_game",
      userColor: "white",
      clockMode: "10+0",
    });
    const internal = store.readSession(created.sessionId);
    internal.clock = {
      mode: "10+0",
      whiteRemainingMs: 0,
      blackRemainingMs: 600_000,
      activeColor: null,
      status: "expired",
      runningSinceMono: null,
      monotonicEpochId: null,
    };
    internal.timeoutDeclared = true;
    internal.status = "completed";
    store.saveSession(internal);
    await expect(service.applyPlayerMove(created.sessionId, { moveUci: "e2e4" })).rejects.toThrow(
      "session_finished",
    );
  });

  it("public session responses contain no decisions", async () => {
    const created = service.createSession({ mode: "full_game", userColor: "white" });
    const pub = service.getSession(created.sessionId);
    expect(pub).not.toHaveProperty("decisions");
    expect(pub).not.toHaveProperty("profileSnapshot");
  });
});

describe("clock monotonic view", () => {
  it("untimed has no fictitious timers", () => {
    expect(clockPublicDto({ mode: "untimed" }, TEST_EPOCH)).toEqual({ mode: "untimed" });
  });
});
