import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGamesStore } from "./store.mjs";
import { createImportService } from "./import-service.mjs";

const PGN = `[Event "Import"]
[Site "Chess.com"]
[White "cholmess21"]
[Black "Opponent"]
[TimeControl "600"]
[Result "1-0"]
[Link "https://www.chess.com/game/live/123"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0`;

describe("import jobs", () => {
  let root;
  let store;
  let service;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "move-mirror-import-"));
    store = createGamesStore(root);
    store.ensure();
    service = createImportService(store);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("is idempotent for the same pasted PGN", async () => {
    const first = await service.importPgn({ sourceType: "pgn_text", text: PGN });
    const second = await service.importPgn({ sourceType: "pgn_text", text: PGN });
    expect(first.summary.newCanonicalGames).toBe(1);
    expect(second.summary.exactDuplicates).toBe(1);
    expect(store.listGames()).toHaveLength(1);
  });

  it("cancels a queued job and refuses to resume PGN jobs", async () => {
    const job = store.createJob("pgn_text", {});
    const cancelled = service.cancel(job.id);
    expect(cancelled.status).toBe("cancelled");
    await expect(service.resume(job.id)).rejects.toThrow("source_not_resumable");
  });

  it("resumes a Chess.com job from a checkpoint using the injected client", async () => {
    const archives = {
      json: { archives: ["https://api.chess.com/pub/player/demo/games/2026/10"] },
      sha256: "a",
    };
    const month = {
      json: { games: [{ rules: "chess", end_time: 1_770_000_000, pgn: PGN }] },
      sha256: "b",
    };
    const fetchText = async (url) => (url.includes("archives") ? archives : month);
    const remote = createImportService(store, { fetchText });
    const job = store.createJob("chess_com", { username: "demo" });
    store.updateJob(job.id, { status: "cancelled", input: { username: "demo" } });
    const resumed = await remote.resume(job.id);
    expect(resumed.summary.newCanonicalGames).toBe(1);
    expect(resumed.status === "completed" || resumed.status === "awaiting_review").toBe(true);
  });

  it("counts a valid game and a failed game in the same job", async () => {
    const job = await service.importPgn({
      sourceType: "pgn_text",
      text: `${PGN}\n\n[Event "Broken"]\n[Result "*"]\n\n1. e4 e5 2. NotAMove *`,
    });
    expect(job.summary.discovered).toBe(2);
    expect(job.summary.parsed).toBe(1);
    expect(job.summary.failed).toBe(1);
    expect(job.summary.newCanonicalGames + job.summary.failed).toBe(2);
  });

  it("previews PGN without creating games", () => {
    const preview = service.previewPgn(PGN);
    expect(preview.detected).toBe(1);
    expect(preview.valid).toBe(1);
    expect(store.listGames()).toHaveLength(0);
  });

  it("saves a confirmed manual game and a draft separately", async () => {
    const confirmed = await service.importManual({
      movesUci: ["e2e4", "e7e5"],
      result: "1-0",
      playerColor: "white",
      metadata: { opponentName: "Rival", timeControl: "600+0" },
    });
    const draft = await service.importManual({
      movesUci: ["d2d4"],
      result: "*",
      playerColor: "black",
      draft: true,
      metadata: { opponentName: "Draft" },
    });
    expect(confirmed.summary.newCanonicalGames).toBe(1);
    expect(store.getGame(confirmed.checkpoint.importedGameIds[0]).eligibility.coachingEligible).toBe(true);
    expect(store.getGame(draft.checkpoint.importedGameIds[0]).eligibility.reasons).toContain("draft");
  });

  it("rejects an illegal manual move", async () => {
    const job = await service.importManual({ movesUci: ["e2e5"], result: "1-0", playerColor: "white" });
    expect(job.status).toBe("failed");
  });
});
