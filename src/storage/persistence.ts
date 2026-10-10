import { visibleSkills, type SkillId } from "../data/skills";
import type { AppState, AttemptRecord, UserProgress } from "../types/learning";
import { updateSkillsFromAttempt } from "../domain/profile";
import { selectNextExercise } from "../domain/adaptive";
import { PLAYER_USERNAME, APP_STATE_VERSION } from "../data/constants";
import { isSuccessForAdaptive } from "@shared/evaluation/classify.js";
import { loadAndMigrate, STORAGE_V2 } from "./migration";
import { createInitialSkills } from "../domain/profile";

const defaultProgress = (): UserProgress => ({
  lessonCompletedAt: null,
  exercisesCompleted: [],
  currentExerciseId: null,
  lastSelectionReason: null,
  totalSessionMinutes: 0,
});

export function createInitialState(): AppState {
  const base: AppState = {
    version: APP_STATE_VERSION,
    username: PLAYER_USERNAME,
    attempts: [],
    skills: createInitialSkills(),
    progress: defaultProgress(),
    updatedAt: new Date().toISOString(),
  };
  const selection = selectNextExercise(base);
  return {
    ...base,
    progress: {
      ...base.progress,
      currentExerciseId: selection.exercise.id,
      lastSelectionReason: selection.reasons.join(" · "),
    },
  };
}

export function loadState(): AppState {
  if (typeof localStorage === "undefined") return createInitialState();
  try {
    const parsed = loadAndMigrate();
    for (const s of visibleSkills) {
      if (!parsed.skills[s.id]) {
        parsed.skills[s.id] = createInitialSkills()[s.id];
      }
    }
    if (!parsed.progress.currentExerciseId) {
      const sel = selectNextExercise(parsed);
      parsed.progress.currentExerciseId = sel.exercise.id;
      parsed.progress.lastSelectionReason = sel.reasons.join(" · ");
    }
    return parsed;
  } catch {
    return createInitialState();
  }
}

export function saveState(state: AppState): void {
  const next = { ...state, updatedAt: new Date().toISOString() };
  localStorage.setItem(STORAGE_V2, JSON.stringify(next));
}

export function recordAttempt(
  state: AppState,
  attempt: Omit<AttemptRecord, "id" | "recordedAt">
): AppState {
  const full: AttemptRecord = {
    ...attempt,
    id: crypto.randomUUID(),
    recordedAt: new Date().toISOString(),
  };

  const attempts = [...state.attempts, full];
  const skills = updateSkillsFromAttempt(state.skills, full);

  const verifiedSuccess = isSuccessForAdaptive(full.evaluationStatus);
  const exercisesCompleted =
    verifiedSuccess &&
    !state.progress.exercisesCompleted.includes(attempt.exerciseId)
      ? [...state.progress.exercisesCompleted, attempt.exerciseId]
      : state.progress.exercisesCompleted;

  const interim: AppState = {
    ...state,
    attempts,
    skills,
    progress: {
      ...state.progress,
      exercisesCompleted,
    },
  };

  const selection = selectNextExercise(interim);

  return {
    ...interim,
    progress: {
      ...interim.progress,
      currentExerciseId: selection.exercise.id,
      lastSelectionReason: selection.reasons.join(" · "),
    },
  };
}

export function markLessonComplete(state: AppState): AppState {
  return {
    ...state,
    progress: {
      ...state.progress,
      lessonCompletedAt: new Date().toISOString(),
    },
  };
}

export function resetProgress(): AppState {
  const fresh = createInitialState();
  saveState(fresh);
  return fresh;
}

export function exportAttempts(state: AppState): string {
  return JSON.stringify(state.attempts, null, 2);
}

export type { SkillId };
