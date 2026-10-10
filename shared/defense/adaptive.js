import { isSuccessForAdaptive } from "../evaluation/classify.js";

export const DEFENSE_ADAPTIVE_VERSION = "defense-adaptive-v1";

export function scoreDefenseExercise(exercise, attempts, now = Date.now()) {
  const own = attempts.filter((attempt) => attempt.exerciseId === exercise.id);
  const failures = own.filter(
    (attempt) =>
      attempt.evaluationStatus === "incorrect" ||
      attempt.evaluationStatus === "playable_inexact" ||
      attempt.evaluationStatus === "unverified",
  ).length;
  const successes = own.filter((attempt) =>
    isSuccessForAdaptive(attempt.evaluationStatus),
  ).length;
  const last = own.at(-1);
  const ageDays = last
    ? Math.max(0, (now - Date.parse(last.confirmedAt)) / 86_400_000)
    : 30;
  const severity = { notable: 1, marked: 2, critical: 3 }[exercise.severity] ?? 1;
  const uncertainty = own.length < 2 ? 3 : 1 / Math.sqrt(own.length);
  return failures * 5 + severity * 2 + Math.min(ageDays, 30) / 10 + uncertainty - successes * 3;
}

export function selectDefenseExercise(exercises, attempts, sessionIds = [], now = Date.now()) {
  const activeExercises = exercises.filter(
    (exercise) => exercise.lifecycle !== "archived_not_selected",
  );
  const recent = attempts.slice(-2);
  const recentMotifs = recent.map((attempt) => attempt.motif);
  const recentColors = recent.map((attempt) => attempt.orientation);
  const sessionGames = new Set(
    attempts
      .filter((attempt) => sessionIds.includes(attempt.exerciseId))
      .map((attempt) => attempt.sourceGameId),
  );
  const pending = activeExercises.filter((exercise) => {
    if (sessionIds.includes(exercise.id)) return false;
    if (sessionGames.has(exercise.source.gameId)) return false;
    if (
      recentMotifs.length === 2 &&
      recentMotifs.every((motif) => motif === exercise.motif.resource)
    ) return false;
    if (
      recentColors.length === 2 &&
      recentColors.every((color) => color === exercise.orientation)
    ) return false;
    return true;
  });
  const candidates = pending.length
    ? pending
    : activeExercises.filter((item) => !sessionIds.includes(item.id));
  const unmastered = candidates.filter((exercise) => {
    const own = attempts.filter((attempt) => attempt.exerciseId === exercise.id);
    return own.length === 0 || own.some((attempt) => !isSuccessForAdaptive(attempt.evaluationStatus));
  });
  const ranked = (unmastered.length
    ? unmastered
    : candidates.length
      ? candidates
      : activeExercises)
    .map((exercise) => ({
      exercise,
      score: scoreDefenseExercise(exercise, attempts, now),
    }))
    .sort((a, b) => b.score - a.score || a.exercise.id.localeCompare(b.exercise.id));
  const selected = ranked[0]?.exercise ?? null;
  if (!selected) return { exercise: null, reason: "No hay posiciones elegibles." };

  const own = attempts.filter((attempt) => attempt.exerciseId === selected.id);
  const failed = own.some((attempt) => !isSuccessForAdaptive(attempt.evaluationStatus));
  const reason = failed
    ? `Elegimos esta posición porque una defensa de ${selected.motif.resource} todavía necesita revisión.`
    : `Elegimos esta posición por su severidad y porque aún hay poca evidencia de dominio en ${selected.motif.resource}.`;
  return { exercise: selected, reason };
}
