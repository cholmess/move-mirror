import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { BASELINE_COHORT_ID, FINGERPRINT } from "../shared/transfer/constants.js";
import { phaseProxy } from "../shared/transfer/detector.js";
import { measureDecisions } from "../shared/transfer/measure.js";
import { finishDecision } from "../shared/transfer/pipeline.js";
import { EnginePool } from "../server/transfer/sync.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const positionsPath = path.join(root, "data/fase-2/output/positions.jsonl");
const outDir = path.join(root, "data/transfer/baseline");
const analysisPath = path.join(outDir, "analysis.jsonl");
const progressPath = path.join(outDir, "progress.json");
const metricsPath = path.join(outDir, "metrics.json");
const enginePath = process.env.STOCKFISH_PATH ?? "stockfish";
const workers = Number(process.env.TRANSFER_WORKERS ?? 3);
const limit = Number(process.env.TRANSFER_LIMIT ?? 0);

function loadDone() {
  const done = new Set();
  if (!existsSync(analysisPath)) return done;
  for (const line of readFileSync(analysisPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      done.add(JSON.parse(line).key);
    } catch {
      /* torn line */
    }
  }
  return done;
}

async function loadDecisions() {
  const decisions = [];
  const stream = readline.createInterface({ input: createReadStream(positionsPath), crlfDelay: Infinity });
  for await (const line of stream) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    decisions.push({
      key: `${row.game_id}:${row.ply}`,
      gameId: row.game_id,
      url: row.game_url ?? null,
      cohortId: BASELINE_COHORT_ID,
      ply: row.ply,
      moveNumber: row.move_number,
      color: row.color,
      fenBefore: row.fen_before,
      moveSan: row.move_san,
      moveUci: row.move_uci,
      phaseProxy: phaseProxy(row.fen_before, row.ply),
    });
    if (limit && decisions.length >= limit) break;
  }
  return decisions;
}

const decisions = await loadDecisions();
mkdirSync(outDir, { recursive: true });
const done = loadDone();
const pending = decisions.filter((decision) => !done.has(decision.key));
console.log(JSON.stringify({ total: decisions.length, done: done.size, pending: pending.length, fingerprint: FINGERPRINT }));

const pool = new EnginePool(enginePath, workers);
const engine = await pool.start();
writeFileSync(
  path.join(outDir, "engine.json"),
  `${JSON.stringify({
    engineVersion: engine.engineVersion,
    engineSha256: engine.engineSha256,
    analysisFingerprint: FINGERPRINT,
    threads: 1,
    hashMb: 128,
    clearHash: true,
    searchMethod: "uci-searchmoves",
  }, null, 2)}\n`
);

let cursor = 0;
let finished = done.size;
const started = Date.now();

async function worker() {
  while (cursor < pending.length) {
    const decision = pending[cursor];
    cursor += 1;
    let raw = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        raw = await pool.analyze(decision);
        break;
      } catch (error) {
        if (attempt === 1) throw error;
      }
    }
    const record = finishDecision(decision, raw, BASELINE_COHORT_ID);
    appendFileSync(analysisPath, `${JSON.stringify(record)}\n`);
    finished += 1;
    if (finished % 20 === 0 || finished === decisions.length) {
      const elapsed = (Date.now() - started) / 1000;
      writeFileSync(
        progressPath,
        `${JSON.stringify({
          done: finished,
          total: decisions.length,
          complete: finished === decisions.length,
          events: null,
          elapsedSeconds: Math.round(elapsed),
        })}\n`
      );
      console.log(JSON.stringify({ done: finished, total: decisions.length, elapsedSeconds: Math.round(elapsed) }));
    }
  }
}

try {
  await Promise.all(Array.from({ length: workers }, () => worker()));
  if (!limit) {
    const rows = readFileSync(analysisPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const byKey = new Map(rows.map((row) => [row.key, row]));
    const metrics = measureDecisions([...byKey.values()], { cohortId: BASELINE_COHORT_ID });
    writeFileSync(metricsPath, `${JSON.stringify(metrics)}\n`);
    writeFileSync(
      progressPath,
      `${JSON.stringify({
        done: byKey.size,
        total: decisions.length,
        complete: byKey.size >= decisions.length,
        eventsPer100: metrics.eventsPer100,
        events: metrics.events,
        decisions: metrics.decisions,
        gamesAnalyzed: metrics.gamesAnalyzed,
      })}\n`
    );
    console.log(JSON.stringify({
      eventsPer100: metrics.eventsPer100,
      events: metrics.events,
      decisions: metrics.decisions,
      gamesAffected: metrics.gamesAffected,
      gamesAnalyzed: metrics.gamesAnalyzed,
    }));
  }
} finally {
  await pool.stop();
}
