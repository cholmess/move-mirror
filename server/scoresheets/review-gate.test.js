import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import { createGamesStore } from "../games/store.mjs";
import { createScoresheetService } from "./service.mjs";

describe("scoresheet import review gate", () => {
  it("cannot import probable ply without confirmation", async () => {
    const png = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/scoresheets/sample.png"));
    const root = mkdtempSync(path.join(tmpdir(), "mm-score-"));
    const games = createGamesStore(root);
    games.ensure();
    const service = createScoresheetService({ scoresheetStore: games.scoresheetStore, gamesStore: games });
    const draft = games.scoresheetStore.createDraft({
      filename: "x.png",
      mimeType: "image/png",
      buffer: png,
      locale: "en",
    });
    draft.transcription.plies = [{
      ply: 1,
      selectedUci: "a2a3",
      selectedSan: "a3",
      resolution: "probable",
      confirmedByUser: false,
      candidates: [],
      sourceTokenIds: [],
      rawText: "a3",
      normalizedText: "a3",
    }];
    draft.transcription.confirmedByUser = true;
    draft.status = "confirmed";
    games.scoresheetStore.writeDraft(draft);
    await expect(service.importDraft(draft.id, { playerColor: "white" })).rejects.toThrow(/SCORESHEET_REVIEW_REQUIRED/);
    rmSync(root, { recursive: true, force: true });
  });
});
