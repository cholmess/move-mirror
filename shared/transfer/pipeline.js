import { DETECTOR, FINGERPRINT } from "./constants.js";
import { detectEvent, needsDeepConfirmation } from "./detector.js";
import { compareMetrics, measureDecisions } from "./measure.js";
import { decidePedagogy, buildTransferChannel, summarizeTraining } from "./pedagogy.js";
import { selectTransferGames } from "./selection.js";

export function scriptedAnalyzeOne(scriptsByKey = {}) {
  return async (decision) => {
    const script =
      (typeof scriptsByKey.get === "function" ? scriptsByKey.get(decision.key) : null) ??
      scriptsByKey[decision.key] ??
      { cpLoss: 0, replyUci: null };
    const shallow = layerFromScript(decision, script);
    const confirmation = needsDeepConfirmation({
      cpLoss: shallow.cpLoss,
      best: shallow.best,
      played: shallow.played,
      playedUci: decision.moveUci,
    });
    const deep = confirmation.confirm
      ? layerFromScript(decision, {
          ...script,
          cpLoss: script.deepCpLoss ?? script.cpLoss,
          nodes: 500_000,
        })
      : null;
    return {
      shallow,
      deep,
      final: deep ?? shallow,
      engineVersion: "scripted-offline",
      engineSha256: null,
    };
  };
}

export function layerFromScript(decision, script) {
  const cpLoss = script.cpLoss ?? 0;
  const replyUci = script.replyUci ?? null;
  const bestNumeric = script.bestNumeric ?? 100;
  const playedNumeric = bestNumeric - cpLoss;
  const pv = [decision.moveUci];
  if (replyUci) pv.push(replyUci);
  return {
    cpLoss,
    opponentReplyUci: replyUci,
    best: {
      score: { cp: bestNumeric, mate: script.bestMate ?? null, numeric: bestNumeric },
      pvUci: ["a2a3"],
      firstMoveUci: "a2a3",
      nodes: script.nodes ?? 80_000,
    },
    played: {
      score: { cp: playedNumeric, mate: script.playedMate ?? null, numeric: playedNumeric },
      pvUci: pv,
      firstMoveUci: decision.moveUci,
      nodes: script.nodes ?? 80_000,
    },
  };
}

export function finishDecision(decision, raw, cohortId) {
  const confirmation = needsDeepConfirmation({
    cpLoss: raw.shallow?.cpLoss ?? raw.final.cpLoss,
    best: raw.shallow?.best ?? raw.final.best,
    played: raw.shallow?.played ?? raw.final.played,
    playedUci: decision.moveUci,
  });
  const usedDeep = Boolean(raw.deep);
  if (confirmation.confirm && !usedDeep && !raw.allowShallow) {
    const error = new Error("deep_confirmation_required");
    error.code = "deep_confirmation_required";
    throw error;
  }
  const finalLayer = raw.final;
  const detected = detectEvent({
    cpLoss: finalLayer.cpLoss,
    fenBefore: decision.fenBefore,
    playedUci: decision.moveUci,
    replyUci: finalLayer.opponentReplyUci,
    cohortId,
  });
  return {
    ...decision,
    ...detected,
    analysisComplete: true,
    excludedFromMeasurement: false,
    analysisFingerprint: FINGERPRINT,
    detectorId: DETECTOR.id,
    escalated: usedDeep,
    escalationReason: usedDeep ? confirmation.reason : null,
    cpLoss: finalLayer.cpLoss,
    opponentReplyUci: finalLayer.opponentReplyUci ?? null,
    engineVersion: raw.engineVersion ?? null,
    engineSha256: raw.engineSha256 ?? null,
  };
}

export async function analyzePending({
  decisions,
  done = new Map(),
  analyzeOne,
  cohortId,
  signal,
  onProgress,
  onCheckpoint,
}) {
  const pending = decisions.filter((decision) => !done.has(decision.key));
  let index = 0;
  for (const decision of pending) {
    if (signal?.aborted) {
      const error = new Error("aborted");
      error.code = "aborted";
      throw error;
    }
    const raw = await analyzeOne(decision, signal);
    const record = finishDecision(decision, raw, cohortId);
    done.set(record.key, record);
    index += 1;
    if (onCheckpoint) await onCheckpoint(record);
    if (onProgress) {
      onProgress({
        phase: "analyze",
        done: done.size,
        total: decisions.length,
        message: `Análisis ${done.size} de ${decisions.length}`,
      });
    }
  }
  return done;
}

export function completeGamesOnly(decisions, records) {
  const byGame = new Map();
  for (const decision of decisions) {
    const list = byGame.get(decision.gameId) ?? [];
    list.push(decision.key);
    byGame.set(decision.gameId, list);
  }
  const ready = [];
  for (const keys of byGame.values()) {
    if (keys.every((key) => records.has(key))) {
      for (const key of keys) ready.push(records.get(key));
    }
  }
  return ready;
}

export async function runTransferScenario({
  rawGames,
  baseline,
  baselineDecisions,
  analyzeOne,
  training,
  knownIds,
  knownUrls,
  recordedExclusions,
  done,
  previousAction = null,
  cohortId = "transfer-test-1",
  syncedAt = "2026-10-10T06:00:00.000Z",
  username,
  signal,
  onCheckpoint,
  provisional = false,
}) {
  const selected = selectTransferGames({
    rawGames,
    baseline,
    knownIds: knownIds ?? new Set(),
    knownUrls: knownUrls ?? new Set(),
    recordedExclusions: recordedExclusions ?? new Set(),
    username,
    cohortId,
    syncedAt,
  });
  const transferDecisions = selected.included.flatMap((game) => game.decisions);
  const baselineDone = await analyzePending({
    decisions: baselineDecisions ?? [],
    done: new Map(),
    analyzeOne,
    cohortId: baseline.cohortId,
    signal,
  });
  const transferDone = await analyzePending({
    decisions: transferDecisions,
    done: done ?? new Map(),
    analyzeOne,
    cohortId,
    signal,
    onCheckpoint,
  });
  const baselineRows = completeGamesOnly(baselineDecisions ?? [], baselineDone);
  const transferRows = completeGamesOnly(transferDecisions, transferDone);
  const baselineMetrics = measureDecisions(baselineRows, { cohortId: baseline.cohortId });
  const transferMetrics = measureDecisions(transferRows, { cohortId });
  const comparison = compareMetrics(baselineMetrics, transferMetrics, { provisional });
  const pedagogy = decidePedagogy({
    training,
    comparison,
    previousAction,
  });
  const channel = buildTransferChannel(comparison, { syncedAt });
  return {
    selected,
    baselineMetrics,
    transferMetrics,
    comparison,
    pedagogy,
    channel,
    training: summarizeTraining(training),
    transferDone,
    pendingDecisions: transferDecisions.length - transferRows.length,
  };
}
