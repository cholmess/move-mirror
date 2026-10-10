import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { baselineManifestFromRows, parseGamesCsv } from "../shared/transfer/selection.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const csvPath = path.join(root, "data/fase-2/output/games.csv");
const outPath = path.join(root, "data/transfer/baseline-manifest.json");

if (!existsSync(csvPath)) {
  console.error("No está data/fase-2/output/games.csv. El manifiesto no se puede reconstruir.");
  process.exit(1);
}

const bytes = readFileSync(csvPath);
const sha256 = createHash("sha256").update(bytes).digest("hex");
if (existsSync(outPath)) {
  const previous = JSON.parse(readFileSync(outPath, "utf8"));
  if (previous.sourceSha256 && previous.sourceSha256 !== sha256) {
    throw new Error("baseline_immutable");
  }
  if (previous.sourceSha256 === sha256) {
    console.log(JSON.stringify({ status: "unchanged", cutoff: previous.cutoff }));
    process.exit(0);
  }
}

const manifest = baselineManifestFromRows(parseGamesCsv(bytes.toString("utf8")), {
  path: "data/fase-2/output/games.csv",
  sha256,
});
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ status: "written", cutoff: manifest.cutoff, games: manifest.gameCount }));
