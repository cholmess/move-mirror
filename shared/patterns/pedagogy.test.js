import { describe, expect, it } from "vitest";
import { applyHypothesisEvidence, fallbackPedagogy, validatePedagogyOutput } from "./pedagogy.js";

describe("personal pedagogy contract", () => {
  const ids = ["decision", "reply", "similar", "contrast"];
  it("accepts grounded structured output and rejects invented evidence", () => {
    const value = fallbackPedagogy({ intervention: "evaluate", evidenceIds: ids });
    expect(validatePedagogyOutput(value, ids).primaryHypothesis.confidence).toBe("low");
    value.teaching.evidenceIds = ["invented-line"];
    expect(() => validatePedagogyOutput(value, ids)).toThrow("invalid_pedagogy_output");
  });
  it("does not permit high confidence from one model generation", () => {
    const value = fallbackPedagogy({ intervention: "search", evidenceIds: ids });
    value.primaryHypothesis.confidence = "high";
    expect(() => validatePedagogyOutput(value, ids)).toThrow("invalid_pedagogy_output");
  });
  it("requires a verified non-error and an error when contrast evidence exists", () => {
    const value = fallbackPedagogy({ intervention: "search", evidenceIds: ["decision", "contrast"] });
    const facts = [{ evidenceId: "decision", kind: "player_decision" }, { evidenceId: "contrast", kind: "comparable_non_error" }];
    expect(validatePedagogyOutput(value, facts).teaching.contrast.evidenceIds).toEqual(["decision", "contrast"]);
    value.teaching.contrast.evidenceIds = ["decision", "decision"];
    expect(() => validatePedagogyOutput(value, facts)).toThrow("invalid_pedagogy_output");
  });
  it("changes the rule-based teaching for the blocked-center second focus without claiming a cause", () => {
    const value = fallbackPedagogy({ intervention: "reinforce", evidenceIds: ids, patternId: "closed-center" });
    expect(value.primaryHypothesis.category).toBe("insufficient_evidence");
    expect(value.teaching.objective).toContain("ruptura de peones");
    expect(value.alternativeHypotheses.map((row) => row.category)).toEqual(["strategic_planning", "concept_recognition"]);
    expect(validatePedagogyOutput(value, ids)).toEqual(value);
  });
  it("keeps probes tentative, ignores inconclusive transfer for cause confidence, and lowers confidence on contradiction", () => {
    const base = { id: "h1", confidence: "low", status: "tentative", observations: [] };
    const practice = applyHypothesisEvidence(base, { id: "p1", source: "practice", direction: "support", at: "2026-10-20T00:00:00Z" });
    const inconclusive = applyHypothesisEvidence(practice, { id: "o0", source: "holdout", direction: "inconclusive", at: "2026-10-21T00:00:00Z" });
    expect(inconclusive).toMatchObject({ confidence: "low", status: "tentative" });
    const holdout = applyHypothesisEvidence(inconclusive, { id: "o1", source: "practice_probe", direction: "support", at: "2026-10-21T01:00:00Z" });
    expect(holdout).toMatchObject({ confidence: "medium", status: "tentative" });
    const contradicted = applyHypothesisEvidence(holdout, { id: "o2", source: "holdout", direction: "contradict", at: "2026-10-22T00:00:00Z" });
    expect(contradicted).toMatchObject({ confidence: "low", status: "tentative" });
  });
  it("does not support a cause from one later game or recurrence without a direct probe", () => {
    const base = { id: "h1", confidence: "low", status: "tentative", observations: [] };
    const probe = applyHypothesisEvidence(base, { id: "p1", source: "practice_probe", direction: "support", measurability: "direct", at: "2026-10-20T00:00:00Z" });
    const oneGame = applyHypothesisEvidence(probe, { id: "g1", source: "real_game", direction: "support", gameId: "g1", at: "2026-10-21T00:00:00Z" });
    expect(oneGame.status).toBe("tentative");
    const twoGames = applyHypothesisEvidence(oneGame, { id: "g2", source: "real_game", direction: "support", gameId: "g2", at: "2026-10-22T00:00:00Z" });
    expect(twoGames.status).toBe("supported");
    const recurrenceOnly = applyHypothesisEvidence(
      applyHypothesisEvidence(base, { id: "r1", source: "real_game", direction: "support", gameId: "r1", at: "2026-10-21T00:00:00Z" }),
      { id: "r2", source: "real_game", direction: "support", gameId: "r2", at: "2026-10-22T00:00:00Z" },
    );
    expect(recurrenceOnly.status).toBe("tentative");
  });
});
