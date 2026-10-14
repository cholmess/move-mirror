import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { BUDGET_SHALLOW } from "../shared/evaluation/budgets.js";

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

export class StockfishEngine {
  constructor(enginePath) {
    this.enginePath = enginePath;
    this.proc = null;
    this.lines = [];
    this.engineVersion = null;
    this.engineSha256 = null;
    this.stopping = false;
    try {
      const resolvedPath = enginePath.includes("/")
        ? enginePath
        : execFileSync("which", [enginePath], { encoding: "utf8" }).trim();
      const buf = readFileSync(resolvedPath);
      this.engineSha256 = createHash("sha256").update(buf).digest("hex");
    } catch {
      this.engineSha256 = null;
    }
  }

  get isAlive() {
    return Boolean(this.proc && !this.proc.killed);
  }

  _attachListeners() {
    const attachedProc = this.proc;
    attachedProc.stdout.on("data", (chunk) => {
      for (const line of chunk.toString().split("\n")) {
        const t = line.trim();
        if (t) this.lines.push(t);
        if (t.startsWith("id name ")) this.engineVersion = t.slice(8);
      }
    });
    attachedProc.stderr.on("data", () => {});
    attachedProc.on("error", () => {
      if (this.proc === attachedProc) this._dead = true;
    });
    attachedProc.on("close", () => {
      if (this.proc !== attachedProc) return;
      this.proc = null;
      if (!this.stopping) {
        this._dead = true;
      }
    });
  }

  async start() {
    if (this.isAlive) return;
    this.stopping = false;
    this._dead = false;
    this.proc = spawn(this.enginePath, [], { stdio: ["pipe", "pipe", "pipe"] });
    this._attachListeners();
    this.lines = [];
    await this._command("uci", /uciok/);
    await this._command("isready", /readyok/);
    await this._command(`setoption name Threads value ${BUDGET_SHALLOW.threads}`, null);
    await this._command(`setoption name Hash value ${BUDGET_SHALLOW.hashMb}`, null);
    await this._command("isready", /readyok/);
  }

  async restart() {
    await this.stop();
    await this.start();
  }

  async stop() {
    this.stopping = true;
    if (!this.proc) return;
    try {
      this.proc.stdin.write("quit\n");
    } catch {
      /* ignore */
    }
    this.proc.kill();
    this.proc = null;
  }

  async _command(cmd, waitPattern, { signal, timeoutMs = 45_000 } = {}) {
    if (!this.isAlive) await this.start();
    if (waitPattern) this.lines = [];
    this.proc.stdin.write(`${cmd}\n`);
    if (!waitPattern) return;

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (signal?.aborted) throw new Error("aborted");
      if (this._dead) throw new Error("engine_died");
      const hit = this.lines.find((l) => waitPattern.test(l));
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 8));
    }
    throw new Error("engine_timeout");
  }

  async analyseMultiPv(
    fen,
    { multiPv = 6, nodes, threads = 1, hashMb = 128, signal, timeoutMs = 120_000 } = {},
  ) {
    if (this._dead) await this.restart();
    await this.start();
    await this._command(`setoption name MultiPV value ${multiPv}`, null, { signal, timeoutMs });
    await this._command(`setoption name Threads value ${threads}`, null, { signal, timeoutMs });
    await this._command(`setoption name Hash value ${hashMb}`, null, { signal, timeoutMs });
    await this.clearHash(signal);
    this.lines = [];
    this.proc.stdin.write(`position fen ${fen}\ngo nodes ${nodes}\n`);

    const byMultipv = new Map();
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (signal?.aborted) throw new Error("aborted");
      if (this._dead) throw new Error("engine_died");

      for (const l of this.lines) {
        if (!l.startsWith("info ") || !l.includes(" multipv ") || !l.includes(" pv ")) continue;
        const mpM = l.match(/multipv (\d+)/);
        const multipv = mpM ? Number(mpM[1]) : 1;
        const score = parseScore(l);
        const pvUci = parsePv(l);
        const depthM = l.match(/depth (\d+)/);
        const nodesM = l.match(/nodes (\d+)/);
        byMultipv.set(multipv, {
          multipv,
          score,
          depth: depthM ? Number(depthM[1]) : undefined,
          nodes: nodesM ? Number(nodesM[1]) : undefined,
          pvUci,
          firstMoveUci: pvUci[0] ?? null,
        });
      }

      const bestmove = this.lines.find((line) => line.startsWith("bestmove "));
      if (bestmove) {
        const lines = [...byMultipv.values()].sort((a, b) => a.multipv - b.multipv);
        if (!lines.length) {
          const bm = bestmove.split(" ")[1];
          lines.push({
            multipv: 1,
            score: { cp: 0, mate: null, numeric: 0 },
            pvUci: bm && bm !== "(none)" ? [bm] : [],
            firstMoveUci: bm && bm !== "(none)" ? bm : null,
          });
        }
        await this._command("setoption name MultiPV value 1", null, { signal, timeoutMs: 20_000 });
        return { lines, nodesRequested: nodes };
      }
      await new Promise((r) => setTimeout(r, 8));
    }
    throw new Error("analysis_timeout");
  }

  async analyse(fen, { rootMoves = null, nodes, signal, timeoutMs = 90_000 } = {}) {
    if (this._dead) await this.restart();
    await this.start();

    this.lines = [];
    const pos = rootMoves?.length
      ? `position fen ${fen} moves ${rootMoves.join(" ")}`
      : `position fen ${fen}`;

    await this._command(pos, null, { signal, timeoutMs });
    await this._command(`go nodes ${nodes}`, null, { signal, timeoutMs });

    let lastInfo = null;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (signal?.aborted) throw new Error("aborted");
      if (this._dead) throw new Error("engine_died");

      for (const l of this.lines) {
        if (l.startsWith("info ") && l.includes(" score ") && l.includes(" pv ")) {
          lastInfo = l;
        }
      }
      const bestmove = this.lines.find((l) => l.startsWith("bestmove "));
      if (bestmove) {
        if (!lastInfo) throw new Error("no_analysis");
        const score = parseScore(lastInfo);
        const pvUci = parsePv(lastInfo);
        const depthM = lastInfo.match(/depth (\d+)/);
        const nodesM = lastInfo.match(/nodes (\d+)/);
        const bm = bestmove.split(" ")[1] ?? null;
        return {
          score,
          depth: depthM ? Number(depthM[1]) : undefined,
          nodes: nodesM ? Number(nodesM[1]) : undefined,
          pvUci,
          firstMoveUci: rootMoves?.[0] ?? pvUci[0] ?? bm,
        };
      }
      await new Promise((r) => setTimeout(r, 8));
    }
    throw new Error("analysis_timeout");
  }

  async evaluatePair(fen, playedUci, budget, signal) {
    // Both scores and PVs must describe the mover's decision at the same root.
    return this.analyseDecision(fen, playedUci, budget.nodes, signal);
  }

  /**
   * Two searches from the position before the move.
   * The played line uses UCI `searchmoves`, so the score stays in the
   * mover's POV and pv[1] is the principal opponent reply.
   */
  async analyseDecision(fen, playedUci, nodes, signal) {
    const best = await this._searchFen(fen, nodes, null, signal);
    const played = await this._searchFen(fen, nodes, playedUci, signal);
    const cpLoss =
      best.score?.numeric === undefined || played.score?.numeric === undefined
        ? null
        : best.score.numeric - played.score.numeric;
    return {
      best,
      played,
      cpLoss,
      opponentReplyUci: played.pvUci[1] ?? null,
      nodesRequested: nodes,
    };
  }

  async clearHash(signal) {
    await this._command("setoption name Clear Hash", null, { signal, timeoutMs: 20_000 });
    await this._command("isready", /readyok/, { signal, timeoutMs: 20_000 });
  }

  async _searchFen(fen, nodes, searchMove, signal) {
    if (this._dead) await this.restart();
    await this.start();
    await this.clearHash(signal);
    this.lines = [];
    const go = searchMove
      ? `go nodes ${nodes} searchmoves ${searchMove}`
      : `go nodes ${nodes}`;
    this.proc.stdin.write(`position fen ${fen}\n${go}\n`);
    const timeoutMs = nodes >= 500_000 ? 300_000 : 120_000;
    const start = Date.now();
    let lastInfo = null;
    while (Date.now() - start < timeoutMs) {
      if (signal?.aborted) throw new Error("aborted");
      if (this._dead) throw new Error("engine_died");
      for (const l of this.lines) {
        if (l.startsWith("info ") && l.includes(" score ") && l.includes(" pv ")) {
          lastInfo = l;
        }
      }
      const bestmove = this.lines.find((l) => l.startsWith("bestmove "));
      if (bestmove) {
        if (!lastInfo) throw new Error("no_analysis");
        const score = parseScore(lastInfo);
        const pvUci = parsePv(lastInfo);
        const depthM = lastInfo.match(/depth (\d+)/);
        const nodesM = lastInfo.match(/nodes (\d+)/);
        const bm = bestmove.split(" ")[1] ?? null;
        if (!bm || bm === "(none)") throw new Error("no_move");
        return {
          score,
          depth: depthM ? Number(depthM[1]) : undefined,
          nodes: nodesM ? Number(nodesM[1]) : undefined,
          pvUci,
          firstMoveUci: pvUci[0] ?? bm,
        };
      }
      await new Promise((r) => setTimeout(r, 6));
    }
    throw new Error("analysis_timeout");
  }
}
