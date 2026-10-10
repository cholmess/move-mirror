#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGamesStore } from "../server/games/store.mjs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2] ?? "verify";
const gamesRoot = path.resolve(process.env.GAMES_DATA_DIR ?? path.join(repoRoot, "data/games"));
const store = createGamesStore(gamesRoot, { projectRoot: repoRoot });
store.ensure();

if (command === "verify") {
  const result = store.scoresheetStore.verify();
  if (result.issues.length) {
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  console.log(`scoresheets:verify ok (${result.drafts} drafts)`);
  process.exit(0);
}

if (command === "cleanup") {
  const result = store.scoresheetStore.cleanupOrphans();
  console.log(`scoresheets:cleanup removed ${result.removed} orphan files`);
  process.exit(0);
}

console.error(`unknown command: ${command}`);
process.exit(1);
