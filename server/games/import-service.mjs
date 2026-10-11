import { Chess } from "chess.js";
import { fetchText } from "../transfer/chesscom.mjs";
import { fetchLichessGames } from "./lichess.mjs";
import { decodePgnBytes, decodePgnText, maxPgnBytes } from "./pgn-encoding.mjs";
import {
  parsePgnCollection,
  STANDARD_FEN,
} from "./model.mjs";

const active = new Map();

export function createImportService(store, deps = {}) {
  const fetchTextFn = deps.fetchText ?? fetchText;
  const fetchLichessFn = deps.fetchLichessGames ?? fetchLichessGames;

  function previewPgn(text) {
    const parsedGames = parsePgnCollection(decodePgnText(text));
    return {
      detected: parsedGames.length,
      valid: parsedGames.filter((row) => row.game && !row.excluded).length,
      excluded: parsedGames.filter((row) => row.excluded).length,
      failed: parsedGames.filter((row) => row.error && !row.excluded).length,
      games: parsedGames.map((row) => ({
        index: row.index,
        excluded: row.excluded,
        error: row.error,
        white: row.game?.headers?.White ?? null,
        black: row.game?.headers?.Black ?? null,
        result: row.game?.result ?? null,
        moves: row.game?.movesSan?.length ?? 0,
      })),
    };
  }

  async function importPgn({ sourceType, text, input = {}, overrides = {}, existingJob = null }) {
    assertTextSize(text);
    const job = existingJob ?? store.createJob(sourceType, input);
    const controller = new AbortController();
    active.set(job.id, controller);
    store.updateJob(job.id, { status: "running", startedAt: job.startedAt ?? new Date().toISOString() });
    const parsedGames = parsePgnCollection(text);
    const summary = {
      discovered: parsedGames.length,
      parsed: 0,
      newCanonicalGames: 0,
      mergedDuplicates: 0,
      exactDuplicates: 0,
      requiresReview: 0,
      excluded: 0,
      failed: 0,
    };
    const errors = [];
    const importedGameIds = [];
    try {
      for (const row of parsedGames) {
        if (controller.signal.aborted) throw new Error("aborted");
        if (row.excluded) {
          summary.excluded += 1;
          errors.push({ ...row.error, excluded: true });
          continue;
        }
        if (row.error) {
          summary.failed += 1;
          errors.push(row.error);
          continue;
        }
        summary.parsed += 1;
        const externalId = externalIdFrom(row.game.headers, input.externalId, row.index);
        const result = store.importParsed({
          parsed: row.game,
          raw: row.rawPgn,
          sourceType,
          importJobId: job.id,
          externalId,
          parsedMetadata: row.game.headers,
          overrides,
        });
        importedGameIds.push(result.game.id);
        if (result.disposition === "new_canonical_game") {
          summary.newCanonicalGames += 1;
          if (deps.onGameImported) {
            await deps.onGameImported(result.game);
          }
        }
        if (result.disposition === "merged_with_existing") summary.mergedDuplicates += 1;
        if (result.disposition === "exact_duplicate") summary.exactDuplicates += 1;
        if (
          result.game.players.playerResolution.confidence !== "verified"
          || result.conflicts.some((conflict) => conflict.requiresReview)
          || result.possibleDuplicateIds.length
        ) summary.requiresReview += 1;
      }
      const status = summary.requiresReview > 0
        ? "awaiting_review"
        : summary.failed > 0
          ? "completed_with_errors"
          : "completed";
      return store.updateJob(job.id, {
        status,
        completedAt: new Date().toISOString(),
        checkpoint: { completedGameIndexes: parsedGames.map((row) => row.index), importedGameIds },
        summary,
        errors,
      });
    } catch (error) {
      if (String(error.message) === "aborted") {
        return store.updateJob(job.id, {
          status: "cancelled",
          completedAt: new Date().toISOString(),
          checkpoint: { importedGameIds },
          summary,
          errors,
        });
      }
      errors.push({ code: "import_failed", message: sanitizedMessage(error) });
      return store.updateJob(job.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        summary,
        errors,
      });
    } finally {
      active.delete(job.id);
    }
  }

  async function importChessCom(input, existingJob = null) {
    const username = requiredUsername(input.username);
    const job = existingJob ?? store.createJob("chess_com", {
      username,
      from: input.from ?? null,
      to: input.to ?? null,
    });
    const controller = new AbortController();
    active.set(job.id, controller);
    store.updateJob(job.id, { status: "running", startedAt: job.startedAt ?? new Date().toISOString() });
    try {
      const archives = await fetchTextFn(`https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/archives`, {
        signal: controller.signal,
      });
      const urls = (archives.json.archives ?? []).filter((url) => monthInRange(url, input.from, input.to));
      const startIndex = Number(job.checkpoint?.archiveIndex ?? 0);
      let combined = job.checkpoint?.combinedPgn ?? "";
      const responses = job.checkpoint?.responses ?? [];
      let excluded = job.checkpoint?.excluded ?? 0;
      for (let index = startIndex; index < urls.length; index += 1) {
        if (controller.signal.aborted) throw new Error("aborted");
        const response = await fetchTextFn(urls[index], { signal: controller.signal });
        responses.push({ url: urls[index], sha256: response.sha256, games: response.json.games?.length ?? 0 });
        for (const game of response.json.games ?? []) {
          if (game.rules && game.rules !== "chess") {
            excluded += 1;
            continue;
          }
          if (!inTimestampRange(game.end_time, input.from, input.to)) continue;
          if (game.pgn) combined += `${game.pgn}\n\n`;
        }
        store.updateJob(job.id, { checkpoint: { archiveIndex: index + 1, responses, excluded, username, from: input.from ?? null, to: input.to ?? null } });
      }
      active.delete(job.id);
      const imported = await importPgn({
        sourceType: "chess_com",
        text: combined,
        input: { username, archiveResponses: responses },
        overrides: { sourceUsername: username },
        existingJob: job,
      });
      if (excluded) {
        return store.updateJob(job.id, {
          summary: { ...imported.summary, excluded: imported.summary.excluded + excluded },
        });
      }
      return imported;
    } catch (error) {
      active.delete(job.id);
      const status = String(error.message) === "aborted" ? "cancelled" : "failed";
      return store.updateJob(job.id, {
        status,
        completedAt: new Date().toISOString(),
        errors: status === "failed" ? [{ code: "chess_com_import_failed", message: sanitizedMessage(error) }] : [],
      });
    }
  }

  async function importLichess(input, existingJob = null) {
    const username = requiredUsername(input.username);
    const job = existingJob ?? store.createJob("lichess", {
      username,
      from: input.from ?? null,
      to: input.to ?? null,
    });
    const controller = new AbortController();
    active.set(job.id, controller);
    store.updateJob(job.id, { status: "running", startedAt: job.startedAt ?? new Date().toISOString() });
    try {
      const downloaded = await fetchLichessFn(username, { from: input.from, to: input.to }, { signal: controller.signal });
      if (!downloaded.complete) {
        store.updateJob(job.id, {
          checkpoint: { responseComplete: false, username },
          errors: [{ code: "lichess_incomplete", message: "La respuesta de Lichess llegó incompleta." }],
        });
      }
      active.delete(job.id);
      return importPgn({
        sourceType: "lichess",
        text: downloaded.text,
        input: { username, responseComplete: downloaded.complete },
        overrides: { sourceUsername: username },
        existingJob: job,
      });
    } catch (error) {
      active.delete(job.id);
      const status = String(error.name) === "AbortError" ? "cancelled" : "failed";
      return store.updateJob(job.id, {
        status,
        completedAt: new Date().toISOString(),
        checkpoint: { responseComplete: false },
        errors: status === "failed" ? [{ code: "lichess_import_failed", message: sanitizedMessage(error) }] : [],
      });
    }
  }

  async function importManual(input) {
    const job = store.createJob("manual", { draft: Boolean(input.draft) });
    try {
      const parsed = parsedFromManual(input);
      const pgn = pgnFromParsed(parsed, input);
      store.updateJob(job.id, { status: "running", startedAt: new Date().toISOString() });
      const result = store.importParsed({
        parsed,
        raw: pgn,
        sourceType: "manual",
        importJobId: job.id,
        parsedMetadata: input.metadata ?? {},
        overrides: {
          ...input.metadata,
          playerColor: input.playerColor,
          result: input.result,
          draft: Boolean(input.draft),
          timeControl: input.metadata?.timeControl,
          confirmedFields: input.draft ? [] : [
            "players.playerResolution",
            input.metadata?.event ? "metadata.event" : null,
            input.metadata?.timeControl ? "timing.startedAt" : null,
          ].filter(Boolean),
        },
      });
      const summary = {
        discovered: 1,
        parsed: 1,
        newCanonicalGames: result.disposition === "new_canonical_game" ? 1 : 0,
        mergedDuplicates: result.disposition === "merged_with_existing" ? 1 : 0,
        exactDuplicates: result.disposition === "exact_duplicate" ? 1 : 0,
        requiresReview: result.game.players.playerResolution.confidence === "verified" ? 0 : 1,
        excluded: 0,
        failed: 0,
      };
      return store.updateJob(job.id, {
        status: summary.requiresReview ? "awaiting_review" : "completed",
        completedAt: new Date().toISOString(),
        checkpoint: { importedGameIds: [result.game.id] },
        summary,
      });
    } catch (error) {
      return store.updateJob(job.id, {
        status: "failed",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        summary: { failed: 1, discovered: 1 },
        errors: [{ code: "invalid_manual_game", message: sanitizedMessage(error) }],
      });
    }
  }

  function cancel(id) {
    active.get(id)?.abort();
    return store.cancelJob(id);
  }

  async function resume(id) {
    const job = store.getJob(id);
    if (!job) throw new Error("job_not_found");
    if (!["cancelled", "failed"].includes(job.status)) return job;
    if (job.sourceType === "chess_com") return importChessCom(job.input, job);
    if (job.sourceType === "lichess") return importLichess(job.input, job);
    throw new Error("source_not_resumable");
  }

  return { importPgn, importChessCom, importLichess, importManual, cancel, resume, previewPgn };
}

function parsedFromManual(input) {
  const startingFen = input.startingFen || STANDARD_FEN;
  const chess = new Chess(startingFen);
  const movesUci = [];
  const movesSan = [];
  for (let ply = 0; ply < (input.movesUci ?? []).length; ply += 1) {
    const uci = String(input.movesUci[ply]);
    const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    if (!move) throw new Error(`illegal_move_at_ply_${ply + 1}`);
    movesUci.push(`${move.from}${move.to}${move.promotion ?? ""}`);
    movesSan.push(move.san);
  }
  if (!movesUci.length && !input.draft) throw new Error("game_has_no_moves");
  return {
    headers: {},
    startingFen,
    movesUci,
    movesSan,
    result: input.result ?? "*",
    termination: null,
  };
}

function pgnFromParsed(parsed, input) {
  const chess = new Chess(parsed.startingFen);
  const metadata = input.metadata ?? {};
  chess.header(
    "Event", metadata.event || "Partida manual",
    "Site", metadata.site || "MoveMirror",
    "Date", normalizePgnDate(metadata.date),
    "Round", metadata.round || "?",
    "White", metadata.whiteName || (input.playerColor === "white" ? "Jugador local" : metadata.opponentName || "Rival"),
    "Black", metadata.blackName || (input.playerColor === "black" ? "Jugador local" : metadata.opponentName || "Rival"),
    "Result", input.result ?? "*",
  );
  if (metadata.timeControl) chess.header("TimeControl", metadata.timeControl);
  if (parsed.startingFen !== STANDARD_FEN) chess.header("SetUp", "1", "FEN", parsed.startingFen);
  for (const uci of parsed.movesUci) chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  return chess.pgn();
}

function externalIdFrom(headers, fallback, index) {
  if (fallback) return `${fallback}:${index}`;
  const link = headers.Link ?? headers.Site;
  const match = String(link ?? "").match(/(?:chess\.com\/game\/live\/|lichess\.org\/)([A-Za-z0-9-]+)/);
  return match?.[1] ?? null;
}

function assertTextSize(text) {
  if (Buffer.byteLength(String(text), "utf8") > maxPgnBytes()) throw new Error("pgn_too_large");
}

export { decodePgnBytes, decodePgnText };

function requiredUsername(value) {
  const username = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_-]{2,32}$/.test(username)) throw new Error("invalid_username");
  return username;
}

function monthInRange(url, from, to) {
  const match = String(url).match(/(\d{4})\/(\d{2})$/);
  if (!match) return false;
  const month = `${match[1]}-${match[2]}`;
  return (!from || month >= String(from).slice(0, 7)) && (!to || month <= String(to).slice(0, 7));
}

function inTimestampRange(timestamp, from, to) {
  const value = Number(timestamp) * 1000;
  return (!from || value >= new Date(from).getTime()) && (!to || value <= new Date(to).getTime());
}

function normalizePgnDate(value) {
  if (!value) return "????.??.??";
  return String(value).slice(0, 10).replaceAll("-", ".");
}

function sanitizedMessage(error) {
  return String(error?.message ?? error).replace(/\s+/g, " ").slice(0, 240);
}
