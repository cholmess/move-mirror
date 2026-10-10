import { createFixtureScoresheetOcrProvider } from "./fixture-provider.mjs";
import { createTesseractScoresheetOcrProvider } from "./tesseract-provider.mjs";

export async function resolveScoresheetOcrProvider(mode = process.env.SCORESHEET_OCR_PROVIDER ?? "auto") {
  const fixture = createFixtureScoresheetOcrProvider();
  const tesseract = createTesseractScoresheetOcrProvider();
  if (mode === "fixture") return fixture;
  if (mode === "tesseract") return tesseract;
  if (mode === "auto") {
    if (process.env.NODE_ENV === "test" || process.env.SCORESHEET_E2E === "1") {
      if (await fixture.isAvailable()) return fixture;
    }
    if (await tesseract.isAvailable()) return tesseract;
    if (await fixture.isAvailable()) return fixture;
  }
  return tesseract;
}
