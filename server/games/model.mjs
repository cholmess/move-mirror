import { createHash, randomUUID } from "node:crypto";
import { Chess } from "chess.js";
import { METADATA_MERGE_RULES, METADATA_MERGE_VERSION } from "./merge-rules.mjs";
import { decodePgnText } from "./pgn-encoding.mjs";

export const CANONICAL_GAME_VERSION = "canonical-game-v1";
export const FINGERPRINT_VERSION = "game-fingerprint-v1";
export { METADATA_MERGE_VERSION, METADATA_MERGE_RULES };
export const COACHING_POLICY_ID = "rapid-10m-coaching-v1";
export const TRANSFER_POLICY_ID = "allowed-forcing-reply-transfer-v1";
export const STANDARD_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
export const DEFAULT_CHESSCOM_ALIAS = "cholmess21";
const UNSUPPORTED_VARIANTS = new Set([
  "chess960", "from position960", "antichess", "atomic", "crazyhouse",
  "horde", "kingofthehill", "racingkings", "threecheck", "3check", "puzzle", "study",
]);

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizedStartingFen(fen = STANDARD_FEN) {
  const chess = new Chess(fen);
  return chess.fen().split(" ").slice(0, 4).join(" ");
}

export function gameFingerprint(startingFen, movesUci) {
  return sha256(`${FINGERPRINT_VERSION}\n${normalizedStartingFen(startingFen)}\n${movesUci.join(" ")}`);
}

export function splitPgnGames(text) {
  const normalized = decodePgnText(text).trim();
  if (!normalized) return [];
  const starts = [...normalized.matchAll(/^\s*\[Event\s+"/gm)].map((match) => match.index);
  if (starts.length < 2) return [normalized];
  return starts.map((start, index) => normalized.slice(start, starts[index + 1] ?? normalized.length).trim());
}

export function parsePgnCollection(text) {
  return splitPgnGames(text).map((rawPgn, index) => {
    try {
      return { index, rawPgn, game: parsePgnGame(rawPgn), error: null, excluded: false };
    } catch (error) {
      return {
        index,
        rawPgn,
        game: null,
        excluded: Boolean(error?.excluded),
        error: {
          code: error?.code ?? (error?.excluded ? "excluded" : "invalid_pgn"),
          gameIndex: index,
          ply: inferFailedPly(error),
          message: sanitizeError(error),
        },
      };
    }
  });
}

export function classifyExclusion(headers = {}, sourceType = null) {
  const rawVariant = String(headers.Variant ?? headers.variant ?? "Standard").toLowerCase();
  const variant = rawVariant.replaceAll(" ", "");
  if (variant && variant !== "standard" && variant !== "fromposition") {
    return { code: "unsupported_variant", message: "Variante no estándar excluida" };
  }
  if (UNSUPPORTED_VARIANTS.has(variant)) {
    return { code: "unsupported_variant", message: "Variante no estándar excluida" };
  }
  if (sourceType === "lichess" && /\/study\//i.test(String(headers.Site ?? headers.Link ?? ""))) {
    return { code: "lichess_study", message: "Los estudios no se importan" };
  }
  if (/puzzle/i.test(String(headers.Event ?? ""))) {
    return { code: "puzzle", message: "Los puzzles no se importan" };
  }
  return null;
}

export function parsePgnGame(rawPgn) {
  const headerMap = extractHeaders(rawPgn);
  const exclusion = classifyExclusion(headerMap);
  if (exclusion) {
    const error = new Error(exclusion.code);
    error.code = exclusion.code;
    error.excluded = true;
    throw error;
  }
  const chess = new Chess();
  try {
    chess.loadPgn(rawPgn, { strict: false });
  } catch {
    // Unknown tags or illegal SAN: headers and ply detection continue below.
  }
  const headers = { ...headerMap, ...safeHeaders(chess) };
  const startingFen = headers.SetUp === "1" && headers.FEN ? new Chess(headers.FEN).fen() : STANDARD_FEN;
  const replay = new Chess(startingFen);
  const tokens = tokenizeMainline(rawPgn);
  const movesUci = [];
  const movesSan = [];
  for (let ply = 0; ply < tokens.length; ply += 1) {
    let move = null;
    try {
      move = replay.move(tokens[ply]);
    } catch {
      move = null;
    }
    if (!move) {
      const error = new Error(`illegal_move_at_ply_${ply + 1}`);
      error.ply = ply + 1;
      error.code = "illegal_move";
      throw error;
    }
    movesUci.push(`${move.from}${move.to}${move.promotion ?? ""}`);
    movesSan.push(move.san);
  }
  if (!movesUci.length) {
    const error = new Error("game_has_no_moves");
    error.code = "game_has_no_moves";
    error.excluded = true;
    throw error;
  }
  return {
    headers,
    startingFen,
    movesUci,
    movesSan,
    result: normalizeResult(headers.Result),
    termination: nullable(headers.Termination),
  };
}

export function canonicalFromParsed(parsed, {
  importedAt = new Date().toISOString(),
  sourceId,
  importJobId,
  identity,
  overrides = {},
} = {}) {
  const h = parsed.headers ?? {};
  const timing = normalizeTiming(h, overrides);
  const resolution = resolvePlayer({
    identity,
    sourceType: overrides.sourceType,
    sourceUsername: overrides.sourceUsername,
    whiteName: overrides.whiteName ?? h.White,
    blackName: overrides.blackName ?? h.Black,
    manualColor: overrides.playerColor,
  });
  const game = {
    id: randomUUID(),
    version: CANONICAL_GAME_VERSION,
    fingerprint: gameFingerprint(parsed.startingFen, parsed.movesUci),
    chess: {
      variant: "standard",
      startingFen: parsed.startingFen,
      movesUci: parsed.movesUci,
      movesSan: parsed.movesSan,
      result: overrides.result ?? parsed.result,
      termination: overrides.termination ?? parsed.termination,
    },
    players: {
      white: player(overrides.whiteName ?? h.White, overrides.whiteUsername, overrides.whiteRating ?? h.WhiteElo),
      black: player(overrides.blackName ?? h.Black, overrides.blackUsername, overrides.blackRating ?? h.BlackElo),
      playerResolution: resolution,
    },
    timing,
    metadata: {
      event: nullable(overrides.event ?? h.Event),
      site: nullable(overrides.site ?? h.Site),
      round: nullable(overrides.round ?? h.Round),
      board: nullable(overrides.board ?? h.Board),
      eco: nullable(overrides.eco ?? h.ECO),
      opening: nullable(overrides.opening ?? h.Opening),
      url: nullable(overrides.url ?? h.Link),
    },
    provenance: {
      sourceIds: sourceId ? [sourceId] : [],
      firstImportedAt: importedAt,
      lastImportedAt: importedAt,
      importJobIds: importJobId ? [importJobId] : [],
    },
    confirmedFields: Array.isArray(overrides.confirmedFields) ? [...overrides.confirmedFields] : [],
    eligibility: {
      stored: true,
      coachingEligible: false,
      coachingPolicyId: null,
      transferEligible: false,
      transferPolicyId: null,
      reasons: [],
    },
  };
  game.eligibility = evaluateEligibility(game, { draft: Boolean(overrides.draft) });
  return game;
}

export function resolvePlayer({ identity, sourceType, sourceUsername, whiteName, blackName, manualColor }) {
  if (manualColor === "white" || manualColor === "black") {
    return {
      playerColor: manualColor,
      method: "manual_confirmation",
      matchedAlias: manualColor === "white" ? nullable(whiteName) : nullable(blackName),
      confidence: "verified",
    };
  }
  const sourceAliases = sourceType === "chess_com"
    ? identity?.chessComUsernames ?? []
    : sourceType === "lichess"
      ? identity?.lichessUsernames ?? []
      : [];
  const sourceMatch = matchOne(sourceUsername, sourceAliases);
  if (sourceMatch) {
    const color = equalFold(whiteName, sourceUsername) ? "white" : equalFold(blackName, sourceUsername) ? "black" : null;
    if (color) return { playerColor: color, method: "source_username", matchedAlias: sourceMatch, confidence: "verified" };
  }
  const aliases = identity?.pgnNameAliases ?? [];
  const whiteAlias = matchOne(whiteName, aliases);
  const blackAlias = matchOne(blackName, aliases);
  if (Boolean(whiteAlias) !== Boolean(blackAlias)) {
    return {
      playerColor: whiteAlias ? "white" : "black",
      method: "pgn_alias",
      matchedAlias: whiteAlias ?? blackAlias,
      confidence: "verified",
    };
  }
  return { playerColor: null, method: "unresolved", matchedAlias: null, confidence: "unknown" };
}

export function evaluateEligibility(game, { draft = false } = {}) {
  const reasons = [];
  if (draft) reasons.push("draft");
  if (game.chess.variant !== "standard") reasons.push("unsupported_variant");
  if (!game.chess.movesUci.length) reasons.push("no_valid_moves");
  if (game.chess.result === "*") reasons.push("unfinished_game");
  if (game.players.playerResolution.confidence !== "verified") reasons.push("player_identity_unverified");
  const control = game.timing.timeControl;
  if (control.initialSeconds !== 600 || control.incrementSeconds !== 0) reasons.push("outside_rapid_10m_policy");
  return {
    stored: true,
    coachingEligible: reasons.length === 0,
    coachingPolicyId: reasons.length === 0 ? COACHING_POLICY_ID : null,
    transferEligible: false,
    transferPolicyId: null,
    reasons,
  };
}

export function normalizeTiming(headers = {}, overrides = {}) {
  const raw = nullable(overrides.timeControl ?? headers.TimeControl);
  const timeControl = parseTimeControl(raw);
  const date = String(overrides.date ?? headers.UTCDate ?? headers.Date ?? "").replace(/\?/g, "");
  const time = String(overrides.time ?? headers.UTCTime ?? "").replace(/\?/g, "");
  let startedAt = nullable(overrides.startedAt);
  let datePrecision = overrides.datePrecision ?? "unknown";
  if (!startedAt && /^\d{4}\.\d{2}\.\d{2}$/.test(date)) {
    const isoDate = date.replaceAll(".", "-");
    if (/^\d{2}:\d{2}(?::\d{2})?$/.test(time)) {
      startedAt = new Date(`${isoDate}T${time.length === 5 ? `${time}:00` : time}Z`).toISOString();
      datePrecision = time.length === 5 ? "minute" : "exact";
    } else {
      startedAt = `${isoDate}T00:00:00.000Z`;
      datePrecision = "day";
    }
  } else if (startedAt && !overrides.datePrecision) {
    datePrecision = "exact";
  }
  return {
    startedAt,
    endedAt: nullable(overrides.endedAt),
    datePrecision,
    timeControl,
  };
}

export function parseTimeControl(raw) {
  const text = nullable(raw);
  let initialSeconds = null;
  let incrementSeconds = null;
  if (text && /^\d+(?:\+\d+)?$/.test(text)) {
    const [initial, increment = "0"] = text.split("+");
    initialSeconds = Number(initial);
    incrementSeconds = Number(increment);
  }
  let category = "unknown";
  if (initialSeconds !== null) {
    const estimate = initialSeconds + 40 * (incrementSeconds ?? 0);
    category = estimate < 180 ? "bullet" : estimate < 600 ? "blitz" : estimate < 3600 ? "rapid" : "classical";
  }
  if (text === "-") category = "correspondence";
  return { raw: text, initialSeconds, incrementSeconds, category };
}

export function mergeCanonical(existing, incoming) {
  const conflicts = [];
  const merged = structuredClone(existing);
  merged.confirmedFields = unique([...(existing.confirmedFields ?? []), ...(incoming.confirmedFields ?? [])]);
  const rules = {
    "timing.startedAt": METADATA_MERGE_RULES["timing.startedAt"],
    "timing.endedAt": METADATA_MERGE_RULES["timing.endedAt"],
    "metadata.url": METADATA_MERGE_RULES["metadata.url"],
    "metadata.opening": METADATA_MERGE_RULES["metadata.opening"],
    "metadata.event": METADATA_MERGE_RULES["metadata.event"],
    "metadata.site": METADATA_MERGE_RULES["metadata.site"],
    "metadata.round": METADATA_MERGE_RULES["metadata.round"],
    "metadata.board": METADATA_MERGE_RULES["metadata.board"],
    "metadata.eco": METADATA_MERGE_RULES["metadata.eco"],
    "players.white.name": METADATA_MERGE_RULES["players.white.name"],
    "players.black.name": METADATA_MERGE_RULES["players.black.name"],
    "players.white.username": METADATA_MERGE_RULES["players.white.username"],
    "players.black.username": METADATA_MERGE_RULES["players.black.username"],
    "players.white.rating": METADATA_MERGE_RULES["players.white.rating"],
    "players.black.rating": METADATA_MERGE_RULES["players.black.rating"],
  };
  for (const [field, rule] of Object.entries(rules)) {
    const current = getPath(merged, field);
    const candidate = getPath(incoming, field);
    if (candidate == null || valuesEqual(current, candidate)) continue;
    const confirmed = (merged.confirmedFields ?? []).includes(field);
    let chosen = current;
    let applied = rule;
    if (confirmed) {
      chosen = current;
      applied = "confirmed_value_never_replaced_by_inference";
    } else if (current == null) {
      chosen = candidate;
    } else if (field === "timing.startedAt" && precisionRank(incoming.timing.datePrecision) > precisionRank(existing.timing.datePrecision)) {
      chosen = candidate;
      merged.timing.datePrecision = incoming.timing.datePrecision;
    } else if ((field === "metadata.url" || field.endsWith(".username")) && isOfficialUrlOrUsername(candidate) && !isOfficialUrlOrUsername(current)) {
      chosen = candidate;
    }
    setPath(merged, field, chosen);
    if (current != null && !valuesEqual(current, candidate)) {
      conflicts.push({
        field,
        existingValue: current,
        incomingValue: candidate,
        chosenValue: chosen,
        resolutionRule: `${METADATA_MERGE_VERSION}:${applied}`,
        requiresReview: chosen !== candidate || confirmed,
      });
    }
  }
  if (existing.players.playerResolution.confidence !== "verified" && incoming.players.playerResolution.confidence === "verified") {
    merged.players.playerResolution = incoming.players.playerResolution;
  }
  merged.eligibility = evaluateEligibility(merged);
  return { merged, conflicts };
}

function isOfficialUrlOrUsername(value) {
  return /chess\.com|lichess\.org/i.test(String(value ?? ""));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function possibleDuplicate(a, b) {
  if (normalizedStartingFen(a.chess.startingFen) !== normalizedStartingFen(b.chess.startingFen)) return false;
  const shortest = Math.min(a.chess.movesUci.length, b.chess.movesUci.length);
  if (shortest < 12 || Math.abs(a.chess.movesUci.length - b.chess.movesUci.length) < 1) return false;
  return a.chess.movesUci.slice(0, shortest).every((move, index) => move === b.chess.movesUci[index]);
}

function player(name, username, rating) {
  const numeric = Number(rating);
  return {
    name: nullable(name),
    username: nullable(username),
    rating: Number.isFinite(numeric) && String(rating ?? "").trim() ? numeric : null,
  };
}

function normalizeResult(value) {
  return ["1-0", "0-1", "1/2-1/2", "*"].includes(value) ? value : "*";
}

function nullable(value) {
  if (value === undefined || value === null || value === "" || value === "?") return null;
  return String(value);
}

function equalFold(a, b) {
  return Boolean(a && b && String(a).localeCompare(String(b), undefined, { sensitivity: "accent" }) === 0);
}

function matchOne(value, aliases) {
  return aliases.find((alias) => equalFold(alias, value)) ?? null;
}

function precisionRank(value) {
  return { unknown: 0, year: 1, month: 2, day: 3, minute: 4, exact: 5 }[value] ?? 0;
}

function getPath(object, field) {
  return field.split(".").reduce((value, key) => value?.[key], object);
}

function setPath(object, field, value) {
  const parts = field.split(".");
  const key = parts.pop();
  const parent = parts.reduce((target, part) => target[part], object);
  parent[key] = value;
}

function valuesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function extractHeaders(pgn) {
  const headers = {};
  for (const match of String(pgn).matchAll(/\[(\w+)\s+"([^"]*)"\]/g)) headers[match[1]] = match[2];
  return headers;
}

function tokenizeMainline(pgn) {
  return String(pgn)
    .replace(/\[.*?\]/gs, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\([^()]*\)/g, " ")
    .replace(/\$\d+/g, " ")
    .replace(/\d+\.(\.\.)?/g, " ")
    .replace(/1-0|0-1|1\/2-1\/2|\*/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function safeHeaders(chess) {
  try {
    return chess.getHeaders();
  } catch {
    return {};
  }
}

function inferFailedPly(error) {
  if (Number.isInteger(error?.ply)) return error.ply;
  const match = String(error?.message ?? "").match(/(?:ply|move)[^\d]*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function sanitizeError(error) {
  const message = String(error?.message ?? error).replace(/\s+/g, " ").slice(0, 240);
  return message || "PGN inválido";
}
