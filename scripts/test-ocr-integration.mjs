#!/usr/bin/env node
import { createTesseractScoresheetOcrProvider } from "../server/scoresheets/ocr/tesseract-provider.mjs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const png = path.join(repoRoot, "fixtures/scoresheets/sample.png");

async function main() {
  const provider = createTesseractScoresheetOcrProvider();
  const available = await provider.isAvailable();
  if (!available) {
    console.log(JSON.stringify({ status: "skipped_provider_unavailable" }));
    process.exit(0);
  }
  try {
    const buffer = await sharp({
      create: { width: 640, height: 240, channels: 3, background: "#ffffff" },
    })
      .composite([{
        input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240"><text x="40" y="120" font-size="48" font-family="monospace">1. e4 e5 2. Nf3</text></svg>`),
        top: 0,
        left: 0,
      }])
      .png()
      .toBuffer();
    const meta = await sharp(buffer).metadata();
    const observation = await provider.recognize({
      pages: [{ page: 1, buffer, width: meta.width ?? 640, height: meta.height ?? 240 }],
    });
    const text = observation.pages?.[0]?.rawText ?? "";
    const status = /e4/.test(text) ? "passed" : "failed";
    console.log(JSON.stringify({ status, providerId: observation.providerId, chars: text.length }));
    await provider.dispose?.();
    process.exit(status === "passed" ? 0 : 1);
  } catch (error) {
    console.log(JSON.stringify({ status: "failed", error: String(error.message ?? error) }));
    process.exit(1);
  }
}

void main();
