import { BUDGET_DEEP, BUDGET_SHALLOW } from "../../shared/evaluation/budgets.js";
import { FINGERPRINT } from "../../shared/transfer/constants.js";
import { needsDeepConfirmation } from "../../shared/transfer/detector.js";
import { analyzePending, scriptedAnalyzeOne } from "../../shared/transfer/pipeline.js";
import { compareMetrics, measureDecisions } from "../../shared/transfer/measure.js";
import { decidePedagogy } from "../../shared/transfer/pedagogy.js";
import { cohortIdForSync, selectTransferGames } from "../../shared/transfer/selection.js";
import { fetchNewGames, loadFixtureGames } from "./chesscom.mjs";
import { StockfishEngine } from "../stockfish.mjs";

export function createEngineAnalyzer(engine) {
  return async (decision, signal) => {
    const shallow = await engine.analyseDecision(
      decision.fenBefore,
      decision.moveUci,
      BUDGET_SHALLOW.nodes,
      signal
    );
    const confirmation = needsDeepConfirmation({
      cpLoss: shallow.cpLoss,
      best: shallow.best,
      played: shallow.played,
      playedUci: decision.moveUci,
    });
    const deep = confirmation.confirm
      ? await engine.analyseDecision(decision.fenBefore, decision.moveUci, BUDGET_DEEP.nodes, signal)
      : null;
    return {
      shallow,
      deep,
      final: deep ?? shallow,
      engineVersion: engine.engineVersion,
      engineSha256: engine.engineSha256,
    };
  };
}

export class EnginePool {
  constructor(enginePath, size = 2) {
    this.engines = Array.from({ length: size }, () => new StockfishEngine(enginePath));
    this.idle = [];
    this.waiters = [];
  }

  async start() {
    await Promise.all(this.engines.map((engine) => engine.start()));
    this.idle = [...this.engines];
    return this.engines[0];
  }

  async stop() {
    await Promise.all(this.engines.map((engine) => engine.stop()));
  }

  async acquire() {
    const engine = this.idle.pop();
    if (engine) return engine;
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  release(engine) {
    const waiter = this.waiters.shift();
    if (waiter) waiter(engine);
    else this.idle.push(engine);
  }

  async analyze(decision, signal) {
    const engine = await this.acquire();
    try {
      return await createEngineAnalyzer(engine)(decision, signal);
    } catch (error) {
      if (String(error.message).includes("engine_died")) await engine.restart();
      throw error;
    } finally {
      this.release(engine);
    }
  }
}

function openCohort(store) {
  return store.listCohortIds().map((id) => store.readMeta(id)).find((meta) => meta && !meta.frozen) ?? null;
}

export async function runSync({
  store,
  source = "live",
  username,
  fixturesDir,
  signal,
  onProgress,
  analyzeOne,
  enginePath,
  training = null,
  sleep,
  fetchImpl,
}) {
  const progress = (patch) => onProgress?.(patch);
  const manifest = store.readManifest();
  const syncedAt = new Date().toISOString();
  progress({ phase: "fetch", done: 0, total: 1, message: "Buscando partidas nuevas" });

  let fetched;
  if (source === "fixtures") {
    fetched = loadFixtureGames(fixturesDir);
  } else {
    const state = store.readState();
    const seen = new Set((state.archives ?? []).filter((row) => !row.offline).map((row) => row.url));
    fetched = await fetchNewGames({
      username,
      cutoffEndTime: manifest.cutoff.endTime,
      fetchImpl,
      sleep,
      signal,
      seenArchives: seen,
    });
  }
  if (signal?.aborted) throw new Error("aborted");

  let cohort = openCohort(store);
  const cohortId = cohort?.id ?? cohortIdForSync(store.listCohortIds(), syncedAt);
  const selected = selectTransferGames({
    rawGames: fetched.games,
    baseline: manifest,
    knownIds: store.knownIds(),
    knownUrls: store.knownUrls(),
    recordedExclusions: store.recordedKeys(),
    username,
    cohortId,
    syncedAt,
  });
  if (!cohort && (selected.included.length || selected.excluded.length)) {
    cohort = store.createCohort({
      id: cohortId,
      createdAt: syncedAt,
      syncedAt,
      cutoff: manifest.cutoff,
      baselineCohortId: manifest.cohortId,
    });
  }
  if (cohort) {
    store.addToCohort(cohort.id, { games: selected.included, exclusions: selected.excluded });
  }

  const state = store.readState();
  const archives = [...(state.archives ?? [])];
  for (const row of fetched.fetched ?? []) {
    if (!archives.some((item) => item.url === row.url && item.sha256 === row.sha256)) archives.push({ ...row, fetchedAt: syncedAt });
  }
  state.archives = archives;
  state.lastSource = source;
  state.lastSyncedAt = syncedAt;
  state.lastError = null;
  store.writeState(state);

  if (!cohort) {
    const idle = store.readState();
    idle.lastSyncedAt = syncedAt;
    idle.lastSource = source;
    idle.lastError = null;
    store.writeState(idle);
    progress({ phase: "done", done: 0, total: 0, message: "No hay partidas nuevas" });
    return store.publicState();
  }

  const decisions = store.decisionsOf(cohort.id);
  const done = store.analysisRecords(cohort.id);
  progress({
    phase: "analyze",
    done: done.size,
    total: decisions.length,
    message: decisions.length ? "Analizando decisiones propias" : "No hay decisiones nuevas",
  });

  let analyzer = analyzeOne;
  let pool = null;
  if (!analyzer) {
    if (source === "fixtures") analyzer = scriptedAnalyzeOne();
    else {
      pool = new EnginePool(enginePath, Number(process.env.TRANSFER_WORKERS ?? 2));
      const sample = await pool.start();
      store.writeBaselineEngine({
        engineVersion: sample.engineVersion,
        engineSha256: sample.engineSha256,
        analysisFingerprint: FINGERPRINT,
        usedFor: "transfer",
      });
      analyzer = (decision, jobSignal) => pool.analyze(decision, jobSignal);
    }
  }

  try {
    await analyzePending({
      decisions,
      done,
      analyzeOne: analyzer,
      cohortId: cohort.id,
      signal,
      onProgress: progress,
      onCheckpoint: async (record) => {
        if (!store.analysisRecords(cohort.id).has(record.key)) store.appendAnalysis(cohort.id, record);
      },
    });
  } finally {
    await pool?.stop();
  }

  const records = store.analysisRecords(cohort.id);
  const ready = decisions.filter((decision) => records.has(decision.key)).map((decision) => records.get(decision.key));
  const completeGames = new Set();
  const byGame = new Map();
  for (const decision of decisions) {
    const list = byGame.get(decision.gameId) ?? [];
    list.push(decision.key);
    byGame.set(decision.gameId, list);
  }
  for (const [gameId, keys] of byGame) {
    if (keys.every((key) => records.has(key))) completeGames.add(gameId);
  }
  const measured = ready.filter((row) => completeGames.has(row.gameId));
  const metrics = measureDecisions(measured, { cohortId: cohort.id });
  if (store.pendingCount(cohort.id) === 0) store.writeMetrics(cohort.id, metrics);

  const baselineMetrics = store.readBaselineMetrics();
  let comparison = null;
  if (baselineMetrics && store.pendingCount(cohort.id) === 0 && metrics.decisions > 0) {
    try {
      comparison = compareMetrics(baselineMetrics, metrics);
    } catch {
      comparison = null;
    }
  }
  const pedagogy = decidePedagogy({ training: training ?? state.trainingSnapshot ?? {}, comparison });
  const next = store.readState();
  next.pedagogy = pedagogy;
  if (training) next.trainingSnapshot = training;
  next.lastSyncedAt = syncedAt;
  store.writeState(next);
  progress({ phase: "done", done: decisions.length, total: decisions.length, message: "Sincronización terminada" });
  return store.publicState();
}
