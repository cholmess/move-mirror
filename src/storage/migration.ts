import type {
  AppStateV1,
  AppStateV2,
  AppStateV3,
  AppStateV4,
  AttemptRecord,
  LegacyAttemptResult,
} from "../types/learning";
import {
  APP_STATE_VERSION,
  EVAL_CRITERION_VERSION,
  PLAYER_USERNAME,
} from "../data/constants";
import { rebuildSkillsFromAttempts } from "../domain/profile";
import { createInitialSkills } from "../domain/profile";
import { calculateQualification } from "../domain/intervention";
import {
  INTERVENTION_LOG_VERSION,
  PATTERN_ID,
} from "../data/constants";

const STORAGE_V1 = "move-mirror-state-v1";
const STORAGE_V2 = "move-mirror-state-v2";
const STORAGE_V3 = "move-mirror-state-v3";
const STORAGE_V4 = "move-mirror-state-v4";
const BACKUP_V1 = "move-mirror-state-v1-backup";
const BACKUP_V2 = "move-mirror-state-v2-backup";
const BACKUP_V3 = "move-mirror-state-v3-backup";

function emptyDefenseLab(): AppStateV4["defenseLab"] {
  return {
    version: "defense-lab-state-v1",
    attempts: [],
    currentExerciseId: null,
    lastSelectionReason: null,
    sessionExerciseIds: [],
    updatedAt: null,
  };
}

export function mapLegacyResult(result: LegacyAttemptResult): AttemptRecord["evaluationStatus"] {
  switch (result) {
    case "correct":
      return "verified_best";
    case "correct_alternative":
      return "unverified";
    case "partial":
      return "unverified";
    case "incorrect":
      return "incorrect";
  }
}

export function migrateV1ToV2(v1: AppStateV1): AppStateV2 {
  const attempts: AttemptRecord[] = v1.attempts.map((a) => ({
    id: a.id,
    exerciseId: a.exerciseId,
    patternId: a.patternId,
    skillIds: a.skillIds,
    fen: a.fen,
    cct: a.cct,
    chosenMoveSan: a.chosenMoveSan,
    reasoning: a.reasoning,
    timeUsedSeconds: a.timeUsedSeconds,
    evaluationStatus: mapLegacyResult(a.result),
    result: a.result,
    evalLossCp: null,
    engineVersion: null,
    engineSha256: null,
    evalVerified: a.result === "correct" || a.result === "incorrect",
    observableReason: null,
    opponentReplySan: null,
    reflectionPrompt: null,
    attemptNumber: a.attemptNumber,
    foundOpponentForcedResponse: a.foundOpponentForcedResponse,
    recordedAt: a.recordedAt,
    lessonVersion: a.lessonVersion,
    evalCriterionVersion: EVAL_CRITERION_VERSION,
  }));

  const skills = rebuildSkillsFromAttempts(attempts);

  const exercisesCompleted = attempts
    .filter(
      (a) =>
        a.evaluationStatus === "verified_best" ||
        a.evaluationStatus === "verified_acceptable"
    )
    .map((a) => a.exerciseId)
    .filter((id, i, arr) => arr.indexOf(id) === i);

  return {
    version: 2,
    username: v1.username,
    attempts,
    skills,
    progress: {
      ...v1.progress,
      exercisesCompleted,
    },
    updatedAt: new Date().toISOString(),
    migrationNote: "migrated_from_v1_engine_validated_v2",
  };
}

export function migrateV2ToV3(v2: AppStateV2): AppStateV3 {
  const events = [];
  const incomplete: NonNullable<AppStateV3["migrationReport"]>["incomplete"] = [];
  if (v2.progress.lessonCompletedAt) {
    events.push({
      id: `migration:lesson-completed:${v2.progress.lessonCompletedAt}`,
      occurredAt: v2.progress.lessonCompletedAt,
      eventType: "lesson_completed" as const,
      patternId: PATTERN_ID,
      lessonVersion: null,
      exerciseId: null,
      attemptId: null,
      evaluationStatus: null,
      evalCriterionVersion: null,
      source: "migration" as const,
    });
  } else {
    incomplete.push({ kind: "lesson_completed", reason: "missing_persisted_completion_timestamp" });
  }
  for (const attempt of v2.attempts) {
    if (!attempt.recordedAt || Number.isNaN(Date.parse(attempt.recordedAt))) {
      incomplete.push({ kind: "exercise_confirmed", attemptId: attempt.id, reason: "missing_timestamp" });
      continue;
    }
    events.push({
      id: `migration:exercise-confirmed:${attempt.id}`,
      occurredAt: attempt.recordedAt,
      eventType: "exercise_confirmed" as const,
      patternId: attempt.patternId,
      lessonVersion: attempt.lessonVersion ?? null,
      exerciseId: attempt.exerciseId,
      attemptId: attempt.id,
      evaluationStatus: attempt.evaluationStatus,
      evalCriterionVersion: attempt.evalCriterionVersion ?? null,
      source: "migration" as const,
    });
  }
  const qualification = calculateQualification(events);
  return {
    ...v2,
    version: 3,
    interventionLogVersion: INTERVENTION_LOG_VERSION,
    pedagogyEvents: events,
    interventionQualification: qualification,
    migrationReport: {
      migratedAt: new Date().toISOString(),
      recoveredEventIds: events.map((event) => event.id),
      incomplete,
    },
    migrationNote: "migrated_from_v2_intervention_log_v1",
  };
}

export function migrateV3ToV4(v3: AppStateV3): AppStateV4 {
  return {
    ...v3,
    version: APP_STATE_VERSION,
    defenseLab: emptyDefenseLab(),
    migrationNote: "migrated_from_v3_defense_lab_state_v1",
  };
}

export function loadAndMigrate(): AppStateV4 {
  if (typeof localStorage === "undefined") {
    return createEmptyV2();
  }

  const v4raw = localStorage.getItem(STORAGE_V4);
  if (v4raw) {
    try {
      const parsed = JSON.parse(v4raw) as AppStateV4;
      if (parsed.version === APP_STATE_VERSION) return normalizeV4(parsed);
    } catch {
      /* fall through */
    }
  }

  const v3raw = localStorage.getItem(STORAGE_V3);
  if (v3raw) {
    try {
      const parsed = JSON.parse(v3raw) as AppStateV3;
      if (parsed.version === 3) {
        if (!localStorage.getItem(BACKUP_V3)) localStorage.setItem(BACKUP_V3, v3raw);
        const v4 = migrateV3ToV4(parsed);
        localStorage.setItem(STORAGE_V4, JSON.stringify(v4));
        return normalizeV4(v4);
      }
    } catch {
      /* fall through */
    }
  }

  const v2raw = localStorage.getItem(STORAGE_V2);
  if (v2raw) {
    try {
      const parsed = JSON.parse(v2raw) as AppStateV2;
      if (parsed.version === 2) {
        if (!localStorage.getItem(BACKUP_V2)) localStorage.setItem(BACKUP_V2, v2raw);
        const v3 = migrateV2ToV3(parsed);
        localStorage.setItem(STORAGE_V3, JSON.stringify(v3));
        const v4 = migrateV3ToV4(v3);
        localStorage.setItem(STORAGE_V4, JSON.stringify(v4));
        return v4;
      }
    } catch {
      /* fall through */
    }
  }

  const v1raw = localStorage.getItem(STORAGE_V1);
  if (v1raw) {
    try {
      const v1 = JSON.parse(v1raw) as AppStateV1;
      if (v1.version === 1) {
        if (!localStorage.getItem(BACKUP_V1)) {
          localStorage.setItem(BACKUP_V1, v1raw);
        }
        const v2 = migrateV1ToV2(v1);
        localStorage.setItem(STORAGE_V2, JSON.stringify(v2));
        const v3 = migrateV2ToV3(v2);
        localStorage.setItem(STORAGE_V3, JSON.stringify(v3));
        const v4 = migrateV3ToV4(v3);
        localStorage.setItem(STORAGE_V4, JSON.stringify(v4));
        return v4;
      }
    } catch {
      /* fall through */
    }
  }

  return createEmptyV2();
}

function createEmptyV2(): AppStateV4 {
  const qualification = calculateQualification([]);
  return {
    version: APP_STATE_VERSION,
    username: PLAYER_USERNAME,
    attempts: [],
    skills: createInitialSkills(),
    progress: {
      lessonCompletedAt: null,
      exercisesCompleted: [],
      currentExerciseId: null,
      lastSelectionReason: null,
      totalSessionMinutes: 0,
    },
    interventionLogVersion: INTERVENTION_LOG_VERSION,
    pedagogyEvents: [],
    interventionQualification: qualification,
    migrationReport: null,
    defenseLab: emptyDefenseLab(),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeV4(state: AppStateV4): AppStateV4 {
  const skills = rebuildSkillsFromAttempts(state.attempts);
  const interventionQualification = calculateQualification(
    state.pedagogyEvents ?? [],
    state.interventionQualification ?? null,
  );
  return {
    ...state,
    skills,
    interventionQualification,
    defenseLab: state.defenseLab ?? emptyDefenseLab(),
  };
}

export {
  STORAGE_V4,
  STORAGE_V3,
  STORAGE_V2,
  BACKUP_V3,
  BACKUP_V2,
  BACKUP_V1,
  STORAGE_V1,
};
