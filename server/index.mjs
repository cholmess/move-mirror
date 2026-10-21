import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";
import { StockfishEngine } from "./stockfish.mjs";
import { EvalCache, sanitizeCacheDir } from "./cache.js";
import { EvalMetrics } from "./metrics.js";
import { EvaluationQueue } from "./queue.js";
import { runEvaluation } from "./evaluator.mjs";
import { BUDGET_SHALLOW } from "../shared/evaluation/budgets.js";
import { createStore } from "./transfer/store.mjs";
import { createTransferRouter } from "./transfer/routes.mjs";
import { createDefenseRouter } from "./defense/routes.mjs";
import { createGamesStore } from "./games/store.mjs";
import { createGamesRouter } from "./games/routes.mjs";
import { createScoresheetRouter } from "./scoresheets/routes.mjs";
import { createSparringStore } from "./sparring/store.mjs";
import { createSparringService } from "./sparring/service.mjs";
import { createSparringRouter } from "./sparring/routes.mjs";
import { createValidationStore } from "./validation/store.mjs";
import { createValidationService } from "./validation/service.mjs";
import { createValidationRouter } from "./validation/routes.mjs";
import { createTrainingPlanService } from "./coach/training-plan.mjs";
import { createCoachStore } from "./coach/store.mjs";
import { createPatternStore } from "./patterns/store.mjs";
import { createPatternService } from "./patterns/service.mjs";
import { createPatternRouter } from "./patterns/routes.mjs";
import { createOpenAIPedagogicalCoach } from "./patterns/pedagogical-coach.mjs";
import { createCoachService } from "./coach/service.mjs";
import { createCoachRouter } from "./coach/routes.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CACHE_DIR = process.env.ENGINE_CACHE_DIR ?? path.join(ROOT, "data/engine-cache");
const METRICS_FILE = path.join(CACHE_DIR, "metrics.json");

const PORT = Number(process.env.ENGINE_PORT ?? 8787);
const ENGINE_PATH = process.env.STOCKFISH_PATH ?? "stockfish";
const MAX_QUEUE = Number(process.env.ENGINE_MAX_QUEUE ?? 32);
const JOB_TIMEOUT_MS = Number(process.env.ENGINE_JOB_TIMEOUT_MS ?? 120_000);

let engine = null;
let engineAvailable = false;
const cache = new EvalCache(CACHE_DIR);
const metrics = new EvalMetrics(METRICS_FILE);
const queue = new EvaluationQueue({ maxQueue: MAX_QUEUE, jobTimeoutMs: JOB_TIMEOUT_MS });

sanitizeCacheDir(CACHE_DIR);

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function uciFromSan(fen, san) {
  const chess = new Chess(fen);
  const move = chess.move(san);
  if (!move) return null;
  return move.from + move.to + (move.promotion ?? "");
}

function isLegalUci(fen, uci) {
  try {
    const chess = new Chess(fen);
    return (
      chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      }) !== null
    );
  } catch {
    return false;
  }
}

function opponentReplySan(fen, playedUci, replyUci) {
  if (!replyUci) return null;
  try {
    const chess = new Chess(fen);
    chess.move({
      from: playedUci.slice(0, 2),
      to: playedUci.slice(2, 4),
      promotion: playedUci.length > 4 ? playedUci[4] : undefined,
    });
    const c2 = new Chess(chess.fen());
    const m = c2.move({
      from: replyUci.slice(0, 2),
      to: replyUci.slice(2, 4),
      promotion: replyUci.length > 4 ? replyUci[4] : undefined,
    });
    return m?.san ?? null;
  } catch {
    return null;
  }
}

function unverifiedPayload(error, extra = {}) {
  metrics.recordError();
  return {
    ok: true,
    status: "unverified",
    verified: false,
    cpLoss: null,
    best: null,
    played: null,
    opponentReplyUci: null,
    opponentReplySan: null,
    engineVersion: engine?.engineVersion ?? null,
    engineSha256: engine?.engineSha256 ?? null,
    evalBudgetId: BUDGET_SHALLOW.id,
    evalInitialBudgetId: BUDGET_SHALLOW.id,
    evalFinalBudgetId: BUDGET_SHALLOW.id,
    evalEscalated: false,
    evalEscalationReason: null,
    evalInitialStatus: null,
    evalFinalStatus: "unverified",
    evalCriterionVersion: "engine-validated-v2",
    evalPipelineVersion: "eval-pipeline-v0.2.2",
    nodesUsed: 0,
    cacheHit: false,
    error,
    ...extra,
  };
}

async function handleEvaluate(body, signal) {
  const { fen, moveSan, moveUci, referenceBestUci } = body;
  if (!fen || typeof fen !== "string") {
    return unverifiedPayload("invalid_fen");
  }

  try {
    // eslint-disable-next-line no-new
    new Chess(fen);
  } catch {
    return unverifiedPayload("invalid_fen");
  }

  const uci =
    moveUci ??
    (moveSan && typeof moveSan === "string" ? uciFromSan(fen, moveSan) : null);

  if (!uci) {
    return {
      ok: true,
      status: "illegal",
      verified: true,
      cpLoss: null,
      best: null,
      played: null,
      opponentReplyUci: null,
      opponentReplySan: null,
      engineVersion: null,
      engineSha256: null,
      evalBudgetId: BUDGET_SHALLOW.id,
      evalInitialBudgetId: BUDGET_SHALLOW.id,
      evalFinalBudgetId: BUDGET_SHALLOW.id,
      evalEscalated: false,
      evalEscalationReason: null,
      evalInitialStatus: "illegal",
      evalFinalStatus: "illegal",
      evalCriterionVersion: "engine-validated-v2",
      evalPipelineVersion: "eval-pipeline-v0.2.2",
      nodesUsed: 0,
      cacheHit: false,
      error: null,
    };
  }

  if (!isLegalUci(fen, uci)) {
    return {
      ok: true,
      status: "illegal",
      verified: true,
      cpLoss: null,
      best: null,
      played: null,
      opponentReplyUci: null,
      opponentReplySan: null,
      engineVersion: null,
      engineSha256: null,
      evalBudgetId: BUDGET_SHALLOW.id,
      evalInitialBudgetId: BUDGET_SHALLOW.id,
      evalFinalBudgetId: BUDGET_SHALLOW.id,
      evalEscalated: false,
      evalEscalationReason: null,
      evalInitialStatus: "illegal",
      evalFinalStatus: "illegal",
      evalCriterionVersion: "engine-validated-v2",
      evalPipelineVersion: "eval-pipeline-v0.2.2",
      nodesUsed: 0,
      cacheHit: false,
      error: null,
    };
  }

  if (!engineAvailable || !engine) {
    return unverifiedPayload("engine_unavailable");
  }

  try {
    const result = await queue.enqueue(
      async ({ signal: jobSignal }) => {
        try {
          return await runEvaluation({
            fen,
            playedUci: uci,
            referenceBestUci: referenceBestUci ?? null,
            engine,
            cache,
            metrics,
            signal: jobSignal,
          });
        } catch (err) {
          if (String(err.message).includes("engine_died")) {
            await engine.restart();
          }
          throw err;
        }
      },
      { signal }
    );

    return {
      ...result,
      opponentReplySan: opponentReplySan(fen, uci, result.opponentReplyUci),
    };
  } catch (err) {
    const msg = String(err.message ?? err);
    if (msg === "queue_full" || msg === "aborted" || msg.includes("timeout")) {
      return unverifiedPayload(msg);
    }
    return unverifiedPayload(msg);
  }
}

const validationRoot = process.env.VALIDATION_DATA_DIR
  ? path.resolve(ROOT, process.env.VALIDATION_DATA_DIR)
  : path.join(ROOT, "data/validation");
const validationStore = createValidationStore(validationRoot);
validationStore.ensure();
const validationService = createValidationService(validationStore);
const handleValidation = createValidationRouter(() => validationService);
const validationHooks = {
  recordCohortCreated: (cohort) => validationService.recordCohortCreated(cohort),
  recordCohortFrozen: (cohortId, frozenAt) => validationService.recordCohortFrozen(cohortId, frozenAt),
};

const transferStore = createStore(path.join(ROOT, "data/transfer"));
transferStore.ensure();
const gamesStore = createGamesStore(
  process.env.GAMES_DATA_DIR
    ? path.resolve(ROOT, process.env.GAMES_DATA_DIR)
    : path.join(ROOT, "data/games"),
  { projectRoot: ROOT },
);
gamesStore.ensure();
const handleTransfer = createTransferRouter({
  store: transferStore,
  fixturesDir: path.join(ROOT, "fixtures/chesscom"),
  enginePath: ENGINE_PATH,
  username: gamesStore.readIdentity().chessComUsernames[0] ?? "",
  validation: validationHooks,
});
const patternService = createPatternService({
  store: createPatternStore(process.env.PATTERNS_DATA_DIR ? path.resolve(ROOT, process.env.PATTERNS_DATA_DIR) : path.join(ROOT, "data/patterns")),
  gamesStore,
  evaluate: (body, signal) => handleEvaluate(body, signal),
  analyzerSignature: () => engineAvailable && engine ? `${engine.engineVersion}:${engine.engineSha256}:eval-pipeline-v0.2.2` : null,
  pedagogicalCoach: createOpenAIPedagogicalCoach(),
});
const handlePatterns = createPatternRouter(patternService);
const handleGames = createGamesRouter({
  store: gamesStore,
  onGameImported: (game) => validationService.recordGameImported(game),
});
const handleScoresheet = createScoresheetRouter({ gamesStore });
const handleDefense = createDefenseRouter({
  datasetFile: path.join(ROOT, "data/defense/defense-lab-v1.json"),
  evaluate: handleEvaluate,
});

const sparringRoot = process.env.SPARRING_DATA_DIR
  ? path.resolve(ROOT, process.env.SPARRING_DATA_DIR)
  : path.join(ROOT, "data/sparring");
const sparringStore = createSparringStore(sparringRoot);
sparringStore.ensure();
let sparringService = null;
function getSparringService() {
  if (!sparringService) {
    sparringService = createSparringService({
      store: sparringStore,
      engine,
      engineAvailable,
      queue,
      evaluate: handleEvaluate,
      defenseDatasetFile: path.join(ROOT, "data/defense/defense-lab-v1.json"),
      cacheRoot: sparringStore.dirs.cache,
      validation: validationService,
    });
  }
  return sparringService;
}
const handleSparring = createSparringRouter(() => getSparringService());

const coachDataDir = process.env.COACH_DATA_DIR
  ? path.resolve(ROOT, process.env.COACH_DATA_DIR)
  : path.join(ROOT, "data");
const coachStore = createCoachStore(coachDataDir);
coachStore.ensure();
const coachService = createCoachService(coachStore, {
  validation: validationService,
  evaluateMove: (body) => handleEvaluate(body, AbortSignal.timeout(JOB_TIMEOUT_MS)),
});
const trainingPlan = createTrainingPlanService({ patterns: patternService, coach: coachService, store: coachStore });
const handleCoach = createCoachRouter(() => coachService, { trainingPlan });

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url?.startsWith("/api/transfer")) {
    const handled = await handleTransfer(req, res);
    if (handled) return;
  }

  if (req.url?.startsWith("/api/import/scoresheet")) {
    const handled = await handleScoresheet(req, res);
    if (handled) { if (req.method === "POST" && res.statusCode < 400) patternService.schedule(); return; }
  }

  if (req.url?.startsWith("/api/import") || req.url?.startsWith("/api/games") || req.url?.startsWith("/api/player-identity")) {
    const handled = await handleGames(req, res);
    if (handled) {
      if (["POST", "PATCH", "DELETE"].includes(req.method) && res.statusCode < 400) patternService.schedule();
      return;
    }
  }

  if (req.url?.startsWith("/api/patterns")) {
    if (await handlePatterns(req, res)) return;
  }

  if (req.url?.startsWith("/api/defense")) {
    const handled = await handleDefense(req, res);
    if (handled) return;
  }

  if (req.url?.startsWith("/api/sparring")) {
    const handled = await handleSparring(req, res);
    if (handled) return;
  }

  if (req.url?.startsWith("/api/validation")) {
    const handled = await handleValidation(req, res);
    if (handled) return;
  }

  if (req.url?.startsWith("/api/coach")) {
    const handled = await handleCoach(req, res);
    if (handled) return;
  }

  if (req.url === "/health" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      engineAvailable,
      enginePath: ENGINE_PATH,
      queueSize: queue.size(),
      metrics: metrics.snapshot(),
      cacheDir: CACHE_DIR,
    });
    return;
  }

  if (req.url === "/api/evaluate" && req.method === "POST") {
    const abort = new AbortController();
    req.on("aborted", () => abort.abort());
    res.on("close", () => {
      if (!res.writableEnded) abort.abort();
    });

    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      json(res, 400, { ok: false, error: "invalid json" });
      return;
    }
    const result = await handleEvaluate(body, abort.signal);
    json(res, 200, result);
    return;
  }

  json(res, 404, { ok: false, error: "not found" });
});

async function boot() {
  engine = new StockfishEngine(ENGINE_PATH);
  try {
    await engine.start();
    engineAvailable = true;
    console.log(`Stockfish ready: ${engine.engineVersion} (${ENGINE_PATH})`);
  } catch (err) {
    engineAvailable = false;
    console.warn(
      `Stockfish not available (${ENGINE_PATH}): ${err.message}. Evaluations → unverified.`
    );
  }

  if (engineAvailable) patternService.schedule();
  server.listen(PORT, () => {
    console.log(`MoveMirror engine service http://127.0.0.1:${PORT}`);
  });
}

boot();

async function shutdown() {
  patternService.cancel();
  await engine?.stop();
  server.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
