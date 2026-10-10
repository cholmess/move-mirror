import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const EVAL_BUDGET = Object.freeze({
  id: "nodes-80k-v1",
  nodes: 80_000,
  threads: 1,
  hashMb: 128,
});

function parseScore(line) {
  const mateM = line.match(/score mate (-?\d+)/);
  if (mateM) {
    const mate = Number(mateM[1]);
    return { cp: null, mate, numeric: mate > 0 ? 100_000 - mate : -100_000 - mate };
  }
  const cpM = line.match(/score cp (-?\d+)/);
  const cp = cpM ? Number(cpM[1]) : 0;
  return { cp, mate: null, numeric: cp };
}

function parsePv(line) {
  const m = line.match(/\spv\s(.+)$/);
  if (!m) return [];
  return m[1].trim().split(/\s+/);
}

export class StockfishPool {
  constructor(enginePath) {
    this.enginePath = enginePath;
    this.proc = null;
    this.lines = [];
    this.engineVersion = null;
    this.engineSha256 = null;
    try {
      const buf = readFileSync(enginePath);
      this.engineSha256 = createHash("sha256").update(buf).digest("hex");
    } catch {
      this.engineSha256 = null;
    }
  }

  _send(cmd) {
    this.proc.stdin.write(`${cmd}\n`);
  }

  _waitFor(fn, timeoutMs = 45_000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const hit = this.lines.find(fn);
        if (hit) {
          resolve(hit);
          return;
        }
        if (Date.now() - start > timeoutMs) {
          reject(new Error("engine timeout"));
          return;
        }
        setTimeout(tick, 8);
      };
      tick();
    });
  }

  async start() {
    if (this.proc) return;
    this.proc = spawn(this.enginePath, [], { stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stdout.on("data", (chunk) => {
      for (const line of chunk.toString().split("\n")) {
        const t = line.trim();
        if (t) this.lines.push(t);
        if (t.startsWith("id name ")) this.engineVersion = t.slice(8);
      }
    });
    this.proc.stderr.on("data", () => {});

    this.lines = [];
    this._send("uci");
    await this._waitFor((l) => l === "uciok");
    this._send("isready");
    await this._waitFor((l) => l === "readyok");
    this._send(`setoption name Threads value ${EVAL_BUDGET.threads}`);
    this._send(`setoption name Hash value ${EVAL_BUDGET.hashMb}`);
    this._send("isready");
    await this._waitFor((l) => l === "readyok");
  }

  async stop() {
    if (!this.proc) return;
    try {
      this._send("quit");
    } catch {
      /* ignore */
    }
    this.proc.kill();
    this.proc = null;
  }

  async _analyse(fen, rootMoves = null) {
    this.lines = [];
    const pos = rootMoves?.length
      ? `position fen ${fen} moves ${rootMoves.join(" ")}`
      : `position fen ${fen}`;
    this._send(pos);
    this._send(`go nodes ${EVAL_BUDGET.nodes}`);

    let lastInfo = null;
    await this._waitFor((l) => {
      if (l.startsWith("info ") && l.includes(" score ") && l.includes(" pv ")) {
        lastInfo = l;
      }
      return l.startsWith("bestmove ");
    });

    const bestmoveLine = this.lines.find((l) => l.startsWith("bestmove "));
    const bestmove = bestmoveLine?.split(" ")[1] ?? null;
    if (!lastInfo) throw new Error("no analysis");

    const score = parseScore(lastInfo);
    const pvUci = parsePv(lastInfo);
    const depthM = lastInfo.match(/depth (\d+)/);
    const nodesM = lastInfo.match(/nodes (\d+)/);

    return {
      score,
      depth: depthM ? Number(depthM[1]) : undefined,
      nodes: nodesM ? Number(nodesM[1]) : undefined,
      pvUci,
      firstMoveUci: rootMoves?.[0] ?? pvUci[0] ?? bestmove,
    };
  }

  async evaluatePosition(fen, playedUci, referenceBestUci) {
    await this.start();
    const best = await this._analyse(fen);
    const played = await this._analyse(fen, [playedUci]);
    const cpLoss = best.score.numeric - played.score.numeric;
    const opponentReplyUci = played.pvUci[1] ?? null;
    return {
      best,
      played,
      cpLoss,
      referenceBestUci,
      opponentReplyUci,
      engineVersion: this.engineVersion,
      engineSha256: this.engineSha256,
    };
  }
}
