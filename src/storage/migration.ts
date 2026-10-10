import type {
  AppStateV1,
  AppStateV2,
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

const STORAGE_V1 = "move-mirror-state-v1";
const STORAGE_V2 = "move-mirror-state-v2";
const BACKUP_V1 = "move-mirror-state-v1-backup";

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
    version: APP_STATE_VERSION,
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

export function loadAndMigrate(): AppStateV2 {
  if (typeof localStorage === "undefined") {
    return createEmptyV2();
  }

  const v2raw = localStorage.getItem(STORAGE_V2);
  if (v2raw) {
    try {
      const parsed = JSON.parse(v2raw) as AppStateV2;
      if (parsed.version === APP_STATE_VERSION) {
        return normalizeV2(parsed);
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
        return v2;
      }
    } catch {
      /* fall through */
    }
  }

  return createEmptyV2();
}

function createEmptyV2(): AppStateV2 {
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
    updatedAt: new Date().toISOString(),
  };
}

function normalizeV2(state: AppStateV2): AppStateV2 {
  const skills = rebuildSkillsFromAttempts(state.attempts);
  return { ...state, skills };
}

export { STORAGE_V2, BACKUP_V1, STORAGE_V1 };
