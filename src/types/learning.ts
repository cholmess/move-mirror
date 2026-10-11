import type { SkillId } from "../data/skills";
import type { EvaluationStatus } from "@shared/evaluation/types";
import { APP_STATE_VERSION } from "../data/constants";
import type { DefenseLabState } from "./defense";

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

export interface ReasoningMove {
  uci: string;
  san: string;
}

export interface TrainingReasoningV2 {
  version: "training-reasoning-v2";
  checks: {
    status: "moves_selected" | "none_seen";
    moves: ReasoningMove[];
  };
  captures: {
    status: "moves_selected" | "none_seen";
    moves: ReasoningMove[];
  };
  threats: {
    status: "moves_selected" | "none_seen";
    moves: Array<ReasoningMove & { note?: string }>;
  };
  candidate: ReasoningMove;
  predictedReply:
    | { status: "move_selected"; move: ReasoningMove }
    | { status: "none_found" }
    | { status: "not_applicable_checkmate" };
  keptCandidateAfterReply: boolean;
}

export interface AttemptRecord {
  id: string;
  exerciseId: string;
  patternId: string;
  skillIds: SkillId[];
  fen: string;
  cct: CctCapture;
  reasoningV2?: TrainingReasoningV2;
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
  evalPipelineVersion?: string;
  evalInitialBudgetId?: string;
  evalFinalBudgetId?: string;
  evalEscalated?: boolean;
  evalEscalationReason?: string | null;
  evalInitialStatus?: EvaluationStatus | null;
  evalFinalStatus?: EvaluationStatus;
  cacheHit?: boolean;
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

export type PedagogyEventType =
  | "lesson_started"
  | "lesson_completed"
  | "exercise_confirmed"
  | "training_session_started"
  | "training_session_completed";

export interface PedagogyEvent {
  id: string;
  occurredAt: string;
  eventType: PedagogyEventType;
  patternId: string;
  lessonVersion: string | null;
  exerciseId: string | null;
  attemptId: string | null;
  evaluationStatus: EvaluationStatus | null;
  evalCriterionVersion: string | null;
  source: "app" | "migration";
}

export interface InterventionQualification {
  protocolId: "cct-refutation-dose-v1";
  patternId: string;
  qualified: boolean;
  qualifiedAt: string | null;
  lessonCompletedAt: string | null;
  confirmedExercises: number;
  verifiedSuccesses: number;
  distinctSessions: number;
  distinctCalendarDays: number;
  missingRequirements: string[];
  evidenceEventIds: string[];
}

export interface AppStateV2 {
  version: 2;
  username: string;
  attempts: AttemptRecord[];
  skills: Record<SkillId, SkillState>;
  progress: UserProgress;
  updatedAt: string;
  migrationNote?: string;
}

export interface AppStateV3 {
  version: 3;
  username: string;
  attempts: AttemptRecord[];
  skills: Record<SkillId, SkillState>;
  progress: UserProgress;
  interventionLogVersion: "intervention-log-v1";
  pedagogyEvents: PedagogyEvent[];
  interventionQualification: InterventionQualification;
  migrationReport: {
    migratedAt: string;
    recoveredEventIds: string[];
    incomplete: { kind: string; attemptId?: string | null; reason: string }[];
  } | null;
  updatedAt: string;
  migrationNote?: string;
}

export interface AppStateV4 extends Omit<AppStateV3, "version"> {
  version: typeof APP_STATE_VERSION;
  defenseLab: DefenseLabState;
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

export type AppState = AppStateV4;
