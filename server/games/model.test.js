import { describe, expect, it } from "vitest";
import {
  canonicalFromParsed,
  classifyExclusion,
  gameFingerprint,
  mergeCanonical,
  METADATA_MERGE_RULES,
  normalizeTiming,
  parsePgnCollection,
  parsePgnGame,
  parseTimeControl,
  possibleDuplicate,
  resolvePlayer,
  STANDARD_FEN,
} from "./model.mjs";
import { decodePgnBytes } from "./pgn-encoding.mjs";

const GAME = `[Event "Test"]
[Site "Local"]
[Date "2026.10.10"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]
[TimeControl "600+0"]

1. e4 {comment} e5 $1 (1... c5) 2. Nf3 Nc6 3. Bb5 a6 1-0`;

describe("canonical game model", () => {
  it("parses mainline SAN and UCI while ignoring comments, NAGs and variations", () => {
    const row = parsePgnCollection(GAME)[0];
    expect(row.error).toBeNull();
    expect(row.game.movesUci).toEqual(["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6"]);
    expect(row.game.movesSan).toEqual(["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"]);
    expect(row.game.result).toBe("1-0");
  });

  it("supports SetUp plus FEN and includes the start in the fingerprint", () => {
    const pgn = `[Event "FEN"]\n[SetUp "1"]\n[FEN "8/8/8/8/8/5k2/8/4K2R w K - 0 1"]\n[Result "*"]\n\n1. Rh3+ Kg2 *`;
    const parsed = parsePgnCollection(pgn)[0].game;
    expect(parsed.startingFen).toContain("8/8/8/8/8/5k2/8/4K2R");
    expect(gameFingerprint(parsed.startingFen, parsed.movesUci)).not.toBe(gameFingerprint(STANDARD_FEN, parsed.movesUci));
  });

  it("fingerprint ignores metadata, comments and result", () => {
    const a = parsePgnCollection(GAME)[0].game;
    const b = parsePgnCollection(GAME.replace("Test", "Other").replace("{comment}", "").replaceAll("1-0", "0-1"))[0].game;
    expect(gameFingerprint(a.startingFen, a.movesUci)).toBe(gameFingerprint(b.startingFen, b.movesUci));
  });

  it("keeps different starting FENs as different identities", () => {
    const a = gameFingerprint(STANDARD_FEN, ["e2e4"]);
    const b = gameFingerprint("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", ["g1f3"]);
    expect(a).not.toBe(b);
  });

  it("detects a long truncated prefix without merging it", () => {
    const base = { chess: { startingFen: STANDARD_FEN, movesUci: Array.from({ length: 14 }, (_, i) => String(i)) } };
    const shorter = { chess: { startingFen: STANDARD_FEN, movesUci: base.chess.movesUci.slice(0, 12) } };
    expect(possibleDuplicate(base, shorter)).toBe(true);
  });

  it("does not treat a different continuation as the same game", () => {
    const a = { chess: { startingFen: STANDARD_FEN, movesUci: ["e2e4", "e7e5", "g1f3"] } };
    const b = { chess: { startingFen: STANDARD_FEN, movesUci: ["e2e4", "c7c5", "g1f3"] } };
    expect(gameFingerprint(a.chess.startingFen, a.chess.movesUci)).not.toBe(gameFingerprint(b.chess.startingFen, b.chess.movesUci));
    expect(possibleDuplicate(a, b)).toBe(false);
  });

  it("normalizes time controls and date precision", () => {
    expect(parseTimeControl("600+0")).toMatchObject({ initialSeconds: 600, incrementSeconds: 0, category: "rapid" });
    expect(parseTimeControl("180+2").category).toBe("blitz");
    expect(parseTimeControl(null).category).toBe("unknown");
    expect(normalizeTiming({ Date: "2026.10.10" }).datePrecision).toBe("day");
    expect(normalizeTiming({ UTCDate: "2026.10.10", UTCTime: "12:00:00" }).datePrecision).toBe("exact");
  });

  it("decodes latin1 PGN when UTF-8 is not valid", () => {
    const text = '[Event "Café"]\n[White "José"]\n[Black "Bob"]\n[Result "1-0"]\n\n1. e4 e5 1-0';
    const latin1 = Buffer.from(text, "latin1");
    expect(decodePgnBytes(latin1)).toContain("José");
  });

  it("reports the failing ply and keeps unknown tags", () => {
    const rows = parsePgnCollection(`${GAME}\n\n[Event "Broken"]\n[Foo "Bar"]\n[Result "*"]\n\n1. e4 e5 2. NotAMove *`);
    expect(rows).toHaveLength(2);
    expect(rows[0].error).toBeNull();
    expect(rows[1].error?.ply).toBeTruthy();
  });

  it("excludes Chess960 and puzzles instead of failing silently", () => {
    expect(classifyExclusion({ Variant: "Chess960" })?.code).toBe("unsupported_variant");
    expect(classifyExclusion({ Event: "Puzzle Rush" })?.code).toBe("puzzle");
  });
});

describe("player identity", () => {
  const identity = {
    chessComUsernames: ["CaseSensitive"],
    lichessUsernames: ["Other"],
    pgnNameAliases: ["Local Name"],
  };

  it("matches Chess.com usernames case-insensitively and preserves alias spelling", () => {
    expect(resolvePlayer({ identity, sourceType: "chess_com", sourceUsername: "casesensitive", whiteName: "CaseSensitive", blackName: "Rival" }))
      .toMatchObject({ playerColor: "white", method: "source_username", matchedAlias: "CaseSensitive", confidence: "verified" });
  });

  it("matches Lichess usernames independently from Chess.com", () => {
    expect(resolvePlayer({ identity, sourceType: "lichess", sourceUsername: "other", whiteName: "Rival", blackName: "Other" }))
      .toMatchObject({ playerColor: "black", method: "source_username", matchedAlias: "Other", confidence: "verified" });
  });

  it("resolves a unique PGN alias but leaves ambiguous names unresolved", () => {
    expect(resolvePlayer({ identity, sourceType: "pgn_text", whiteName: "Local Name", blackName: "Rival" }).playerColor).toBe("white");
    expect(resolvePlayer({ identity, sourceType: "pgn_text", whiteName: "Local Name", blackName: "local name" })).toMatchObject({
      method: "unresolved",
      confidence: "unknown",
    });
  });

  it("records manual confirmation and leaves unknown players unresolved", () => {
    expect(resolvePlayer({ identity, whiteName: "A", blackName: "B", manualColor: "black" }))
      .toMatchObject({ playerColor: "black", method: "manual_confirmation", confidence: "verified" });
    expect(resolvePlayer({ identity, sourceType: "pgn_text", whiteName: "A", blackName: "B" }).method).toBe("unresolved");
  });
});

describe("metadata-merge-v1", () => {
  it("documents a field-level rule table", () => {
    expect(METADATA_MERGE_RULES["timing.startedAt"]).toBe("higher_date_precision");
    expect(METADATA_MERGE_RULES["metadata.url"]).toBe("preserve_official_platform_url");
  });

  it("keeps a confirmed value instead of replacing it with an inference", () => {
    const parsed = parsePgnGame(GAME);
    const existing = canonicalFromParsed(parsed, { overrides: { event: "Manual", confirmedFields: ["metadata.event"] } });
    const incoming = canonicalFromParsed(parsed, { overrides: { event: "Inferred" } });
    const { merged, conflicts } = mergeCanonical(existing, incoming);
    expect(merged.metadata.event).toBe("Manual");
    expect(conflicts.some((conflict) => conflict.field === "metadata.event")).toBe(true);
  });

  it("prefers a more precise timestamp", () => {
    const parsed = parsePgnGame(GAME);
    const existing = canonicalFromParsed(parsed, { overrides: { date: "2026.10.10" } });
    const incoming = canonicalFromParsed(parsed, { overrides: { startedAt: "2026-10-10T12:00:00.000Z", datePrecision: "exact" } });
    const { merged } = mergeCanonical(existing, incoming);
    expect(merged.timing.startedAt).toBe("2026-10-10T12:00:00.000Z");
    expect(merged.timing.datePrecision).toBe("exact");
  });
});
