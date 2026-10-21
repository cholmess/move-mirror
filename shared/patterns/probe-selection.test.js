import { describe, expect, it } from "vitest";
import { classifyProbeObservation, planHypothesisProbe } from "./probe-selection.js";

const fen = (file) => `4k3/8/8/8/8/8/${{ a: "P7", b: "1P6", c: "2P5" }[file]}/4K3 w - - 0 1`;
const rows = [
  { exerciseId: "forcing", fen: fen("a"), loss: 250, replyUci: "e8e7", replySan: "Kxe7+", referencePv: ["a2a3", "e8e7"] },
  { exerciseId: "deep", fen: fen("b"), loss: 230, replyUci: "e8e7", replySan: "Ke7", referencePv: ["b2b3", "e8e7", "e1e2", "e7e6"] },
  { exerciseId: "closed", fen: fen("c"), loss: 210, replyUci: "e8e7", replySan: "Ke7", referencePv: ["c2c3"], context: { closed: true } },
];
const hypothesis = {
  id: "h1", category: "reply_search",
  alternatives: [{ category: "calculation_depth" }, { category: "strategic_planning" }],
};

describe("hypothesis probe planning", () => {
  it("assigns distinct positions to the primary cause and alternatives", () => {
    const result = planHypothesisProbe(rows, hypothesis, []);
    expect(result.ordered.map((row) => row.exerciseId)).toEqual(["forcing", "deep", "closed"]);
    expect(result.plan.slots.map((slot) => [slot.recordId, slot.targetCategory, slot.measurability])).toEqual([
      ["forcing", "reply_search", "direct"],
      ["deep", "calculation_depth", "partial"],
      ["closed", "strategic_planning", "partial"],
    ]);
  });

  it("prefers unseen evidence and leaves no plan without a hypothesis", () => {
    const exposed = [{ positionKey: rows[0].fen.split(" ").slice(0, 4).join(" ") }];
    const result = planHypothesisProbe(rows.slice(0, 2), { id: "h", category: "reply_search", alternatives: [] }, exposed);
    expect(result.ordered[0].exerciseId).toBe("deep");
    expect(planHypothesisProbe(rows, null, []).plan).toBeNull();
  });

  it("supports only an observed primary signature and contradicts with a named alternative", () => {
    const slot = { targetCategory: "reply_search", measurability: "direct" };
    expect(classifyProbeObservation({ coaching: { intervention: "search" } }, hypothesis, slot)).toMatchObject({ observedCategory: "reply_search", direction: "support" });
    expect(classifyProbeObservation({ coaching: { intervention: "evaluate" } }, { ...hypothesis, alternatives: [{ category: "consequence_evaluation" }] }, slot)).toMatchObject({ observedCategory: "consequence_evaluation", direction: "contradict" });
    expect(classifyProbeObservation({ coaching: { intervention: "reinforce" } }, hypothesis, slot).direction).toBe("inconclusive");
  });
});
