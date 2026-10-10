import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { SPARRING_POLICY_VERSION } from "../../shared/sparring/constants.js";

export function makeSparringDecisionCacheKey(input) {
  const parts = {
    fen: input.fen,
    candidateBudgetId: input.candidateBudgetId,
    engineSha256: input.engineSha256 ?? "unknown",
    multiPv: input.multiPv,
    policyVersion: input.policyVersion ?? SPARRING_POLICY_VERSION,
    profileSnapshotHash: input.profileSnapshotHash,
    style: input.style,
    seed: input.seed,
    turnKey: input.turnKey,
  };
  return crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export class SparringCache {
  constructor(rootDir) {
    this.rootDir = rootDir;
    fs.mkdirSync(rootDir, { recursive: true });
  }

  _path(key) {
    return path.join(this.rootDir, `${key}.json`);
  }

  get(key) {
    try {
      return JSON.parse(fs.readFileSync(this._path(key), "utf8"));
    } catch {
      return null;
    }
  }

  set(key, value) {
    const file = this._path(key);
    const tmp = `${file}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(value));
    fs.renameSync(tmp, file);
  }
}
