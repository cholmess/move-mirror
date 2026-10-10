import { Chess } from "chess.js";
import {
  BASELINE_COHORT_ID,
  DETECTOR_ID,
  FILTER_RULES_ID,
  PLAYER_USERNAME,
  TIME_CONTROL,
} from "./constants.js";
import { phaseProxy } from "./detector.js";

const STANDARD_BOARD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";

export function normalizeUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    let text = parsed.toString();
    if (text.endsWith("/")) text = text.slice(0, -1);
    return text;
  } catch {
    return String(url).trim();
  }
}

/** A game is posterior to the frozen cutoff pair (end_time, game_id). */
export function isAfterCutoff(endTime, gameId, cutoff) {
  const time = Number(endTime);
  if (!Number.isFinite(time) || !cutoff) return false;
  if (time > cutoff.endTime) return true;
  if (time === cutoff.endTime && String(gameId) > String(cutoff.gameId)) return true;
  return false;
}

export function parseGamesCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else if (ch !== "\r") {
      cur += ch;
    }
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  const header = rows[0] ?? [];
  return rows
    .slice(1)
    .filter((cells) => cells.length === header.length && cells.some((cell) => cell !== ""))
    .map((cells) => {
      const record = {};
      header.forEach((key, index) => {
        record[key] = cells[index];
      });
      return record;
    });
}

export function baselineManifestFromRows(rows, source) {
  if (rows.length !== 200) {
    throw new Error(`baseline_count_${rows.length}`);
  }
  const gameIds = [];
  const urls = [];
  const seen = new Set();
  let cutoff = null;
  for (const row of rows) {
    const gameId = row.game_id;
    const url = normalizeUrl(row.url);
    if (!gameId || !url) throw new Error("baseline_row_incomplete");
    if (seen.has(gameId)) throw new Error("baseline_duplicate");
    if (String(row.time_control) !== TIME_CONTROL) throw new Error("baseline_time_control");
    seen.add(gameId);
    gameIds.push(gameId);
    urls.push(url);
    const endTime = Number(row.end_time);
    if (
      !cutoff ||
      endTime > cutoff.endTime ||
      (endTime === cutoff.endTime && gameId > cutoff.gameId)
    ) {
      cutoff = { endTime, gameId, endUtc: row.end_utc };
    }
  }
  gameIds.sort();
  urls.sort();
  return {
    cohortId: BASELINE_COHORT_ID,
    immutable: true,
    source: source.path,
    sourceSha256: source.sha256,
    gameCount: 200,
    timeControl: TIME_CONTROL,
    username: PLAYER_USERNAME,
    rulesVersion: FILTER_RULES_ID,
    cutoffRule: "strictly_after_pair_(end_time, game_id)_lexicographic",
    cutoff,
    gameIds,
    urls,
  };
}

function exclusionKey(gameId, url, reason) {
  return `${gameId ?? ""}|${url ?? ""}|${reason}`;
}

function resultSide(raw, side) {
  return raw?.[side]?.result ?? null;
}

export function ownPerspective(color, whiteResult, blackResult) {
  const mine = color === "white" ? whiteResult : blackResult;
  if (mine === "win") return "win";
  if (["agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"].includes(mine)) {
    return "draw";
  }
  if (["checkmated", "timeout", "resigned", "abandoned", "lose"].includes(mine)) return "loss";
  return mine ?? "unknown";
}

function earlyResignOrAbandon(raw) {
  const results = [resultSide(raw, "white"), resultSide(raw, "black")];
  return results.some((result) => result === "resigned" || result === "abandoned");
}

export function decisionsFromPgn(pgn, game) {
  const chess = new Chess();
  chess.loadPgn(pgn, { strict: true });
  const headers = chess.getHeaders();
  const history = chess.history({ verbose: true });
  const start = history[0]?.before?.split(" ")[0];
  if (history.length && start !== STANDARD_BOARD) {
    const error = new Error("nonstandard_start");
    error.code = "nonstandard_start";
    throw error;
  }
  if (headers.Variant && headers.Variant !== "Standard") {
    const error = new Error("not_standard_chess");
    error.code = "not_standard_chess";
    throw error;
  }
  const own = game.color === "white" ? "w" : "b";
  const decisions = [];
  history.forEach((move, index) => {
    const ply = index + 1;
    if (move.color !== own) return;
    const fenBefore = move.before;
    decisions.push({
      key: `${game.gameId}:${ply}`,
      gameId: game.gameId,
      url: game.url,
      cohortId: game.cohortId,
      ply,
      moveNumber: Number(fenBefore.split(" ")[5] ?? Math.ceil(ply / 2)),
      color: game.color,
      fenBefore,
      moveSan: move.san,
      moveUci: `${move.from}${move.to}${move.promotion ?? ""}`,
      phaseProxy: phaseProxy(fenBefore, ply),
    });
  });
  return { historyLength: history.length, headers, decisions };
}

function clocksInPgn(pgn) {
  return [...String(pgn).matchAll(/\{\[%clk\s+([0-9:.]+)\]\}/g)].map((match) => match[1]);
}

/**
 * Phase-1 filter. New games are transfer members first.
 * Timeout, abandonment and resignation are never labeled as a weakness.
 */
export function selectTransferGames({
  rawGames,
  baseline,
  knownIds = new Set(),
  knownUrls = new Set(),
  recordedExclusions = new Set(),
  username = PLAYER_USERNAME,
  cohortId,
  syncedAt,
}) {
  const included = [];
  const excluded = [];
  const originalIds = new Set(knownIds);
  const seenIds = new Set();
  const seenUrls = new Set();
  const baselineIds = new Set(baseline.gameIds ?? []);
  const baselineUrls = new Set((baseline.urls ?? []).map(normalizeUrl));
  const user = username.toLowerCase();

  const note = (gameId, url, reason, detail) => {
    const key = exclusionKey(gameId, url, reason);
    if (recordedExclusions.has(key)) return;
    recordedExclusions.add(key);
    excluded.push({
      gameId: gameId ?? null,
      url: url ?? null,
      reason,
      detail,
      cohortId,
      syncedAt,
      rulesVersion: FILTER_RULES_ID,
      weaknessInference: null,
    });
  };

  for (const raw of rawGames ?? []) {
    const gameId = raw.uuid || raw.gameId || null;
    const url = normalizeUrl(raw.url);
    if (gameId && originalIds.has(gameId)) continue;
    if (gameId && seenIds.has(gameId)) {
      note(gameId, url, "duplicate_game_id", "Mismo game id en la sincronización.");
      continue;
    }
    if (url && (seenUrls.has(url) || knownUrls.has(url))) {
      note(gameId, url, "duplicate_url", "Misma URL en la sincronización.");
      continue;
    }
    if (gameId) seenIds.add(gameId);
    if (url) seenUrls.add(url);

    if (gameId && baselineIds.has(gameId)) {
      note(gameId, url, "already_in_baseline", "La partida ya está en el baseline congelado.");
      continue;
    }
    if (url && baselineUrls.has(url)) {
      note(gameId, url, "already_in_baseline", "La URL ya está en el baseline congelado.");
      continue;
    }
    if (raw.time_control !== TIME_CONTROL) {
      note(gameId, url, "time_control_not_600", `time_control=${raw.time_control ?? "ausente"}`);
      continue;
    }
    if (raw.rules !== "chess") {
      note(gameId, url, "not_standard_chess", `rules=${raw.rules ?? "ausente"}`);
      continue;
    }
    if (raw.time_class && raw.time_class !== "rapid") {
      note(gameId, url, "not_rapid", `time_class=${raw.time_class}`);
      continue;
    }
    const whiteName = raw.white?.username?.toLowerCase() ?? "";
    const blackName = raw.black?.username?.toLowerCase() ?? "";
    if (whiteName !== user && blackName !== user) {
      note(gameId, url, "user_not_in_game", "El usuario no juega esta partida.");
      continue;
    }
    if (whiteName === user && blackName === user) {
      note(gameId, url, "user_both_sides", "El usuario aparece en ambos colores.");
      continue;
    }
    if (!raw.end_time) {
      note(gameId, url, "not_finished", "Sin end_time.");
      continue;
    }
    if (!isAfterCutoff(raw.end_time, gameId, baseline.cutoff)) {
      note(gameId, url, "not_after_baseline_cutoff", "No es posterior al corte del baseline.");
      continue;
    }
    if (!raw.pgn || typeof raw.pgn !== "string") {
      note(gameId, url, "missing_pgn", "PGN ausente.");
      continue;
    }

    const color = whiteName === user ? "white" : "black";
    const game = {
      gameId,
      url,
      cohortId,
      color,
      pgn: raw.pgn,
    };
    let parsed;
    try {
      parsed = decisionsFromPgn(raw.pgn, game);
    } catch (error) {
      const code = error.code || "unparseable_pgn";
      note(gameId, url, code === "nonstandard_start" || code === "not_standard_chess" ? code : "unparseable_pgn", String(error.message ?? error));
      continue;
    }

    const headers = parsed.headers ?? {};
    const pgnTc = headers.TimeControl;
    if (pgnTc && pgnTc !== "600" && pgnTc !== "600+0") {
      note(gameId, url, "time_control_mismatch", `PGN TimeControl=${pgnTc}`);
      continue;
    }

    const plies = parsed.historyLength;
    if (plies <= 8) {
      note(gameId, url, "too_few_plies", "0–8 medias jugadas: partida de uno a cuatro movimientos.");
      continue;
    }
    if (plies <= 20 && earlyResignOrAbandon(raw)) {
      note(
        gameId,
        url,
        "early_resign_or_abandon",
        "9–20 medias jugadas con resigned o abandoned. No se interpreta como debilidad ajedrecística."
      );
      continue;
    }

    const whiteResult = resultSide(raw, "white");
    const blackResult = resultSide(raw, "black");
    included.push({
      gameId,
      url,
      cohortId,
      endTime: Number(raw.end_time),
      endUtc: new Date(Number(raw.end_time) * 1000).toISOString(),
      timeControl: TIME_CONTROL,
      timeClass: raw.time_class ?? "rapid",
      rules: "chess",
      rated: Boolean(raw.rated),
      color,
      result: ownPerspective(color, whiteResult, blackResult),
      termination: { white: whiteResult, black: blackResult, pgn: headers.Termination ?? null },
      weaknessInference: null,
      ratings: {
        own: color === "white" ? raw.white?.rating ?? null : raw.black?.rating ?? null,
        opponent: color === "white" ? raw.black?.rating ?? null : raw.white?.rating ?? null,
        pgnOwn: color === "white" ? headers.WhiteElo ?? null : headers.BlackElo ?? null,
        pgnOpponent: color === "white" ? headers.BlackElo ?? null : headers.WhiteElo ?? null,
        source: "api_post",
      },
      opening: { eco: headers.ECO ?? null, name: headers.Opening ?? null },
      clocks: clocksInPgn(raw.pgn),
      pgn: raw.pgn,
      plies,
      ownDecisions: parsed.decisions.length,
      decisions: parsed.decisions,
      syncedAt,
      rulesVersion: FILTER_RULES_ID,
      detectorId: DETECTOR_ID,
    });
    if (gameId) knownIds.add(gameId);
    if (url) knownUrls.add(url);
  }

  return { included, excluded, knownIds, knownUrls, recordedExclusions };
}

export function cohortIdForSync(existingIds, nowIso) {
  const day = nowIso.slice(0, 10).replace(/-/g, "");
  const prefix = `transfer-${day}-`;
  const n = existingIds.filter((id) => String(id).startsWith(prefix)).length + 1;
  return `${prefix}${n}`;
}
