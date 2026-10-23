import { describe, expect, it } from "vitest";
import { buildCurriculumPlan, createHypothesisRevision, decideCurriculum } from "./curriculum.js";

const transfer = (status = "insufficient", differencePer100 = null) => ({ status, differencePer100, causal: false });
const pattern = (id = "piece-loss", overrides = {}) => ({
  id, status: "recurrent", priority: 10, transfer: transfer(), ...overrides,
});
const hypothesis = (overrides = {}) => ({
  id: "h1", patternId: "piece-loss", category: "reply_search", statement: "Busca la respuesta rival.",
  status: "tentative", confidence: "low",
  alternatives: [{ category: "candidate_comparison", statement: "Compara más candidatas." }],
  observations: [], ...overrides,
});

describe("adaptive curriculum decisions", () => {
  it("abandons a contradicted cause and creates an auditable alternative revision", () => {
    const h = hypothesis({ status: "contradicted", observations: [
      { direction: "contradict", observedCategory: "candidate_comparison" },
      { direction: "contradict", observedCategory: "candidate_comparison" },
    ] });
    const decision = decideCurriculum(pattern(), h);
    expect(decision).toMatchObject({ action: "revise_hypothesis", previousCategory: "reply_search", targetCategory: "candidate_comparison" });
    expect(createHypothesisRevision(h, decision, { id: "h2", at: "2026-10-22T10:00:00Z" })).toMatchObject({
      id: "h2", parentHypothesisId: "h1", category: "candidate_comparison", status: "tentative", observations: [],
      alternatives: [{ category: "reply_search" }],
    });
  });

  it("reteaches after blind failure instead of repeating the same test", () => {
    const h = hypothesis({ observations: [{ source: "holdout", skillOutcome: "failure", at: "2026-10-21T10:00:00Z" }] });
    expect(decideCurriculum(pattern(), h).action).toBe("reteach");
  });

  it("bridges a generalized skill toward real play while transfer is pending or flat", () => {
    const h = hypothesis({ observations: [{ source: "holdout", skillOutcome: "success", at: "2026-10-21T10:00:00Z" }] });
    expect(decideCurriculum(pattern(), h).action).toBe("bridge_transfer");
    expect(decideCurriculum(pattern("piece-loss", { transfer: transfer("descriptive_comparison", 0) }), h).reasonKey).toBe("generalized_without_transfer");
  });

  it("uses maintenance only after blind generalization and lower later recurrence", () => {
    const h = hypothesis({ observations: [{ source: "holdout", skillOutcome: "success", at: "2026-10-21T10:00:00Z" }] });
    expect(decideCurriculum(pattern("piece-loss", { transfer: transfer("descriptive_comparison", -4.2) }), h)).toMatchObject({ action: "maintenance" });
    expect(decideCurriculum(pattern(), hypothesis({ observations: [{ source: "practice_probe", direction: "support" }] })).action).toBe("diagnose");
  });

  it("assigns primary, support and maintenance deterministically", () => {
    const rows = [
      pattern("piece-loss", { priority: 99, curriculum: { ...decideCurriculum(pattern(), hypothesis({ observations: [{ source: "holdout", skillOutcome: "success", at: "2026-10-21" }] })), action: "maintenance" } }),
      pattern("closed-center", { priority: 5 }),
      pattern("endgame-decisions", { priority: 1, curriculum: { ...decideCurriculum(pattern(), hypothesis()), action: "reteach" } }),
    ];
    expect(buildCurriculumPlan(rows).map((row) => [row.patternId, row.slot])).toEqual([
      ["endgame-decisions", "primary"], ["closed-center", "support"], ["piece-loss", "maintenance"],
    ]);
  });

  it("caps active work at primary plus support and prefers a different skill family", () => {
    const plan = buildCurriculumPlan([
      pattern("piece-loss", { priority: 9 }),
      pattern("forcing-reply", { priority: 8 }),
      pattern("closed-center", { priority: 7 }),
      pattern("endgame-decisions", { priority: 6 }),
    ]);
    expect(plan.map((row) => [row.patternId, row.slot])).toEqual([
      ["piece-loss", "primary"], ["closed-center", "support"],
    ]);
    expect(plan[0].skillFamilyId).toBe("candidate-refutation");
    expect(plan[1]).toMatchObject({
      skillDefinitionId: "closed-center-planning",
      skillFamilyId: "strategic-planning",
      evidenceScope: "pattern:closed-center",
    });
    const urgentOverlap = buildCurriculumPlan([
      pattern("piece-loss", { priority: 9, curriculum: { ...decideCurriculum(pattern()), action: "reteach" } }),
      pattern("forcing-reply", { priority: 8, curriculum: { ...decideCurriculum(pattern()), action: "reteach" } }),
      pattern("closed-center", { priority: 7 }),
    ]);
    expect(urgentOverlap.map((row) => row.patternId)).toEqual(["piece-loss", "forcing-reply"]);
  });
});
