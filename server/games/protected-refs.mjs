import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export function collectProtectedReferences(projectRoot) {
  const reasonsByCanonical = new Map();
  const historicalIds = new Set();
  const defenseGameIds = new Set();
  const exerciseUrls = new Set();

  const mapFile = path.join(projectRoot, "data/games/historical-id-map.json");
  if (existsSync(mapFile)) {
    const map = JSON.parse(readFileSync(mapFile, "utf8"));
    for (const [historicalId, canonicalId] of Object.entries(map)) {
      historicalIds.add(historicalId);
      addReason(reasonsByCanonical, canonicalId, "frozen_cohort");
    }
  }

  const cohortsDir = path.join(projectRoot, "data/transfer/cohorts");
  if (existsSync(cohortsDir)) {
    for (const cohort of readdirSync(cohortsDir)) {
      const file = path.join(cohortsDir, cohort, "games.json");
      if (!existsSync(file)) continue;
      for (const game of JSON.parse(readFileSync(file, "utf8"))) {
        if (game.gameId) historicalIds.add(game.gameId);
      }
    }
  }

  for (const relative of ["data/defense/defense-lab-v1.json", "data/defense/defense-ranking-v1.json"]) {
    const file = path.join(projectRoot, relative);
    if (!existsSync(file)) continue;
    collectGameIds(JSON.parse(readFileSync(file, "utf8")), defenseGameIds);
  }

  for (const relative of ["src/data/generated/exercises.core.json", "src/data/generated/exercises.pool.json"]) {
    const file = path.join(projectRoot, relative);
    if (!existsSync(file)) continue;
    for (const exercise of JSON.parse(readFileSync(file, "utf8"))) {
      if (exercise.gameUrl) exerciseUrls.add(exercise.gameUrl);
    }
  }

  return {
    reasonsByCanonical,
    historicalIds,
    defenseGameIds,
    exerciseUrls,
  };
}

export function protectionForGame(game, refs) {
  const reasons = new Set(refs.reasonsByCanonical.get(game.id) ?? []);
  for (const source of game.sources ?? []) {
    if (source.externalId && refs.historicalIds.has(source.externalId)) reasons.add("frozen_cohort");
    if (source.externalId && refs.defenseGameIds.has(source.externalId)) reasons.add("defense_lab");
  }
  const url = game.metadata?.url;
  if (url && refs.exerciseUrls.has(url)) reasons.add("exercise_dataset");
  if (game.eligibility?.transferEligible) reasons.add("transfer_measurement");
  return [...reasons];
}

function addReason(map, id, reason) {
  if (!id) return;
  const current = map.get(id) ?? [];
  if (!current.includes(reason)) current.push(reason);
  map.set(id, current);
}

function collectGameIds(value, target) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectGameIds(item, target));
    return;
  }
  if (typeof value.gameId === "string") target.add(value.gameId);
  Object.values(value).forEach((item) => collectGameIds(item, target));
}
