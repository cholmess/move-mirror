import type { EvaluationStatus } from "@shared/evaluation/types";

export type DefenseSelectionReasonPayload =
  | { key: string; params?: Record<string, string | number> }
  | string;

export type DefensiveResource =
  | "countercheck"
  | "capture_attacker"
  | "move_attacked_piece"
  | "defend_target"
  | "block_or_interpose"
  | "trade_attackers"
  | "queen_trade"
  | "create_escape_square"
  | "remove_defender"
  | "counterattack"
  | "simplify"
  | "prophylaxis"
  | "unknown";

export interface DefensePromptDto {
  exerciseId: string;
  fen: string;
  orientation: "white" | "black";
  phase: "opening" | "middlegame" | "endgame";
  sourceContext: {
    playedAt: string;
    playerColor: "white" | "black";
    moveNumber: number;
    opening: string | null;
  };
  previousMoveSan: string | null;
  /** @deprecated API may omit; use promptKey */
  prompt?: string;
  promptKey?: "default";
  selectionReason: DefenseSelectionReasonPayload;
  dataset?: {
    releaseVersion: "0.4.1";
    selectionVersion: "defense-selection-v1";
    selected: number;
    technicallyEligible: number;
    candidatesAnalyzed: number;
  };
}

export interface DefenseFeedbackDto {
  exerciseId: string;
  evaluationStatus: EvaluationStatus;
  evaluationId: string | null;
  cpLoss: number | null;
  opponentReplySan: string | null;
  threat: {
    type: "check" | "capture" | "mate" | "material" | "positional";
    description: string;
    confidence: "high" | "medium" | "low";
  };
  motif: {
    resource: DefensiveResource;
    confidence: "high" | "medium" | "low";
    evidence: string[];
    classifierVersion: "defense-motif-v1";
  };
  referenceDefenseSan: string;
  actualPlayedMoveSan: string;
  actualPunishmentLineSan: string[];
  defenseReferenceLineSan: string[];
  pedagogy: {
    observable: string;
    interpretation: string;
    habitHypothesis: string;
    confidence: "high" | "medium" | "low";
    transferableRule: string;
  };
}

export interface DefenseAttempt {
  attemptId: string;
  exerciseId: string;
  startedAt: string;
  confirmedAt: string;
  moveUci: string;
  moveSan: string;
  perceivedThreat: string[];
  perceivedThreatText: string;
  selectedResource: DefensiveResource | "not_sure";
  predictedOpponentReply: string;
  defenseReasoning: string;
  verificationConfirmed: boolean;
  evaluationStatus: EvaluationStatus;
  evaluationId: string | null;
  retryOfAttemptId: string | null;
  sourceGameId: string;
  interventionEventId: string;
  doseEligible: false;
  motif: DefensiveResource;
  phase: "opening" | "middlegame" | "endgame";
  orientation: "white" | "black";
  sessionId: string;
}

export interface DefenseLabState {
  version: "defense-lab-state-v1";
  attempts: DefenseAttempt[];
  currentExerciseId: string | null;
  lastSelectionReason: DefenseSelectionReasonPayload | null;
  sessionExerciseIds: string[];
  updatedAt: string | null;
}
