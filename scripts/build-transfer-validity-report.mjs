import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseGamesCsv } from "../shared/transfer/selection.js";
import {
  auditCohortExposure,
  calculateInterventionQualification,
  comparabilityWarning,
  contextSummary,
  DOSE_PROTOCOL_ID,
  INTERVENTION_LOG_VERSION,
  VALIDITY_PIPELINE_VERSION,
} from "../shared/transfer/intervention.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const transferRoot = path.join(root, "data/transfer");
const cohortId = "transfer-20261010-2";
const cohortDir = path.join(transferRoot, "cohorts", cohortId);
const reportsDir = path.join(transferRoot, "reports");
const auditedAt = "2026-10-10T10:11:00.000Z";
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const hashFile = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

const state = read(path.join(transferRoot, "state.json"));
const games = read(path.join(cohortDir, "games.json"));
const meta = read(path.join(cohortDir, "meta.json"));
const frozen = read(path.join(cohortDir, "frozen.json"));
const metricsPath = path.join(cohortDir, "metrics.json");
const metricsHash = hashFile(metricsPath);

// The server snapshot has counts only; it contains no attempt timestamps, session boundaries,
// lesson completion timestamp, or criterion versions from which historical exposure can be proven.
const migration = {
  version: INTERVENTION_LOG_VERSION,
  recoveredEvents: [],
  incompleteEvents: [
    { kind: "lesson_completed", reason: "no_persisted_lesson_completion_event_on_server" },
    { kind: "exercise_confirmed", reason: "training_snapshot_contains_counts_without_attempt_timestamps" },
    { kind: "training_session", reason: "no_persisted_session_boundaries" },
  ],
  demonstrableRequirements: [],
  nonDemonstrableRequirements: [
    "lesson_completed",
    "12_confirmed_exercises",
    "8_verified_successes",
    "2_distinct_sessions",
    "2_distinct_calendar_days",
    "engine-validated-v2_for_all_qualifying_attempts",
  ],
};
const qualification = calculateInterventionQualification([]);
const audit = auditCohortExposure({ cohortId, games, qualification, auditedAt });

const rows = parseGamesCsv(readFileSync(path.join(root, "data/fase-2/output/games.csv"), "utf8"));
const baselineGames = rows.map((row) => ({
  color: row.color,
  result: row.result,
  ratingOwn: Number(row.rating_api_post),
  ratingOpponent: Number(row.opponent_rating_api_post),
  ownDecisions: Number(row.own_decisions),
}));
const baselineContext = contextSummary(baselineGames);
const cohortContext = contextSummary(games);
const warning = comparabilityWarning(baselineContext, cohortContext);

mkdirSync(path.join(transferRoot, "audits"), { recursive: true });
mkdirSync(path.join(transferRoot, "baseline"), { recursive: true });
mkdirSync(reportsDir, { recursive: true });
writeFileSync(path.join(transferRoot, "audits", `${cohortId}.json`), `${JSON.stringify(audit, null, 2)}\n`);
writeFileSync(path.join(transferRoot, "baseline", "context.json"), `${JSON.stringify(baselineContext, null, 2)}\n`);

const report = {
  version: "0.3.1",
  validityPipelineVersion: VALIDITY_PIPELINE_VERSION,
  generatedAt: auditedAt,
  cohortId,
  immutableCohortConfirmed: meta.frozen === true && frozen.metrics.gamesAnalyzed === 55,
  originalMetricsHash: metricsHash,
  auditHash: audit.auditHash,
  interventionLogVersion: INTERVENTION_LOG_VERSION,
  protocolId: DOSE_PROTOCOL_ID,
  migration,
  qualification,
  exposureAudit: audit,
  validPostInterventionGameIds: [],
  comparability: { baseline: baselineContext, cohort: cohortContext, warning },
  answers: {
    verifiableTrainingEvidence: "No. El snapshot histórico solo conserva conteos, no eventos fechados ni sesiones.",
    minimumDoseReachedAt: null,
    v03Timing: "exposure_unknown; la cohorte es post-baseline, no post-intervención verificable.",
    validPostInterventionGames: "Ninguna puede declararse válida con la evidencia histórica disponible.",
    permittedConclusions: [
      "La tasa puntual bajó, pero el intervalo incluye ausencia de cambio.",
      "La cohorte contiene 55 partidas post-baseline y 2091 decisiones.",
      "No hay evidencia suficiente para atribuir el cambio a la lección.",
    ],
    missingData: migration.nonDemonstrableRequirements,
  },
  frozenArtifacts: {
    detectorId: meta.detectorId,
    analysisFingerprint: meta.analysisFingerprint,
    metricsHash,
  },
  sourceTrainingSnapshot: state.trainingSnapshot ?? null,
};
writeFileSync(path.join(reportsDir, "transfer-validity-v0.3.1.json"), `${JSON.stringify(report, null, 2)}\n`);

const md = `# MoveMirror v0.3.1 — validez de transferencia

- Evidencia verificable de entrenamiento histórico: **no suficiente**.
- \`qualifiedAt\`: **null**. Faltan finalización versionada de lección, timestamps de intentos, criterio por intento y límites de sesión.
- \`${cohortId}\`: **post-baseline; exposure_unknown**.
- Partidas válidas como post-intervención: **ninguna demostrable con el historial conservado**.
- Métricas originales: 55 partidas, 2.091 decisiones, 5,7 eventos/100; no fueron recalculadas.
- Hash de métricas: \`${metricsHash}\`.
- Hash independiente de auditoría: \`${audit.auditHash}\`.

## Conclusiones permitidas

La tasa puntual bajó, pero el intervalo incluye ausencia de cambio. No hay evidencia suficiente para atribuir el cambio a la lección. No puede describirse esta cohorte como “después del entrenamiento”.

## Datos faltantes

${migration.nonDemonstrableRequirements.map((item) => `- ${item}`).join("\n")}

## Comparabilidad

${warning.message ?? "No se activó la advertencia de composición con los umbrales versionados."}
`;
writeFileSync(path.join(reportsDir, "transfer-validity-v0.3.1.md"), md);

if (hashFile(metricsPath) !== metricsHash) throw new Error("frozen_metrics_changed");
console.log(JSON.stringify({ status: "passed", cohortId, metricsHash, auditHash: audit.auditHash }));
