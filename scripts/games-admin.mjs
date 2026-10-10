import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGamesStore } from "../server/games/store.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const store = createGamesStore(path.join(ROOT, "data/games"));
store.ensure();
const command = process.argv[2];

if (command === "reindex") {
  const index = store.rebuildIndex();
  console.log(JSON.stringify({ ok: true, fingerprints: Object.keys(index.byFingerprint).length, updatedAt: index.updatedAt }, null, 2));
} else if (command === "verify") {
  const report = store.verify();
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} else if (command === "export") {
  const target = path.join(ROOT, "data/games/export");
  mkdirSync(path.join(target, "pgn"), { recursive: true });
  const games = store.listGames();
  writeFileSync(path.join(target, "canonical-games.json"), `${JSON.stringify(games, null, 2)}\n`);
  for (const game of games) {
    const available = game.sources.find((source) => source.rawLocation);
    if (available) {
      writeFileSync(
        path.join(target, "pgn", `${game.id}.pgn`),
        readFileSync(path.join(store.root, available.rawLocation), "utf8"),
      );
    }
  }
  console.log(JSON.stringify({ ok: true, games: games.length, location: path.relative(ROOT, target) }, null, 2));
} else {
  console.error("Usage: node scripts/games-admin.mjs <reindex|verify|export>");
  process.exitCode = 2;
}
