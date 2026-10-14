import { ENGINE_API } from "../data/constants";
import type { EvaluationStatus } from "@shared/evaluation/types";

export interface EvaluateRequest {
  fen: string;
  moveSan: string;
  referenceBestUci?: string | null;
  signal?: AbortSignal;
}

export interface EvaluateResult {
  status: EvaluationStatus;
  verified: boolean;
  cpLoss: number | null;
  opponentReplySan: string | null;
  engineVersion: string | null;
  engineSha256: string | null;
  evalBudgetId: string;
  evalInitialBudgetId: string;
  evalFinalBudgetId: string;
  evalEscalated: boolean;
  evalEscalationReason: string | null;
  evalInitialStatus: EvaluationStatus | null;
  evalFinalStatus: EvaluationStatus;
  evalCriterionVersion: string;
  evalPipelineVersion: string;
  cacheHit: boolean;
  error: string | null;
}

export async function evaluateMoveWithEngine(
  req: EvaluateRequest
): Promise<EvaluateResult> {
  const base = ENGINE_API.replace(/\/$/, "");
  const url =
    import.meta.env.DEV && !import.meta.env.VITE_ENGINE_API
      ? "/api/evaluate"
      : `${base}/api/evaluate`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fen: req.fen,
        moveSan: req.moveSan,
        referenceBestUci: req.referenceBestUci ?? null,
      }),
      signal: req.signal,
    });
    if (!res.ok) {
      return unverified("http_error");
    }
    const data = await res.json();
    return mapResponse(data);
  } catch (err) {
    if (req.signal?.aborted) return unverified("aborted");
    return unverified("network_error");
  }
}

function mapResponse(data: Record<string, unknown>): EvaluateResult {
  return {
    status: (data.status as EvaluationStatus) ?? "unverified",
    verified: Boolean(data.verified),
    cpLoss: (data.cpLoss as number | null) ?? null,
    opponentReplySan: (data.opponentReplySan as string | null) ?? null,
    engineVersion: (data.engineVersion as string | null) ?? null,
    engineSha256: (data.engineSha256 as string | null) ?? null,
    evalBudgetId: String(data.evalBudgetId ?? "nodes-80k-v1"),
    evalInitialBudgetId: String(data.evalInitialBudgetId ?? "nodes-80k-v1"),
    evalFinalBudgetId: String(data.evalFinalBudgetId ?? "nodes-80k-v1"),
    evalEscalated: Boolean(data.evalEscalated),
    evalEscalationReason: (data.evalEscalationReason as string | null) ?? null,
    evalInitialStatus: (data.evalInitialStatus as EvaluationStatus | null) ?? null,
    evalFinalStatus: (data.evalFinalStatus as EvaluationStatus) ?? "unverified",
    evalCriterionVersion: String(data.evalCriterionVersion ?? "engine-validated-v2"),
    evalPipelineVersion: String(data.evalPipelineVersion ?? "eval-pipeline-v0.2.2"),
    cacheHit: Boolean(data.cacheHit),
    error: (data.error as string | null) ?? null,
  };
}

function unverified(error: string): EvaluateResult {
  return {
    status: "unverified",
    verified: false,
    cpLoss: null,
    opponentReplySan: null,
    engineVersion: null,
    engineSha256: null,
    evalBudgetId: "nodes-80k-v1",
    evalInitialBudgetId: "nodes-80k-v1",
    evalFinalBudgetId: "nodes-80k-v1",
    evalEscalated: false,
    evalEscalationReason: null,
    evalInitialStatus: null,
    evalFinalStatus: "unverified",
    evalCriterionVersion: "engine-validated-v2",
    evalPipelineVersion: "eval-pipeline-v0.2.2",
    cacheHit: false,
    error,
  };
}

export async function fetchEngineHealth(): Promise<boolean> {
  try {
    const base = import.meta.env.DEV ? "/health" : `${ENGINE_API}/health`;
    const res = await fetch(base);
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data.engineAvailable);
  } catch {
    return false;
  }
}
