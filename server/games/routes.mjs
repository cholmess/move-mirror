import { Chess } from "chess.js";
import { createImportService, decodePgnBytes, decodePgnText } from "./import-service.mjs";

const MAX_BODY = Number(process.env.IMPORT_MAX_BODY_BYTES ?? 12 * 1024 * 1024);

export function createGamesRouter({ store, onGameImported = null }) {
  store.ensure();
  store.recoverInterruptedJobs();
  const service = createImportService(store, { onGameImported });

  return async function handleGames(req, res) {
    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname;
    try {
      if (pathname === "/api/import/jobs" && req.method === "GET") {
        return respond(res, 200, { jobs: store.listJobs().map(publicJob) });
      }
      if (pathname === "/api/player-identity" && req.method === "GET") return respond(res, 200, store.readIdentityPublic());
      if (pathname === "/api/player-identity" && req.method === "PATCH") {
        store.writeIdentity(await body(req));
        return respond(res, 200, store.readIdentityPublic());
      }
      if (pathname === "/api/player-identity/reconcile" && req.method === "POST") {
        const input = await body(req);
        return respond(res, 200, store.reconcileIdentity({
          dryRun: Boolean(input.dryRun),
          confirm: Boolean(input.confirm),
        }));
      }
      if (pathname === "/api/games" && req.method === "GET") {
        return respond(res, 200, {
          games: store.listGames({
            source: url.searchParams.get("source"),
            eligibility: url.searchParams.get("eligibility"),
            review: url.searchParams.get("review"),
            color: url.searchParams.get("color"),
            result: url.searchParams.get("result"),
            category: url.searchParams.get("category"),
            analyzed: url.searchParams.get("analyzed"),
            from: url.searchParams.get("from"),
            to: url.searchParams.get("to"),
            archived: url.searchParams.get("archived"),
          }).map((game) => publicGame(game, store)),
        });
      }
      if (pathname === "/api/games/scopes" && req.method === "GET") {
        return respond(res, 200, { scopes: store.listScopes() });
      }
      if (pathname === "/api/games/scopes" && req.method === "POST") {
        return respond(res, 201, store.upsertScope(await body(req)));
      }
      const historicalMatch = pathname.match(/^\/api\/games\/historical\/([A-Za-z0-9-]+)$/);
      if (historicalMatch && req.method === "GET") {
        const game = store.resolveHistoricalId(historicalMatch[1]);
        return game ? respond(res, 200, publicGame(game, store)) : respond(res, 404, { error: "game_not_found" });
      }

      const jobMatch = pathname.match(/^\/api\/import\/jobs\/([A-Za-z0-9-]+)$/);
      if (jobMatch && req.method === "GET") {
        const job = store.getJob(jobMatch[1]);
        return job ? respond(res, 200, publicJob(job)) : respond(res, 404, { error: "job_not_found" });
      }
      const cancelMatch = pathname.match(/^\/api\/import\/jobs\/([A-Za-z0-9-]+)\/cancel$/);
      if (cancelMatch && req.method === "POST") return respond(res, 200, publicJob(service.cancel(cancelMatch[1])));
      const resumeMatch = pathname.match(/^\/api\/import\/jobs\/([A-Za-z0-9-]+)\/resume$/);
      if (resumeMatch && req.method === "POST") return respond(res, 200, publicJob(await service.resume(resumeMatch[1])));

      if (pathname === "/api/import/pgn-preview" && req.method === "POST") {
        const input = await body(req);
        return respond(res, 200, service.previewPgn(decodeIncomingPgn(input)));
      }
      if (pathname === "/api/import/pgn-text" && req.method === "POST") {
        const input = await body(req);
        return respond(res, 201, publicJob(await service.importPgn({
          sourceType: "pgn_text",
          text: decodeIncomingPgn(input),
          input: {},
        })));
      }
      if (pathname === "/api/import/pgn" && req.method === "POST") {
        const input = await body(req);
        const files = Array.isArray(input.files) ? input.files : [{ name: input.name ?? "upload.pgn", text: input.pgn, bytes: input.bytes }];
        const jobs = [];
        for (const file of files) {
          jobs.push(publicJob(await service.importPgn({
            sourceType: "pgn_file",
            text: decodeIncomingPgn(file),
            input: { filename: safeFilename(file.name) },
          })));
        }
        return respond(res, 201, { jobs });
      }
      if (pathname === "/api/import/chess-com" && req.method === "POST") {
        return respond(res, 202, publicJob(await service.importChessCom(await body(req))));
      }
      if (pathname === "/api/import/lichess" && req.method === "POST") {
        return respond(res, 202, publicJob(await service.importLichess(await body(req))));
      }
      if (pathname === "/api/import/manual" && req.method === "POST") {
        return respond(res, 201, publicJob(await service.importManual(await body(req))));
      }

      const gameMatch = pathname.match(/^\/api\/games\/([A-Za-z0-9-]+)$/);
      if (gameMatch && req.method === "GET") {
        const game = store.getGame(gameMatch[1]);
        return game ? respond(res, 200, publicGame(game, store)) : respond(res, 404, { error: "game_not_found" });
      }
      if (gameMatch && req.method === "PATCH") {
        return respond(res, 200, publicGame(store.patchGame(gameMatch[1], await body(req)), store));
      }
      if (gameMatch && req.method === "DELETE") {
        return respond(res, 200, store.deleteGame(gameMatch[1]));
      }
      const archiveMatch = pathname.match(/^\/api\/games\/([A-Za-z0-9-]+)\/archive$/);
      if (archiveMatch && req.method === "POST") {
        const input = await body(req);
        return respond(res, 200, publicGame(store.archiveGame(archiveMatch[1], input.archived !== false), store));
      }
      const pgnMatch = pathname.match(/^\/api\/games\/([A-Za-z0-9-]+)\/pgn$/);
      if (pgnMatch && req.method === "GET") {
        const game = store.getGame(pgnMatch[1]);
        if (!game) return respond(res, 404, { error: "game_not_found" });
        res.writeHead(200, {
          "Content-Type": "application/x-chess-pgn; charset=utf-8",
          "Content-Disposition": `attachment; filename="${game.id}.pgn"`,
        });
        res.end(exportPgn(game));
        return true;
      }
      const playerMatch = pathname.match(/^\/api\/games\/([A-Za-z0-9-]+)\/resolve-player$/);
      if (playerMatch && req.method === "POST") {
        const input = await body(req);
        return respond(res, 200, publicGame(store.resolvePlayer(playerMatch[1], input.playerColor), store));
      }
      const conflictMatch = pathname.match(/^\/api\/games\/([A-Za-z0-9-]+)\/resolve-conflicts$/);
      if (conflictMatch && req.method === "POST") {
        const input = await body(req);
        return respond(res, 200, publicGame(store.resolveConflicts(conflictMatch[1], input.resolutions), store));
      }
      const sourceMatch = pathname.match(/^\/api\/games\/sources\/([A-Za-z0-9-]+)$/);
      if (sourceMatch && req.method === "DELETE") return respond(res, 200, store.deleteSource(sourceMatch[1]));
      const rawMatch = pathname.match(/^\/api\/games\/sources\/([A-Za-z0-9-]+)\/raw$/);
      if (rawMatch && req.method === "DELETE") return respond(res, 200, publicSource(store.removeRaw(rawMatch[1])));
      return false;
    } catch (error) {
      const code = publicError(error);
      const status = code.includes("not_found") ? 404 : code.includes("too_large") ? 413 : code === "game_protected" ? 409 : 400;
      respond(res, status, { ok: false, error: code, protection: error.protection ?? [] });
      return true;
    }
  };
}

function decodeIncomingPgn(input = {}) {
  if (input.bytes) return decodePgnBytes(Buffer.from(input.bytes, "base64"));
  return decodePgnText(input.pgn ?? input.text ?? "");
}

function publicGame(game, store) {
  const { sources = [], ...rest } = game;
  return {
    ...rest,
    protection: store.protectionReasons(game),
    sources: sources.map(publicSource),
  };
}

function publicSource(source) {
  const { rawLocation, ...rest } = source;
  return { ...rest, rawAvailable: Boolean(rawLocation) };
}

function publicJob(job) {
  const checkpoint = job.checkpoint && typeof job.checkpoint === "object"
    ? Object.fromEntries(Object.entries(job.checkpoint).filter(([key]) => !/path|file|dir|location/i.test(key)))
    : job.checkpoint;
  const { input, ...rest } = job;
  const safeInput = input && typeof input === "object"
    ? Object.fromEntries(Object.entries(input).filter(([key]) => !["pgn", "raw", "text", "bytes"].includes(key)))
    : input;
  return { ...rest, input: safeInput, checkpoint };
}

async function body(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("invalid_json");
  }
}

function respond(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
  return true;
}

function exportPgn(game) {
  const chess = new Chess(game.chess.startingFen);
  chess.header(
    "Event", game.metadata.event ?? "?",
    "Site", game.metadata.site ?? game.metadata.url ?? "?",
    "Date", game.timing.startedAt ? game.timing.startedAt.slice(0, 10).replaceAll("-", ".") : "????.??.??",
    "Round", game.metadata.round ?? "?",
    "White", game.players.white.name ?? game.players.white.username ?? "?",
    "Black", game.players.black.name ?? game.players.black.username ?? "?",
    "Result", game.chess.result,
  );
  if (game.timing.timeControl.raw) chess.header("TimeControl", game.timing.timeControl.raw);
  if (game.chess.startingFen && !game.chess.startingFen.startsWith("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR")) {
    chess.header("SetUp", "1", "FEN", game.chess.startingFen);
  }
  for (const uci of game.chess.movesUci) chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  return chess.pgn();
}

function safeFilename(value) {
  return String(value ?? "upload.pgn").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
}

function publicError(error) {
  const message = String(error?.message ?? error);
  const allowed = [
    "invalid_json", "request_too_large", "pgn_too_large", "invalid_username",
    "job_not_found", "game_not_found", "source_not_found", "source_not_resumable",
    "invalid_player_color", "game_protected", "alias_empty", "alias_looks_like_url",
    "duplicate_alias", "display_name_empty", "reconcile_requires_dry_run_or_confirm",
  ];
  return allowed.includes(message) ? message : "import_request_failed";
}
