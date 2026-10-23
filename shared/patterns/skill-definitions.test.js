import { describe, expect, it } from "vitest";
import { PATTERNS } from "./catalog.js";
import { skillDefinitionFor, skillDefinitions } from "./skill-definitions.js";

describe("personal skill definitions", () => {
  it("versions every detectable pattern with an isolated evidence scope", () => {
    expect(skillDefinitions().map((row) => row.patternId).sort())
      .toEqual(PATTERNS.map((row) => row.id).sort());
    for (const pattern of PATTERNS) {
      expect(skillDefinitionFor(pattern.id)).toMatchObject({
        patternId: pattern.id,
        evidenceScope: `pattern:${pattern.id}`,
        observableOnly: true,
      });
    }
  });

  it("defines blocked-center planning as a real non-tactical second focus", () => {
    const first = skillDefinitionFor("piece-loss");
    const second = skillDefinitionFor("closed-center");
    expect(second).toMatchObject({
      id: "closed-center-planning",
      familyId: "strategic-planning",
      kind: "strategic_process",
      diagnosticCategories: ["strategic_planning", "concept_recognition", "consequence_evaluation"],
    });
    expect(second.familyId).not.toBe(first.familyId);
    expect(second.evidenceScope).not.toBe(first.evidenceScope);
  });
});
