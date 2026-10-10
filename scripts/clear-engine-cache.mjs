import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root =
  process.env.ENGINE_CACHE_DIR ??
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data/engine-cache");

if (fs.existsSync(root)) {
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`Cleared engine cache: ${root}`);
} else {
  console.log(`No cache at ${root}`);
}
