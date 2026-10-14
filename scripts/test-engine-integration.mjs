import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Chess } from "chess.js";
import { StockfishEngine } from "../server/stockfish.mjs";
import { EvalCache } from "../server/cache.js";
import { runEvaluation } from "../server/evaluator.mjs";

const enginePath = process.env.STOCKFISH_PATH ?? "stockfish";

const cacheDir = mkdtempSync(path.join(tmpdir(), "move-mirror-engine-smoke-"));
const engine = new StockfishEngine(enginePath);
const counters = { hit: 0 };
const metrics = {
  recordHit: () => { counters.hit += 1; },
  recordMiss: () => {},
  recordEscalation: () => {},
  recordDuration: () => {},
};
const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

try {
  await engine.start();
  if (!engine.isAlive || !engine.engineVersion) throw new Error("engine_start_failed");

  const first = await engine.analyse(fen, { nodes: 20_000 });
  const chess = new Chess(fen);
  const legal = chess.moves({ verbose: true }).some((move) =>
    `${move.from}${move.to}${move.promotion ?? ""}` === first.firstMoveUci
  );
  if (!legal) throw new Error("engine_returned_illegal_move");

  const constrained = await engine.analyseDecision(fen, "e2e4", 20_000);
  if (constrained.played.firstMoveUci !== "e2e4") throw new Error("searchmoves_not_respected");

  await engine.restart();
  const afterRestart = await engine.analyse(fen, { nodes: 20_000 });
  if (!afterRestart.firstMoveUci) throw new Error("restart_recovery_failed");

  const cache = new EvalCache(cacheDir);
  const params = { fen, playedUci: "e2e4", referenceBestUci: null, engine, cache, metrics };
  const evaluation = await runEvaluation(params);
  if (evaluation.played.pvUci[0] !== "e2e4") throw new Error("played_pv_wrong_root");
  const replyPosition = new Chess(fen);
  replyPosition.move("e4");
  const reply = evaluation.opponentReplyUci;
  if (!reply || !replyPosition.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply[4] })) throw new Error("opponent_reply_wrong_turn");
  const cached = await runEvaluation(params);
  if (evaluation.cacheHit || !cached.cacheHit || counters.hit < 1) throw new Error("cache_hit_failed");
  if (evaluation.status !== cached.status || evaluation.cpLoss !== cached.cpLoss) throw new Error("non_reproducible_result");

  console.log(JSON.stringify({
    status: "passed",
    engineVersion: engine.engineVersion,
    legalMove: first.firstMoveUci,
    searchmoves: constrained.played.firstMoveUci,
    recoveredAfterRestart: true,
    cacheHit: true,
  }));
} catch (error) {
  const message = String(error.message ?? error);
  if (message.includes("ENOENT") || message.includes("not found")) {
    console.log(JSON.stringify({ status: "skipped_no_stockfish" }));
  } else {
    console.error(JSON.stringify({ status: "failed", error: message }));
    process.exitCode = 1;
  }
} finally {
  await engine.stop();
  rmSync(cacheDir, { recursive: true, force: true });
}
