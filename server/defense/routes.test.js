import { describe, expect, it } from "vitest";
import { promptDto } from "./routes.mjs";

describe("Defense prompt payload", () => {
  it("does not expose solution, alternatives, or reference lines", () => {
    const dto = promptDto({
      id: "def-1",
      positionBeforeDecisionFen: "fen",
      orientation: "white",
      phase: "middlegame",
      source: {
        playedAt: "2026-01-01T00:00:00Z",
        playerColor: "white",
        previousMoveSan: "Qh4",
      },
      sourceContext: { moveNumber: 20, opening: null },
      referenceDefenseUci: "g2g3",
      referenceDefenseSan: "g3",
      acceptableAlternatives: ["h3"],
      defenseReferenceLineSan: ["g3", "Qh6"],
    }, "Razón");
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain("referenceDefenseUci");
    expect(serialized).not.toContain("referenceDefenseSan");
    expect(serialized).not.toContain("acceptableAlternatives");
    expect(serialized).not.toContain("defenseReferenceLineSan");
  });
});
