#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { decodeScoresheetSequence } from "../shared/scoresheet/legality-decoder.mjs";
import { observationToRawMoveTokens } from "../shared/scoresheet/layout.mjs";
import { humanReviewRequiredCount, draftReviewState } from "../shared/scoresheet/review.mjs";
import { createTesseractScoresheetOcrProvider } from "../server/scoresheets/ocr/tesseract-provider.mjs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturesDir = path.join(repoRoot, "fixtures/scoresheets");
const outDir = path.join(repoRoot, "data/games/scoresheets");
mkdirSync(outDir, { recursive: true });

if (!existsSync(path.join(fixturesDir, "manifest.json"))) {
  await import("./build-scoresheet-fixtures.mjs");
}

const manifest = JSON.parse(readFileSync(path.join(fixturesDir, "manifest.json"), "utf8"));
const scenarioIds = manifest.scenarios;

function runDecoderScenario(id) {
  const observation = JSON.parse(readFileSync(path.join(fixturesDir, `${id}.observation.json`), "utf8"));
  const ground = existsSync(path.join(fixturesDir, `${id}.ground.json`))
    ? JSON.parse(readFileSync(path.join(fixturesDir, `${id}.ground.json`), "utf8"))
    : { locale: "en" };
  const moveRows = observationToRawMoveTokens(observation);
  const started = performance.now();
  const decoded = decodeScoresheetSequence({ moveRows, locale: ground.locale ?? "en" });
  const review = draftReviewState(decoded.plies);
  return {
    id,
    ms: Math.round(performance.now() - started),
    pliesTop1: decoded.plies.filter((p) => p.selectedUci).length,
    pliesTop3: decoded.plies.reduce((sum, ply) => sum + Math.min(3, ply.candidates?.length ?? 0), 0),
    sequenceLegal: review.readyToConfirm || decoded.plies.every((p) => p.selectedUci),
    humanReviewRequired: humanReviewRequiredCount(decoded.plies),
    importBlocked: !review.readyToConfirm,
    sequence: decoded.plies.map((p) => p.selectedSan).filter(Boolean),
  };
}

async function runVisualScenario(id, provider) {
  const png = path.join(fixturesDir, `${id}.png`);
  const pdf = path.join(fixturesDir, `${id}.pdf`);
  const artifact = existsSync(png) ? png : existsSync(pdf) ? pdf : null;
  if (!artifact || !provider) {
    return { id, status: "skipped_no_artifact_or_provider" };
  }
  const buffer = readFileSync(artifact);
  const meta = await sharp(buffer, { failOn: "none" }).metadata().catch(() => ({}));
  const started = performance.now();
  const observation = await provider.recognize({
    pages: [{ page: 1, buffer, width: meta.width ?? 800, height: meta.height ?? 600 }],
    originalFilename: `${id}.png`,
  });
  const moveRows = observationToRawMoveTokens(observation);
  const decoded = decodeScoresheetSequence({ moveRows, locale: "en" });
  const review = draftReviewState(decoded.plies);
  return {
    id,
    ms: Math.round(performance.now() - started),
    ocrTokens: observation.pages?.[0]?.tokens?.length ?? 0,
    pliesTop1: decoded.plies.filter((p) => p.selectedUci).length,
    humanReviewRequired: humanReviewRequiredCount(decoded.plies),
    importBlocked: !review.readyToConfirm,
    status: "ran",
  };
}

const deterministic_decoder = scenarioIds.map(runDecoderScenario);
const tesseract = createTesseractScoresheetOcrProvider();
const visualAvailable = await tesseract.isAvailable();
const synthetic_visual_pipeline = [];
if (visualAvailable) {
  for (const id of scenarioIds) {
    if (!existsSync(path.join(fixturesDir, `${id}.png`))) continue;
    synthetic_visual_pipeline.push(await runVisualScenario(id, tesseract));
  }
  await tesseract.dispose?.();
}

const report = {
  version: "scoresheet-benchmark-v2",
  generatedAt: new Date().toISOString(),
  disclaimer: "Estos resultados verifican el pipeline técnico. La precisión sobre planillas manuscritas reales necesita una muestra real independiente.",
  deterministic_decoder,
  synthetic_visual_pipeline,
  real_handwriting_validation: { status: "not_run", reason: "No independent real scoresheet sample was provided." },
};

writeFileSync(path.join(outDir, "benchmark-report.json"), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(path.join(outDir, "benchmark-report.md"), [
  "# Scoresheet benchmark",
  "",
  "> Estos resultados verifican el pipeline técnico. La precisión sobre planillas manuscritas reales necesita una muestra real independiente.",
  "",
  "## Deterministic decoder",
  ...deterministic_decoder.map((row) => `- **${row.id}**: top1=${row.pliesTop1}, humanReview=${row.humanReviewRequired}, importBlocked=${row.importBlocked}`),
  "",
  "## Synthetic visual pipeline (local OCR)",
  ...synthetic_visual_pipeline.map((row) => `- **${row.id}**: ${row.status ?? "ran"}, review=${row.humanReviewRequired ?? "n/a"}`),
  "",
  "## Real handwriting validation",
  "- status: not_run",
  "",
].join("\n"));

console.log("scoresheets:benchmark written");
