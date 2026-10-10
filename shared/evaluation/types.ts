export const EVAL_CRITERION_V2 = "engine-validated-v2" as const;

export type EvaluationStatus =
  | "verified_best"
  | "verified_acceptable"
  | "playable_inexact"
  | "incorrect"
  | "unverified"
  | "illegal";

export interface ScoreLine {
  cp: number | null;
  mate: number | null;
  numeric: number;
}

export interface EngineLineResult {
  score: ScoreLine;
  depth?: number;
  nodes?: number;
  pvUci: string[];
  firstMoveUci: string | null;
}

export interface EngineEvaluateResponse {
  ok: boolean;
  status: EvaluationStatus;
  cpLoss: number | null;
  best: EngineLineResult | null;
  played: EngineLineResult | null;
  opponentReplyUci: string | null;
  opponentReplySan: string | null;
  verified: boolean;
  engineVersion: string | null;
  engineSha256: string | null;
  evalBudgetId: string;
  nodesUsed: number;
  error: string | null;
}

export interface ClassifyInput {
  fen: string;
  playedUci: string;
  referenceBestUci: string | null;
  best: Pick<EngineLineResult, "score" | "pvUci" | "firstMoveUci">;
  played: Pick<EngineLineResult, "score" | "pvUci" | "firstMoveUci">;
  cpLoss: number | null;
}
