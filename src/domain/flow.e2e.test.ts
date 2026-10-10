import { describe, it, expect, vi, beforeEach } from "vitest";
import { createInitialState, recordAttempt, saveState, loadState } from "../storage/persistence";
import { evaluateMoveWithEngine } from "../api/engineClient";
import { selectNextExercise } from "./adaptive";

vi.mock("../api/engineClient", () => ({
  evaluateMoveWithEngine: vi.fn(),
}));

const mockedEval = vi.mocked(evaluateMoveWithEngine);

const memStore: Record<string, string> = {};

describe("flow CCT → eval → profile → next", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(memStore)) delete memStore[k];
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => memStore[k] ?? null,
      setItem: (k: string, v: string) => {
        memStore[k] = v;
      },
      removeItem: (k: string) => {
        delete memStore[k];
      },
      clear: () => {
        for (const k of Object.keys(memStore)) delete memStore[k];
      },
    });
  });

  it("end-to-end without spoiler before record", async () => {
    mockedEval.mockResolvedValue({
      status: "verified_best",
      verified: true,
      cpLoss: 0,
      opponentReplySan: "Nxg4",
      engineVersion: "Test Engine",
      engineSha256: "abc",
      evalBudgetId: "nodes-80k-v1",
      error: null,
    });

    let state = createInitialState();
    const exerciseId = state.progress.currentExerciseId!;

    const engine = await evaluateMoveWithEngine({
      fen: "fen",
      moveSan: "Qxe4",
    });
    expect(engine.status).toBe("verified_best");

    state = recordAttempt(state, {
      exerciseId,
      patternId: "cct-opponent-refutation",
      skillIds: ["cct-opponent-refutation"],
      fen: "r4rk1/2p1n1p1/3p3p/1pb1p2P/p3Pq2/P1P2N2/RP3PPN/3Q1RK1 b - - 0 20",
      cct: {
        checksConsidered: "Qg4",
        capturesConsidered: "Qxe4",
        threatsConsidered: "attack",
        firstCandidate: "Qxe4",
        opponentForcedResponse: "Nxg4",
      },
      chosenMoveSan: "Qxe4",
      reasoning: "Captura central verificando jaque",
      timeUsedSeconds: 42,
      evaluationStatus: engine.status,
      evalLossCp: engine.cpLoss,
      engineVersion: engine.engineVersion,
      engineSha256: engine.engineSha256,
      evalVerified: engine.verified,
      observableReason: "La respuesta forzada del rival quedó disponible",
      opponentReplySan: engine.opponentReplySan,
      reflectionPrompt: "¿Comprobaste la refutación?",
      attemptNumber: 1,
      foundOpponentForcedResponse: true,
      lessonVersion: "cct-refutation-v1",
      evalCriterionVersion: "engine-validated-v2",
    });

    expect(state.attempts).toHaveLength(1);
    expect(state.skills["cct-opponent-refutation"]!.alpha).toBeGreaterThan(4);

    const next = selectNextExercise(state);
    expect(next.exercise.id).toBeTruthy();

    saveState(state);
    const reloaded = loadState();
    expect(reloaded.attempts).toHaveLength(1);
  });
});
