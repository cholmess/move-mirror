import crypto from "node:crypto";

export const DEFENSE_SELECTION_VERSION = "defense-selection-v1";
export const DEFENSE_SELECTION_LIMIT = 24;
export const DEFENSE_MINIMUM_QUALITY_SCORE = 55;

export const DEFENSE_SELECTION_WEIGHTS = Object.freeze({
  threatConfidence: Object.freeze({ high: 30, medium: 20, low: 10 }),
  tacticalClarity: Object.freeze({
    forcingReply: 12,
    shortDefenseLine: 8,
    mediumDefenseLine: 5,
  }),
  engineStability: Object.freeze({
    deepVerified: 15,
    shallowVerified: 11,
    completeScore: 3,
  }),
  severity: Object.freeze({ critical: 15, marked: 10, notable: 6 }),
  motifConfidence: Object.freeze({ high: 10, medium: 7, low: 3 }),
  sourceQuality: Object.freeze({
    phase2_reproducible: 10,
    frozen_transfer_cohort: 10,
    baseline: 10,
  }),
  diversity: Object.freeze({
    newColor: 2,
    newPhase: 2,
    newResource: 3,
    newOpening: 1,
  }),
});

function confidenceScore(confidence, weights) {
  return weights[confidence] ?? weights.low ?? 0;
}

export function scoreDefenseCandidate(exercise) {
  const lineLength = exercise.defenseReferenceLineSan?.length ?? 0;
  const tacticalClarityScore =
    (exercise.actualPunishmentLineSan?.length >= 2
      ? DEFENSE_SELECTION_WEIGHTS.tacticalClarity.forcingReply
      : 0) +
    (lineLength > 0 && lineLength <= 6
      ? DEFENSE_SELECTION_WEIGHTS.tacticalClarity.shortDefenseLine
      : lineLength <= 10
        ? DEFENSE_SELECTION_WEIGHTS.tacticalClarity.mediumDefenseLine
        : 0);
  const budget = exercise.evaluation?.budgetId;
  const engineStabilityScore =
    (budget === "nodes-500k-v1"
      ? DEFENSE_SELECTION_WEIGHTS.engineStability.deepVerified
      : DEFENSE_SELECTION_WEIGHTS.engineStability.shallowVerified) +
    (exercise.evaluation?.before && exercise.evaluation?.afterActual
      ? DEFENSE_SELECTION_WEIGHTS.engineStability.completeScore
      : 0);
  const qualityScore = confidenceScore(
    exercise.opponentThreat?.confidence,
    DEFENSE_SELECTION_WEIGHTS.threatConfidence,
  );
  const severityScore =
    DEFENSE_SELECTION_WEIGHTS.severity[exercise.severity] ?? 0;
  const motifConfidenceScore = confidenceScore(
    exercise.motif?.confidence,
    DEFENSE_SELECTION_WEIGHTS.motifConfidence,
  );
  const sourceQualityScore =
    DEFENSE_SELECTION_WEIGHTS.sourceQuality[exercise.source?.sourceSet] ?? 0;
  const baseScore =
    qualityScore +
    tacticalClarityScore +
    engineStabilityScore +
    severityScore +
    motifConfidenceScore +
    sourceQualityScore;
  return {
    candidateId: exercise.id,
    qualityScore,
    tacticalClarityScore,
    engineStabilityScore,
    severityScore,
    motifConfidenceScore,
    sourceQualityScore,
    baseScore,
  };
}

function openingKey(exercise) {
  return exercise.source?.opening?.eco ?? null;
}

function diversityAdjustments(exercise, selected) {
  const colors = new Set(selected.map((item) => item.exercise.orientation));
  const phases = new Set(selected.map((item) => item.exercise.phase));
  const resources = new Set(selected.map((item) => item.exercise.motif.resource));
  const openings = new Set(selected.map((item) => openingKey(item.exercise)).filter(Boolean));
  const opening = openingKey(exercise);
  return {
    color: colors.has(exercise.orientation)
      ? 0
      : DEFENSE_SELECTION_WEIGHTS.diversity.newColor,
    phase: phases.has(exercise.phase)
      ? 0
      : DEFENSE_SELECTION_WEIGHTS.diversity.newPhase,
    resource: resources.has(exercise.motif.resource)
      ? 0
      : DEFENSE_SELECTION_WEIGHTS.diversity.newResource,
    opening:
      opening && !openings.has(opening)
        ? DEFENSE_SELECTION_WEIGHTS.diversity.newOpening
        : 0,
  };
}

function adjustmentTotal(adjustments) {
  return Object.values(adjustments).reduce((sum, value) => sum + value, 0);
}

function compareScored(a, b) {
  return b.finalScore - a.finalScore || a.candidateId.localeCompare(b.candidateId);
}

export function selectDefenseExercises(
  exercises,
  {
    limit = DEFENSE_SELECTION_LIMIT,
    minimumQualityScore = DEFENSE_MINIMUM_QUALITY_SCORE,
  } = {},
) {
  const uniqueGames = new Map();
  const duplicateGame = [];
  for (const exercise of [...exercises].sort((a, b) => a.id.localeCompare(b.id))) {
    const gameId = exercise.source.gameId;
    if (uniqueGames.has(gameId)) {
      duplicateGame.push(exercise);
    } else {
      uniqueGames.set(gameId, exercise);
    }
  }

  const scored = [...uniqueGames.values()].map((exercise) => ({
    exercise,
    ...scoreDefenseCandidate(exercise),
  }));
  const rejectedLowQuality = scored
    .filter((item) => item.baseScore < minimumQualityScore)
    .sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  const eligible = scored.filter((item) => item.baseScore >= minimumQualityScore);
  const remaining = new Map(eligible.map((item) => [item.candidateId, item]));
  const selected = [];

  while (selected.length < limit && remaining.size) {
    const rankedStep = [...remaining.values()]
      .map((item) => {
        const adjustments = diversityAdjustments(item.exercise, selected);
        return {
          ...item,
          diversityAdjustments: adjustments,
          finalScore: item.baseScore + adjustmentTotal(adjustments),
        };
      })
      .sort(compareScored);
    const winner = rankedStep[0];
    selected.push(winner);
    remaining.delete(winner.candidateId);
  }

  const selectedIds = new Set(selected.map((item) => item.candidateId));
  const eligibleNotSelected = eligible
    .filter((item) => !selectedIds.has(item.candidateId))
    .map((item) => {
      const adjustments = diversityAdjustments(item.exercise, selected);
      return {
        ...item,
        diversityAdjustments: adjustments,
        finalScore: item.baseScore + adjustmentTotal(adjustments),
      };
    })
    .sort(compareScored);
  const ordered = [...selected, ...eligibleNotSelected];
  const cutoff = selected.at(-1)?.finalScore ?? null;
  const ranking = ordered.map((item, index) => {
    const isSelected = index < selected.length;
    const categories = Object.entries(item.diversityAdjustments)
      .filter(([, value]) => value > 0)
      .map(([key]) => key);
    return {
      candidateId: item.candidateId,
      qualityScore: item.qualityScore,
      tacticalClarityScore: item.tacticalClarityScore,
      engineStabilityScore: item.engineStabilityScore,
      severityScore: item.severityScore,
      motifConfidenceScore: item.motifConfidenceScore,
      sourceQualityScore: item.sourceQualityScore,
      baseScore: item.baseScore,
      diversityAdjustments: item.diversityAdjustments,
      finalScore: item.finalScore,
      rank: index + 1,
      selected: isSelected,
      scoreDeltaFromCutoff:
        !isSelected && cutoff !== null ? item.finalScore - cutoff : null,
      diversityCategories: categories,
      selectionReason: isSelected
        ? `Seleccionado en el puesto ${index + 1}: calidad pedagógica ${item.baseScore} y ajuste de diversidad ${adjustmentTotal(item.diversityAdjustments)}.`
        : `Elegible, pero quedó en el puesto ${index + 1}. No fue seleccionado por la cuota de ${limit}${categories.length ? `; los ajustes de diversidad (${categories.join(", ")}) no compensaron la diferencia de calidad` : "; ya había cobertura suficiente de sus categorías"}.`,
    };
  });

  return {
    version: DEFENSE_SELECTION_VERSION,
    limit,
    minimumQualityScore,
    selected: selected.map((item) => item.exercise),
    eligibleNotSelected: eligibleNotSelected.map((item) => item.exercise),
    rejectedLowQuality: rejectedLowQuality.map((item) => item.exercise),
    duplicateGame,
    ranking,
  };
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function deterministicHash(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}
