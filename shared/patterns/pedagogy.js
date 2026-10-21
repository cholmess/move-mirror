export const PEDAGOGY_VERSION = "personal-pedagogy-v1";

export const HYPOTHESIS_CATEGORIES = [
  "reply_search",
  "candidate_comparison",
  "calculation_depth",
  "consequence_evaluation",
  "concept_recognition",
  "strategic_planning",
  "insufficient_evidence",
];

const CONFIDENCE = ["low", "medium"];

export const PEDAGOGY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["primaryHypothesis", "alternativeHypotheses", "teaching", "nextTest"],
  properties: {
    primaryHypothesis: {
      type: "object", additionalProperties: false,
      required: ["category", "statement", "confidence", "supportingEvidenceIds", "contradictingEvidenceIds"],
      properties: {
        category: { type: "string", enum: HYPOTHESIS_CATEGORIES },
        statement: { type: "string" },
        confidence: { type: "string", enum: CONFIDENCE },
        supportingEvidenceIds: { type: "array", items: { type: "string" } },
        contradictingEvidenceIds: { type: "array", items: { type: "string" } },
      },
    },
    alternativeHypotheses: {
      type: "array", maxItems: 2,
      items: {
        type: "object", additionalProperties: false, required: ["category", "statement"],
        properties: { category: { type: "string", enum: HYPOTHESIS_CATEGORIES }, statement: { type: "string" } },
      },
    },
    teaching: {
      type: "object", additionalProperties: false, required: ["objective", "explanation", "evidenceIds", "contrast"],
      properties: {
        objective: { type: "string" }, explanation: { type: "string" },
        evidenceIds: { type: "array", items: { type: "string" } },
        contrast: {
          type: "object", additionalProperties: false, required: ["worksWhen", "failsWhen", "evidenceIds"],
          properties: {
            worksWhen: { type: "string" }, failsWhen: { type: "string" },
            evidenceIds: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    nextTest: {
      type: "object", additionalProperties: false, required: ["skill", "instruction", "successSignal"],
      properties: {
        skill: { type: "string", enum: HYPOTHESIS_CATEGORIES },
        instruction: { type: "string" }, successSignal: { type: "string" },
      },
    },
  },
};

function shortText(value, max) {
  return typeof value === "string" && value.trim().length >= 2 && value.trim().length <= max;
}

function evidenceIds(value, allowed, { min = 0 } = {}) {
  return Array.isArray(value)
    && value.length >= min
    && value.length <= 8
    && value.every((id) => typeof id === "string" && allowed.has(id));
}

/** Rejects ungrounded prose and deliberately excludes a high-confidence state. */
export function validatePedagogyOutput(value, evidence) {
  const facts = evidence.map((item) => typeof item === "string" ? { evidenceId: item, kind: null } : item);
  const allowed = new Set(facts.map((item) => item.evidenceId));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_pedagogy_output");
  const primary = value.primaryHypothesis;
  const teaching = value.teaching;
  const nextTest = value.nextTest;
  if (!primary || !HYPOTHESIS_CATEGORIES.includes(primary.category)
    || !shortText(primary.statement, 400) || !CONFIDENCE.includes(primary.confidence)
    || !evidenceIds(primary.supportingEvidenceIds, allowed, { min: 1 })
    || !evidenceIds(primary.contradictingEvidenceIds, allowed)) throw new Error("invalid_pedagogy_output");
  if (!Array.isArray(value.alternativeHypotheses) || value.alternativeHypotheses.length > 2
    || value.alternativeHypotheses.some((row) => !HYPOTHESIS_CATEGORIES.includes(row?.category) || !shortText(row?.statement, 300))) {
    throw new Error("invalid_pedagogy_output");
  }
  if (!teaching || !shortText(teaching.objective, 240) || !shortText(teaching.explanation, 800)
    || !evidenceIds(teaching.evidenceIds, allowed, { min: 1 })
    || !teaching.contrast || !shortText(teaching.contrast.worksWhen, 400)
    || !shortText(teaching.contrast.failsWhen, 400)
    || !evidenceIds(teaching.contrast.evidenceIds, allowed, { min: 2 })) throw new Error("invalid_pedagogy_output");
  const kinds = new Map(facts.map((item) => [item.evidenceId, item.kind]));
  if (facts.some((item) => item.kind === "comparable_non_error")) {
    const contrastKinds = teaching.contrast.evidenceIds.map((id) => kinds.get(id));
    const hasNonError = contrastKinds.includes("comparable_non_error");
    const hasError = contrastKinds.some((kind) => ["player_decision", "similar_error"].includes(kind));
    if (!hasNonError || !hasError) throw new Error("invalid_pedagogy_output");
  }
  if (!nextTest || !HYPOTHESIS_CATEGORIES.includes(nextTest.skill)
    || !shortText(nextTest.instruction, 400) || !shortText(nextTest.successSignal, 300)) throw new Error("invalid_pedagogy_output");
  return structuredClone(value);
}

export function diagnosticQuestion(intervention) {
  if (intervention === "search") return "¿Qué intentabas conseguir con tu jugada y qué respuestas del rival alcanzaste a revisar antes de decidir?";
  if (intervention === "compare") return "¿Por qué esperabas esa respuesta del rival y qué otras defensas llegaste a comparar?";
  if (intervention === "evaluate") return "Viste una respuesta fuerte. ¿Cómo evaluabas la posición al final de esa variante y qué consecuencia considerabas favorable para ti?";
  if (intervention === "reinforce") return "Tu jugada fue válida. ¿Qué señal de la posición te llevó a elegirla y qué respuesta rival estabas tratando de neutralizar?";
  return "¿Qué intentabas conseguir, qué respuesta esperabas del rival y cómo evaluabas la posición resultante?";
}

export function fallbackPedagogy({ intervention, evidenceIds: ids }) {
  const first = ids[0];
  const contrast = ids.slice(0, 2);
  while (contrast.length < 2) contrast.push(first);
  const byIntervention = {
    search: ["reply_search", "Comprobar si buscas activamente la respuesta más exigente del rival.", "Antes de decidir, enumera los jaques, capturas y amenazas disponibles para el rival en la posición resultante."],
    compare: ["candidate_comparison", "Comparar tu respuesta prevista con otras defensas legales y fuertes.", "Después de tu candidata, busca una segunda defensa rival antes de cerrar el cálculo."],
    evaluate: ["consequence_evaluation", "Separar el cálculo de la evaluación de la posición final.", "Al terminar la variante, compara material, seguridad del rey y actividad antes de decidir."],
    reinforce: ["insufficient_evidence", "Comprobar si el mismo criterio se mantiene en otra posición.", "Explica qué señal reconociste y vuelve a buscar la respuesta más exigente del rival."],
    uncertain: ["insufficient_evidence", "Recoger evidencia verificable antes de atribuir una causa.", "Repite el proceso en otra posición y explica la variante que calculaste."],
  };
  const [category, objective, instruction] = byIntervention[intervention] ?? byIntervention.uncertain;
  return {
    primaryHypothesis: {
      category,
      statement: "La evidencia actual permite elegir qué comprobar, pero todavía no confirma por qué ocurrió el error.",
      confidence: "low",
      supportingEvidenceIds: [first],
      contradictingEvidenceIds: [],
    },
    alternativeHypotheses: [{ category: "insufficient_evidence", statement: "Las posiciones agrupadas podrían no compartir la misma causa." }],
    teaching: {
      objective,
      explanation: instruction,
      evidenceIds: [first],
      contrast: {
        worksWhen: "La candidata resiste la respuesta más exigente que pudiste verificar.",
        failsWhen: "La candidata depende de que el rival responda de una forma menos exigente.",
        evidenceIds: contrast,
      },
    },
    nextTest: { skill: category, instruction, successSignal: "Reconoce la exigencia de la posición sin ver el nombre del patrón ni recibir pistas." },
  };
}

export function applyHypothesisEvidence(hypothesis, evidence) {
  const next = structuredClone(hypothesis);
  next.observations ??= [];
  if (next.observations.some((row) => row.id === evidence.id)) return next;
  next.observations.push(evidence);
  const support = next.observations.filter((row) => row.direction === "support").length;
  const contradict = next.observations.filter((row) => row.direction === "contradict").length;
  next.confidence = contradict ? "low" : support >= 2 ? "medium" : "low";
  // Practice and holdout can adjust confidence, but only a later real game can support a causal hypothesis.
  next.status = support >= 2 && next.observations.some((row) => row.source === "real_game")
    ? "supported"
    : contradict >= 2 ? "contradicted" : "tentative";
  next.updatedAt = evidence.at;
  return next;
}
