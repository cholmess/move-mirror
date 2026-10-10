#!/usr/bin/env node
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures/scoresheets");
mkdirSync(root, { recursive: true });

const scenarios = [
  { id: "clear-en", locale: "en", lines: ["White: ScoresheetAlice", "Black: ScoresheetBob", "1. e4 e5", "2. Nf3 Nc6"], moves: ["e4", "e5", "Nf3", "Nc6"] },
  { id: "clear-es", locale: "es", lines: ["1. e4 e5", "2. Cf3"], moves: ["e4", "e5", "Cf3"] },
  { id: "clear-de", locale: "de", lines: ["1. e4 e5", "2. Sf3"], moves: ["e4", "e5", "Sf3"] },
  { id: "castling-zero", locale: "en", lines: ["1. e4 e5", "2. 0-0"], moves: ["e4", "e5", "0-0"] },
  { id: "unclear-capture", locale: "en", lines: ["1. e4 d5", "2. exd5"], moves: ["e4", "d5", "exd5"] },
  { id: "s-five-confusion", locale: "de", lines: ["1. e4 e5", "2. 5f3"], moves: ["e4", "e5", "Sf3"], ocrTypos: { "5f3": "5f3" } },
  { id: "ambiguous-legal-moves", locale: "en", lines: ["1. e4 e5", "2. Nd3"], moves: ["e4", "e5", "Nc3"], expectReview: 1, ambiguousToken: "Nd3" },
  { id: "rotated-image", locale: "en", lines: ["1. d4 d5", "2. c4"], moves: ["d4", "d5", "c4"], rotate: 90 },
  { id: "low-contrast", locale: "en", lines: ["1. c4 c5", "2. Nf3"], moves: ["c4", "c5", "Nf3"], lowContrast: true },
  { id: "early-correction", locale: "en", lines: ["1. e4 e5", "2. Nf3 Nc6"], moves: ["e4", "e5", "Nf3", "Nc6"], forkPly: 3 },
  { id: "dedup-scoresheet", locale: "en", lines: ["White: DedupAlice", "Black: DedupBob", "1. a3 h6", "2. b3 g6"], moves: ["a3", "h6", "b3", "g6"] },
];

function tokensFromLines(lines, width = 800) {
  const tokens = [];
  let y = 120;
  for (const line of lines) {
    const parts = line.split(/\s+/);
    let x = 40;
    for (const part of parts) {
      if (/^\d+\.$/.test(part)) {
        tokens.push(token(part, x, y, 0.99));
        x += 30;
        continue;
      }
      tokens.push(token(part, x, y, part === "5f3" || part === "Nd3" ? 0.55 : 0.93));
      x += part.length > 3 ? 90 : 60;
    }
    y += 30;
  }
  return tokens;
}

function token(text, x, y, confidence) {
  const id = `t-${text}-${x}-${y}`;
  const side = x > 300 ? "black" : "white";
  return {
    id,
    page: 1,
    text,
    confidence,
    boundingBox: { x, y, width: Math.max(20, text.length * 10), height: 14 },
    lineId: `line-${y}`,
    side,
  };
}

async function renderPng(lines, { rotate = 0, lowContrast = false } = {}) {
  const svgLines = lines.map((line, i) => `<text x="40" y="${120 + i * 30}" font-size="28" font-family="monospace">${line}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">${svgLines}</svg>`;
  let img = sharp(Buffer.from(svg)).png();
  if (lowContrast) img = img.modulate({ brightness: 1.2 }).linear(0.6, 40);
  if (rotate) img = img.rotate(rotate, { background: "#ffffff" });
  return img.png().toBuffer();
}

function writeObservation(id, lines, extra = {}) {
  const tokens = tokensFromLines(lines);
  const observation = {
    providerId: "fixture",
    providerVersion: "scoresheet-ocr-fixture-v1",
    pages: [{ page: 1, width: 800, height: 600, rawText: lines.join("\n"), tokens }],
    ...extra,
  };
  writeFileSync(path.join(root, `${id}.observation.json`), `${JSON.stringify(observation, null, 2)}\n`);
}

function writeGround(id, scenario) {
  writeFileSync(path.join(root, `${id}.ground.json`), `${JSON.stringify({
    id,
    locale: scenario.locale,
    expectedPlies: scenario.moves.length,
    expectedMoves: scenario.moves,
    expectedHumanReview: scenario.expectReview ?? 0,
    metadata: { result: "*" },
  }, null, 2)}\n`);
}

for (const scenario of scenarios) {
  writeObservation(scenario.id, scenario.lines);
  writeGround(scenario.id, scenario);
  writeFileSync(path.join(root, `${scenario.id}.png`), await renderPng(scenario.lines, scenario));
}

writeFileSync(path.join(root, "ambiguous.observation.json"), readFileSync(path.join(root, "ambiguous-legal-moves.observation.json")));
writeFileSync(path.join(root, "default.observation.json"), readFileSync(path.join(root, "clear-en.observation.json")));
writeFileSync(path.join(root, "spanish.observation.json"), readFileSync(path.join(root, "clear-es.observation.json")));
writeFileSync(path.join(root, "german.observation.json"), readFileSync(path.join(root, "clear-de.observation.json")));

await renderPng(["White: ScoresheetAlice", "Black: ScoresheetBob", "1. e4 e5", "2. Nf3 Nc6"]).then((png) => {
  writeFileSync(path.join(root, "sample.png"), png);
  writeFileSync(path.join(root, "clear-en.png"), png);
  writeFileSync(path.join(root, "ambiguous.png"), readFileSync(path.join(root, "ambiguous-legal-moves.png")));
});

const twoPagePdf = await PDFDocument.create();
const font = await twoPagePdf.embedFont(StandardFonts.Helvetica);
for (const [index, text] of [["1. e4 e5", "2. Nf3"], ["3. Nc6", "1-0"]].entries()) {
  const page = twoPagePdf.addPage([612, 792]);
  page.drawText(text[0], { x: 50, y: 700, size: 18, font, color: rgb(0, 0, 0) });
  page.drawText(text[1], { x: 50, y: 670, size: 18, font, color: rgb(0, 0, 0) });
}
writeFileSync(path.join(root, "two-page-pdf.pdf"), await twoPagePdf.save());
writeObservation("two-page-pdf", ["1. e4 e5", "2. Nf3", "3. Nc6"], { pageCount: 2 });
writeGround("two-page-pdf", { locale: "en", moves: ["e4", "e5", "Nf3", "Nc6"], expectReview: 0 });

const clearPdfPath = path.join(root, "_clear-for-encrypt.pdf");
writeFileSync(clearPdfPath, await twoPagePdf.save());
const encryptedPath = path.join(root, "encrypted.pdf");
const gsEncrypt = spawnSync("gs", [
  "-q",
  "-dNOPAUSE",
  "-dBATCH",
  "-sDEVICE=pdfwrite",
  "-dCompatibilityLevel=1.4",
  "-sOwnerPassword=owner",
  "-sUserPassword=secret",
  `-sOutputFile=${encryptedPath}`,
  clearPdfPath,
], { encoding: "utf8" });
if (gsEncrypt.status !== 0) {
  throw new Error(`build-scoresheet-fixtures: gs encrypt failed: ${gsEncrypt.stderr ?? gsEncrypt.stdout}`);
}
try {
  unlinkSync(clearPdfPath);
} catch {
  /* ignore */
}
writeFileSync(path.join(root, "corrupt.pdf"), Buffer.from("%PDF-1.4\n%corrupt payload"));

writeFileSync(path.join(root, "manifest.json"), `${JSON.stringify({
  version: "scoresheet-fixtures-v1",
  scenarios: scenarios.map((s) => s.id).concat(["two-page-pdf"]),
}, null, 2)}\n`);

console.log("build-scoresheet-fixtures: ok");
