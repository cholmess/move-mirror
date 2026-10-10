import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createGamesStore } from "./store.mjs";
import { createImportService } from "./import-service.mjs";
import {
  IdentityValidationError,
  cleanAliasList,
  countLinkedGames,
  isReconcileCandidate,
  reconcileUnresolvedGames,
  validateIdentityPatch,
} from "./identity.mjs";
import { collectProtectedReferences } from "./protected-refs.mjs";

describe("player identity", () => {
  it("seeds migrated chess.com alias and validates display name", () => {
    const root = mkdtempSync(path.join(tmpdir(), "identity-"));
    const store = createGamesStore(root);
    store.ensure();
    const identity = store.readIdentity();
    expect(identity.version).toBe("player-identity-v1");
    expect(identity.chessComUsernames[0]).toBe("cholmess21");
    expect(() => validateIdentityPatch(identity, { displayName: "   " })).toThrow(IdentityValidationError);
    rmSync(root, { recursive: true, force: true });
  });

  it("adds aliases with trim and case-insensitive dedupe", () => {
    const base = {
      id: "x",
      version: "player-identity-v1",
      displayName: "Tester",
      chessComUsernames: ["cholmess21"],
      lichessUsernames: [],
      pgnNameAliases: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const next = validateIdentityPatch(base, {
      chessComUsernames: ["  NewAlias  ", "AnotherAlias"],
      lichessUsernames: ["LichessOne"],
      pgnNameAliases: ["PGN Name"],
    });
    expect(next.chessComUsernames).toEqual(["NewAlias", "AnotherAlias"]);
    expect(next.lichessUsernames).toEqual(["LichessOne"]);
    expect(next.pgnNameAliases).toEqual(["PGN Name"]);
    expect(cleanAliasList(["A", "a", "b"])).toEqual(["A", "b"]);
  });

  it("rejects empty alias, url-like username and duplicates", () => {
    const base = {
      id: "x",
      version: "player-identity-v1",
      displayName: "Tester",
      chessComUsernames: [],
      lichessUsernames: [],
      pgnNameAliases: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(() => validateIdentityPatch(base, { chessComUsernames: [""] })).toThrow("alias_empty");
    expect(() => validateIdentityPatch(base, { lichessUsernames: ["https://lichess.org/foo"] })).toThrow("alias_looks_like_url");
    expect(() => validateIdentityPatch(base, { pgnNameAliases: ["Same", "same"] })).toThrow("duplicate_alias");
  });

  it("persists idempotent identity updates", () => {
    const root = mkdtempSync(path.join(tmpdir(), "identity-"));
    const store = createGamesStore(root);
    store.ensure();
    const first = store.writeIdentity({ displayName: "Local Hero" });
    const second = store.writeIdentity({ displayName: "Local Hero" });
    expect(first.id).toBe(second.id);
    expect(store.readIdentity().displayName).toBe("Local Hero");
    rmSync(root, { recursive: true, force: true });
  });

  it("allows the same spelling on different platforms", () => {
    const base = {
      id: "x",
      version: "player-identity-v1",
      displayName: "Tester",
      chessComUsernames: [],
      lichessUsernames: [],
      pgnNameAliases: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const next = validateIdentityPatch(base, {
      chessComUsernames: ["shared"],
      lichessUsernames: ["shared"],
      pgnNameAliases: ["shared"],
    });
    expect(next.chessComUsernames).toEqual(["shared"]);
    expect(next.lichessUsernames).toEqual(["shared"]);
    expect(next.pgnNameAliases).toEqual(["shared"]);
  });

  it("reconciles unresolved games without touching manual verified or ambiguous games", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "identity-"));
    const store = createGamesStore(root);
    const service = createImportService(store);
    const pendingJob = await service.importPgn({
      sourceType: "pgn_text",
      text: `[Event "R"]\n[White "ResolveMe"]\n[Black "Other"]\n[TimeControl "600"]\n[Result "1-0"]\n\n1. e4 e5 1-0`,
    });
    const pending = store.getGame(pendingJob.checkpoint.importedGameIds[0]);
    expect(isReconcileCandidate(pending)).toBe(true);

    const manualJob = await service.importPgn({
      sourceType: "pgn_text",
      text: `[Event "M"]\n[White "ManualKeep"]\n[Black "Other"]\n[TimeControl "600"]\n[Result "1-0"]\n\n1. d4 d5 1-0`,
    });
    const manualGame = store.getGame(manualJob.checkpoint.importedGameIds[0]);
    store.resolvePlayer(manualGame.id, "white");

    store.writeIdentity({ pgnNameAliases: ["ResolveMe"] });

    const ambiguousJob = await service.importPgn({
      sourceType: "pgn_text",
      text: `[Event "A"]\n[White "ResolveMe"]\n[Black "ResolveMe"]\n[TimeControl "600"]\n[Result "1-0"]\n\n1. c4 c5 1-0`,
    });
    const ambiguous = store.getGame(ambiguousJob.checkpoint.importedGameIds[0]);

    const summary = store.reconcileIdentity({ confirm: true });
    expect(summary.resolved).toBe(1);
    expect(store.getGame(pending.id).players.playerResolution.confidence).toBe("verified");
    expect(store.getGame(manualGame.id).players.playerResolution.method).toBe("manual_confirmation");
    expect(store.getGame(ambiguous.id).players.playerResolution.confidence).not.toBe("verified");

    const games = store.listGames({ archived: "true" });
    expect(countLinkedGames(games, "pgn", "ResolveMe")).toBeGreaterThan(0);
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps reconcile from touching protected references map", () => {
    const refs = collectProtectedReferences(path.join(fileURLToPath(new URL(".", import.meta.url)), "../.."));
    expect(refs.historicalIds.size).toBeGreaterThan(0);
    const fakeGame = {
      id: "protected",
      sources: [{ sourceType: "chess_com", externalId: [...refs.historicalIds][0], parsedMetadata: {} }],
      players: {
        white: { name: "A", username: "A", rating: null },
        black: { name: "B", username: "B", rating: null },
        playerResolution: { playerColor: null, method: "unresolved", matchedAlias: null, confidence: "unknown" },
      },
      metadata: {},
      eligibility: {},
    };
    const summary = reconcileUnresolvedGames({
      games: [fakeGame],
      identity: { pgnNameAliases: ["A"], chessComUsernames: [], lichessUsernames: [] },
      protectedRefs: refs,
      apply: true,
    });
    expect(summary.skippedProtected).toBe(1);
  });
});
