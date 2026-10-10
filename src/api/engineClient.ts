import { ENGINE_API } from "../data/constants";
import type { EvaluationStatus } from "@shared/evaluation/types";

export interface EvaluateRequest {
  fen: string;
  moveSan: string;
  referenceBestUci?: string | null;
}

export interface EvaluateResult {
  status: EvaluationStatus;
  verified: boolean;
  cpLoss: number | null;
  opponentReplySan: string | null;
  engineVersion: string | null;
  engineSha256: string | null;
  evalBudgetId: string;
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
    });
    if (!res.ok) {
      return unverified("http_error");
    }
    const data = await res.json();
    return {
      status: data.status ?? "unverified",
      verified: Boolean(data.verified),
      cpLoss: data.cpLoss ?? null,
      opponentReplySan: data.opponentReplySan ?? null,
      engineVersion: data.engineVersion ?? null,
      engineSha256: data.engineSha256 ?? null,
      evalBudgetId: data.evalBudgetId ?? "unknown",
      error: data.error ?? null,
    };
  } catch {
    return unverified("network_error");
  }
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
