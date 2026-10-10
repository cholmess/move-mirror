import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { EVAL_CRITERION_ID, EVAL_PIPELINE_VERSION } from "../shared/evaluation/budgets.js";

export function cacheKeyParts(input) {
  return {
    fen: input.fen,
    uci: input.uci.toLowerCase(),
    engineSha256: input.engineSha256 ?? "unknown",
    threads: input.threads,
    hashMb: input.hashMb,
    budgetId: input.budgetId,
    criterion: input.criterion ?? EVAL_CRITERION_ID,
    pipeline: input.pipeline ?? EVAL_PIPELINE_VERSION,
  };
}

export function makeCacheKey(input) {
  const parts = cacheKeyParts(input);
  return crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export class EvalCache {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.shallowDir = path.join(rootDir, "shallow");
    this.deepDir = path.join(rootDir, "deep");
    this.finalDir = path.join(rootDir, "final");
    for (const d of [this.rootDir, this.shallowDir, this.deepDir, this.finalDir]) {
      fs.mkdirSync(d, { recursive: true });
    }
  }

  _path(tier, key) {
    const base =
      tier === "shallow" ? this.shallowDir : tier === "deep" ? this.deepDir : this.finalDir;
    return path.join(base, `${key}.json`);
  }

  get(tier, key) {
    const file = this._path(tier, key);
    try {
      const raw = fs.readFileSync(file, "utf8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  set(tier, key, value) {
    const file = this._path(tier, key);
    const tmp = `${file}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(value));
    fs.renameSync(tmp, file);
  }

  getShallow(keyInput) {
    const key = makeCacheKey(keyInput);
    return { key, entry: this.get("shallow", key) };
  }

  setShallow(keyInput, payload) {
    const key = makeCacheKey(keyInput);
    this.set("shallow", key, payload);
    return key;
  }

  getDeep(keyInput) {
    const key = makeCacheKey({ ...keyInput, budgetId: keyInput.budgetId });
    return { key, entry: this.get("deep", key) };
  }

  setDeep(keyInput, payload) {
    const key = makeCacheKey(keyInput);
    this.set("deep", key, payload);
    return key;
  }

  getFinal(keyInput) {
    const key = makeCacheKey({ ...keyInput, budgetId: "final" });
    return { key, entry: this.get("final", key) };
  }

  setFinal(keyInput, payload) {
    const key = makeCacheKey({ ...keyInput, budgetId: "final" });
    this.set("final", key, payload);
    return key;
  }

  clearAll() {
    for (const tier of ["shallow", "deep", "final"]) {
      const dir =
        tier === "shallow" ? this.shallowDir : tier === "deep" ? this.deepDir : this.finalDir;
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith(".json")) fs.unlinkSync(path.join(dir, f));
      }
    }
  }
}

/** Repara entradas corruptas sin borrar el resto (best-effort en startup). */
export function sanitizeCacheDir(rootDir) {
  if (!fs.existsSync(rootDir)) return 0;
  let removed = 0;
  for (const sub of ["shallow", "deep", "final"]) {
    const dir = path.join(rootDir, sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      const p = path.join(dir, f);
      try {
        JSON.parse(fs.readFileSync(p, "utf8"));
      } catch {
        fs.unlinkSync(p);
        removed += 1;
      }
    }
  }
  return removed;
}
