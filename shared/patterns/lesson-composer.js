import { skillDefinitionFor } from "./skill-definitions.js";

export const PERSONAL_LESSON_VERSION = "personal-lesson-v2";

const METHOD_BY_ACTION = {
  diagnose: "discriminating_probe",
  reteach: "worked_contrast",
  revise_hypothesis: "alternative_probe",
  bridge_transfer: "game_like_retrieval",
  maintenance: "spaced_retrieval",
};

function distinctGames(records, limit) {
  const seen = new Set();
  const selected = [];
  for (const record of records) {
    if (seen.has(record.gameId)) continue;
    seen.add(record.gameId);
    selected.push(record);
    if (selected.length === limit) break;
  }
  return selected;
}

function severity(loss) {
  if ((loss ?? 0) >= 300) return "high";
  if ((loss ?? 0) >= 150) return "medium";
  return "low";
}

function evidenceReference(record, kind) {
  return {
    evidenceId: `${kind}:${record.exerciseId}`,
    kind,
    gameId: record.gameId,
    moveNumber: record.moveNumber,
    recordId: record.exerciseId,
    severity: kind === "personal_error" ? severity(record.loss) : null,
  };
}

/**
 * Compiles a bounded, spoiler-free lesson from verified personal evidence.
 * Engine moves, FENs and reference lines deliberately never enter this DTO.
 */
export function composePersonalLesson({ pattern, hypothesis, curriculum, records, guided, holdout, at }) {
  const skill = skillDefinitionFor(pattern.id);
  const sessionRecords = [...guided, holdout].filter(Boolean);
  if (sessionRecords.some((row) => row.patternId !== pattern.id)) {
    throw new Error("lesson_evidence_scope_mismatch");
  }
  const sessionIds = new Set([...guided, holdout].filter(Boolean).map((row) => row.exerciseId));
  const errors = records
    .filter((row) => row.patternId === pattern.id)
    .sort((a, b) => (sessionIds.has(a.exerciseId) ? 1 : 0) - (sessionIds.has(b.exerciseId) ? 1 : 0)
      || (b.loss ?? 0) - (a.loss ?? 0)
      || String(a.gameId).localeCompare(String(b.gameId)));
  const examples = distinctGames(errors, 3).map((row) => evidenceReference(row, "personal_error"));
  const contrasts = distinctGames(records
    .filter((row) => row.patternId !== pattern.id && row.opportunities?.includes(pattern.id))
    .sort((a, b) => String(a.gameId).localeCompare(String(b.gameId)) || (a.moveNumber ?? 0) - (b.moveNumber ?? 0)), 1)
    .map((row) => evidenceReference(row, "comparable_non_error"));
  const teachingEvidence = new Set([
    ...(hypothesis?.teaching?.evidenceIds ?? []),
    ...(hypothesis?.teaching?.contrast?.evidenceIds ?? []),
  ]);
  const citations = (hypothesis?.grounding ?? [])
    .filter((row) => teachingEvidence.has(row.evidenceId) && row.gameId)
    .map(({ evidenceId, kind, gameId, moveNumber }) => ({ evidenceId, kind, gameId, moveNumber }));
  const narrative = hypothesis ? {
    hypothesisId: hypothesis.id,
    category: hypothesis.category,
    status: hypothesis.status,
    statement: hypothesis.statement,
    objective: hypothesis.teaching?.objective ?? hypothesis.teachingObjective ?? null,
    explanation: hypothesis.teaching?.explanation ?? null,
    nextTest: hypothesis.nextTest ?? null,
    source: hypothesis.synthesisSource ?? "rules",
    sourceReflectionId: hypothesis.sourceReflectionId ?? null,
    citations,
  } : null;
  return {
    version: PERSONAL_LESSON_VERSION,
    patternId: pattern.id,
    skill,
    createdAt: at,
    action: curriculum.action,
    method: METHOD_BY_ACTION[curriculum.action],
    targetCategory: curriculum.targetCategory,
    narrative,
    evidence: {
      errors: pattern.errors,
      games: pattern.games,
      opportunities: pattern.opportunities,
      confidence: pattern.confidence,
      examples,
      contrast: contrasts[0] ?? null,
    },
    sequence: {
      guidedPositions: guided.length,
      blindHoldout: Boolean(holdout),
      positionRecordIds: guided.map((row) => row.exerciseId),
    },
    success: {
      practice: "process_observed",
      generalization: "independent_blind_holdout",
      transfer: "later_unexposed_games",
      causal: false,
    },
    spoilerPolicy: curriculum.action === "bridge_transfer" ? "game_like_hidden" : "teaching_visible",
  };
}
