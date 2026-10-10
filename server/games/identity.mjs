import { protectionForGame } from "./protected-refs.mjs";
import { evaluateEligibility, resolvePlayer } from "./model.mjs";

const URLLIKE = /^https?:\/\//i;

export class IdentityValidationError extends Error {
  constructor(code, detail = null) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

export function normalizeAlias(value) {
  return String(value ?? "").trim();
}

export function cleanAliasList(values) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(values) ? values : []) {
    const value = normalizeAlias(raw);
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function validatePlatformUsername(value, platform) {
  const alias = normalizeAlias(value);
  if (!alias) throw new IdentityValidationError("alias_empty");
  if (URLLIKE.test(alias) || alias.includes("/")) throw new IdentityValidationError("alias_looks_like_url", { platform });
  return alias;
}

export function validatePgnAlias(value) {
  const alias = normalizeAlias(value);
  if (!alias) throw new IdentityValidationError("alias_empty");
  return alias;
}

export function validateIdentityPatch(current, patch) {
  const next = { ...current, ...patch };
  const displayName = normalizeAlias(patch.displayName ?? current.displayName);
  if (!displayName) throw new IdentityValidationError("display_name_empty");

  const chessComUsernames = patch.chessComUsernames
    ? patch.chessComUsernames.map((value) => validatePlatformUsername(value, "chess_com"))
    : cleanAliasList(current.chessComUsernames);
  const lichessUsernames = patch.lichessUsernames
    ? patch.lichessUsernames.map((value) => validatePlatformUsername(value, "lichess"))
    : cleanAliasList(current.lichessUsernames);
  const pgnNameAliases = patch.pgnNameAliases
    ? patch.pgnNameAliases.map((value) => validatePgnAlias(value))
    : cleanAliasList(current.pgnNameAliases);

  if (patch.chessComUsernames && chessComUsernames.length !== cleanAliasList(chessComUsernames).length) {
    throw new IdentityValidationError("duplicate_alias", { platform: "chess_com" });
  }
  if (patch.lichessUsernames && lichessUsernames.length !== cleanAliasList(lichessUsernames).length) {
    throw new IdentityValidationError("duplicate_alias", { platform: "lichess" });
  }
  if (patch.pgnNameAliases && pgnNameAliases.length !== cleanAliasList(pgnNameAliases).length) {
    throw new IdentityValidationError("duplicate_alias", { platform: "pgn" });
  }

  return {
    displayName,
    chessComUsernames: cleanAliasList(chessComUsernames),
    lichessUsernames: cleanAliasList(lichessUsernames),
    pgnNameAliases: cleanAliasList(pgnNameAliases),
  };
}

export function equalFold(a, b) {
  return normalizeAlias(a).toLocaleLowerCase() === normalizeAlias(b).toLocaleLowerCase();
}

export function countLinkedGames(games, platform, alias) {
  let count = 0;
  for (const game of games) {
    if (gameLinkedToAlias(game, platform, alias)) count += 1;
  }
  return count;
}

export function publicIdentity(identity, games = []) {
  const mapStats = (platform, aliases) =>
    aliases.map((alias) => ({
      platform,
      alias,
      active: true,
      linkedGames: countLinkedGames(games, platform, alias),
    }));

  return {
    id: identity.id,
    version: identity.version,
    displayName: identity.displayName,
    chessComUsernames: [...identity.chessComUsernames],
    lichessUsernames: [...identity.lichessUsernames],
    pgnNameAliases: [...identity.pgnNameAliases],
    createdAt: identity.createdAt,
    updatedAt: identity.updatedAt,
    aliases: [
      ...mapStats("chess_com", identity.chessComUsernames),
      ...mapStats("lichess", identity.lichessUsernames),
      ...mapStats("pgn", identity.pgnNameAliases),
    ],
  };
}

export function isReconcileCandidate(game) {
  const resolution = game.players?.playerResolution;
  if (!resolution) return false;
  if (resolution.method === "manual_confirmation" && resolution.confidence === "verified") return false;
  if (resolution.confidence === "verified" && resolution.method !== "unresolved") return false;
  return resolution.confidence === "unknown"
    || resolution.confidence === "probable"
    || resolution.method === "unresolved";
}

export function reconcileUnresolvedGames({ games, identity, protectedRefs, apply = false }) {
  const summary = {
    candidates: 0,
    wouldResolve: 0,
    resolved: 0,
    ambiguous: 0,
    skippedProtected: 0,
    skippedVerified: 0,
    unchanged: 0,
    gameIds: [],
  };

  for (const game of games) {
    if (!isReconcileCandidate(game)) {
      if (game.players?.playerResolution?.method === "manual_confirmation") summary.skippedVerified += 1;
      continue;
    }
    summary.candidates += 1;
    const protection = protectionForGame(game, protectedRefs);
    if (protection.includes("frozen_cohort")) {
      summary.skippedProtected += 1;
      continue;
    }

    const source = pickPrimarySource(game);
    const nextResolution = resolvePlayer({
      identity,
      sourceType: source?.sourceType ?? "pgn_text",
      sourceUsername: source?.sourceUsername ?? null,
      whiteName: game.players.white.name ?? game.players.white.username,
      blackName: game.players.black.name ?? game.players.black.username,
      manualColor: source?.sourceType === "manual" ? game.players.playerResolution.playerColor : null,
    });

    const ambiguous = !nextResolution.playerColor
      && (matchBothSides(game, identity) || nextResolution.method === "unresolved");
    if (ambiguous) {
      summary.ambiguous += 1;
      continue;
    }
    if (nextResolution.confidence !== "verified" || !nextResolution.playerColor) {
      summary.unchanged += 1;
      continue;
    }

    summary.wouldResolve += 1;
    if (apply) {
      game.players.playerResolution = nextResolution;
      game.eligibility = evaluateEligibility(game);
      summary.resolved += 1;
      summary.gameIds.push(game.id);
    }
  }

  return summary;
}

function pickPrimarySource(game) {
  const sources = game.sources ?? [];
  const preferred = sources.find((source) => source.sourceType === "chess_com")
    ?? sources.find((source) => source.sourceType === "lichess")
    ?? sources[0];
  if (!preferred) return null;
  const parsed = preferred.parsedMetadata ?? {};
  return {
    sourceType: preferred.sourceType,
    sourceUsername: parsed.WhiteUsername ?? parsed.BlackUsername ?? parsed.username ?? null,
  };
}

function matchBothSides(game, identity) {
  const aliases = identity.pgnNameAliases ?? [];
  const white = game.players.white.name ?? game.players.white.username;
  const black = game.players.black.name ?? game.players.black.username;
  const whiteHit = aliases.some((alias) => equalFold(alias, white));
  const blackHit = aliases.some((alias) => equalFold(alias, black));
  return whiteHit && blackHit;
}

function gameLinkedToAlias(game, platform, alias) {
  const white = game.players.white;
  const black = game.players.black;
  const resolution = game.players.playerResolution;
  if (resolution?.matchedAlias && equalFold(resolution.matchedAlias, alias)) return true;

  if (platform === "chess_com") {
    return equalFold(white.username, alias) || equalFold(black.username, alias)
      || game.sources?.some((source) => source.sourceType === "chess_com" && equalFold(source.parsedMetadata?.username, alias));
  }
  if (platform === "lichess") {
    return equalFold(white.username, alias) || equalFold(black.username, alias)
      || game.sources?.some((source) => source.sourceType === "lichess" && equalFold(source.parsedMetadata?.username, alias));
  }
  return equalFold(white.name, alias) || equalFold(black.name, alias)
    || equalFold(white.username, alias) || equalFold(black.username, alias);
}
