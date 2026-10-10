import { describe, expect, it } from "vitest";
import {
  classifyDefensiveMotif,
  detectDefenseOpportunity,
  isPositionDefendable,
  limitOnePerGame,
} from "./domain.js";

const FEN = "r3k2r/ppp2ppp/2n5/8/8/2N5/PPP2PPP/R3K2R w KQkq - 0 1";

describe("defense-opportunity-v1", () => {
  it("accepts a legal, defendable 120cp opportunity with a forcing consequence", () => {
    const result = detectDefenseOpportunity({
      fen: FEN,
      playedSan: "O-O",
      referenceSan: "Kd2",
      cpLoss: 120,
      bestScore: { cp: -250, mate: null },
      playedScore: { cp: -370, mate: null },
      forcingConsequence: true,
      explainableResource: true,
      activeCohort: false,
    });
    expect(result.accepted).toBe(true);
  });

  it("excludes positions already completely lost", () => {
    expect(isPositionDefendable({ bestScore: { cp: -251, mate: null } })).toEqual({
      accepted: false,
      reason: "position_already_completely_lost",
    });
  });

  it("excludes inevitable mate when no verified alternative escapes", () => {
    expect(
      isPositionDefendable({
        bestScore: { cp: null, mate: -4 },
        alternatives: [{ score: { mate: -3 } }],
      }).accepted,
    ).toBe(false);
  });

  it("rejects invalid FEN, illegal moves, and active cohorts", () => {
    expect(
      detectDefenseOpportunity({
        fen: "bad",
        playedSan: "e4",
        referenceSan: "d4",
      }).reasons,
    ).toContain("invalid_fen");
    expect(
      detectDefenseOpportunity({
        fen: FEN,
        playedSan: "Qh9",
        referenceSan: "Kd2",
        cpLoss: 200,
        bestScore: { cp: 0, mate: null },
        forcingConsequence: true,
        explainableResource: true,
        activeCohort: true,
      }).reasons,
    ).toEqual(expect.arrayContaining(["illegal_played_move", "active_transfer_cohort"]));
  });

  it("keeps at most one position per game", () => {
    const rows = [
      { id: "a", source: { gameId: "g1" } },
      { id: "b", source: { gameId: "g1" } },
      { id: "c", source: { gameId: "g2" } },
    ];
    expect(limitOnePerGame(rows).map((row) => row.id)).toEqual(["a", "c"]);
  });
});

describe("defense-motif-v1", () => {
  it("classifies counterchecks with high confidence", () => {
    const result = classifyDefensiveMotif({
      fen: FEN,
      defenseSan: "Kd2",
      actualLineSan: ["O-O", "O-O"],
      motifs: [],
    });
    expect(result.classifierVersion).toBe("defense-motif-v1");
    expect(["medium", "low"]).toContain(result.confidence);
  });

  it("downgrades illegal recommendations to unknown", () => {
    expect(
      classifyDefensiveMotif({
        fen: FEN,
        defenseSan: "Qh9",
      }),
    ).toMatchObject({ resource: "unknown", confidence: "low" });
  });
});
