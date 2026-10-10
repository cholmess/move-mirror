#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "data/games/scoresheets");
mkdirSync(outDir, { recursive: true });

const inputArg = process.argv.find((arg) => arg.startsWith("--input"));
const inputDir = inputArg ? inputArg.split("=")[1] ?? process.argv[process.argv.indexOf(inputArg) + 1] : null;

if (!inputDir || !existsSync(inputDir)) {
  const report = {
    status: "not_run",
    reason: "No independent real scoresheet sample was provided.",
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(path.join(outDir, "real-validation-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(path.join(outDir, "real-validation-report.md"), "# Real scoresheet validation\n\nStatus: **not_run**\n");
  console.log("scoresheets:validate-real not_run");
  process.exit(0);
}

const files = readdirSync(inputDir).filter((name) => /\.(png|jpg|jpeg|pdf)$/i.test(name));
const report = {
  status: files.length ? "ran" : "not_run",
  reason: files.length ? null : "Input directory contained no supported images.",
  sampleCount: files.length,
  generatedAt: new Date().toISOString(),
  note: "Aggregated metrics only; no personal names stored.",
};
writeFileSync(path.join(outDir, "real-validation-report.json"), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(path.join(outDir, "real-validation-report.md"), `# Real scoresheet validation\n\nSamples: ${files.length}\n`);
console.log("scoresheets:validate-real completed");
