#!/usr/bin/env node
/**
 * Builds data/puzzles/bank.json from the Lichess puzzle database (CC0).
 *   Download (≈250 MB): https://database.lichess.org/lichess_db_puzzle.csv.zst
 *   npm run puzzles:import -- --file ~/Downloads/lichess_db_puzzle.csv.zst
 * Options: --min 800 --max 2000 --limit 60000 --out data/puzzles/bank.json
 * .zst files are decompressed with the `zstd` CLI (brew install zstd).
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { PUZZLE_BANK_VERSION, PATTERN_THEMES, compactPuzzle, keepPuzzle, parseCsvLine, validatePuzzle } from "../shared/daily/puzzles.js";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}
const file = arg("file");
if (!file) { console.error("Usage: npm run puzzles:import -- --file <lichess_db_puzzle.csv[.zst]>"); process.exit(1); }
const filters = { minRating: Number(arg("min", 800)), maxRating: Number(arg("max", 2000)) };
const limit = Number(arg("limit", 60000));
const out = path.resolve(arg("out", "data/puzzles/bank.json"));
// Keep the bank balanced: no theme group may take more than its share.
const perPatternCap = Math.ceil(limit / Object.keys(PATTERN_THEMES).length * 1.5);

let input; let child = null;
if (file.endsWith(".zst")) {
  child = spawn("zstd", ["-dc", file], { stdio: ["ignore", "pipe", "inherit"] });
  child.on("error", () => { console.error("zstd not found. Install it (brew install zstd) or pass the decompressed .csv"); process.exit(1); });
  input = child.stdout;
} else input = fs.createReadStream(file);

const rows = []; const perPattern = {}; let seen = 0; let invalid = 0;
const rl = readline.createInterface({ input, crlfDelay: Infinity });
for await (const line of rl) {
  seen++;
  const p = parseCsvLine(line);
  if (!keepPuzzle(p, filters)) continue;
  const groups = Object.entries(PATTERN_THEMES).filter(([, t]) => t.some(x => p.themes.includes(x))).map(([k]) => k);
  if (groups.every(g => (perPattern[g] ?? 0) >= perPatternCap)) continue;
  if (!validatePuzzle(p)) { invalid++; continue; }
  for (const g of groups) perPattern[g] = (perPattern[g] ?? 0) + 1;
  rows.push(compactPuzzle(p));
  if (rows.length >= limit) break;
  if (seen % 500000 === 0) console.log(`  read ${seen.toLocaleString()} · kept ${rows.length.toLocaleString()}`);
}
rl.close(); child?.kill();
fs.mkdirSync(path.dirname(out), { recursive: true });
const bank = { version: PUZZLE_BANK_VERSION, source: "Lichess puzzle database (CC0)", importedAt: new Date().toISOString(),
  filters: { ...filters, limit }, perPattern, count: rows.length, rows };
fs.writeFileSync(out + ".tmp", JSON.stringify(bank)); fs.renameSync(out + ".tmp", out);
console.log(`Puzzle bank: ${rows.length.toLocaleString()} puzzles (${invalid} invalid skipped) → ${path.relative(process.cwd(), out)}`);
console.log(perPattern);
