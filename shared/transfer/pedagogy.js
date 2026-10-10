import {
  EXERCISE_QUALITY_ID,
  LANGUAGE_POLICY_ID,
  PEDAGOGY_POLICY_ID,
} from "./constants.js";

export function summarizeTraining(summary = {}) {
  const verifiedBest = summary.verified_best ?? 0;
  const verifiedAcceptable = summary.verified_acceptable ?? 0;
  const playable = summary.playable_inexact ?? 0;
  const incorrect = summary.incorrect ?? 0;
  const unverified = summary.unverified ?? 0;
  const success = verifiedBest + verifiedAcceptable;
  const attempts = summary.attempts ?? verifiedBest + verifiedAcceptable + playable + incorrect + unverified;
  const mastery = summary.mastery ?? null;
  return {
    verified_best: verifiedBest,
    verified_acceptable: verifiedAcceptable,
    playable_inexact: playable,
    incorrect,
    unverified,
    attempts,
    success,
    mastery,
    nextReviewAt: summary.nextReviewAt ?? null,
    improving: success >= 2 && success > incorrect,
    strong: mastery !== null && mastery >= 0.7 && success >= 3 && success > incorrect,
    weak: attempts >= 3 && ((mastery !== null && mastery < 0.45) || incorrect > success),
  };
}

export function patternPersists(comparison) {
  if (!comparison) return false;
  if (comparison.status === "insufficient_data" || comparison.status === "observed_improvement") return false;
  return (comparison.transfer?.events ?? 0) > 0;
}

function candidateFor(comparison) {
  const transfer = comparison?.transfer;
  if (!transfer || transfer.pieceCaptureEvents < 3) return null;
  const share = transfer.events ? transfer.pieceCaptureEvents / transfer.events : 0;
  if (share < 0.25) return null;
  return {
    id: "allowed-piece-capture-review",
    note: "Candidato para revisión futura: en varios eventos la respuesta del rival captura una pieza. v0.3 no abre esa lección.",
    teachAutomatically: false,
  };
}

/**
 * @param {{ training?: object, comparison?: { status?: string, transfer?: { events?: number, pieceCaptureEvents?: number } } | null, previousAction?: string | null }} input
 */
export function decidePedagogy({ training, comparison, previousAction = null }) {
  const profile = summarizeTraining(training);
  const persists = patternPersists(comparison);
  const candidate = candidateFor(comparison);
  const base = {
    policyId: PEDAGOGY_POLICY_ID,
    languagePolicyId: LANGUAGE_POLICY_ID,
    candidate,
    replacesLesson: false,
    teachNewPattern: false,
    updatesExerciseAlphaBeta: false,
  };

  if (profile.weak) {
    return {
      ...base,
      action: "return_to_basics",
      title: "Volver a ejemplos básicos",
      explanation:
        "En los ejercicios los errores pesan más que los aciertos verificados. Es conveniente volver a ejemplos básicos de CCT + refutación.",
    };
  }

  if (comparison?.status === "observed_improvement" && profile.strong && previousAction === "space_practice") {
    return {
      ...base,
      action: "propose_next_pattern",
      title: "Proponer evaluar el siguiente patrón",
      explanation:
        "La lección actual ya muestra mejor desempeño posterior y la práctica está espaciada. Es conveniente proponer evaluar el siguiente patrón en una revisión futura. Esta versión no lo enseña ni reemplaza la lección.",
    };
  }

  if (comparison?.status === "observed_improvement" && profile.strong) {
    return {
      ...base,
      action: "space_practice",
      title: "Espaciar la práctica",
      explanation:
        "El patrón disminuye también en partidas nuevas. Es mejor desempeño posterior, no una mejora causada por MoveMirror. Es conveniente espaciar esta lección.",
    };
  }

  if (profile.strong && persists) {
    return {
      ...base,
      action: "increase_difficulty",
      title: "Aumentar dificultad",
      explanation:
        "Buen rendimiento en ejercicios, pero el patrón persiste en juego real. Es conveniente mantener el tema y aumentar la dificultad.",
    };
  }

  const improvingGap =
    profile.improving && comparison?.status === "insufficient_data"
      ? "Mejoras en ejercicios, aún sin datos suficientes en partidas. "
      : "";
  return {
    ...base,
    action: "continue_cct",
    title: "Continuar con CCT + refutación",
    explanation: `${improvingGap}Es conveniente mantener esta lección y continuar con CCT + refutación.`,
  };
}

/**
 * @param {{ training?: object, comparison?: { status?: string, transfer?: { events?: number } } | null, pedagogy?: { explanation?: string } | null }} input
 * @returns {string[]}
 */
export function combinedNarrative({ training, comparison, pedagogy }) {
  const profile = summarizeTraining(training);
  const lines = [];
  if (profile.improving && comparison?.status === "insufficient_data") {
    lines.push("Mejoras en ejercicios, aún sin datos suficientes en partidas.");
  }
  if (comparison?.status === "observed_improvement") {
    lines.push("El patrón disminuye también en partidas nuevas.");
  }
  if (profile.strong && patternPersists(comparison)) {
    lines.push("Buen rendimiento en ejercicios, pero el patrón persiste en juego real.");
  }
  if (pedagogy?.explanation) lines.push(pedagogy.explanation);
  return lines;
}

export function buildTransferChannel(comparison, { syncedAt = null } = {}) {
  if (!comparison) {
    return {
      source: "real-games",
      writesExerciseAlphaBeta: false,
      syncedAt,
      status: "insufficient_data",
      label: "Datos insuficientes",
    };
  }
  return {
    source: "real-games",
    writesExerciseAlphaBeta: false,
    syncedAt,
    detectorId: comparison.detectorId,
    status: comparison.status,
    label: comparison.label,
    eventsPer100: comparison.transfer?.eventsPer100 ?? null,
    baselinePer100: comparison.baseline?.eventsPer100 ?? null,
    absoluteDifference: comparison.absoluteDifference,
    relativeDifference: comparison.relativeDifference,
    interval: comparison.interval,
    sample: comparison.sample,
    severity: comparison.transfer?.severity ?? null,
    gamesAffected: comparison.transfer?.gamesAffected ?? 0,
    gamesAnalyzed: comparison.transfer?.gamesAnalyzed ?? 0,
    confidence: comparison.label,
  };
}

export function combineChannels({ exerciseSkills, training, comparison, syncedAt = null }) {
  const transfer = buildTransferChannel(comparison, { syncedAt });
  const pedagogy = decidePedagogy({ training, comparison });
  return {
    exerciseSkills,
    training: summarizeTraining(training),
    transfer,
    narrative: combinedNarrative({ training, comparison, pedagogy }),
    pedagogy,
    transferWritesAlpha: false,
  };
}

export function assertCohortMutable(cohort) {
  if (cohort?.frozen) throw new Error("cohort_frozen");
}

export function freezeCohort(cohort, metrics, frozenAt) {
  assertCohortMutable(cohort);
  if ((cohort.pendingDecisions ?? 0) > 0) throw new Error("analysis_incomplete");
  if (!metrics) throw new Error("metrics_missing");
  return {
    ...cohort,
    frozen: true,
    frozenAt,
    metrics,
    pendingDecisions: 0,
  };
}

export function remeasureFrozen() {
  throw new Error("cohort_frozen");
}

export function promoteExerciseCandidate({ cohort, decision, existing = [] }) {
  if (!cohort?.frozen) throw new Error("cohort_not_frozen");
  if (!decision?.event) throw new Error("quality_not_event");
  if (!(decision.loss >= 120)) throw new Error("quality_loss");
  if (!decision.reply?.forcing) throw new Error("quality_not_forcing");
  const already = existing.filter(
    (item) => item.cohortId === cohort.id && item.gameId === decision.gameId
  );
  if (already.length >= 1) throw new Error("quality_max_per_game");
  if (existing.some((item) => item.key === decision.key)) throw new Error("quality_duplicate");
  return {
    id: `cand-${decision.key}`,
    key: decision.key,
    gameId: decision.gameId,
    url: decision.url ?? null,
    cohortId: cohort.id,
    fen: decision.fenBefore,
    moveUci: decision.moveUci,
    moveSan: decision.moveSan ?? null,
    ply: decision.ply,
    color: decision.color,
    severity: decision.severity,
    qualityId: EXERCISE_QUALITY_ID,
    excludedFromCohortRemeasurement: true,
    autoAddedToTrainer: false,
    accepted: true,
  };
}

export function examplesForCohort(cohort, decisions) {
  if (!cohort?.frozen) throw new Error("examples_locked");
  return (decisions ?? []).filter((row) => row.event);
}
