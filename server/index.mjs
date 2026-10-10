import http from "node:http";
import { Chess } from "chess.js";
import { StockfishPool, EVAL_BUDGET } from "./stockfish.mjs";
import { classifyEngineResult } from "../shared/evaluation/classify.js";

const PORT = Number(process.env.ENGINE_PORT ?? 8787);
const ENGINE_PATH = process.env.STOCKFISH_PATH ?? "stockfish";

let pool = null;
let engineAvailable = false;

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function parseUci(fen, uci) {
  const chess = new Chess(fen);
  const move = chess.move({
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci[4] : undefined,
  });
  return move;
}

function uciFromSan(fen, san) {
  const chess = new Chess(fen);
  const move = chess.move(san);
  if (!move) return null;
  return move.from + move.to + (move.promotion ?? "");
}

function sanFromUci(fen, uci) {
  const move = parseUci(fen, uci);
  return move?.san ?? null;
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
    return sanFromUci(chess.fen(), replyUci);
  } catch {
    return null;
  }
}

function unverifiedPayload(error) {
  return {
    ok: true,
    status: "unverified",
    verified: false,
    cpLoss: null,
    best: null,
    played: null,
    opponentReplyUci: null,
    opponentReplySan: null,
    engineVersion: pool?.engineVersion ?? null,
    engineSha256: pool?.engineSha256 ?? null,
    evalBudgetId: EVAL_BUDGET.id,
    nodesUsed: 0,
    error,
  };
}

async function handleEvaluate(body) {
  const { fen, moveSan, moveUci, referenceBestUci } = body;
  if (!fen || typeof fen !== "string") {
    return unverifiedPayload("invalid_fen");
  }

  let chess;
  try {
    chess = new Chess(fen);
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
      evalBudgetId: EVAL_BUDGET.id,
      nodesUsed: 0,
      error: null,
    };
  }

  if (!parseUci(fen, uci)) {
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
      evalBudgetId: EVAL_BUDGET.id,
      nodesUsed: 0,
      error: null,
    };
  }

  if (!engineAvailable || !pool) {
    return unverifiedPayload("engine_unavailable");
  }

  try {
    const raw = await pool.evaluatePosition(
      fen,
      uci,
      referenceBestUci ?? null
    );
    const status = classifyEngineResult({
      fen,
      playedUci: uci,
      referenceBestUci: referenceBestUci ?? null,
      best: {
        score: raw.best.score,
        pvUci: raw.best.pvUci,
        firstMoveUci: raw.best.firstMoveUci,
      },
      played: {
        score: raw.played.score,
        pvUci: raw.played.pvUci,
        firstMoveUci: uci,
      },
      cpLoss: raw.cpLoss,
    });

    return {
      ok: true,
      status,
      verified: status !== "unverified",
      cpLoss: raw.cpLoss,
      best: raw.best,
      played: raw.played,
      opponentReplyUci: raw.opponentReplyUci,
      opponentReplySan: opponentReplySan(fen, uci, raw.opponentReplyUci),
      engineVersion: raw.engineVersion,
      engineSha256: raw.engineSha256,
      evalBudgetId: EVAL_BUDGET.id,
      nodesUsed: EVAL_BUDGET.nodes * 2,
      error: null,
    };
  } catch (err) {
    return unverifiedPayload(String(err.message ?? err));
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/health" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      engineAvailable,
      enginePath: ENGINE_PATH,
      evalBudget: EVAL_BUDGET,
    });
    return;
  }

  if (req.url === "/api/evaluate" && req.method === "POST") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      json(res, 400, { ok: false, error: "invalid json" });
      return;
    }
    const result = await handleEvaluate(body);
    json(res, 200, result);
    return;
  }

  json(res, 404, { ok: false, error: "not found" });
});

async function boot() {
  pool = new StockfishPool(ENGINE_PATH);
  try {
    await pool.start();
    engineAvailable = true;
    console.log(`Stockfish ready: ${pool.engineVersion} (${ENGINE_PATH})`);
  } catch (err) {
    engineAvailable = false;
    console.warn(
      `Stockfish not available (${ENGINE_PATH}): ${err.message}. Evaluations → unverified.`
    );
  }

  server.listen(PORT, () => {
    console.log(`MoveMirror engine service http://127.0.0.1:${PORT}`);
  });
}

boot();

process.on("SIGINT", async () => {
  await pool?.stop();
  process.exit(0);
});
