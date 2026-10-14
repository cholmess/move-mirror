import fs from "node:fs";
import path from "node:path";
import { PATTERN_VERSION } from "../../shared/patterns/catalog.js";
export function createPatternStore(root) {
  const file = path.join(root, "state.json"), analysesDir = path.join(root, "analyses");
  const initial = () => ({ version: PATTERN_VERSION, revision: 0, analyses: {}, attempts: [], exposures: [], exercises: [],
    job: { status: "idle", completedGames: 0, totalGames: 0, completedDecisions: 0, totalDecisions: 0, error: null }, updatedAt: null });
  let state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : initial();
  const embedded = state.analyses;
  state.analyses = embedded ?? Object.fromEntries((state.analysisKeys ?? []).map(key => [key, JSON.parse(fs.readFileSync(path.join(analysesDir, key + ".json"), "utf8"))]));
  delete state.analysisKeys;
  function atomic(target, value) { fs.mkdirSync(path.dirname(target), { recursive: true }); const tmp = target + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(value), "utf8"); fs.renameSync(tmp, target); }
  function read() { const { analyses, ...meta } = state; return { ...structuredClone(meta), analyses: { ...analyses } }; }
  function write(next, changedKeys = []) {
    for (const key of changedKeys) atomic(path.join(analysesDir, key + ".json"), next.analyses[key]);
    const { analyses, ...meta } = next;
    atomic(file, { ...meta, analysisKeys: Object.keys(analyses) });
    for (const key of Object.keys(state.analyses)) if (!analyses[key]) fs.rmSync(path.join(analysesDir, key + ".json"), { force: true });
    state = next;
  }
  if (embedded && Object.keys(embedded).length) write(read(), Object.keys(embedded));
  if (state.job.status === "running" || state.job.status === "queued") { const next = read(); next.job.status = "interrupted"; write(next); }
  return { read, write };
}
