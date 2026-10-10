/**
 * Regeneración determinista de datos MoveMirror desde Fase 2.
 * Fuentes: exercises.json, critical_positions.csv, deep_500k.jsonl
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";
import { createHash } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const REVIEW = path.join(ROOT, "data/fase-2/review_output");
const DEEP = path.join(ROOT, "data/fase-2/engine_output/deep_500k.jsonl");
const DEEP_MANIFEST = path.join(ROOT, "data/fase-2/engine_output/deep_manifest.json");
const OUT = path.join(ROOT, "src/data/generated");

const PATTERN_ID = "cct-opponent-refutation";
const POOL_MOTIF = "allowed_forcing_reply";
const POOL_LIMIT = Number(process.env.POOL_LIMIT ?? "347");
const ANALYSIS_VERSION = "deep-500k-v1";

const MOTIF_LABELS = {
  allowed_forcing_reply: "La respuesta forzada del rival quedó disponible",
  allowed_piece_capture: "La línea principal permite capturar una pieza",
  missed_forcing_move: "Había jaque o captura fuerte y se jugó una jugada no forzada",
  bad_capture_choice: "La captura elegida fue costosa",
  costly_quiet_pawn_move: "Movimiento tranquilo de peón en posición crítica",
  allowed_immediate_mate: "Permitiste mate inmediato",
};

function readJsonl(filePath) {
  const map = new Map();
  if (!fs.existsSync(filePath)) return map;
  for (const line of fs.readFileSync(filePath, "utf8").trim().split("\n")) {
    if (!line) continue;
    const row = JSON.parse(line);
    map.set(row.key, row);
  }
  return map;
}

function gameIdFromUrl(url) {
  const m = url.match(/\/live\/(\d+)/);
  return m ? m[1] : url.replace(/\W+/g, "").slice(-12);
}

function exerciseIdFromGame(gameUrl, moveNumber) {
  return `ex-${gameIdFromUrl(gameUrl)}-m${moveNumber}`;
}

function phaseFromProxy(phase) {
  if (phase?.startsWith("opening")) return "opening";
  if (phase?.startsWith("endgame")) return "endgame";
  return "middlegame";
}

function severityFromLoss(cp) {
  const n = Number(cp) || 120;
  if (n >= 1200) return 5;
  if (n >= 700) return 4;
  if (n >= 400) return 3;
  return 2;
}

function skillIdsFromMotifs(motifs) {
  const tags = new Set(motifs);
  const ids = [PATTERN_ID];
  if (tags.has("missed_forcing_move")) ids.push("forced-candidate-generation");
  if (tags.has("bad_capture_choice") || tags.has("allowed_piece_capture")) {
    ids.push("capture-recapture-check");
  }
  return [...new Set(ids)];
}

function uciToSan(fen, uci) {
  if (!uci || uci.length < 4) return null;
  try {
    const chess = new Chess(fen);
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
    return move?.san ?? null;
  } catch {
    return null;
  }
}

function sanLine(fen, pvUci, maxPlies = 8) {
  if (!pvUci?.length) return null;
  try {
    const chess = new Chess(fen);
    const sans = [];
    for (const uci of pvUci.slice(0, maxPlies)) {
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      });
      if (!move) break;
      sans.push(move.san);
    }
    return sans.length ? sans.join(" ") : null;
  } catch {
    return null;
  }
}

function linesFromDeep(deepRow) {
  if (!deepRow) {
    return {
      referenceMoveUci: null,
      referenceMoveSan: null,
      referenceLineUci: null,
      referenceLineSan: null,
      realMoveUci: null,
      realMoveSan: null,
      realLineUci: null,
      realLineSan: null,
    };
  }
  const fen = deepRow.fen_before;
  const refUci = deepRow.best?.first_move_uci ?? null;
  const realUci = deepRow.played_uci ?? null;
  const refPv = deepRow.best?.pv_uci ?? [];
  const realPv = deepRow.played?.pv_uci ?? [];

  return {
    referenceMoveUci: refUci,
    referenceMoveSan: refUci ? uciToSan(fen, refUci) : null,
    referenceLineUci: refPv.length ? refPv : null,
    referenceLineSan: sanLine(fen, refPv),
    realMoveUci: realUci,
    realMoveSan: deepRow.played_san ?? (realUci ? uciToSan(fen, realUci) : null),
    realLineUci: realPv.length ? realPv : null,
    realLineSan: sanLine(fen, realPv),
  };
}

function observableReason(motifs) {
  if (!motifs?.length) return null;
  return motifs.map((t) => MOTIF_LABELS[t] ?? t).join(" · ");
}

function buildExerciseBase({ id, tier, sourceKey, fen, sideToMove, moveNumber, gameUrl, motifs, severity, phase, block, deepRow, coreRow }) {
  const lines = linesFromDeep(deepRow);
  const playedSan = coreRow?.played ?? deepRow?.played_san ?? lines.realMoveSan;
  const solutionSan =
    coreRow?.solution ?? lines.referenceMoveSan ?? uciToSan(fen, deepRow?.best?.first_move_uci);

  return {
    id,
    sourceKey,
    tier,
    fen,
    sideToMove,
    moveNumber,
    gameUrl,
    playedMoveSan: playedSan,
    solutionSan: solutionSan ?? "unavailable",
    referenceLineSan: coreRow?.solution_line ?? lines.referenceLineSan ?? "",
    realLineSan: coreRow?.played_line ?? lines.realLineSan ?? playedSan ?? "",
    prompt: `En la partida jugaste ${playedSan}. Encuentra una alternativa que supere la prueba CCT + refutación.`,
    patternId: PATTERN_ID,
    skillIds: skillIdsFromMotifs(motifs),
    severity,
    phase,
    motifs,
    observableReason: observableReason(motifs),
    source: tier === "core" ? "exercises.json+deep_500k" : "critical_positions.csv+deep_500k",
    analysisVersion: ANALYSIS_VERSION,
    block: block ?? null,
    ...lines,
  };
}

function parseCsvLine(line) {
  const parts = line.split(",");
  if (parts.length < 12) return null;
  const fen = parts.slice(11).join(",").trim();
  return {
    key: parts[0],
    block: parts[1],
    game_id: parts[2],
    move_number: Number(parts[3]),
    color: parts[4],
    phase: parts[5],
    played: parts[6],
    best_uci: parts[7],
    cp_loss_numeric: parts[8],
    motifs: parts[9] ? parts[9].split("|").filter(Boolean) : [],
    game_url: parts[10],
    fen,
  };
}

function sha256File(p) {
  return createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function main() {
  const corePath = path.join(REVIEW, "exercises.json");
  const csvPath = path.join(REVIEW, "critical_positions.csv");
  if (!fs.existsSync(corePath) || !fs.existsSync(csvPath)) {
    console.error("Extrae el zip en data/fase-2/");
    process.exit(1);
  }

  const deepByKey = readJsonl(DEEP);
  const coreRaw = JSON.parse(fs.readFileSync(corePath, "utf8"));

  const core = coreRaw.map((row) => {
    const deepRow = deepByKey.get(row.key) ?? null;
    const sideToMove = row.color === "white" ? "w" : "b";
    return buildExerciseBase({
      id: exerciseIdFromGame(row.game_url, row.move_number),
      tier: "core",
      sourceKey: row.key,
      fen: row.fen,
      sideToMove,
      moveNumber: row.move_number,
      gameUrl: row.game_url,
      motifs: row.motifs ?? [],
      severity: severityFromLoss(row.loss_numeric),
      phase: phaseFromProxy(deepRow?.phase_proxy),
      block: deepRow ? (deepRow.game_id ? "discovery" : null) : null,
      deepRow,
      coreRow: row,
    });
  });

  const coreKeys = new Set(core.map((e) => e.sourceKey));
  const coreIds = new Set(core.map((e) => e.id));

  const csvLines = fs.readFileSync(csvPath, "utf8").trim().split("\n").slice(1);
  const pool = [];

  for (const line of csvLines) {
    const row = parseCsvLine(line);
    if (!row || !row.motifs.includes(POOL_MOTIF)) continue;
    if (coreKeys.has(row.key)) continue;

    const deepRow = deepByKey.get(row.key) ?? null;
    const sideToMove = row.color === "white" ? "w" : "b";
    const ex = buildExerciseBase({
      id: exerciseIdFromGame(row.game_url, row.move_number),
      tier: "pool",
      sourceKey: row.key,
      fen: row.fen,
      sideToMove,
      moveNumber: row.move_number,
      gameUrl: row.game_url,
      motifs: row.motifs,
      severity: severityFromLoss(row.cp_loss_numeric),
      phase: phaseFromProxy(row.phase),
      block: row.block,
      deepRow,
      coreRow: null,
    });

    if (coreIds.has(ex.id)) continue;
    if (!ex.referenceMoveUci && row.best_uci) {
      ex.referenceMoveUci = row.best_uci;
      ex.referenceMoveSan = uciToSan(row.fen, row.best_uci);
    }
    pool.push(ex);
    if (pool.length >= POOL_LIMIT) break;
  }

  pool.sort((a, b) => b.severity - a.severity || a.id.localeCompare(b.id));

  fs.mkdirSync(OUT, { recursive: true });

  const manifest = {
    generatedAt: new Date().toISOString(),
    analysisVersion: ANALYSIS_VERSION,
    sources: {
      exercisesJson: sha256File(corePath),
      criticalPositionsCsv: sha256File(csvPath),
      deep500k: fs.existsSync(DEEP) ? sha256File(DEEP) : null,
      deepManifest: fs.existsSync(DEEP_MANIFEST)
        ? JSON.parse(fs.readFileSync(DEEP_MANIFEST, "utf8"))
        : null,
    },
    counts: { core: core.length, pool: pool.length, deepRows: deepByKey.size },
    poolFilter: { motif: POOL_MOTIF, limit: POOL_LIMIT },
    coreIntegrityKeys: coreRaw.map((r) => r.key),
  };

  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(OUT, "exercises.core.json"), JSON.stringify(core, null, 2));
  fs.writeFileSync(path.join(OUT, "exercises.pool.json"), JSON.stringify(pool, null, 2));

  console.log(`OK: ${core.length} core + ${pool.length} pool (deep keys ${deepByKey.size})`);
}

main();
