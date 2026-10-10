import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Chess } from "chess.js";
import { createSparringStore } from "./store.mjs";
import { createSparringService } from "./service.mjs";
import {
  clockPublicDto,
  migratePersistedClock,
  pauseClock,
  recoverClockAfterProcessChange,
} from "../../shared/sparring/clock.js";

const EPOCH_A = "epoch-a1111111-1111-4111-8111-111111111111";
const EPOCH_B = "epoch-b2222222-2222-4222-8222-222222222222";

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

function baseService(root, monotonicEpochId) {
  const store = createSparringStore(root);
  store.ensure();
  return createSparringService({
    store,
    engine: mockEngine(),
    engineAvailable: true,
    queue: { enqueue: async (fn) => fn({ signal: undefined }) },
    evaluate: async () => ({ status: "unverified", evalFinalStatus: "unverified" }),
    defenseDatasetFile: null,
    cacheRoot: store.dirs.cache,
    monotonicEpochId,
  });
}

describe("sparring clock server restart", () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "sparring-clock-restart-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reinstanciated service pauses running clock without charging downtime", async () => {
    const store = createSparringStore(root);
    store.ensure();
    let serviceA = baseService(root, EPOCH_A);
    const created = serviceA.createSession({ mode: "full_game", userColor: "white", clockMode: "10+0" });
    let internal = store.readSession(created.sessionId);
    internal.status = "active";
    internal.clock = {
      mode: "10+0",
      whiteRemainingMs: 500_000,
      blackRemainingMs: 600_000,
      activeColor: "white",
      status: "running",
      pauseReason: null,
      runningSinceMono: performance.now(),
      monotonicEpochId: EPOCH_A,
    };
    store.saveSession(internal);

    serviceA = null;
    const serviceB = baseService(root, EPOCH_B);
    const pub = serviceB.getSession(created.sessionId);
    expect(pub.clock.status).toBe("paused");
    expect(pub.clock.resumeRequired).toBe(true);
    expect(pub.clock.whiteRemainingMs).toBe(500_000);

    const again = serviceB.getSession(created.sessionId);
    expect(again.clock.resumeRequired).toBe(true);
    expect(again.clock.whiteRemainingMs).toBe(500_000);

    const internalB = store.readSession(created.sessionId);
    expect(internalB.clock.pauseReason).toBe("server_restart");
    expect(internalB.clock.runningSinceMono).toBeNull();
    expect(internalB.movesUci.length).toBe(0);
    expect(internalB.decisions.length).toBe(0);
  });

  it("resume is idempotent and only ticks after explicit resume", async () => {
    const store = createSparringStore(root);
    store.ensure();
    const serviceA = baseService(root, EPOCH_A);
    const created = serviceA.createSession({ mode: "full_game", userColor: "white", clockMode: "10+0" });
    let internal = store.readSession(created.sessionId);
    internal.status = "active";
    internal.clock = {
      mode: "10+0",
      whiteRemainingMs: 120_000,
      blackRemainingMs: 600_000,
      activeColor: "white",
      status: "running",
      runningSinceMono: performance.now(),
      monotonicEpochId: EPOCH_A,
    };
    store.saveSession(internal);

    const serviceB = baseService(root, EPOCH_B);
    const beforeResume = serviceB.getSession(created.sessionId);
    expect(beforeResume.clock.resumeRequired).toBe(true);

    const r1 = serviceB.resume(created.sessionId);
    expect(r1.clock.status).toBe("running");
    expect(r1.clock.resumeRequired).toBe(false);

    const r2 = serviceB.resume(created.sessionId);
    expect(r2.clock.status).toBe("running");
    expect(r2.sessionStatus).toBe("active");
  });

  it("timeout stays terminal across restart", async () => {
    const store = createSparringStore(root);
    store.ensure();
    const serviceA = baseService(root, EPOCH_A);
    const created = serviceA.createSession({ mode: "full_game", userColor: "white", clockMode: "10+0" });
    let internal = store.readSession(created.sessionId);
    internal.status = "completed";
    internal.timeoutDeclared = true;
    internal.result = "0-1";
    internal.termination = "timeout";
    internal.clock = {
      mode: "10+0",
      whiteRemainingMs: 0,
      blackRemainingMs: 600_000,
      activeColor: null,
      status: "expired",
      pauseReason: null,
      runningSinceMono: null,
      monotonicEpochId: null,
    };
    store.saveSession(internal);

    const serviceB = baseService(root, EPOCH_B);
    const pub = serviceB.getSession(created.sessionId);
    expect(pub.sessionStatus).toBe("completed");
    expect(pub.clock.status).toBe("expired");
    expect(() => serviceB.resume(created.sessionId)).toThrow("session_finished");
  });

  it("migrates v0.6 running clock without epoch as server_restart pause", () => {
    const { clock, changed } = recoverClockAfterProcessChange(
      {
        mode: "10+0",
        whiteRemainingMs: 300_000,
        blackRemainingMs: 600_000,
        runningColor: "white",
        runningSinceMono: 12345,
      },
      EPOCH_B,
    );
    expect(changed).toBe(true);
    expect(clock.status).toBe("paused");
    expect(clock.pauseReason).toBe("server_restart");
    expect(clock.whiteRemainingMs).toBe(300_000);
    expect(clock.runningSinceMono).toBeNull();
  });

  it("preserves engine-wait pause across restart", () => {
    const store = createSparringStore(root);
    store.ensure();
    const serviceA = baseService(root, EPOCH_A);
    const created = serviceA.createSession({ mode: "full_game", userColor: "white", clockMode: "10+0" });
    let internal = store.readSession(created.sessionId);
    internal.status = "paused";
    internal.enginePaused = true;
    internal.clock = pauseClock(
      {
        mode: "10+0",
        whiteRemainingMs: 450_000,
        blackRemainingMs: 600_000,
        activeColor: null,
        status: "paused",
        pauseReason: "engine_wait",
        runningSinceMono: null,
        monotonicEpochId: null,
      },
      { reason: "engine_wait", currentEpochId: EPOCH_A },
    );
    store.saveSession(internal);

    const serviceB = baseService(root, EPOCH_B);
    const pub = serviceB.getSession(created.sessionId);
    expect(pub.sessionStatus).toBe("paused");
    expect(pub.clock.whiteRemainingMs).toBe(450_000);
    expect(pub.clock.resumeRequired).toBe(false);
    expect(store.readSession(created.sessionId).clock.pauseReason).toBe("engine_wait");
  });

  it("untimed session ignores restart resume", () => {
    const service = baseService(root, EPOCH_A);
    const created = service.createSession({ mode: "full_game", userColor: "white", clockMode: "untimed" });
    expect(() => service.resume(created.sessionId)).toThrow("not_paused");
  });

  it("missing session on resume", () => {
    const service = baseService(root, EPOCH_A);
    expect(() => service.resume("11111111-1111-4111-8111-111111111111")).toThrow("session_not_found");
  });

  it("repeated GET does not start the clock", () => {
    const store = createSparringStore(root);
    store.ensure();
    const service = baseService(root, EPOCH_B);
    const created = service.createSession({ mode: "full_game", userColor: "white", clockMode: "10+0" });
    let internal = store.readSession(created.sessionId);
    internal.status = "active";
    internal.clock = {
      mode: "10+0",
      whiteRemainingMs: 200_000,
      blackRemainingMs: 600_000,
      activeColor: "white",
      status: "running",
      runningSinceMono: performance.now(),
      monotonicEpochId: EPOCH_A,
    };
    store.saveSession(internal);

    const a = service.getSession(created.sessionId);
    const b = service.getSession(created.sessionId);
    expect(a.clock.resumeRequired).toBe(true);
    expect(b.clock.resumeRequired).toBe(true);
    expect(b.clock.whiteRemainingMs).toBe(200_000);
  });

  it("concurrent resume calls stay idempotent", () => {
    const store = createSparringStore(root);
    store.ensure();
    const service = baseService(root, EPOCH_B);
    const created = service.createSession({ mode: "full_game", userColor: "white", clockMode: "10+0" });
    let internal = store.readSession(created.sessionId);
    internal.status = "active";
    internal.clock = {
      mode: "10+0",
      whiteRemainingMs: 90_000,
      blackRemainingMs: 600_000,
      activeColor: "black",
      status: "paused",
      pauseReason: "server_restart",
      runningSinceMono: null,
      monotonicEpochId: null,
    };
    store.saveSession(internal);

    const r1 = service.resume(created.sessionId);
    const r2 = service.resume(created.sessionId);
    expect(r1.clock.status).toBe("running");
    expect(r2.clock.status).toBe("running");
    expect(store.readSession(created.sessionId).decisions.length).toBe(0);
  });

  it("preserves engine-error pause across restart", () => {
    const store = createSparringStore(root);
    store.ensure();
    const serviceA = baseService(root, EPOCH_A);
    const created = serviceA.createSession({ mode: "full_game", userColor: "white", clockMode: "10+0" });
    let internal = store.readSession(created.sessionId);
    internal.status = "paused";
    internal.enginePaused = true;
    internal.clock = {
      mode: "10+0",
      whiteRemainingMs: 410_000,
      blackRemainingMs: 600_000,
      activeColor: null,
      status: "paused",
      pauseReason: "engine_error",
      runningSinceMono: null,
      monotonicEpochId: null,
    };
    store.saveSession(internal);

    const serviceB = baseService(root, EPOCH_B);
    const pub = serviceB.getSession(created.sessionId);
    expect(pub.clock.whiteRemainingMs).toBe(410_000);
    expect(pub.clock.pauseReason).toBeUndefined();
    expect(store.readSession(created.sessionId).clock.pauseReason).toBe("engine_error");
  });

  it("terminal completed session is unchanged after restart", () => {
    const store = createSparringStore(root);
    store.ensure();
    const serviceA = baseService(root, EPOCH_A);
    const created = serviceA.createSession({ mode: "full_game", userColor: "white", clockMode: "10+0" });
    let internal = store.readSession(created.sessionId);
    internal.status = "completed";
    internal.result = "1-0";
    internal.termination = "checkmate";
    internal.clock = {
      mode: "10+0",
      whiteRemainingMs: 100_000,
      blackRemainingMs: 100_000,
      activeColor: null,
      status: "finished",
      pauseReason: null,
      runningSinceMono: null,
      monotonicEpochId: null,
    };
    store.saveSession(internal);

    const serviceB = baseService(root, EPOCH_B);
    const pub = serviceB.getSession(created.sessionId);
    expect(pub.sessionStatus).toBe("completed");
    expect(pub.clock.status).toBe("finished");
    expect(pub.clock.whiteRemainingMs).toBe(100_000);
  });

  it("declares timeout once and blocks moves after restart", async () => {
    const store = createSparringStore(root);
    store.ensure();
    const service = baseService(root, EPOCH_B);
    const created = service.createSession({ mode: "full_game", userColor: "white", clockMode: "10+0" });
    let internal = store.readSession(created.sessionId);
    internal.status = "completed";
    internal.timeoutDeclared = true;
    internal.result = "0-1";
    internal.termination = "timeout";
    internal.clock = {
      mode: "10+0",
      whiteRemainingMs: 0,
      blackRemainingMs: 600_000,
      activeColor: null,
      status: "expired",
      pauseReason: null,
      runningSinceMono: null,
      monotonicEpochId: null,
    };
    store.saveSession(internal);

    await expect(service.applyPlayerMove(created.sessionId, { moveUci: "e2e4" })).rejects.toThrow(
      "session_finished",
    );

    const serviceC = baseService(root, "epoch-c3333333-3333-4333-8333-333333333333");
    const pub = serviceC.getSession(created.sessionId);
    expect(pub.sessionStatus).toBe("completed");
    expect(pub.termination).toBe("timeout");
    expect(pub.clock.status).toBe("expired");
    expect(() => serviceC.resume(created.sessionId)).toThrow("session_finished");
  });

  it("public dto hides internal clock fields", () => {
    const dto = clockPublicDto(
      migratePersistedClock({
        mode: "10+0",
        whiteRemainingMs: 1,
        blackRemainingMs: 2,
        activeColor: "white",
        status: "paused",
        pauseReason: "server_restart",
        runningSinceMono: 9,
        monotonicEpochId: EPOCH_A,
      }),
      EPOCH_B,
    );
    expect(dto).not.toHaveProperty("runningSinceMono");
    expect(dto).not.toHaveProperty("monotonicEpochId");
    expect(dto).not.toHaveProperty("pauseReason");
    expect(dto.resumeRequired).toBe(true);
  });
});
