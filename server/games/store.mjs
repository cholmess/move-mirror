import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_CHESSCOM_ALIAS,
  canonicalFromParsed,
  evaluateEligibility,
  gameFingerprint,
  mergeCanonical,
  possibleDuplicate,
  sha256,
} from "./model.mjs";
import { collectProtectedReferences, protectionForGame } from "./protected-refs.mjs";
import { createScoresheetStore } from "../scoresheets/store.mjs";
import {
  IdentityValidationError,
  publicIdentity,
  reconcileUnresolvedGames,
  validateIdentityPatch,
} from "./identity.mjs";

const EMPTY_SUMMARY = Object.freeze({
  discovered: 0,
  parsed: 0,
  newCanonicalGames: 0,
  mergedDuplicates: 0,
  exactDuplicates: 0,
  requiresReview: 0,
  excluded: 0,
  failed: 0,
});

export function createGamesStore(root, { projectRoot = path.join(root, "..", "..") } = {}) {
  const scoresheetStore = createScoresheetStore(root);
  const dirs = {
    root,
    canonical: path.join(root, "canonical"),
    sources: path.join(root, "sources"),
    jobs: path.join(root, "import-jobs"),
    raw: path.join(root, "raw"),
    scopes: path.join(root, "scopes"),
    index: path.join(root, "index.json"),
    identity: path.join(root, "player-identity.json"),
  };
  let index = null;

  function ensure() {
    Object.values(dirs).filter((value) => !path.extname(value)).forEach((dir) => mkdirSync(dir, { recursive: true }));
    scoresheetStore.ensure();
    if (!existsSync(dirs.identity)) {
      const now = new Date().toISOString();
      atomicJson(dirs.identity, {
        id: randomUUID(),
        displayName: "Jugador local",
        chessComUsernames: [DEFAULT_CHESSCOM_ALIAS],
        lichessUsernames: [],
        pgnNameAliases: [],
        createdAt: now,
        updatedAt: now,
        version: "player-identity-v1",
      });
    }
    loadIndex();
  }

  function loadIndex() {
    if (index) return index;
    try {
      index = JSON.parse(readFileSync(dirs.index, "utf8"));
    } catch {
      index = rebuildIndex();
    }
    return index;
  }

  function rebuildIndex() {
    const next = { version: "games-index-v1", byFingerprint: {}, byExternalId: {}, updatedAt: new Date().toISOString() };
    for (const game of readDirectory(dirs.canonical)) {
      if (game?.id && game?.fingerprint) next.byFingerprint[game.fingerprint] = game.id;
    }
    for (const source of readDirectory(dirs.sources)) {
      if (source?.externalId) next.byExternalId[`${source.sourceType}:${source.externalId}`] = source.canonicalGameId;
    }
    index = next;
    atomicJson(dirs.index, next);
    return next;
  }

  function readIdentity() {
    ensure();
    return readJson(dirs.identity);
  }

  function writeIdentity(patch) {
    const current = readIdentity();
    const validated = validateIdentityPatch(current, patch);
    const next = {
      ...current,
      ...validated,
      id: current.id,
      version: "player-identity-v1",
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    };
    atomicJson(dirs.identity, next);
    return next;
  }

  function readIdentityPublic() {
    const games = listGames({ archived: "true" });
    return publicIdentity(readIdentity(), games);
  }

  function reconcileIdentity({ dryRun = false, confirm = false } = {}) {
    if (!dryRun && !confirm) throw new IdentityValidationError("reconcile_requires_dry_run_or_confirm");
    const identity = readIdentity();
    const protectedRefs = collectProtectedReferences(projectRoot);
    const games = listGames({ archived: "true" });
    const summary = reconcileUnresolvedGames({
      games,
      identity,
      protectedRefs,
      apply: confirm,
    });
    if (confirm) {
      for (const id of summary.gameIds) {
        const game = games.find((item) => item.id === id);
        if (!game) continue;
        const { sources, ...stored } = game;
        atomicJson(gameFile(id), stored);
      }
    }
    return summary;
  }

  function createJob(sourceType, input = {}) {
    ensure();
    const job = {
      id: randomUUID(),
      version: "import-job-v1",
      sourceType,
      status: "queued",
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      checkpoint: input.checkpoint ?? null,
      input: sanitizeJobInput(input),
      summary: { ...EMPTY_SUMMARY },
      errors: [],
    };
    atomicJson(jobFile(job.id), job);
    return job;
  }

  function updateJob(id, patch) {
    const current = getJob(id);
    if (!current) throw new Error("job_not_found");
    const next = { ...current, ...patch };
    if (patch.summary) next.summary = { ...current.summary, ...patch.summary };
    atomicJson(jobFile(id), next);
    return next;
  }

  function listJobs() {
    ensure();
    return readDirectory(dirs.jobs).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  function getJob(id) {
    if (!safeId(id)) return null;
    return readJson(jobFile(id), null);
  }

  function cancelJob(id) {
    const job = getJob(id);
    if (!job) throw new Error("job_not_found");
    if (["completed", "completed_with_errors", "failed"].includes(job.status)) return job;
    return updateJob(id, { status: "cancelled", completedAt: new Date().toISOString() });
  }

  function importParsed({
    parsed,
    raw,
    sourceType,
    importJobId,
    externalId = null,
    parsedMetadata = {},
    overrides = {},
  }) {
    ensure();
    const importedAt = new Date().toISOString();
    const rawSha256 = sha256(raw);
    const exact = readDirectory(dirs.sources).find((source) =>
      source.sourceType === sourceType
      && source.rawSha256 === rawSha256
      && (source.externalId ?? null) === externalId
    );
    if (exact) {
      const game = getGame(exact.canonicalGameId);
      return { game, source: exact, disposition: "exact_duplicate", conflicts: [], possibleDuplicateIds: [] };
    }
    const sourceId = randomUUID();
    const incoming = canonicalFromParsed(parsed, {
      importedAt,
      sourceId,
      importJobId,
      identity: readIdentity(),
      overrides: { ...overrides, sourceType },
    });
    const existingId = loadIndex().byFingerprint[incoming.fingerprint];
    let game = incoming;
    let disposition = "new_canonical_game";
    let conflicts = [];
    if (existingId) {
      const existing = getGame(existingId);
      const result = mergeCanonical(existing, incoming);
      game = result.merged;
      conflicts = result.conflicts;
      disposition = "merged_with_existing";
      game.provenance.sourceIds = unique([...game.provenance.sourceIds, sourceId]);
      game.provenance.importJobIds = unique([...game.provenance.importJobIds, importJobId]);
      game.provenance.lastImportedAt = importedAt;
    }
    const possibleDuplicateIds = existingId
      ? []
      : listGames().filter((candidate) => possibleDuplicate(candidate, incoming)).map((candidate) => candidate.id);
    if (possibleDuplicateIds.length) {
      conflicts.push({
        field: "chess.movesUci",
        existingValue: possibleDuplicateIds,
        incomingValue: incoming.chess.movesUci.length,
        chosenValue: incoming.chess.movesUci.length,
        resolutionRule: "game-fingerprint-v1:long_prefix_possible_truncation",
        requiresReview: true,
      });
    }
    const rawLocation = persistRaw(rawSha256, raw);
    const source = {
      id: sourceId,
      version: "game-source-record-v1",
      sourceType,
      externalId,
      importedAt,
      importJobId,
      rawSha256,
      rawLocation,
      parsedMetadata,
      canonicalGameId: game.id,
      duplicateDisposition: disposition,
      conflicts,
    };
    atomicJson(sourceFile(sourceId), source);
    atomicJson(gameFile(game.id), game);
    index.byFingerprint[game.fingerprint] = game.id;
    if (externalId) index.byExternalId[`${sourceType}:${externalId}`] = game.id;
    index.updatedAt = importedAt;
    atomicJson(dirs.index, index);
    return { game, source, disposition, conflicts, possibleDuplicateIds };
  }

  function listGames(filters = {}) {
    ensure();
    const sources = readDirectory(dirs.sources);
    const byGame = new Map();
    for (const source of sources) {
      const list = byGame.get(source.canonicalGameId) ?? [];
      list.push(source);
      byGame.set(source.canonicalGameId, list);
    }
    return readDirectory(dirs.canonical)
      .map((game) => ({ ...game, sources: byGame.get(game.id) ?? [] }))
      .filter((game) => {
        if (filters.archived !== "true" && game.archived) return false;
        if (filters.source && !game.sources.some((source) => source.sourceType === filters.source)) return false;
        if (filters.eligibility === "coaching" && !game.eligibility.coachingEligible) return false;
        if (filters.eligibility === "transfer" && !game.eligibility.transferEligible) return false;
        if (filters.color && game.players.playerResolution.playerColor !== filters.color) return false;
        if (filters.result && game.chess.result !== filters.result) return false;
        if (filters.category && game.timing.timeControl.category !== filters.category) return false;
        if (filters.analyzed === "true" && !game.analysisSelected) return false;
        if (filters.analyzed === "false" && game.analysisSelected) return false;
        if (filters.from && (game.timing.startedAt ?? "") < filters.from) return false;
        if (filters.to && (game.timing.startedAt ?? "9999") > `${filters.to}T23:59:59.999Z`) return false;
        if (filters.review === "true" && game.players.playerResolution.confidence === "verified" && !game.sources.some((source) => source.conflicts?.some((conflict) => conflict.requiresReview))) return false;
        return true;
      })
      .sort((a, b) => String(b.timing.startedAt ?? b.provenance.firstImportedAt).localeCompare(String(a.timing.startedAt ?? a.provenance.firstImportedAt)));
  }

  function getGame(id) {
    if (!safeId(id)) return null;
    const game = readJson(gameFile(id), null);
    if (!game) return null;
    return { ...game, sources: readDirectory(dirs.sources).filter((source) => source.canonicalGameId === id) };
  }

  function patchGame(id, patch) {
    const current = getGame(id);
    if (!current) throw new Error("game_not_found");
    const { sources, ...stored } = current;
    if (patch.archived !== undefined) stored.archived = Boolean(patch.archived);
    if (patch.analysisSelected !== undefined) stored.analysisSelected = Boolean(patch.analysisSelected);
    if (patch.confirmedFields) stored.confirmedFields = unique([...(stored.confirmedFields ?? []), ...patch.confirmedFields]);
    atomicJson(gameFile(id), stored);
    if (patch.analysisSelected !== undefined) {
      const scope = nextScope();
      const gameIds = stored.analysisSelected
        ? unique([...scope.gameIds, id])
        : scope.gameIds.filter((gameId) => gameId !== id);
      upsertScope({ ...scope, gameIds });
    }
    return getGame(id);
  }

  function resolvePlayer(id, color) {
    if (!["white", "black"].includes(color)) throw new Error("invalid_player_color");
    const current = getGame(id);
    if (!current) throw new Error("game_not_found");
    const { sources, ...stored } = current;
    stored.players.playerResolution = {
      playerColor: color,
      method: "manual_confirmation",
      matchedAlias: stored.players[color].username ?? stored.players[color].name,
      confidence: "verified",
    };
    stored.eligibility = evaluateEligibility(stored);
    atomicJson(gameFile(id), stored);
    return getGame(id);
  }

  function resolveConflicts(id, resolutions) {
    const game = getGame(id);
    if (!game) throw new Error("game_not_found");
    for (const source of game.sources) {
      let changed = false;
      source.conflicts = (source.conflicts ?? []).map((conflict) => {
        const resolution = resolutions?.[conflict.field];
        if (resolution === undefined) return conflict;
        changed = true;
        return { ...conflict, chosenValue: resolution, resolutionRule: "metadata-merge-v1:manual_confirmation", requiresReview: false };
      });
      if (changed) atomicJson(sourceFile(source.id), source);
    }
    return getGame(id);
  }

  function removeRaw(sourceId) {
    const source = readJson(sourceFile(sourceId), null);
    if (!source) throw new Error("source_not_found");
    if (source.rawLocation) rmSync(path.join(root, source.rawLocation), { force: true });
    source.rawLocation = null;
    atomicJson(sourceFile(sourceId), source);
    return source;
  }

  function deleteSource(sourceId) {
    const source = readJson(sourceFile(sourceId), null);
    if (!source) throw new Error("source_not_found");
    const game = getGame(source.canonicalGameId);
    if (source.rawLocation) {
      const shared = readDirectory(dirs.sources).some((row) => row.id !== sourceId && row.rawSha256 === source.rawSha256);
      if (!shared) rmSync(path.join(root, source.rawLocation), { force: true });
    }
    rmSync(sourceFile(sourceId), { force: true });
    if (game) {
      const { sources, ...stored } = game;
      stored.provenance.sourceIds = (stored.provenance.sourceIds ?? []).filter((id) => id !== sourceId);
      atomicJson(gameFile(game.id), stored);
    }
    rebuildIndex();
    return { ok: true, sourceId, canonicalGameId: source.canonicalGameId };
  }

  function archiveGame(id, archived = true) {
    return patchGame(id, { archived });
  }

  function deleteGame(id) {
    const game = getGame(id);
    if (!game) throw new Error("game_not_found");
    const protection = protectionReasons(game);
    if (protection.length) {
      const error = new Error("game_protected");
      error.protection = protection;
      throw error;
    }
    for (const source of game.sources) deleteSource(source.id);
    rmSync(gameFile(id), { force: true });
    rebuildIndex();
    return { ok: true, deleted: id };
  }

  function protectionReasons(game) {
    try {
      return protectionForGame(game, collectProtectedReferences(projectRoot));
    } catch {
      return [];
    }
  }

  function resolveHistoricalId(historicalId) {
    const map = readJson(path.join(root, "historical-id-map.json"), {});
    const canonicalId = map[historicalId] ?? loadIndex().byExternalId[`chess_com:${historicalId}`] ?? null;
    return canonicalId ? getGame(canonicalId) : null;
  }

  function recoverInterruptedJobs() {
    ensure();
    for (const job of listJobs()) {
      if (job.status === "running") {
        updateJob(job.id, {
          status: "cancelled",
          completedAt: new Date().toISOString(),
          errors: [...(job.errors ?? []), { code: "server_restarted", message: "El servidor se reinició durante la importación." }],
        });
      }
    }
  }

  function listScopes() {
    ensure();
    return readDirectory(dirs.scopes);
  }

  function upsertScope(scope) {
    ensure();
    const current = scope.id && safeId(scope.id) ? readJson(scopeFile(scope.id), null) : null;
    const next = {
      id: current?.id ?? randomUUID(),
      name: scope.name ?? current?.name ?? "Próximo análisis",
      policyVersion: scope.policyVersion ?? current?.policyVersion ?? "rapid-10m-coaching-v1",
      gameIds: unique(scope.gameIds ?? current?.gameIds ?? []),
      timeControlCategories: unique(scope.timeControlCategories ?? current?.timeControlCategories ?? ["rapid"]),
      createdAt: current?.createdAt ?? new Date().toISOString(),
      frozenAt: scope.frozenAt === undefined ? current?.frozenAt ?? null : scope.frozenAt,
    };
    atomicJson(scopeFile(next.id), next);
    return next;
  }

  function nextScope() {
    const existing = listScopes().find((scope) => !scope.frozenAt);
    if (existing) return existing;
    return upsertScope({
      name: "Próximo análisis 10+0",
      policyVersion: "rapid-10m-coaching-v1",
      timeControlCategories: ["rapid"],
      gameIds: listGames().filter((game) => game.analysisSelected).map((game) => game.id),
    });
  }

  function setAnalysisSelected(id, selected) {
    const game = patchGame(id, { analysisSelected: selected });
    const scope = nextScope();
    const gameIds = selected
      ? unique([...scope.gameIds, id])
      : scope.gameIds.filter((gameId) => gameId !== id);
    upsertScope({ ...scope, gameIds });
    return game;
  }

  function scopeFile(id) { return path.join(dirs.scopes, `${id}.json`); }

  function verify() {
    ensure();
    const errors = [];
    const idx = loadIndex();
    for (const game of readDirectory(dirs.canonical)) {
      if (idx.byFingerprint[game.fingerprint] !== game.id) errors.push({ gameId: game.id, error: "index_mismatch" });
      if (game.fingerprint !== gameFingerprint(game.chess.startingFen, game.chess.movesUci)) {
        errors.push({ gameId: game.id, error: "fingerprint_mismatch" });
      }
      for (const sourceId of game.provenance.sourceIds ?? []) {
        if (!existsSync(sourceFile(sourceId))) errors.push({ gameId: game.id, sourceId, error: "missing_source" });
      }
    }
    const map = readJson(path.join(root, "historical-id-map.json"), {});
    for (const [historicalId, canonicalId] of Object.entries(map)) {
      if (!existsSync(gameFile(canonicalId))) errors.push({ historicalId, canonicalId, error: "unresolved_historical_id" });
    }
    return {
      ok: errors.length === 0,
      games: readDirectory(dirs.canonical).length,
      sources: readDirectory(dirs.sources).length,
      historicalIds: Object.keys(map).length,
      errors,
    };
  }


  function backup(label = "pre-v0.5.0") {
    const target = path.join(path.dirname(root), `games-backup-${label}`);
    if (!existsSync(target) && existsSync(root)) copyDirectory(root, target);
    return target;
  }

  function persistRaw(hash, raw) {
    const relative = path.join("raw", `${hash}.pgn`);
    const file = path.join(root, relative);
    if (!existsSync(file)) atomicText(file, raw);
    return relative;
  }

  function gameFile(id) { return path.join(dirs.canonical, `${id}.json`); }
  function sourceFile(id) { return path.join(dirs.sources, `${id}.json`); }
  function jobFile(id) { return path.join(dirs.jobs, `${id}.json`); }

  return {
    root,
    dirs,
    scoresheetStore,
    ensure,
    readIdentity,
    readIdentityPublic,
    writeIdentity,
    reconcileIdentity,
    createJob,
    updateJob,
    listJobs,
    getJob,
    cancelJob,
    importParsed,
    listGames,
    getGame,
    patchGame,
    resolvePlayer,
    resolveConflicts,
    removeRaw,
    deleteSource,
    archiveGame,
    deleteGame,
    protectionReasons,
    resolveHistoricalId,
    recoverInterruptedJobs,
    listScopes,
    upsertScope,
    nextScope,
    rebuildIndex,
    verify,
    backup,
  };
}

export function atomicJson(file, value) {
  atomicText(file, `${JSON.stringify(value, null, 2)}\n`);
}

function atomicText(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, text, "utf8");
  renameSync(temporary, file);
}

function readDirectory(dir) {
  if (!existsSync(dir)) return [];
  const rows = [];
  for (const name of readdirSync(dir).filter((item) => item.endsWith(".json"))) {
    try {
      rows.push(JSON.parse(readFileSync(path.join(dir, name), "utf8")));
    } catch {
      // Corrupt entries are isolated; games:verify reports broken references.
    }
  }
  return rows;
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function sanitizeJobInput(input) {
  const { pgn, raw, ...safe } = input;
  return safe;
}

function cleanAliases(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value).trim())
    .filter((value) => {
      const key = value.toLocaleLowerCase();
      if (!value || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function safeId(value) {
  return /^[A-Za-z0-9-]+$/.test(String(value));
}

function copyDirectory(source, target) {
  mkdirSync(target, { recursive: true });
  for (const name of readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, name.name);
    const to = path.join(target, name.name);
    if (name.isDirectory()) copyDirectory(from, to);
    else copyFileSync(from, to);
  }
}
