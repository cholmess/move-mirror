import { visibleSkills, type SkillId } from "../data/skills";
import type { AppState, AttemptRecord, UserProgress } from "../types/learning";
import type { DefenseAttempt } from "../types/defense";
import { updateSkillsFromAttempt } from "../domain/profile";
import { selectNextExercise } from "../domain/adaptive";
import {
  PLAYER_USERNAME,
  APP_STATE_VERSION,
  INTERVENTION_LOG_VERSION,
  LESSON_VERSION,
} from "../data/constants";
import { isSuccessForAdaptive } from "@shared/evaluation/classify.js";
import { loadAndMigrate, STORAGE_V4 } from "./migration";
import { createInitialSkills } from "../domain/profile";
import { appendPedagogyEvent, calculateQualification, pedagogyEvent } from "../domain/intervention";

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
    interventionLogVersion: INTERVENTION_LOG_VERSION,
    pedagogyEvents: [],
    interventionQualification: calculateQualification([]),
    defenseLab: {
      version: "defense-lab-state-v1",
      attempts: [],
      currentExerciseId: null,
      lastSelectionReason: null,
      sessionExerciseIds: [],
      updatedAt: null,
    },
    migrationReport: null,
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
  localStorage.setItem(STORAGE_V4, JSON.stringify(next));
}

export function recordDefenseAttempt(
  state: AppState,
  attempt: DefenseAttempt,
  nextExerciseId: string | null,
  selectionReason: import("../types/defense").DefenseSelectionReasonPayload | null,
): AppState {
  return {
    ...state,
    defenseLab: {
      ...state.defenseLab,
      attempts: [...state.defenseLab.attempts, attempt],
      currentExerciseId: nextExerciseId,
      lastSelectionReason: selectionReason,
      sessionExerciseIds: state.defenseLab.sessionExerciseIds.includes(attempt.exerciseId)
        ? state.defenseLab.sessionExerciseIds
        : [...state.defenseLab.sessionExerciseIds, attempt.exerciseId],
      updatedAt: attempt.confirmedAt,
    },
  };
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
  const now = full.recordedAt;
  const sessionId = activeTrainingSessionId(now);
  let pedagogyEvents = appendPedagogyEvent(
    state.pedagogyEvents,
    pedagogyEvent({
      id: `training-session:${sessionId}:started`,
      occurredAt: sessionStartedAt(sessionId, now),
      eventType: "training_session_started",
      lessonVersion: LESSON_VERSION,
      exerciseId: null,
      attemptId: null,
      evaluationStatus: null,
      evalCriterionVersion: null,
    }),
  );
  pedagogyEvents = appendPedagogyEvent(
    pedagogyEvents,
    pedagogyEvent({
      id: `exercise-confirmed:${full.id}`,
      occurredAt: now,
      eventType: "exercise_confirmed",
      patternId: full.patternId,
      lessonVersion: full.lessonVersion,
      exerciseId: full.exerciseId,
      attemptId: full.id,
      evaluationStatus: full.evaluationStatus,
      evalCriterionVersion: full.evalCriterionVersion,
    }),
  );

  if (full.practiceMode === "direct") pedagogyEvents = state.pedagogyEvents;
  const attempts = [...state.attempts, full];
  const skills = full.assisted || (full.practiceMode === "direct" && !full.evalVerified) ? state.skills : updateSkillsFromAttempt(state.skills, full);

  const verifiedSuccess = !full.assisted && isSuccessForAdaptive(full.evaluationStatus);
  const exercisesCompleted =
    verifiedSuccess &&
    !state.progress.exercisesCompleted.includes(attempt.exerciseId)
      ? [...state.progress.exercisesCompleted, attempt.exerciseId]
      : state.progress.exercisesCompleted;

  const interim: AppState = {
    ...state,
    attempts,
    skills,
    pedagogyEvents,
    interventionQualification: calculateQualification(
      pedagogyEvents,
      state.interventionQualification,
    ),
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
  const occurredAt = state.progress.lessonCompletedAt ?? new Date().toISOString();
  const pedagogyEvents = appendPedagogyEvent(
    state.pedagogyEvents,
    pedagogyEvent({
      id: `lesson-completed:${LESSON_VERSION}`,
      occurredAt,
      eventType: "lesson_completed",
      lessonVersion: LESSON_VERSION,
      exerciseId: null,
      attemptId: null,
      evaluationStatus: null,
      evalCriterionVersion: null,
    }),
  );
  return {
    ...state,
    pedagogyEvents,
    interventionQualification: calculateQualification(
      pedagogyEvents,
      state.interventionQualification,
    ),
    progress: {
      ...state.progress,
      lessonCompletedAt: occurredAt,
    },
  };
}

export function markLessonStarted(state: AppState): AppState {
  if (state.pedagogyEvents.some((event) => event.id === `lesson-started:${LESSON_VERSION}`)) return state;
  const pedagogyEvents = appendPedagogyEvent(
    state.pedagogyEvents,
    pedagogyEvent({
      id: `lesson-started:${LESSON_VERSION}`,
      occurredAt: new Date().toISOString(),
      eventType: "lesson_started",
      lessonVersion: LESSON_VERSION,
      exerciseId: null,
      attemptId: null,
      evaluationStatus: null,
      evalCriterionVersion: null,
    }),
  );
  return { ...state, pedagogyEvents };
}

export function resetProgress(): AppState {
  const fresh = createInitialState();
  saveState(fresh);
  return fresh;
}

export function exportAttempts(state: AppState): string {
  return JSON.stringify({
    version: APP_VERSION_FOR_EXPORT,
    state,
    attempts: state.attempts,
    pedagogyEvents: state.pedagogyEvents,
    interventionQualification: state.interventionQualification,
  }, null, 2);
}

export function importState(serialized: string): AppState {
  const parsed = JSON.parse(serialized) as { state?: AppState } | AppState;
  const candidate = "state" in parsed && parsed.state ? parsed.state : parsed as AppState;
  if (candidate.version !== APP_STATE_VERSION || !Array.isArray(candidate.pedagogyEvents)) {
    throw new Error("unsupported_state_export");
  }
  return {
    ...candidate,
    interventionQualification: calculateQualification(
      candidate.pedagogyEvents,
      candidate.interventionQualification,
    ),
  };
}

const APP_VERSION_FOR_EXPORT = "0.4.1";
const SESSION_KEY = "move-mirror-training-session-v1";
const SESSION_STARTED_KEY = "move-mirror-training-session-started-v1";

function activeTrainingSessionId(now: string): string {
  if (typeof sessionStorage === "undefined") return `runtime-${now}`;
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, id);
    sessionStorage.setItem(SESSION_STARTED_KEY, now);
  }
  return id;
}

function sessionStartedAt(_id: string, fallback: string): string {
  if (typeof sessionStorage === "undefined") return fallback;
  return sessionStorage.getItem(SESSION_STARTED_KEY) ?? fallback;
}

export type { SkillId };
