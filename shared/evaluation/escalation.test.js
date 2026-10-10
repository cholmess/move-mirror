import { describe, it, expect } from "vitest";
import { shouldEscalate, inBand, BAND_NEAR_50, BAND_NEAR_120 } from "./escalation.js";

const best = { firstMoveUci: "e2e4", score: { cp: 50, mate: null, numeric: 50 } };
const played = { firstMoveUci: "d2d4", score: { cp: 10, mate: null, numeric: 10 } };

describe("shouldEscalate", () => {
  it("49 cp near 50 escalates", () => {
    const r = shouldEscalate({
      cpLoss: 49,
      best,
      played,
      playedUci: "d2d4",
      shallowIncomplete: false,
      referenceBestUci: null,
    });
    expect(r.escalate).toBe(true);
    expect(r.reason).toBe("cp_loss_near_50");
  });

  it("51 cp near 50 escalates", () => {
    const r = shouldEscalate({
      cpLoss: 51,
      best,
      played,
      playedUci: "d2d4",
      shallowIncomplete: false,
      referenceBestUci: null,
    });
    expect(r.escalate).toBe(true);
  });

  it("119/121 cp near 120 escalate", () => {
    expect(
      shouldEscalate({
        cpLoss: 119,
        best,
        played,
        playedUci: "d2d4",
        shallowIncomplete: false,
        referenceBestUci: null,
      }).escalate
    ).toBe(true);
    expect(
      shouldEscalate({
        cpLoss: 121,
        best,
        played,
        playedUci: "d2d4",
        shallowIncomplete: false,
        referenceBestUci: null,
      }).escalate
    ).toBe(true);
  });

  it("outside bands does not escalate", () => {
    expect(
      shouldEscalate({
        cpLoss: 20,
        best,
        played,
        playedUci: "d2d4",
        shallowIncomplete: false,
        referenceBestUci: null,
      }).escalate
    ).toBe(false);
    expect(
      shouldEscalate({
        cpLoss: 200,
        best,
        played,
        playedUci: "d2d4",
        shallowIncomplete: false,
        referenceBestUci: null,
      }).escalate
    ).toBe(false);
  });

  it("mate state change escalates", () => {
    const r = shouldEscalate({
      cpLoss: 10,
      best: { firstMoveUci: "a1a2", score: { cp: null, mate: 3, numeric: 99997 } },
      played: { firstMoveUci: "d2d4", score: { cp: 0, mate: null, numeric: 0 } },
      playedUci: "d2d4",
      shallowIncomplete: false,
      referenceBestUci: null,
    });
    expect(r.escalate).toBe(true);
    expect(r.reason).toBe("mate_state_change");
  });

  it("precomputed match skips escalation", () => {
    const r = shouldEscalate({
      cpLoss: 49,
      best: { firstMoveUci: "e2e4", score: { cp: 50, mate: null, numeric: 50 } },
      played,
      playedUci: "e2e4",
      shallowIncomplete: false,
      referenceBestUci: "e2e4",
    });
    expect(r.escalate).toBe(false);
  });

  it("bands constants", () => {
    expect(inBand(49, BAND_NEAR_50)).toBe(true);
    expect(inBand(119, BAND_NEAR_120)).toBe(true);
  });
});
