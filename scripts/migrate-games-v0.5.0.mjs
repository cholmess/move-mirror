import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePgnGame } from "../server/games/model.mjs";
import { createGamesStore } from "../server/games/store.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const store = createGamesStore(path.join(DATA, "games"));
store.ensure();
store.backup("pre-v0.5.0");

const protectedPaths = [
  "data/transfer/baseline",
  "data/transfer/cohorts",
  "data/defense",
  "src/data/generated",
  "shared/transfer/intervention.js",
];
const before = hashPaths(protectedPaths);
const references = historicalGames();
const job = store.createJob("chess_com", { migration: "v0.5.0" });
store.updateJob(job.id, { status: "running", startedAt: new Date().toISOString() });
const equivalence = {};
const errors = [];
let migrated = 0;
let duplicates = 0;
let conflicts = 0;

for (const row of references) {
  if (equivalence[row.gameId]) continue;
  try {
    const parsed = parsePgnGame(row.pgn);
    const result = store.importParsed({
      parsed,
      raw: row.pgn,
      sourceType: "chess_com",
      importJobId: job.id,
      externalId: row.gameId,
      parsedMetadata: { migrationSource: row.file, historicalGameId: row.gameId },
      overrides: { sourceUsername: store.readIdentity().chessComUsernames[0] },
    });
    equivalence[row.gameId] = result.game.id;
    migrated += result.disposition === "new_canonical_game" ? 1 : 0;
    duplicates += result.disposition === "new_canonical_game" ? 0 : 1;
    conflicts += result.conflicts.length;
  } catch (error) {
    errors.push({ gameId: row.gameId, file: row.file, error: String(error.message).slice(0, 200) });
  }
}

const after = hashPaths(protectedPaths);
const protectedUnchanged = JSON.stringify(before) === JSON.stringify(after);
const report = {
  version: "migration-v0.5.0",
  migrationId: randomUUID(),
  completedAt: new Date().toISOString(),
  historicalRecordsDiscovered: references.length,
  canonicalGamesCreated: migrated,
  duplicatesMerged: duplicates,
  metadataConflicts: conflicts,
  failures: errors.length,
  errors,
  equivalence,
  protectedArtifacts: {
    unchanged: protectedUnchanged,
    before,
    after,
  },
  guarantees: {
    baselineRecalculated: false,
    cohortsModified: false,
    exerciseDatasetsModified: false,
    defenseLabModified: false,
    doseProtocolModified: false,
    automaticTransferEnrollment: false,
  },
};

writeFileSync(path.join(DATA, "games", "historical-id-map.json"), `${JSON.stringify(equivalence, null, 2)}\n`);
writeFileSync(path.join(DATA, "games", "migration-v0.5.0.json"), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(path.join(DATA, "games", "migration-v0.5.0.md"), markdown(report));
store.updateJob(job.id, {
  status: errors.length ? "completed_with_errors" : "completed",
  completedAt: report.completedAt,
  summary: {
    discovered: references.length,
    parsed: references.length - errors.length,
    newCanonicalGames: migrated,
    mergedDuplicates: duplicates,
    exactDuplicates: 0,
    requiresReview: conflicts,
    excluded: 0,
    failed: errors.length,
  },
  errors,
});
console.log(JSON.stringify(report, null, 2));
if (!protectedUnchanged) process.exitCode = 1;

function historicalGames() {
  const cohorts = path.join(DATA, "transfer", "cohorts");
  if (!existsSync(cohorts)) return [];
  const rows = [];
  for (const cohort of readdirSync(cohorts)) {
    const file = path.join(cohorts, cohort, "games.json");
    if (!existsSync(file)) continue;
    for (const game of JSON.parse(readFileSync(file, "utf8"))) {
      if (game.gameId && typeof game.pgn === "string" && game.pgn.includes("[")) {
        rows.push({ gameId: game.gameId, pgn: game.pgn, file: path.relative(ROOT, file) });
      }
    }
  }
  return rows;
}

function hashPaths(paths) {
  const result = {};
  for (const relative of paths) result[relative] = hashTree(path.join(ROOT, relative));
  return result;
}

function hashTree(target) {
  if (!existsSync(target)) return null;
  const hash = createHash("sha256");
  const visit = (entry) => {
    if (statSync(entry).isDirectory()) {
      for (const name of readdirSync(entry).sort()) visit(path.join(entry, name));
    } else {
      hash.update(path.relative(ROOT, entry));
      hash.update(readFileSync(entry));
    }
  };
  visit(target);
  return hash.digest("hex");
}

function markdown(report) {
  return `# Migración MoveMirror v0.5.0

- Registros históricos encontrados: ${report.historicalRecordsDiscovered}
- Partidas canónicas creadas: ${report.canonicalGamesCreated}
- Duplicados fusionados: ${report.duplicatesMerged}
- Conflictos de metadata: ${report.metadataConflicts}
- Fallos: ${report.failures}
- Artefactos protegidos sin cambios: ${report.protectedArtifacts.unchanged ? "sí" : "NO"}

## Garantías

- Baseline recalculado: no
- Cohortes modificadas: no
- Datasets de ejercicios modificados: no
- Defense Lab modificado: no
- Protocolo de dosis modificado: no
- Entrada automática en transferencia: no
`;
}
