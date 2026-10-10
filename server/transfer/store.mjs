import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, appendFileSync } from "node:fs";
import path from "node:path";
import { DETECTOR_ID, FINGERPRINT, FILTER_RULES_ID, TRANSFER_VERSION } from "../../shared/transfer/constants.js";
import { compareMetrics } from "../../shared/transfer/measure.js";

function safeId(id) {
  if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error("bad_cohort_id");
  return id;
}

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readJsonl(file) {
  if (!existsSync(file)) return [];
  const out = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* ignore a torn final line */
    }
  }
  return out;
}

function emptyState() {
  return {
    version: TRANSFER_VERSION,
    lastSyncedAt: null,
    lastError: null,
    lastSource: null,
    pedagogy: null,
    trainingSnapshot: null,
    exerciseCandidates: [],
    archives: [],
  };
}

export function createStore(root) {
  const manifestPath = path.join(root, "baseline-manifest.json");
  const statePath = path.join(root, "state.json");
  const cohortsDir = path.join(root, "cohorts");
  const baselineDir = path.join(root, "baseline");

  function cohortDir(id) {
    return path.join(cohortsDir, safeId(id));
  }

  function readMeta(id) {
    return readJson(path.join(cohortDir(id), "meta.json"), null);
  }

  function writeMeta(meta) {
    if (readMeta(meta.id)?.frozen) throw new Error("cohort_frozen");
    writeJson(path.join(cohortDir(meta.id), "meta.json"), meta);
  }

  function listCohortIds() {
    if (!existsSync(cohortsDir)) return [];
    return readdirSync(cohortsDir).filter((name) => existsSync(path.join(cohortsDir, name, "meta.json")));
  }

  function readGames(id) {
    return readJson(path.join(cohortDir(id), "games.json"), []);
  }

  function readExclusions(id) {
    return readJson(path.join(cohortDir(id), "exclusions.json"), []);
  }

  function analysisRecords(id) {
    const rows = readJsonl(path.join(cohortDir(id), "analysis.jsonl"));
    const map = new Map();
    for (const row of rows) map.set(row.key, row);
    return map;
  }

  function decisionsOf(id) {
    return readGames(id).flatMap((game) => game.decisions ?? []);
  }

  function pendingCount(id) {
    const done = analysisRecords(id);
    return decisionsOf(id).filter((decision) => !done.has(decision.key)).length;
  }

  function cohortSummary(id) {
    const meta = readMeta(id);
    if (!meta) return null;
    const games = readGames(id);
    const exclusions = readExclusions(id);
    const metrics = readJson(path.join(cohortDir(id), "metrics.json"), null);
    const pending = pendingCount(id);
    return {
      ...meta,
      pendingDecisions: pending,
      games: games.length,
      exclusions: exclusions.length,
      decisions: games.reduce((sum, game) => sum + (game.ownDecisions ?? 0), 0),
      metrics: metrics ? stripClusters(metrics) : null,
      analysisComplete: pending === 0 && games.length > 0,
    };
  }

  function knownIds() {
    const ids = new Set();
    for (const id of listCohortIds()) {
      for (const game of readGames(id)) ids.add(game.gameId);
    }
    return ids;
  }

  function knownUrls() {
    const urls = new Set();
    for (const id of listCohortIds()) {
      for (const game of readGames(id)) if (game.url) urls.add(game.url);
    }
    return urls;
  }

  function recordedKeys() {
    const keys = new Set();
    for (const id of listCohortIds()) {
      for (const row of readExclusions(id)) keys.add(`${row.gameId ?? ""}|${row.url ?? ""}|${row.reason}`);
    }
    return keys;
  }

  return {
    root,
    ensure() {
      mkdirSync(root, { recursive: true });
      mkdirSync(cohortsDir, { recursive: true });
      mkdirSync(baselineDir, { recursive: true });
      if (!existsSync(statePath)) writeJson(statePath, emptyState());
    },
    readManifest() {
      if (!existsSync(manifestPath)) {
        throw new Error("baseline_manifest_missing");
      }
      return readJson(manifestPath, null);
    },
    readState() {
      this.ensure();
      return readJson(statePath, emptyState());
    },
    writeState(state) {
      writeJson(statePath, state);
    },
    listCohortIds,
    readMeta,
    cohortSummary,
    readGames,
    readExclusions,
    analysisRecords,
    decisionsOf,
    pendingCount,
    knownIds,
    knownUrls,
    recordedKeys,
    createCohort(meta) {
      this.ensure();
      if (readMeta(meta.id)) throw new Error("cohort_exists");
      const full = {
        id: safeId(meta.id),
        createdAt: meta.createdAt,
        syncedAt: meta.syncedAt,
        frozen: false,
        frozenAt: null,
        cutoff: meta.cutoff,
        detectorId: DETECTOR_ID,
        analysisFingerprint: FINGERPRINT,
        filterRulesId: FILTER_RULES_ID,
        baselineCohortId: meta.baselineCohortId,
      };
      writeJson(path.join(cohortDir(full.id), "meta.json"), full);
      writeJson(path.join(cohortDir(full.id), "games.json"), []);
      writeJson(path.join(cohortDir(full.id), "exclusions.json"), []);
      return full;
    },
    addToCohort(id, { games, exclusions }) {
      const meta = readMeta(id);
      if (!meta) throw new Error("cohort_missing");
      if (meta.frozen) throw new Error("cohort_frozen");
      const existing = readGames(id);
      const ids = new Set(existing.map((game) => game.gameId));
      const fresh = [];
      for (const game of games) {
        if (ids.has(game.gameId)) continue;
        ids.add(game.gameId);
        fresh.push(game);
      }
      if (fresh.length) {
        mkdirSync(path.join(cohortDir(id), "pgn"), { recursive: true });
        for (const game of fresh) {
          writeFileSync(path.join(cohortDir(id), "pgn", `${safeId(game.gameId)}.pgn`), game.pgn ?? "");
        }
        writeJson(path.join(cohortDir(id), "games.json"), existing.concat(fresh));
        const positions = path.join(cohortDir(id), "positions.jsonl");
        mkdirSync(path.dirname(positions), { recursive: true });
        for (const game of fresh) {
          for (const decision of game.decisions ?? []) {
            appendFileSync(positions, `${JSON.stringify(decision)}\n`);
          }
        }
      }
      if (exclusions.length) {
        writeJson(path.join(cohortDir(id), "exclusions.json"), readExclusions(id).concat(exclusions));
      }
      writeJson(path.join(cohortDir(id), "meta.json"), { ...meta, syncedAt: new Date().toISOString() });
      return { added: fresh.length };
    },
    appendAnalysis(id, record) {
      const meta = readMeta(id);
      if (!meta) throw new Error("cohort_missing");
      if (meta.frozen) throw new Error("cohort_frozen");
      const file = path.join(cohortDir(id), "analysis.jsonl");
      mkdirSync(path.dirname(file), { recursive: true });
      appendFileSync(file, `${JSON.stringify(record)}\n`);
    },
    writeMetrics(id, metrics) {
      const meta = readMeta(id);
      if (!meta) throw new Error("cohort_missing");
      if (meta.frozen) throw new Error("cohort_frozen");
      writeJson(path.join(cohortDir(id), "metrics.json"), metrics);
    },
    freeze(id, metrics, frozenAt) {
      const meta = readMeta(id);
      if (!meta) throw new Error("cohort_missing");
      if (meta.frozen) throw new Error("cohort_frozen");
      if (pendingCount(id) > 0) throw new Error("analysis_incomplete");
      writeJson(path.join(cohortDir(id), "metrics.json"), metrics);
      writeJson(path.join(cohortDir(id), "frozen.json"), {
        frozenAt,
        detectorId: meta.detectorId,
        analysisFingerprint: meta.analysisFingerprint,
        metrics,
      });
      writeJson(path.join(cohortDir(id), "meta.json"), { ...meta, frozen: true, frozenAt });
    },
    addCandidate(candidate) {
      const state = this.readState();
      if (state.exerciseCandidates.some((item) => item.key === candidate.key)) {
        return state.exerciseCandidates;
      }
      state.exerciseCandidates.push(candidate);
      this.writeState(state);
      return state.exerciseCandidates;
    },
    readBaselineMetrics() {
      return readJson(path.join(baselineDir, "metrics.json"), null);
    },
    readBaselineProgress() {
      return readJson(path.join(baselineDir, "progress.json"), null);
    },
    writeBaselineEngine(engine) {
      writeJson(path.join(baselineDir, "engine.json"), engine);
    },
    publicState(job = null) {
      this.ensure();
      const state = this.readState();
      let manifest = null;
      try {
        manifest = this.readManifest();
      } catch {
        manifest = null;
      }
      const ids = listCohortIds();
      const cohorts = ids.map((id) => cohortSummary(id)).filter(Boolean);
      const open = cohorts.find((cohort) => !cohort.frozen) ?? null;
      const frozen = cohorts.filter((cohort) => cohort.frozen);
      const current = open ?? frozen[frozen.length - 1] ?? null;
      const baselineMetrics = this.readBaselineMetrics();
      const exclusions = current ? readExclusions(current.id) : [];
      const games = current ? readGames(current.id) : [];
      let comparison = null;
      if (baselineMetrics && current?.metrics && current.analysisComplete) {
        try {
          comparison = compareMetrics(baselineMetrics, readJson(path.join(cohortDir(current.id), "metrics.json"), current.metrics), {
            provisional: false,
          });
        } catch {
          comparison = null;
        }
      }
      const grouped = new Map();
      for (const row of exclusions) grouped.set(row.reason, (grouped.get(row.reason) ?? 0) + 1);
      return {
        version: TRANSFER_VERSION,
        detectorId: DETECTOR_ID,
        analysisFingerprint: FINGERPRINT,
        filterRulesId: FILTER_RULES_ID,
        baseline: manifest
          ? {
              cohortId: manifest.cohortId,
              games: manifest.gameCount,
              cutoff: manifest.cutoff,
              rulesVersion: manifest.rulesVersion,
              metrics: baselineMetrics ? stripClusters(baselineMetrics) : null,
              analysis: this.readBaselineProgress(),
            }
          : null,
        sync: {
          lastSyncedAt: state.lastSyncedAt,
          lastError: state.lastError,
          lastSource: state.lastSource,
          running: Boolean(job?.running),
          progress: job?.progress ?? null,
        },
        openCohort: open,
        frozenCohorts: frozen,
        currentCohortId: current?.id ?? null,
        includedCount: games.length,
        excludedCount: exclusions.length,
        exclusionCounts: [...grouped.entries()].map(([reason, count]) => ({ reason, count })),
        exclusionSamples: exclusions.slice(0, 12).map(({ gameId, url, reason, detail }) => ({
          gameId,
          url,
          reason,
          detail,
        })),
        included: games.map(publicGame),
        comparison: comparison ? stripComparison(comparison) : null,
        pedagogy: state.pedagogy,
        exerciseCandidates: state.exerciseCandidates,
        examplesLocked: !current?.frozen,
      };
    },
    exportBundle() {
      const state = this.publicState();
      const cohorts = {};
      for (const id of listCohortIds()) {
        cohorts[id] = {
          meta: readMeta(id),
          games: readGames(id),
          exclusions: readExclusions(id),
          metrics: readJson(path.join(cohortDir(id), "metrics.json"), null),
          frozen: readJson(path.join(cohortDir(id), "frozen.json"), null),
          analysis: [...analysisRecords(id).values()],
        };
      }
      return {
        version: TRANSFER_VERSION,
        exportedAt: new Date().toISOString(),
        manifest: existsSync(manifestPath) ? readJson(manifestPath, null) : null,
        baselineMetrics: this.readBaselineMetrics(),
        baselineEngine: readJson(path.join(baselineDir, "engine.json"), null),
        state: this.readState(),
        cohorts,
        public: state,
      };
    },
    examples(id) {
      const meta = readMeta(id);
      if (!meta?.frozen) throw new Error("examples_locked");
      return [...analysisRecords(id).values()].filter((row) => row.event);
    },
    analyzedRows(id) {
      return [...analysisRecords(id).values()];
    },
  };
}

function publicGame(game) {
  return {
    gameId: game.gameId,
    url: game.url,
    color: game.color,
    result: game.result,
    termination: game.termination,
    opening: game.opening,
    plies: game.plies,
    endUtc: game.endUtc,
    rated: game.rated,
    timeControl: game.timeControl,
    ownDecisions: game.ownDecisions,
    ratings: game.ratings,
    weaknessInference: null,
  };
}

function stripClusters(metrics) {
  if (!metrics) return null;
  const { gameClusters, ...rest } = metrics;
  return rest;
}

function stripComparison(comparison) {
  return {
    ...comparison,
    baseline: stripClusters(comparison.baseline),
    transfer: stripClusters(comparison.transfer),
  };
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}
