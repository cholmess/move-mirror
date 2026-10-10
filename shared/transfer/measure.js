import {
  BOOTSTRAP_ITERATIONS,
  BOOTSTRAP_METHOD,
  DETECTOR,
  FINGERPRINT,
  LANGUAGE_POLICY_ID,
  MIN_DECISIONS,
  MIN_GAMES,
  OBSERVED_MIN_DECISIONS,
  OBSERVED_MIN_GAMES,
} from "./constants.js";
import { assertDetectorUntuned } from "./detector.js";

function hashString(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  return sorted[low] * (high - index) + sorted[high] * (index - low);
}

function ratePer100(events, decisions) {
  if (!decisions) return null;
  return (100 * events) / decisions;
}

function resample(games, rand) {
  const out = [];
  for (let i = 0; i < games.length; i += 1) {
    const index = Math.floor(rand() * games.length);
    out.push(games[index]);
  }
  return out;
}

function clusterRate(games) {
  let events = 0;
  let decisions = 0;
  for (const game of games) {
    events += game.events;
    decisions += game.decisions;
  }
  if (!decisions) return null;
  return (100 * events) / decisions;
}

/** Deterministic bootstrap at game-id level. Decisions inside a game stay together. */
export function bootstrapDifference(baselineGames, transferGames, options = {}) {
  const iterations = options.iterations ?? BOOTSTRAP_ITERATIONS;
  const seedKey = options.seedKey ?? `${DETECTOR.id}|${BOOTSTRAP_METHOD}`;
  const rand = mulberry32(hashString(seedKey));
  const absolute = [];
  const relative = [];
  for (let i = 0; i < iterations; i += 1) {
    const baseRate = clusterRate(resample(baselineGames, rand));
    const nextRate = clusterRate(resample(transferGames, rand));
    if (baseRate === null || nextRate === null) continue;
    const diff = nextRate - baseRate;
    absolute.push(diff);
    if (baseRate !== 0) relative.push(diff / baseRate);
  }
  absolute.sort((a, b) => a - b);
  relative.sort((a, b) => a - b);
  return {
    method: BOOTSTRAP_METHOD,
    unit: "game",
    iterations: absolute.length,
    seedKey,
    absolute: {
      low: percentile(absolute, 0.025),
      high: percentile(absolute, 0.975),
    },
    relative: relative.length
      ? { low: percentile(relative, 0.025), high: percentile(relative, 0.975) }
      : null,
  };
}

function emptySlice() {
  return { decisions: 0, events: 0, per100: null };
}

function addSlice(slice, event) {
  slice.decisions += 1;
  if (event) slice.events += 1;
  slice.per100 = ratePer100(slice.events, slice.decisions);
}

export function measureDecisions(decisions, { cohortId, detector = DETECTOR } = {}) {
  assertDetectorUntuned(detector, cohortId);
  const rows = (decisions ?? []).filter((row) => row.analysisComplete && !row.excludedFromMeasurement);
  const games = new Map();
  const byPhase = {
    opening_proxy: emptySlice(),
    middlegame_proxy: emptySlice(),
    endgame_proxy: emptySlice(),
  };
  const byColor = { white: emptySlice(), black: emptySlice() };
  const severity = { notable: 0, marcada: 0, grave: 0 };
  let events = 0;
  let pieceCaptureEvents = 0;

  for (const row of rows) {
    const game = games.get(row.gameId) ?? { id: row.gameId, events: 0, decisions: 0, pieceCaptureEvents: 0 };
    game.decisions += 1;
    if (row.event) {
      events += 1;
      game.events += 1;
      if (severity[row.severity] !== undefined) severity[row.severity] += 1;
    }
    if (row.pieceCaptureSubgroup) {
      pieceCaptureEvents += 1;
      game.pieceCaptureEvents += 1;
    }
    games.set(row.gameId, game);
    if (byPhase[row.phaseProxy]) addSlice(byPhase[row.phaseProxy], row.event);
    if (byColor[row.color]) addSlice(byColor[row.color], row.event);
  }

  const gameClusters = [...games.values()];
  const gamesAnalyzed = gameClusters.length;
  const gamesAffected = gameClusters.filter((game) => game.events > 0).length;
  const decisionCount = rows.length;

  return {
    cohortId: cohortId ?? null,
    detectorId: DETECTOR.id,
    analysisFingerprint: FINGERPRINT,
    gamesAnalyzed,
    gamesAffected,
    decisions: decisionCount,
    events,
    eventsPer100: ratePer100(events, decisionCount),
    pieceCaptureEvents,
    pieceCapturePer100: ratePer100(pieceCaptureEvents, decisionCount),
    byPhase,
    byColor,
    severity,
    gameClusters,
  };
}

export function classifyComparison(comparison) {
  const games = comparison.transfer?.gamesAnalyzed ?? 0;
  const decisions = comparison.transfer?.decisions ?? 0;
  const baseGames = comparison.baseline?.gamesAnalyzed ?? 0;
  const baseDecisions = comparison.baseline?.decisions ?? 0;
  if (games < MIN_GAMES || decisions < MIN_DECISIONS || baseGames < MIN_GAMES || baseDecisions < MIN_DECISIONS) {
    return {
      status: "insufficient_data",
      label: "Datos insuficientes",
      meaning:
        "Todavía no hay suficientes partidas o decisiones para comparar este patrón con el baseline.",
      notMeaning:
        "No significa que hayas mejorado ni que el patrón siga igual. Tampoco dice nada sobre la causa.",
    };
  }
  const enoughVolume = games >= OBSERVED_MIN_GAMES && decisions >= OBSERVED_MIN_DECISIONS;
  const upper = comparison.interval?.high;
  const reduction = upper !== null && upper !== undefined && upper < 0;
  if (enoughVolume && reduction && !comparison.provisional) {
    return {
      status: "observed_improvement",
      label: "Mejora observada",
      meaning:
        "En las partidas nuevas el patrón aparece menos que en el baseline, y el intervalo es compatible con una reducción real. Es mejor desempeño posterior.",
      notMeaning: "No demuestra que la lección de MoveMirror haya causado el cambio.",
    };
  }
  if (!enoughVolume) {
    return {
      status: "early_signal",
      label: "Señal temprana",
      meaning:
        "Hay una primera lectura, pero la muestra todavía es pequeña. El intervalo puede moverse cuando entren más partidas.",
      notMeaning: "No es una mejora confirmada ni una prueba de que la lección funcionó.",
    };
  }
  return {
    status: "no_clear_reduction",
    label: "Sin reducción clara",
    meaning:
      "Hay volumen suficiente y el intervalo no queda por debajo de cero. No se observa una reducción real del patrón.",
    notMeaning:
      "No significa que la lección haya empeorado tu juego, ni que el trabajo en ejercicios haya fallado.",
  };
}

export function compareMetrics(baseline, transfer, options = {}) {
  if (!baseline || !transfer) throw new Error("metrics_missing");
  if (baseline.analysisFingerprint !== transfer.analysisFingerprint) {
    throw new Error("mixed_analysis_config");
  }
  if (baseline.detectorId !== transfer.detectorId) {
    throw new Error("mixed_detector");
  }
  const absoluteDifference =
    baseline.eventsPer100 === null || transfer.eventsPer100 === null
      ? null
      : transfer.eventsPer100 - baseline.eventsPer100;
  const relativeDifference =
    absoluteDifference === null || !baseline.eventsPer100
      ? null
      : absoluteDifference / baseline.eventsPer100;
  const boot = bootstrapDifference(baseline.gameClusters ?? [], transfer.gameClusters ?? [], options.bootstrap);
  const comparison = {
    detectorId: baseline.detectorId,
    analysisFingerprint: baseline.analysisFingerprint,
    languagePolicyId: LANGUAGE_POLICY_ID,
    provisional: Boolean(options.provisional),
    baseline,
    transfer,
    absoluteDifference,
    relativeDifference,
    interval: {
      low: boot.absolute.low,
      high: boot.absolute.high,
      relativeLow: boot.relative?.low ?? null,
      relativeHigh: boot.relative?.high ?? null,
      level: 0.95,
      method: boot.method,
      unit: boot.unit,
      iterations: boot.iterations,
      seedKey: boot.seedKey,
    },
    sample: {
      baselineGames: baseline.gamesAnalyzed,
      baselineDecisions: baseline.decisions,
      transferGames: transfer.gamesAnalyzed,
      transferDecisions: transfer.decisions,
    },
  };
  return { ...comparison, ...classifyComparison(comparison) };
}
