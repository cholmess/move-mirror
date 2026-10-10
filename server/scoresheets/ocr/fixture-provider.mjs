import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/scoresheets");

export function createFixtureScoresheetOcrProvider() {
  return {
    id: "fixture",
    version: "scoresheet-ocr-fixture-v1",
    async isAvailable() {
      return existsSync(FIXTURES);
    },
    async recognize(processed) {
      const hint = String(processed.originalFilename ?? "").toLowerCase();
      const scenarios = [
        "clear-en", "clear-es", "clear-de", "castling-zero", "unclear-capture", "s-five-confusion",
        "ambiguous-legal-moves", "rotated-image", "low-contrast", "two-page-pdf", "early-correction",
        "dedup-scoresheet", "ambiguous", "default", "spanish", "german", "sample",
      ];
      const hinted = scenarios.find((id) => hint.includes(id)) ?? (hint.includes("sample") ? "clear-en" : null);
      const key = processed.fixtureId || hinted || processed.fixtureKey || processed.draftId;
      const file = path.join(FIXTURES, `${key}.observation.json`);
      if (!existsSync(file)) {
        const fallback = path.join(FIXTURES, "default.observation.json");
        if (!existsSync(fallback)) throw new Error("scoresheet_fixture_missing");
        return JSON.parse(readFileSync(fallback, "utf8"));
      }
      return JSON.parse(readFileSync(file, "utf8"));
    },
  };
}
