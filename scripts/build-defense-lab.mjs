import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";
import { StockfishEngine } from "../server/stockfish.mjs";
import { EvalCache, sanitizeCacheDir } from "../server/cache.js";
import { EvalMetrics } from "../server/metrics.js";
import { EvaluationQueue } from "../server/queue.js";
import { runEvaluation } from "../server/evaluator.mjs";
import {
  DEFENSE_VERSIONS,
  classifyDefensiveMotif,
  detectDefenseOpportunity,
  sanLineFromUci,
  stableDefenseExerciseId,
  threatFromLine,
  uciFromSan,
} from "../shared/defense/domain.js";
import {
  DEFENSE_SELECTION_VERSION,
  deterministicHash,
  scoreDefenseCandidate,
  selectDefenseExercises,
} from "../shared/defense/selection.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = path.join(ROOT, "data/defense");
const DATASET_FILE = path.join(OUTPUT_DIR, "defense-lab-v1.json");
const MANIFEST_FILE = path.join(OUTPUT_DIR, "manifest.json");
const RANKING_FILE = path.join(OUTPUT_DIR, "defense-ranking-v1.json");
const V040_SELECTION_FILE = path.join(OUTPUT_DIR, "selection-v0.4.0.json");
const CACHE_DIR = process.env.ENGINE_CACHE_DIR ?? path.join(ROOT, "data/engine-cache");
const ENGINE_PATH = process.env.STOCKFISH_PATH ?? "stockfish";
const TARGET = Number(process.env.DEFENSE_TARGET ?? 24);

const pool = JSON.parse(
  fs.readFileSync(path.join(ROOT, "src/data/generated/exercises.pool.json"), "utf8"),
);
const sourceManifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, "src/data/generated/manifest.json"), "utf8"),
);
const gamesCsv = fs.readFileSync(
  path.join(ROOT, "data/fase-2/output/games.csv"),
  "utf8",
);
const transferState = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data/transfer/state.json"), "utf8"),
);

function parseCsvLine(line) {
  const fields = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

function readGames(csv) {
  const [headerLine, ...lines] = csv.trim().split(/\r?\n/);
  const headers = parseCsvLine(headerLine);
  return lines.map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""]),
    );
  });
}

const sourceGames = readGames(gamesCsv);
const gamesById = new Map(sourceGames.map((game) => [game.game_id, game]));

function activeCohortIds(state) {
  const ids = new Set();
  const current = state.currentCohortId ?? state.activeCohortId ?? null;
  if (current) ids.add(current);
  for (const cohort of state.cohorts ?? []) {
    if (!cohort.frozenAt && cohort.id) ids.add(cohort.id);
  }
  return ids;
}

function severity(loss) {
  if (loss >= 500) return "critical";
  if (loss >= 250) return "marked";
  return "notable";
}

function phaseName(phase) {
  return String(phase).replace("_proxy", "");
}

function score(score) {
  return score
    ? { cp: score.cp ?? null, mate: score.mate ?? null, numeric: score.numeric ?? null }
    : null;
}

function stableCandidateOrder(a, b) {
  return b.severity - a.severity || a.sourceKey.localeCompare(b.sourceKey);
}

function candidatePool() {
  const active = activeCohortIds(transferState);
  const seenGames = new Set();
  return pool
    .filter((row) => row.motifs.includes("allowed_forcing_reply"))
    .sort(stableCandidateOrder)
    .filter((row) => {
      const gameId = row.sourceKey.split(":")[0];
      if (seenGames.has(gameId)) return false;
      seenGames.add(gameId);
      return !active.has(row.sourceCohortId);
    });
}

function openingName(game) {
  if (!game?.opening_url) return null;
  const slug = game.opening_url.split("/").at(-1);
  return decodeURIComponent(slug).replaceAll("-", " ");
}

function rejectedDisposition(reasons) {
  if (reasons.includes("invalid_fen") || reasons.includes("position_finished")) {
    return "rejected_invalid_position";
  }
  if (reasons.some((reason) => reason.includes("illegal"))) {
    return "rejected_illegal_move";
  }
  if (reasons.includes("mate_inevitable_under_verified_alternatives")) {
    return "rejected_forced_mate";
  }
  if (reasons.includes("position_already_completely_lost")) {
    return "rejected_already_lost";
  }
  if (
    reasons.includes("missing_best_evaluation") ||
    reasons.includes("inconsistent_best_evaluation")
  ) {
    return "rejected_unstable_analysis";
  }
  if (reasons.includes("loss_below_120_cp")) {
    return "rejected_below_cp_loss";
  }
  return "rejected_low_pedagogical_quality";
}

function exerciseFrom(row, result, eligibility) {
  const gameId = row.sourceKey.split(":")[0];
  const ply = Number(row.sourceKey.split(":")[1]);
  const actualLineSan = row.realLineUci?.length
    ? sanLineFromUci(row.fen, row.realLineUci)
    : row.realLineSan.split(/\s+/);
  const defenseLineSan = row.referenceLineUci?.length
    ? sanLineFromUci(row.fen, row.referenceLineUci)
    : row.referenceLineSan.split(/\s+/);
  const referenceDefenseUci = uciFromSan(row.fen, row.solutionSan);
  const actualPlayedMoveUci = uciFromSan(row.fen, row.playedMoveSan);
  const motif = classifyDefensiveMotif({
    fen: row.fen,
    defenseSan: row.solutionSan,
    actualLineSan,
    motifs: row.motifs,
  });
  const threat = threatFromLine(actualLineSan);
  const moveNumber = Math.ceil(ply / 2);
  const sourceGame = gamesById.get(gameId);
  const opening = sourceGame?.eco
    ? { eco: sourceGame.eco, name: openingName(sourceGame) }
    : null;

  return {
    id: stableDefenseExerciseId(gameId, ply),
    version: DEFENSE_VERSIONS.exercise,
    source: {
      gameId,
      gameUrl: row.gameUrl ?? null,
      playedAt: sourceGame?.end_utc ?? sourceManifest.generatedAt,
      playerColor: row.sideToMove === "w" ? "white" : "black",
      ply,
      fen: row.fen,
      previousMoveSan: null,
      playedMoveUci: actualPlayedMoveUci,
      playedMoveSan: row.playedMoveSan,
      sourceSet: "phase2_reproducible",
      sourceCohortId: null,
      sourceFrozenAt: null,
      opening,
    },
    orientation: row.sideToMove === "w" ? "white" : "black",
    phase: phaseName(row.phase),
    positionBeforeDecisionFen: row.fen,
    actualPlayedMoveUci,
    actualPlayedMoveSan: row.playedMoveSan,
    referenceDefenseUci,
    referenceDefenseSan: row.solutionSan,
    acceptableAlternatives: [],
    actualPunishmentLineSan: actualLineSan,
    defenseReferenceLineSan: defenseLineSan,
    opponentThreat: threat,
    motif,
    severity: severity(result.cpLoss ?? row.severity * 120),
    evaluation: {
      before: score(result.best?.score),
      afterActual: score(result.played?.score),
      afterDefense: score(result.best?.score),
      cpLossActual: result.cpLoss,
      mateChange: {
        best: result.best?.score?.mate ?? null,
        actual: result.played?.score?.mate ?? null,
      },
      budgetId: result.evalFinalBudgetId,
      engineSha256: result.engineSha256,
      pipelineVersion: result.evalPipelineVersion,
      criterionVersion: result.evalCriterionVersion,
      cacheKeys: [result.cacheKey].filter(Boolean),
      escalationReason: result.evalEscalationReason,
    },
    eligibility: {
      detectorVersion: DEFENSE_VERSIONS.detector,
      accepted: eligibility.accepted,
      reasons: eligibility.reasons,
    },
    pedagogy: {
      observable: threat.description,
      interpretation:
        motif.confidence === "low"
          ? "La defensa recomendada reduce la continuación más exigente del rival."
          : motif.evidence[0],
      habitHypothesis:
        "Antes de comprometer una jugada, comprueba la respuesta más forzante del rival.",
      confidence: motif.confidence,
      transferableRule:
        "CCT + refutación: después de elegir tu defensa, busca el jaque, captura o amenaza más incómoda del rival.",
    },
    sourceContext: {
      moveNumber,
      opening: opening ? `${opening.eco} · ${opening.name}` : null,
    },
  };
}

async function main() {
  sanitizeCacheDir(CACHE_DIR);
  const engine = new StockfishEngine(ENGINE_PATH);
  const cache = new EvalCache(CACHE_DIR);
  const metrics = new EvalMetrics(path.join(CACHE_DIR, "metrics.json"));
  const queue = new EvaluationQueue({ maxQueue: 32, jobTimeoutMs: 120_000 });
  const candidates = candidatePool();
  const eligibilityResults = [];
  const eligibleExercises = [];
  const rejected = [];
  const analysisFailures = [];
  const previousDataset = fs.existsSync(DATASET_FILE)
    ? JSON.parse(fs.readFileSync(DATASET_FILE, "utf8"))
    : { exercises: [] };
  const previousRanking = fs.existsSync(RANKING_FILE)
    ? JSON.parse(fs.readFileSync(RANKING_FILE, "utf8"))
    : { archivedExercises: [] };

  try {
    await engine.start();
  } catch (error) {
    console.error(
      `defense_build_engine_unavailable: ${error.message}. Se conserva el último dataset válido.`,
    );
    process.exitCode = 1;
    return;
  }

  try {
    for (const row of candidates) {
      const candidateId = stableDefenseExerciseId(
        row.sourceKey.split(":")[0],
        Number(row.sourceKey.split(":")[1]),
      );
      const playedUci = uciFromSan(row.fen, row.playedMoveSan);
      const referenceUci = uciFromSan(row.fen, row.solutionSan);
      if (!playedUci || !referenceUci) {
        const reasons = ["illegal_source_move"];
        eligibilityResults.push({
          candidateId,
          eligible: false,
          reasons,
          evaluationId: null,
          analysisStatus: "completed",
        });
        rejected.push({
          candidateId,
          sourceKey: row.sourceKey,
          disposition: "rejected_illegal_move",
          reasons,
        });
        continue;
      }
      try {
        const result = await queue.enqueue(() =>
          runEvaluation({
            fen: row.fen,
            playedUci,
            referenceBestUci: referenceUci,
            engine,
            cache,
            metrics,
          }),
        );
        const actualLine = row.realLineUci?.length
          ? sanLineFromUci(row.fen, row.realLineUci)
          : row.realLineSan.split(/\s+/);
        const eligibility = detectDefenseOpportunity({
          fen: row.fen,
          playedSan: row.playedMoveSan,
          referenceSan: row.solutionSan,
          cpLoss: result.cpLoss,
          bestScore: result.best?.score,
          playedScore: result.played?.score,
          alternatives: [],
          activeCohort: false,
          forcingConsequence: actualLine.length >= 2,
          explainableResource:
            classifyDefensiveMotif({
              fen: row.fen,
              defenseSan: row.solutionSan,
              actualLineSan: actualLine,
              motifs: row.motifs,
            }).resource !== "unknown",
        });
        const evaluationId = deterministicHash({
          candidateId,
          engineSha256: result.engineSha256,
          budgetId: result.evalFinalBudgetId,
          cacheKey: result.cacheKey,
        }).slice(0, 24);
        eligibilityResults.push({
          candidateId,
          eligible: eligibility.accepted,
          reasons: eligibility.reasons,
          evaluationId,
          analysisStatus: result.cacheHit ? "cache_hit" : "completed",
        });
        if (!eligibility.accepted) {
          rejected.push({
            candidateId,
            sourceKey: row.sourceKey,
            disposition: rejectedDisposition(eligibility.reasons),
            reasons: eligibility.reasons,
          });
          continue;
        }
        eligibleExercises.push(exerciseFrom(row, result, eligibility));
      } catch (error) {
        const failure = {
          candidateId,
          sourceKey: row.sourceKey,
          disposition: "analysis_failed",
          reasons: [String(error.message ?? error)],
        };
        analysisFailures.push(failure);
        eligibilityResults.push({
          candidateId,
          eligible: false,
          reasons: failure.reasons,
          evaluationId: null,
          analysisStatus: "failed",
        });
      }
    }
  } finally {
    await engine.stop();
  }

  if (!eligibleExercises.length) {
    console.error("defense_build_no_valid_positions: se conserva el último dataset válido.");
    process.exitCode = 1;
    return;
  }

  const selection = selectDefenseExercises(eligibleExercises, { limit: TARGET });
  const rankingById = new Map(
    selection.ranking.map((entry) => [entry.candidateId, entry]),
  );
  const selected = selection.selected.map((exercise) => {
    const ranking = rankingById.get(exercise.id);
    return {
      ...exercise,
      lifecycle: "active",
      selection: {
        version: DEFENSE_SELECTION_VERSION,
        rank: ranking.rank,
        finalScore: ranking.finalScore,
        reason: ranking.selectionReason,
      },
    };
  });
  const selectedIds = new Set(selected.map((exercise) => exercise.id));
  const v040Selection = JSON.parse(
    fs.readFileSync(V040_SELECTION_FILE, "utf8"),
  );
  const previousIds = new Set(v040Selection.selectedIds);
  const entered = selected
    .map((exercise) => exercise.id)
    .filter((id) => !previousIds.has(id));
  const exited = [...previousIds].filter((id) => !selectedIds.has(id)).sort();
  const historicalExercises = [
    ...(previousDataset.exercises ?? []),
    ...(previousRanking.archivedExercises ?? []),
    ...eligibleExercises,
  ];
  const archivedExercises = historicalExercises
    .filter((exercise) => exited.includes(exercise.id))
    .filter(
      (exercise, index, all) =>
        all.findIndex((candidate) => candidate.id === exercise.id) === index,
    )
    .map((exercise) => ({
      ...exercise,
      lifecycle: "archived_not_selected",
    }));

  const lowQualityRecords = selection.rejectedLowQuality.map((exercise) => {
    const candidateScore = scoreDefenseCandidate(exercise);
    return {
      candidateId: exercise.id,
      disposition: "rejected_low_pedagogical_quality",
      reasons: [
        `base_score_below_${selection.minimumQualityScore}`,
        `base_score:${candidateScore.baseScore}`,
      ],
    };
  });
  const eligibleDispositionRecords = selection.ranking.map((entry) => ({
    ...entry,
    disposition: entry.selected ? "selected" : "eligible_not_selected",
    reasons: [entry.selectionReason],
  }));
  const fullCandidates = [
    ...eligibleDispositionRecords,
    ...rejected,
    ...lowQualityRecords,
    ...analysisFailures,
  ].sort((a, b) => {
    const rankA = a.rank ?? Number.MAX_SAFE_INTEGER;
    const rankB = b.rank ?? Number.MAX_SAFE_INTEGER;
    return rankA - rankB || a.candidateId.localeCompare(b.candidateId);
  });
  const dispositionCounts = Object.fromEntries(
    [
      "selected",
      "eligible_not_selected",
      "rejected_below_cp_loss",
      "rejected_already_lost",
      "rejected_forced_mate",
      "rejected_unstable_analysis",
      "rejected_invalid_position",
      "rejected_illegal_move",
      "rejected_duplicate_game",
      "rejected_low_pedagogical_quality",
      "analysis_failed",
    ].map((disposition) => [
      disposition,
      fullCandidates.filter((candidate) => candidate.disposition === disposition).length,
    ]),
  );

  const dataset = {
    version: "defense-lab-v1",
    releaseVersion: "0.4.1",
    generatedAt: sourceManifest.generatedAt,
    selection: {
      version: DEFENSE_SELECTION_VERSION,
      selected: selected.length,
      technicallyEligible: selection.ranking.length,
      candidatesAnalyzed: candidates.length - analysisFailures.length,
    },
    exercises: selected,
  };
  const serialized = `${JSON.stringify(dataset, null, 2)}\n`;
  const selectedDatasetSha256 = deterministicHash({
    version: dataset.version,
    releaseVersion: dataset.releaseVersion,
    selection: dataset.selection,
    exercises: dataset.exercises,
  });
  const rankingArtifact = {
    version: "defense-ranking-v1",
    detectorVersion: DEFENSE_VERSIONS.detector,
    selectionVersion: DEFENSE_SELECTION_VERSION,
    generatedAt: sourceManifest.generatedAt,
    weights: selection.version === DEFENSE_SELECTION_VERSION
      ? "DEFENSE_SELECTION_WEIGHTS"
      : null,
    minimumQualityScore: selection.minimumQualityScore,
    candidates: fullCandidates,
    eligibility: eligibilityResults.sort((a, b) =>
      a.candidateId.localeCompare(b.candidateId)),
    archivedExercises,
  };
  const {
    generatedAt: _rankingGeneratedAt,
    ...deterministicRankingArtifact
  } = rankingArtifact;
  const fullRankingSha256 = deterministicHash(deterministicRankingArtifact);
  const resourceDistribution = Object.fromEntries(
    [...new Set(selected.map((item) => item.motif.resource))]
      .sort()
      .map((resource) => [
        resource,
        selected.filter((item) => item.motif.resource === resource).length,
      ]),
  );
  const sourceGamesByEco = new Map();
  for (const game of sourceGames) {
    if (!game.eco) continue;
    sourceGamesByEco.set(game.eco, (sourceGamesByEco.get(game.eco) ?? 0) + 1);
  }
  const openingDistribution = [...new Set(
    selected.map((item) => item.source.opening?.eco).filter(Boolean),
  )]
    .map((eco) => {
      const positions = selected.filter((item) => item.source.opening?.eco === eco);
      const games = sourceGamesByEco.get(eco) ?? 0;
      return {
        eco,
        name: positions[0]?.source.opening?.name ?? null,
        games,
        positions: positions.length,
        descriptiveRate: games ? positions.length / games : null,
      };
    })
    .sort((a, b) => b.positions - a.positions || a.eco.localeCompare(b.eco));
  const manifest = {
    version: "defense-manifest-v0.4.1",
    detectorVersion: DEFENSE_VERSIONS.detector,
    selectionVersion: DEFENSE_SELECTION_VERSION,
    generatedAt: sourceManifest.generatedAt,
    sourceHashes: {
      exercises: sourceManifest.sources.exercisesJson,
      criticalPositions: sourceManifest.sources.criticalPositionsCsv,
      deepAnalysis: sourceManifest.sources.deep500k,
    },
    engine: {
      sha256: selected[0]?.evaluation.engineSha256 ?? null,
      shallowBudget: "nodes-80k-v1",
      deepBudget: "nodes-500k-v1",
      threads: 1,
      hashMb: 128,
    },
    counts: {
      candidatesFound: candidates.length,
      candidatesAnalyzed: candidates.length - analysisFailures.length,
      analysisFailed: analysisFailures.length,
      technicallyEligible: selection.ranking.length,
      selected: selected.length,
      eligibleNotSelected: selection.eligibleNotSelected.length,
      rejectedByQuality:
        rejected.length + selection.rejectedLowQuality.length,
    },
    dispositions: dispositionCounts,
    selectedIds: selected.map((exercise) => exercise.id),
    selectedDatasetSha256,
    fullRankingSha256,
    accountingValid:
      candidates.length ===
        candidates.length - analysisFailures.length + analysisFailures.length &&
      candidates.length - analysisFailures.length ===
        selection.ranking.length + rejected.length + selection.rejectedLowQuality.length &&
      selection.ranking.length ===
        selected.length + selection.eligibleNotSelected.length,
    changesFromV040: {
      entered,
      exited,
      enteredReasons: Object.fromEntries(
        entered.map((id) => [
          id,
          rankingById.get(id)?.selectionReason ?? "selected_after_full_analysis",
        ]),
      ),
      exitedReasons: Object.fromEntries(
        exited.map((id) => {
          const record = fullCandidates.find((candidate) => candidate.candidateId === id);
          return [
            id,
            record?.reasons?.join(" · ") ?? "archived_not_selected_after_full_ranking",
          ];
        }),
      ),
    },
    distributions: {
      beforeSelection: {
        resource: Object.fromEntries(
          [...new Set(eligibleExercises.map((item) => item.motif.resource))]
            .sort()
            .map((resource) => [
              resource,
              eligibleExercises.filter((item) => item.motif.resource === resource).length,
            ]),
        ),
        phase: Object.fromEntries(
          ["opening", "middlegame", "endgame"].map((phase) => [
            phase,
            eligibleExercises.filter((item) => item.phase === phase).length,
          ]),
        ),
        color: Object.fromEntries(
          ["white", "black"].map((color) => [
            color,
            eligibleExercises.filter((item) => item.orientation === color).length,
          ]),
        ),
      },
      afterSelection: {
      resource: resourceDistribution,
      phase: Object.fromEntries(
        ["opening", "middlegame", "endgame"].map((phase) => [
          phase,
          selected.filter((item) => item.phase === phase).length,
        ]),
      ),
      color: Object.fromEntries(
        ["white", "black"].map((color) => [
          color,
          selected.filter((item) => item.orientation === color).length,
        ]),
      ),
      opening: openingDistribution,
      },
    },
    constraints: {
      maxPerGame: 1,
      defendableThresholdCp: -250,
      activeCohortsExcluded: true,
      transferArtifactsMutated: false,
      minimumQualityScore: selection.minimumQualityScore,
    },
    limitations: [
      "La apertura se muestra como contexto descriptivo; no se interpreta como debilidad ni repertorio.",
      "Las alternativas del usuario se verifican al confirmar mediante engine-validated-v2; el dataset no predeclara alternativas sin análisis.",
    ],
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(DATASET_FILE, serialized);
  fs.writeFileSync(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(RANKING_FILE, `${JSON.stringify(rankingArtifact, null, 2)}\n`);
  console.log(JSON.stringify(manifest.counts));
}

await main();
