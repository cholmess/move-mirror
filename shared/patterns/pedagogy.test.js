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
  it("keeps practice evidence tentative and lowers confidence on contradiction", () => {
    const base = { id: "h1", confidence: "low", status: "tentative", observations: [] };
    const practice = applyHypothesisEvidence(base, { id: "p1", source: "practice", direction: "support", at: "2026-10-20T00:00:00Z" });
    const holdout = applyHypothesisEvidence(practice, { id: "o1", source: "holdout", direction: "support", at: "2026-10-21T00:00:00Z" });
    expect(holdout).toMatchObject({ confidence: "medium", status: "tentative" });
    const contradicted = applyHypothesisEvidence(holdout, { id: "o2", source: "holdout", direction: "contradict", at: "2026-10-22T00:00:00Z" });
    expect(contradicted).toMatchObject({ confidence: "low", status: "tentative" });
  });
});
