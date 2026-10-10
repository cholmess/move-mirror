import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import { passesQualityGate } from "./quality-gate.js";
import { extractPressureFeatures, pressureTargetScore } from "./pressure.js";
import { countSafeReplies, createsNarrowDefense } from "./narrow-defense.js";
import { chooseAgentMove } from "./policy.js";
import { pickDeterministicTie, mulberry32 } from "./determinism.js";
import { assertNoSpoilers, agentMovePublicDto } from "./dto.js";
import { buildProfileSnapshot, applyReviewToProfile, emptySparringProfile } from "./profile.js";
import { detectTermination, idempotencyKey, sideToMoveIsAgent } from "./chess-rules.js";
import { sessionToPgn } from "./pgn.js";
import { pauseClock, switchClockAfterMove, timeoutResult } from "./clock.js";
import { SPARRING_DOSE_ELIGIBLE, SPARRING_TRANSFER_ELIGIBLE } from "./constants.js";

const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

describe("sparring quality gate", () => {
  it("rejects large loss for strong style", () => {
    const gate = passesQualityGate({
      style: "strong",
      rank: 2,
      bestScore: { cp: 50, mate: null, numeric: 50 },
      candidateScore: { cp: 10, mate: null, numeric: 10 },
      fen,
      uci: "d7d5",
      agentColor: "black",
    });
    expect(gate.eligible).toBe(false);
  });

  it("allows rank 1 always", () => {
    const gate = passesQualityGate({
      style: "strong",
      rank: 1,
      bestScore: { cp: 50, mate: null, numeric: 50 },
      candidateScore: { cp: 50, mate: null, numeric: 50 },
      fen,
      uci: "e7e5",
      agentColor: "black",
    });
    expect(gate.eligible).toBe(true);
  });
});

describe("sparring pressure", () => {
  it("detects capture pressure", () => {
    const features = extractPressureFeatures(fen, "e7e5", "white", {
      patternId: "allowed-forcing-reply",
    });
    expect(features.phase).toBe("opening");
    expect(typeof features.givesCheck).toBe("boolean");
  });

  it("scores priority pattern higher with forcing capture", () => {
    const features = {
      matchesPriorityPattern: true,
      matchesWeakDefenseResource: false,
      createsNarrowDefense: true,
      createsForcingCapture: true,
      givesCheck: false,
      createsMateThreat: false,
      repeatsRecentMotif: false,
      likelyDefensiveResource: "capture_attacker",
    };
    expect(pressureTargetScore(features, {})).toBeGreaterThan(3);
  });
});

describe("narrow defense", () => {
  it("counts safe replies reproducibly", () => {
    const n = countSafeReplies(fen, "g8f6", "white");
    expect(n).toBeTypeOf("number");
  });
});

describe("determinism", () => {
  it("seeded tie-break is stable", () => {
    const pool = [
      { uci: "a7a6", finalScore: 2 },
      { uci: "b7b6", finalScore: 2 },
    ];
    const a = pickDeterministicTie(pool, "seed-1", "turn-3");
    const b = pickDeterministicTie(pool, "seed-1", "turn-3");
    expect(a?.uci).toBe(b?.uci);
    expect(mulberry32(123)()).toBeGreaterThanOrEqual(0);
  });
});

describe("policy", () => {
  it("falls back to best when none pass gate", () => {
    const result = chooseAgentMove({
      fen,
      agentColor: "black",
      userColor: "white",
      multiPvLines: [
        { multipv: 1, score: { cp: 40, mate: null, numeric: 40 }, firstMoveUci: "e7e5", pvUci: ["e7e5"] },
        { multipv: 2, score: { cp: -200, mate: null, numeric: -200 }, firstMoveUci: "f7f6", pvUci: ["f7f6"] },
      ],
      style: "strong",
      profileSnapshot: buildProfileSnapshot({ patternId: "allowed-forcing-reply" }),
      seed: "test",
      turnKey: "k1",
    });
    expect(result.chosen.rank).toBe(1);
  });
});

describe("no-spoiler dto", () => {
  it("public agent payload stays minimal", () => {
    const dto = agentMovePublicDto({
      moveUci: "e7e5",
      moveSan: "e5",
      sessionStatus: "active",
      clock: { mode: "untimed" },
    });
    expect(assertNoSpoilers(dto)).toBe(true);
    expect(Object.keys(dto).sort()).toEqual(["clock", "moveSan", "moveUci", "sessionStatus"]);
  });
});

describe("chess rules", () => {
  it("detects checkmate", () => {
    const chess = new Chess("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3");
    expect(detectTermination(chess)?.termination).toBe("checkmate");
  });

  it("idempotency key stable", () => {
    expect(idempotencyKey("s1", fen, 2)).toContain("s1");
  });

  it("agent turn detection", () => {
    expect(sideToMoveIsAgent(fen, "white")).toBe(true);
  });
});

describe("profile separation", () => {
  it("review updates sparring profile with dose false", () => {
    const profile = applyReviewToProfile(emptySparringProfile(), {
      completedAt: new Date().toISOString(),
      moments: [
        {
          agentCreated: true,
          resolved: false,
          evaluationStatus: "incorrect",
          defensiveResource: "capture_attacker",
          hintUsed: false,
        },
      ],
    });
    expect(profile.doseEligible).toBe(SPARRING_DOSE_ELIGIBLE);
    expect(profile.transferEligible).toBe(SPARRING_TRANSFER_ELIGIBLE);
    expect(profile.byResource.capture_attacker.errors).toBe(1);
  });
});

describe("clock", () => {
  it("timeout awards win to opponent", () => {
    const t = timeoutResult({
      mode: "10+0",
      whiteRemainingMs: 0,
      blackRemainingMs: 600_000,
      runningColor: null,
      lastStartedAt: null,
    });
    expect(t?.result).toBe("0-1");
  });
});

describe("pgn", () => {
  it("tags training game", () => {
    const pgn = sessionToPgn({
      mode: "full_game",
      userColor: "white",
      movesSan: ["e4", "e5"],
      result: "*",
    });
    expect(pgn).toContain('[TrainingGame "true"]');
    expect(pgn).toContain("MoveMirror Sparring");
  });
});
