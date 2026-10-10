import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createGamesStore } from "./store.mjs";
import { createImportService } from "./import-service.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PROTECTED = [
  "data/transfer/baseline",
  "data/transfer/cohorts",
  "data/defense",
  "src/data/generated",
  "shared/transfer/intervention.js",
];

const PGN = `[Event "Integration"]
[White "Visitor"]
[Black "Host"]
[TimeControl "180+0"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 1-0`;

describe("import hub integration", () => {
  it("does not change frozen baseline, cohorts, exercises, defense or dose protocol", async () => {
    const before = hashPaths(PROTECTED);
    const root = mkdtempSync(path.join(tmpdir(), "move-mirror-int-"));
    const store = createGamesStore(root, { projectRoot: ROOT });
    store.ensure();
    const service = createImportService(store);
    await service.importPgn({ sourceType: "pgn_text", text: PGN });
    expect(hashPaths(PROTECTED)).toEqual(before);
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps every historical transfer game id resolvable", () => {
    const store = createGamesStore(path.join(ROOT, "data/games"), { projectRoot: ROOT });
    const map = JSON.parse(readFileSync(path.join(ROOT, "data/games/historical-id-map.json"), "utf8"));
    for (const [historicalId, canonicalId] of Object.entries(map)) {
      expect(store.resolveHistoricalId(historicalId)?.id).toBe(canonicalId);
    }
    const report = store.verify();
    expect(report.ok).toBe(true);
    expect(report.historicalIds).toBe(Object.keys(map).length);
  });

  it("keeps exercise and defense datasets pointing at their original game ids", () => {
    const core = JSON.parse(readFileSync(path.join(ROOT, "src/data/generated/exercises.core.json"), "utf8"));
    expect(core.every((exercise) => exercise.gameUrl || exercise.id)).toBe(true);
    const defense = JSON.parse(readFileSync(path.join(ROOT, "data/defense/defense-lab-v1.json"), "utf8"));
    expect(JSON.stringify(defense)).toContain("gameId");
  });

  it("does not mark an imported imprecise-date game as transfer eligible", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "move-mirror-int-"));
    const store = createGamesStore(root, { projectRoot: ROOT });
    const service = createImportService(store);
    const job = await service.importPgn({
      sourceType: "pgn_text",
      text: `[Event "Daily"]\n[Date "2026.10.10"]\n[White "A"]\n[Black "B"]\n[TimeControl "600"]\n[Result "1-0"]\n\n1. e4 e5 1-0`,
    });
    const game = store.getGame(job.checkpoint.importedGameIds[0]);
    expect(game.timing.datePrecision).toBe("day");
    expect(game.eligibility.transferEligible).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});

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
