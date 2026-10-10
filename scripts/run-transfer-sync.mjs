import path from "node:path";
import { fileURLToPath } from "node:url";
import { PLAYER_USERNAME } from "../shared/transfer/constants.js";
import { createStore } from "../server/transfer/store.mjs";
import { runSync } from "../server/transfer/sync.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const store = createStore(path.join(root, "data/transfer"));
store.ensure();
const source = process.argv.includes("--fixtures") ? "fixtures" : "live";

await runSync({
  store,
  source,
  username: PLAYER_USERNAME,
  fixturesDir: path.join(root, "fixtures/chesscom"),
  enginePath: process.env.STOCKFISH_PATH ?? "stockfish",
  onProgress: (progress) => console.log(JSON.stringify(progress)),
});
console.log(JSON.stringify({ included: store.publicState().includedCount, excluded: store.publicState().excludedCount }));
