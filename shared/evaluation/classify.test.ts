import { describe, it, expect } from "vitest";
import {
  classifyEngineResult,
  affectsDomain,
  isSuccessForAdaptive,
} from "./classify.js";

const baseBest = {
  score: { cp: 100, mate: null, numeric: 100 },
  pvUci: ["e2e4"],
  firstMoveUci: "e2e4",
};

const baseInput = {
  fen: "start",
  playedUci: "d2d4",
  referenceBestUci: "e2e4",
  best: baseBest,
  played: {
    score: { cp: 100, mate: null, numeric: 100 },
    pvUci: ["d2d4"],
    firstMoveUci: "d2d4",
  },
  cpLoss: 0,
};

describe("classifyEngineResult", () => {
  it("reference match → verified_best", () => {
    expect(
      classifyEngineResult({ ...baseInput, playedUci: "e2e4", cpLoss: 0 })
    ).toBe("verified_best");
  });

  it("alternative ≤50 cp → verified_acceptable", () => {
    expect(
      classifyEngineResult({
        ...baseInput,
        played: { ...baseInput.played, score: { cp: 60, mate: null, numeric: 60 } },
        cpLoss: 40,
      })
    ).toBe("verified_acceptable");
  });

  it("51–120 cp → playable_inexact", () => {
    expect(
      classifyEngineResult({
        ...baseInput,
        cpLoss: 80,
      })
    ).toBe("playable_inexact");
  });

  it(">120 cp → incorrect", () => {
    expect(
      classifyEngineResult({
        ...baseInput,
        cpLoss: 200,
      })
    ).toBe("incorrect");
  });

  it("mate regression → incorrect", () => {
    expect(
      classifyEngineResult({
        ...baseInput,
        best: {
          score: { cp: null, mate: 3, numeric: 99997 },
          pvUci: [],
          firstMoveUci: "a1a2",
        },
        played: {
          score: { cp: 0, mate: null, numeric: 0 },
          pvUci: [],
          firstMoveUci: "d2d4",
        },
        cpLoss: 99997,
      })
    ).toBe("incorrect");
  });

  it("null cpLoss → unverified", () => {
    expect(classifyEngineResult({ ...baseInput, cpLoss: null })).toBe("unverified");
  });
});

describe("domain scoring gates", () => {
  it("unverified does not affect domain", () => {
    expect(affectsDomain("unverified")).toBe(false);
    expect(isSuccessForAdaptive("unverified")).toBe(false);
  });
});
