import { describe, expect, it } from "vitest";
import { assertReadyForImport, draftReviewState, humanReviewRequiredCount, plyRequiresUserAction } from "./review.mjs";
import { decodeScoresheetSequence } from "./legality-decoder.mjs";
import { observationToRawMoveTokens } from "./layout.mjs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/scoresheets");

describe("scoresheet review gates", () => {
  it("blocks probable until confirmed", () => {
    const ply = { selectedUci: "a2a3", resolution: "probable", confirmedByUser: false };
    expect(plyRequiresUserAction(ply)).toBe(true);
    expect(() => assertReadyForImport([ply])).toThrow(/SCORESHEET_REVIEW_REQUIRED/);
  });

  it("allows high_confidence without manual confirm", () => {
    const ply = { selectedUci: "e2e4", resolution: "high_confidence", confirmedByUser: false };
    expect(plyRequiresUserAction(ply)).toBe(false);
  });

  it("ambiguous fixture blocks import until ply confirmed", () => {
    const observation = JSON.parse(readFileSync(path.join(fixtures, "ambiguous-legal-moves.observation.json"), "utf8"));
    const decoded = decodeScoresheetSequence({ moveRows: observationToRawMoveTokens(observation), locale: "en" });
    expect(decoded.plies.length).toBeGreaterThan(0);
    expect(draftReviewState(decoded.plies).readyToConfirm).toBe(false);
    expect(() => assertReadyForImport(decoded.plies)).toThrow(/SCORESHEET_REVIEW_REQUIRED/);
  });
});
