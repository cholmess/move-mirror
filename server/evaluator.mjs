import { classifyFromLayers } from "../shared/evaluation/pipeline.js";
import { shouldEscalate, analysisIncomplete } from "../shared/evaluation/escalation.js";
import {
  BUDGET_SHALLOW,
  BUDGET_DEEP,
  EVAL_CRITERION_ID,
  EVAL_PIPELINE_VERSION,
} from "../shared/evaluation/budgets.js";
import { makeCacheKey } from "./cache.js";

function baseKeyInput(fen, uci, engineSha256) {
  return {
    fen,
    uci,
    engineSha256,
    threads: BUDGET_SHALLOW.threads,
    hashMb: BUDGET_SHALLOW.hashMb,
    criterion: EVAL_CRITERION_ID,
    pipeline: EVAL_PIPELINE_VERSION,
  };
}

export async function runEvaluation({
  fen,
  playedUci,
  referenceBestUci,
  engine,
  cache,
  metrics,
  signal,
}) {
  const t0 = Date.now();
  const engineSha256 = engine.engineSha256;

  const finalKeyInput = {
    ...baseKeyInput(fen, playedUci, engineSha256),
    budgetId: "final",
  };
  const cachedFinal = cache.getFinal(finalKeyInput);
  if (cachedFinal.entry) {
    metrics.recordHit();
    return { ...cachedFinal.entry, cacheHit: true };
  }
  metrics.recordMiss();

  const shallowKeyInput = {
    ...baseKeyInput(fen, playedUci, engineSha256),
    budgetId: BUDGET_SHALLOW.id,
  };

  let shallow = cache.getShallow(shallowKeyInput).entry;
  if (!shallow) {
    const raw = await engine.evaluatePair(fen, playedUci, BUDGET_SHALLOW, signal);
    shallow = {
      budgetId: BUDGET_SHALLOW.id,
      ...raw,
    };
    cache.setShallow(shallowKeyInput, shallow);
  } else {
    metrics.recordHit();
  }

  const shallowIncomplete = analysisIncomplete(shallow.best) || analysisIncomplete(shallow.played);

  const esc = shouldEscalate({
    cpLoss: shallow.cpLoss,
    best: shallow.best,
    played: shallow.played,
    playedUci,
    shallowIncomplete,
    referenceBestUci,
  });

  let deep = null;
  let escalated = false;
  let escalationReason = null;

  if (esc.escalate) {
    escalated = true;
    escalationReason = esc.reason;
    metrics.recordEscalation();

    const deepKeyInput = {
      ...baseKeyInput(fen, playedUci, engineSha256),
      budgetId: BUDGET_DEEP.id,
    };
    deep = cache.getDeep(deepKeyInput).entry;
    if (!deep) {
      const rawDeep = await engine.evaluatePair(fen, playedUci, BUDGET_DEEP, signal);
      deep = {
        budgetId: BUDGET_DEEP.id,
        ...rawDeep,
      };
      cache.setDeep(deepKeyInput, deep);
    } else {
      metrics.recordHit();
    }
  }

  const { initialStatus, finalStatus, cpLoss, layer } = classifyFromLayers({
    fen,
    playedUci,
    referenceBestUci,
    shallow,
    deep,
  });

  const usedLayer = layer === "deep" ? deep : shallow;
  const evalBudgetId = layer === "deep" ? BUDGET_DEEP.id : BUDGET_SHALLOW.id;
  const nodesUsed =
    layer === "deep" ? BUDGET_DEEP.nodes * 2 : BUDGET_SHALLOW.nodes * 2;

  const response = {
    ok: true,
    status: finalStatus,
    verified: finalStatus !== "unverified",
    cpLoss,
    best: usedLayer.best,
    played: usedLayer.played,
    opponentReplyUci: usedLayer.opponentReplyUci ?? null,
    engineVersion: engine.engineVersion,
    engineSha256,
    evalBudgetId,
    evalInitialBudgetId: BUDGET_SHALLOW.id,
    evalFinalBudgetId: evalBudgetId,
    evalEscalated: escalated,
    evalEscalationReason: escalationReason,
    evalInitialStatus: initialStatus,
    evalFinalStatus: finalStatus,
    evalCriterionVersion: EVAL_CRITERION_ID,
    evalPipelineVersion: EVAL_PIPELINE_VERSION,
    nodesUsed,
    cacheHit: false,
    cacheKey: makeCacheKey(finalKeyInput),
    error: null,
  };

  cache.setFinal(finalKeyInput, response);
  metrics.recordDuration(Date.now() - t0);
  return response;
}
