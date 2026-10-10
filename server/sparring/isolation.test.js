import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { Chess } from "chess.js";
import { createSparringStore } from "./store.mjs";
import { createSparringService } from "./service.mjs";
import { createGamesStore } from "../games/store.mjs";

function hashFile(file) {
  if (!existsSync(file)) return null;
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function countGames(gamesRoot) {
  const dir = path.join(gamesRoot, "canonical");
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => f.endsWith(".json")).length;
}

describe("sparring domain isolation", () => {
  let sparringRoot;
  let gamesRoot;
  let repoRoot;
  let sparringStore;
  let gamesStore;
  let service;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), "mm-iso-"));
    sparringRoot = path.join(repoRoot, "sparring");
    gamesRoot = path.join(repoRoot, "games");
    sparringStore = createSparringStore(sparringRoot);
    sparringStore.ensure();
    gamesStore = createGamesStore(gamesRoot, { projectRoot: repoRoot });
    gamesStore.ensure();
    service = createSparringService({
      store: sparringStore,
      engine: {
        engineSha256: "mock",
        analyseMultiPv: async (fen) => {
          const chess = new Chess(fen);
          const move = chess.moves({ verbose: true })[0];
          const uci = move ? `${move.from}${move.to}${move.promotion ?? ""}` : "a7a6";
          return {
            lines: [{ multipv: 1, score: { cp: 20, numeric: 20 }, firstMoveUci: uci, pvUci: [uci] }],
          };
        },
      },
      engineAvailable: true,
      queue: { enqueue: async (fn) => fn({}) },
      evaluate: async () => ({ status: "unverified" }),
      defenseDatasetFile: null,
      cacheRoot: sparringStore.dirs.cache,
    });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("does not mutate games library or transfer files", async () => {
    const gamesBefore = countGames(gamesRoot);
    const transferState = path.join(repoRoot, "transfer", "state.json");
    const transferBefore = hashFile(transferState);

    const session = service.createSession({ mode: "full_game", userColor: "white", patternId: "cct-opponent-refutation" });
    await service.applyPlayerMove(session.sessionId, { moveUci: "e2e4" });
    await service.resign(session.sessionId);
    await service.runReview(session.sessionId);
    const pgn = service.exportPgn(session.sessionId);
    expect(pgn).toContain('[TrainingGame "true"]');

    expect(countGames(gamesRoot)).toBe(gamesBefore);
    expect(hashFile(transferState)).toBe(transferBefore);
    expect(existsSync(path.join(sparringRoot, "sessions"))).toBe(true);
    expect(existsSync(path.join(sparringRoot, "reviews", `${session.sessionId}.json`))).toBe(true);
    const profile = sparringStore.readProfile();
    expect(profile.sessions).toBeGreaterThan(0);
    expect(profile.doseEligible).toBe(false);
  });
});
