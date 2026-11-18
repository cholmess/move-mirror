export const SKILL_DEFINITION_VERSION = "personal-skill-definitions-v1";

const DEFINITIONS = {
  "piece-loss": {
    id: "material-safety",
    familyId: "candidate-refutation",
    kind: "tactical_process",
    objectiveKey: "catalog.piece-loss.goal",
    observableKey: "catalog.piece-loss.observation",
    diagnosticCategories: ["reply_search", "candidate_comparison", "consequence_evaluation"],
  },
  "forcing-reply": {
    id: "hostile-reply-search",
    familyId: "candidate-refutation",
    kind: "tactical_process",
    objectiveKey: "catalog.forcing-reply.goal",
    observableKey: "catalog.forcing-reply.observation",
    diagnosticCategories: ["reply_search", "calculation_depth", "consequence_evaluation"],
  },
  "missed-capture": {
    id: "forcing-capture-search",
    familyId: "forcing-moves",
    kind: "tactical_process",
    objectiveKey: "catalog.missed-capture.goal",
    observableKey: "catalog.missed-capture.observation",
    diagnosticCategories: ["candidate_comparison", "calculation_depth", "consequence_evaluation"],
  },
  "missed-mate": {
    id: "forcing-mate-search",
    familyId: "forcing-moves",
    kind: "tactical_process",
    objectiveKey: "catalog.missed-mate.goal",
    observableKey: "catalog.missed-mate.observation",
    diagnosticCategories: ["concept_recognition", "calculation_depth", "consequence_evaluation"],
  },
  "closed-center": {
    id: "closed-center-planning",
    familyId: "strategic-planning",
    kind: "strategic_process",
    objectiveKey: "catalog.closed-center.goal",
    observableKey: "catalog.closed-center.observation",
    diagnosticCategories: ["strategic_planning", "concept_recognition", "consequence_evaluation"],
  },
  "endgame-decisions": {
    id: "low-material-decision-making",
    familyId: "endgame-technique",
    kind: "technical_process",
    objectiveKey: "catalog.endgame-decisions.goal",
    observableKey: "catalog.endgame-decisions.observation",
    diagnosticCategories: ["concept_recognition", "calculation_depth", "consequence_evaluation"],
  },
};

export function skillDefinitionFor(patternId) {
  const definition = DEFINITIONS[patternId];
  if (!definition) throw new Error("skill_definition_unknown");
  return {
    version: SKILL_DEFINITION_VERSION,
    patternId,
    evidenceScope: `pattern:${patternId}`,
    observableOnly: true,
    ...definition,
  };
}

export function skillDefinitions() {
  return Object.keys(DEFINITIONS).map(skillDefinitionFor);
}
