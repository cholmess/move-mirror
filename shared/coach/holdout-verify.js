import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function loadBundledExerciseFens(rootDir = ROOT) {
  const pool = JSON.parse(
    fs.readFileSync(path.join(rootDir, "src/data/generated/exercises.pool.json"), "utf8"),
  );
  const core = JSON.parse(
    fs.readFileSync(path.join(rootDir, "src/data/generated/exercises.core.json"), "utf8"),
  );
  return new Set([...pool, ...core].map((row) => row.fen));
}

export function assertEvalContentIndependent(content, rootDir = ROOT) {
  const bundled = loadBundledExerciseFens(rootDir);
  const issues = [];
  if (bundled.has(content.fen)) issues.push("fen_in_client_bundle");
  if (content.sourceExerciseId && String(content.sourceExerciseId).startsWith("ex-")) {
    const pool = JSON.parse(
      fs.readFileSync(path.join(rootDir, "src/data/generated/exercises.pool.json"), "utf8"),
    );
    if (pool.some((row) => row.id === content.sourceExerciseId)) {
      issues.push("source_id_in_client_bundle");
    }
  }
  return { ok: issues.length === 0, issues };
}
