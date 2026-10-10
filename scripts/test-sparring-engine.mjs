import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Chess } from "chess.js";
import { StockfishEngine } from "../server/stockfish.mjs";
import { createSparringStore } from "../server/sparring/store.mjs";
import { createSparringService } from "../server/sparring/service.mjs";
import { EvaluationQueue } from "../server/queue.js";

const enginePath = process.env.STOCKFISH_PATH ?? "stockfish";
const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

const cacheDir = mkdtempSync(path.join(tmpdir(), "sparring-engine-"));
const engine = new StockfishEngine(enginePath);
const queue = new EvaluationQueue({ maxQueue: 8, jobTimeoutMs: 180_000 });

try {
  await engine.start();
  const store = createSparringStore(cacheDir);
  store.ensure();
  const service = createSparringService({
    store,
    engine,
    engineAvailable: true,
    queue,
    evaluate: async () => ({ status: "unverified", evalFinalStatus: "unverified" }),
    defenseDatasetFile: null,
    cacheRoot: store.dirs.cache,
  });

  const session = service.createSession({
    mode: "targeted_position",
    userColor: "white",
    startingFen: fen,
    style: "balanced",
    patternId: "cct-opponent-refutation",
  });

  const move1 = await service.agentMove(session.sessionId);
  if (!move1.moveUci) throw new Error("missing_agent_move");

  const chess = new Chess(fen);
  const legal = chess.moves({ verbose: true }).some(
    (m) => `${m.from}${m.to}${m.promotion ?? ""}` === move1.moveUci,
  );
  if (!legal) throw new Error("agent_move_illegal");

  const stored = store.readSession(session.sessionId);
  if (stored.decisions.length !== 1) throw new Error("decision_not_persisted");

  const move1b = await service.agentMove(session.sessionId);
  if (move1b.moveUci !== move1.moveUci) throw new Error("idempotency_failed");

  await engine.restart();
  const resumed = service.getSession(session.sessionId);
  if (!resumed) throw new Error("session_lost");

  console.log(
    JSON.stringify({
      status: "passed",
      engineVersion: engine.engineVersion,
      moveUci: move1.moveUci,
      idempotent: true,
      cacheDir,
    }),
  );
} catch (error) {
  const message = String(error.message ?? error);
  if (message.includes("ENOENT") || message.includes("not found") || message.includes("engine")) {
    console.log(JSON.stringify({ status: "skipped_no_stockfish", error: message }));
  } else {
    console.error(JSON.stringify({ status: "failed", error: message }));
    process.exitCode = 1;
  }
} finally {
  await engine?.stop();
  rmSync(cacheDir, { recursive: true, force: true });
}
