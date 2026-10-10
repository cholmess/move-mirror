import type { DefenseAttempt, DefensiveResource } from "../types/defense";

export function buildDefenseProfile(attempts: DefenseAttempt[]) {
  const latestByExercise = new Map<string, DefenseAttempt>();
  for (const attempt of attempts) latestByExercise.set(attempt.exerciseId, attempt);
  const positions = [...latestByExercise.values()];
  const verified = positions.filter((attempt) =>
    ["verified_best", "verified_acceptable", "playable_inexact", "incorrect"].includes(
      attempt.evaluationStatus,
    ),
  );
  const acceptable = verified.filter((attempt) =>
    ["verified_best", "verified_acceptable"].includes(attempt.evaluationStatus),
  );
  const byResource = new Map<DefensiveResource, { attempts: number; errors: number }>();
  for (const attempt of positions) {
    const entry = byResource.get(attempt.motif) ?? { attempts: 0, errors: 0 };
    entry.attempts += 1;
    if (!["verified_best", "verified_acceptable"].includes(attempt.evaluationStatus)) {
      entry.errors += 1;
    }
    byResource.set(attempt.motif, entry);
  }
  const weakest = [...byResource.entries()].sort(
    (a, b) => b[1].errors / b[1].attempts - a[1].errors / a[1].attempts,
  )[0];
  const games = new Set(positions.map((attempt) => attempt.sourceGameId)).size;
  const sessions = new Set(positions.map((attempt) => attempt.sessionId)).size;
  const evidenceEnough = positions.length >= 5 && games >= 3 && sessions >= 2;
  const sample = positions.length;
  const confidence = sample >= 12 && games >= 6 && sessions >= 3
    ? "alta"
    : evidenceEnough
      ? "media"
      : "baja";
  const last = attempts.at(-1)?.confirmedAt ?? null;
  const nextReviewAt = last
    ? new Date(Date.parse(last) + 3 * 86_400_000).toISOString()
    : null;
  return {
    positionsAttempted: positions.length,
    verifiedResults: verified.length,
    acceptableRate: verified.length ? acceptable.length / verified.length : 0,
    resourcesPracticed: [...byResource.keys()],
    weakestResource: weakest?.[0] ?? null,
    weakestStats: weakest?.[1] ?? null,
    games,
    sessions,
    lastPracticeAt: last,
    nextReviewAt,
    evidenceEnough,
    confidence,
    observation: weakest
      ? `Fallaste ${weakest[1].errors} de ${weakest[1].attempts} posiciones de ${weakest[0]}.`
      : "Todavía no hay intentos defensivos.",
    hypothesis: evidenceEnough && weakest
      ? `Podrías estar omitiendo el recurso ${weakest[0]} al verificar la respuesta rival.`
      : "Aún no hay volumen suficiente para formular una nueva debilidad.",
  };
}
