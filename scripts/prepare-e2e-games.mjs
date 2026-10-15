import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const allowedRoot = path.resolve(repoRoot, "data/test-games");
const target = path.resolve(process.env.GAMES_DATA_DIR ?? allowedRoot);

if (target !== allowedRoot) {
  throw new Error(`refusing_to_prepare_non_test_games_dir:${target}`);
}
if (!target.startsWith(path.resolve(repoRoot, "data") + path.sep)) {
  throw new Error(`refusing_outside_data_dir:${target}`);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
rmSync(path.join(repoRoot, "data/test-patterns"), { recursive: true, force: true });
