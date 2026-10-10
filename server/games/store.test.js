import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parsePgnGame } from "./model.mjs";
import { createGamesStore } from "./store.mjs";
import { createImportService } from "./import-service.mjs";

const PGN = `[Event "Import"]
[Site "Chess.com"]
[UTCDate "2026.10.10"]
[UTCTime "12:00:00"]
[White "cholmess21"]
[Black "Opponent"]
[WhiteElo "1200"]
[BlackElo "1210"]
[TimeControl "600"]
[Result "1-0"]
[Link "https://www.chess.com/game/live/123"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0`;

describe("games store", () => {
  let root;
  let store;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "move-mirror-games-"));
    store = createGamesStore(root);
    store.ensure();
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("deduplicates the same game across sources and preserves both source records", () => {
    const parsed = parsePgnGame(PGN);
    const first = store.importParsed({ parsed, raw: PGN, sourceType: "chess_com", importJobId: "one", externalId: "123", overrides: { sourceUsername: "cholmess21" } });
    const second = store.importParsed({ parsed, raw: PGN.replace("Chess.com", "Export"), sourceType: "pgn_file", importJobId: "two" });
    expect(second.game.id).toBe(first.game.id);
    expect(second.disposition).toBe("merged_with_existing");
    expect(store.listGames()).toHaveLength(1);
    expect(store.getGame(first.game.id).sources).toHaveLength(2);
  });

  it("is idempotent for the same source payload", () => {
    const parsed = parsePgnGame(PGN);
    store.importParsed({ parsed, raw: PGN, sourceType: "pgn_text", importJobId: "one" });
    const again = store.importParsed({ parsed, raw: PGN, sourceType: "pgn_text", importJobId: "two" });
    expect(again.disposition).toBe("exact_duplicate");
    expect(store.listGames()).toHaveLength(1);
    expect(store.listGames()[0].sources).toHaveLength(1);
  });

  it("keeps a valid game when another game in the import fails", async () => {
    const service = createImportService(store);
    const job = await service.importPgn({
      sourceType: "pgn_text",
      text: `${PGN}\n\n[Event "Broken"]\n[Result "*"]\n\n1. e4 e5 2. NotAMove *`,
    });
    expect(job.summary.discovered).toBe(2);
    expect(job.summary.newCanonicalGames).toBe(1);
    expect(job.summary.failed).toBe(1);
    expect(store.listGames()).toHaveLength(1);
  });

  it("uses atomic JSON files and can rebuild its index", () => {
    const parsed = parsePgnGame(PGN);
    const imported = store.importParsed({ parsed, raw: PGN, sourceType: "pgn_text", importJobId: "one" });
    writeFileSync(path.join(root, "index.json"), "{}");
    const index = store.rebuildIndex();
    expect(index.byFingerprint[imported.game.fingerprint]).toBe(imported.game.id);
    expect(() => JSON.parse(readFileSync(path.join(root, "canonical", `${imported.game.id}.json`), "utf8"))).not.toThrow();
  });

  it("does not make unknown time controls coaching eligible", () => {
    const parsed = parsePgnGame(PGN.replace('[TimeControl "600"]\n', ""));
    const imported = store.importParsed({ parsed, raw: "different", sourceType: "pgn_text", importJobId: "one", overrides: { playerColor: "white" } });
    expect(imported.game.eligibility.coachingEligible).toBe(false);
    expect(imported.game.eligibility.reasons).toContain("outside_rapid_10m_policy");
    expect(imported.game.eligibility.transferEligible).toBe(false);
  });

  it("makes a verified 10+0 game coaching eligible without transfer enrollment", () => {
    const parsed = parsePgnGame(PGN);
    const imported = store.importParsed({
      parsed,
      raw: PGN,
      sourceType: "chess_com",
      importJobId: "one",
      overrides: { sourceUsername: "cholmess21" },
    });
    expect(imported.game.eligibility.coachingEligible).toBe(true);
    expect(imported.game.eligibility.coachingPolicyId).toBe("rapid-10m-coaching-v1");
    expect(imported.game.eligibility.transferEligible).toBe(false);
  });

  it("merges Lichess and PGN copies of the same game", () => {
    const parsed = parsePgnGame(PGN);
    const first = store.importParsed({ parsed, raw: PGN, sourceType: "lichess", importJobId: "one", externalId: "abc" });
    const second = store.importParsed({ parsed, raw: PGN.replace("Chess.com", "Lichess"), sourceType: "pgn_text", importJobId: "two" });
    expect(second.game.id).toBe(first.game.id);
    expect(store.listGames()).toHaveLength(1);
  });

  it("can delete an unprotected source and archive a game", () => {
    const parsed = parsePgnGame(PGN);
    const imported = store.importParsed({ parsed, raw: PGN, sourceType: "pgn_text", importJobId: "one" });
    store.deleteSource(imported.source.id);
    expect(store.getGame(imported.game.id).sources).toHaveLength(0);
    store.archiveGame(imported.game.id, true);
    expect(store.listGames()).toHaveLength(0);
    expect(store.listGames({ archived: "true" })[0].archived).toBe(true);
  });

  it("recovers running jobs after a simulated restart", () => {
    const job = store.createJob("chess_com", { username: "someone" });
    store.updateJob(job.id, { status: "running" });
    store.recoverInterruptedJobs();
    expect(store.getJob(job.id).status).toBe("cancelled");
  });

  it("tracks selected games in an analysis scope", () => {
    const parsed = parsePgnGame(PGN);
    const imported = store.importParsed({ parsed, raw: PGN, sourceType: "pgn_text", importJobId: "one" });
    store.patchGame(imported.game.id, { analysisSelected: true });
    expect(store.nextScope().gameIds).toContain(imported.game.id);
  });
});
