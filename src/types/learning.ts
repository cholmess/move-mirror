import type { SkillId } from "../data/skills";
import type { EvaluationStatus } from "@shared/evaluation/types";
import { APP_STATE_VERSION } from "../data/constants";

export type { EvaluationStatus };

/** @deprecated v0.1 — solo en migración */
export type LegacyAttemptResult =
  | "correct"
  | "correct_alternative"
  | "incorrect"
  | "partial";

export interface CctCapture {
  checksConsidered: string;
  capturesConsidered: string;
  threatsConsidered: string;
  firstCandidate: string;
  opponentForcedResponse: string;
}

export interface AttemptRecord {
  id: string;
  exerciseId: string;
  patternId: string;
  skillIds: SkillId[];
  fen: string;
  cct: CctCapture;
  chosenMoveSan: string;
  reasoning: string;
  timeUsedSeconds: number;
  evaluationStatus: EvaluationStatus;
  /** @deprecated use evaluationStatus */
  result?: LegacyAttemptResult;
  evalLossCp: number | null;
  engineVersion: string | null;
  engineSha256: string | null;
  evalVerified: boolean;
  observableReason: string | null;
  opponentReplySan: string | null;
  reflectionPrompt: string | null;
  attemptNumber: number;
  foundOpponentForcedResponse: boolean;
  recordedAt: string;
  lessonVersion: string;
  evalCriterionVersion: string;
}

export interface SkillState {
  skillId: SkillId;
  successes: number;
  failures: number;
  partials: number;
  unverifiedCount: number;
  alpha: number;
  beta: number;
  confidence: number;
  masteryEstimate: number;
  lastPracticeAt: string | null;
  nextReviewAt: string | null;
  history: { at: string; mastery: number; event: string }[];
}

export interface UserProgress {
  lessonCompletedAt: string | null;
  exercisesCompleted: string[];
  currentExerciseId: string | null;
  lastSelectionReason: string | null;
  totalSessionMinutes: number;
}

export interface AppStateV2 {
  version: typeof APP_STATE_VERSION;
  username: string;
  attempts: AttemptRecord[];
  skills: Record<SkillId, SkillState>;
  progress: UserProgress;
  updatedAt: string;
  migrationNote?: string;
}

/** @deprecated */
export interface AppStateV1 {
  version: 1;
  username: string;
  attempts: Array<
    Omit<
      AttemptRecord,
      | "evaluationStatus"
      | "evalLossCp"
      | "engineVersion"
      | "engineSha256"
      | "evalVerified"
      | "observableReason"
      | "opponentReplySan"
      | "reflectionPrompt"
    > & { result: LegacyAttemptResult }
  >;
  skills: Record<SkillId, SkillState>;
  progress: UserProgress;
  updatedAt: string;
}

export type AppState = AppStateV2;
