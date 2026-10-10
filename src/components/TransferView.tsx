import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { APP_VERSION, PATTERN_ID } from "../data/constants";
import {
  cancelTransfer,
  fetchExamples,
  fetchTransferState,
  freezeTransfer,
  postTrainingSummary,
  promoteTransfer,
  resumeTransfer,
  startTransferSync,
} from "../api/transferClient";
import { combinedNarrative, decidePedagogy, summarizeTraining } from "@shared/transfer/pedagogy.js";
import type { TransferExample, TransferState } from "../types/transfer";

const REASONS: Record<string, string> = {
  time_control_not_600: "Otro control de tiempo",
  not_standard_chess: "Variante no estándar",
  not_rapid: "No es Rapid",
  too_few_plies: "Partida de uno a cuatro movimientos",
  early_resign_or_abandon: "Rendición o abandono temprano",
  not_after_baseline_cutoff: "Anterior al corte del baseline",
  already_in_baseline: "Ya estaba en el baseline",
  duplicate_game_id: "Identificador repetido",
  duplicate_url: "URL repetida",
  unparseable_pgn: "PGN no parseable",
  missing_pgn: "Sin PGN",
  time_control_mismatch: "El PGN no coincide con 10+0",
};

const PHASES: Record<string, string> = {
  opening_proxy: "Apertura",
  middlegame_proxy: "Medio juego",
  endgame_proxy: "Final",
};

function trainingFromState(attempts: { skillIds: string[]; patternId: string; evaluationStatus: string }[], mastery: number | null, nextReviewAt: string | null) {
  const related = attempts.filter((attempt) => attempt.patternId === PATTERN_ID || attempt.skillIds.includes(PATTERN_ID));
  const count = (status: string) => related.filter((attempt) => attempt.evaluationStatus === status).length;
  return {
    verified_best: count("verified_best"),
    verified_acceptable: count("verified_acceptable"),
    playable_inexact: count("playable_inexact"),
    incorrect: count("incorrect"),
    unverified: count("unverified"),
    attempts: related.length,
    mastery,
    nextReviewAt,
  };
}

function formatRate(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—";
  return value.toLocaleString("es", { maximumFractionDigits: 1 });
}

function formatWhen(iso: string | null) {
  if (!iso) return "Todavía no";
  return new Date(iso).toLocaleString("es");
}

function explainTransferError(error: unknown, fallback: string) {
  const code = error instanceof Error ? error.message : "";
  if (code === "quality_max_per_game") return "Esta partida ya tiene un ejercicio futuro. Solo se guarda uno por partida.";
  if (code === "quality_duplicate") return "Esa posición ya está guardada.";
  if (code.startsWith("quality_")) return "Esta posición no cumple el criterio para convertirse en ejercicio.";
  if (code === "examples_locked") return "Los ejemplos se abren después de congelar la cohorte.";
  if (code === "cohort_frozen") return "Esa cohorte ya está congelada.";
  return code || fallback;
}

export function TransferView() {
  const { state } = useApp();
  const [data, setData] = useState<TransferState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [examples, setExamples] = useState<TransferExample[]>([]);
  const [busy, setBusy] = useState(false);

  const training = useMemo(
    () => trainingFromState(state.attempts, state.skills[PATTERN_ID]?.masteryEstimate ?? null, state.skills[PATTERN_ID]?.nextReviewAt ?? null),
    [state.attempts, state.skills]
  );
  const profile = summarizeTraining(training);
  const pedagogy = useMemo(
    () => data ? decidePedagogy({ training, comparison: data.comparison, previousAction: data.pedagogy?.action ?? null }) : null,
    [data, training]
  );
  const narrative = pedagogy && data
    ? combinedNarrative({ training, comparison: data.comparison, pedagogy })
    : [];

  async function reload() {
    try {
      const next = await fetchTransferState();
      setData(next);
      setError(null);
      if (next.currentCohortId && !next.examplesLocked) {
        const payload = await fetchExamples(next.currentCohortId);
        setExamples(payload.examples ?? []);
      } else {
        setExamples([]);
      }
    } catch (err) {
      setError(explainTransferError(err, "No se pudo leer la transferencia"));
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    if (!data?.sync.running) return;
    const id = window.setInterval(() => void reload(), 1200);
    return () => window.clearInterval(id);
  }, [data?.sync.running]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
    } catch (err) {
      setError(explainTransferError(err, "La operación no se completó"));
    } finally {
      setBusy(false);
    }
  }

  const comparison = data?.comparison;
  const pending = data?.openCohort?.pendingDecisions ?? 0;
  const cutoff = data?.baseline?.cutoff?.endUtc
    ? new Date(data.baseline.cutoff.endUtc).toLocaleString("es")
    : null;

  return (
    <div className="page transfer">
      <header className="page-head">
        <p className="eyebrow">MoveMirror {APP_VERSION}</p>
        <h1>Transferencia a partidas reales</h1>
        <p className="lead">
          Aquí se mira si el patrón entrenado aparece menos en partidas 10+0 nuevas que en el baseline congelado.
          Es desempeño posterior, no una prueba de que la lección lo haya causado.
        </p>
      </header>

      {error && <p className="warn">{error}</p>}

      <section className="card">
        <h2>Sincronización</h2>
        <p>Última sincronización: {formatWhen(data?.sync.lastSyncedAt ?? null)}</p>
        <p className="muted small">
          Corte del baseline: {cutoff ?? "cargando"}. Solo entran partidas terminadas después, de ajedrez estándar y 10+0.
        </p>
        {data?.sync.progress && (
          <p>
            {data.sync.progress.message}
            {data.sync.progress.total > 0 ? ` (${data.sync.progress.done} / ${data.sync.progress.total})` : ""}
          </p>
        )}
        {data?.sync.lastError && <p className="warn">{data.sync.lastError}</p>}
        <div className="actions">
          <button
            type="button"
            className="btn primary"
            disabled={busy || data?.sync.running}
            onClick={() => run(() => startTransferSync("live", training))}
          >
            Sincronizar nuevas partidas
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !data?.sync.running}
            onClick={() => run(() => cancelTransfer())}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || data?.sync.running || pending === 0}
            onClick={() => run(() => resumeTransfer(training))}
          >
            Reanudar análisis
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={busy || data?.sync.running}
            onClick={() => run(() => startTransferSync("fixtures", training))}
          >
            Modo offline (fixtures)
          </button>
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <h2>Qué entró y qué quedó fuera</h2>
          <ul className="stat-list">
            <li>Partidas nuevas válidas: {data?.includedCount ?? "—"}</li>
            <li>Partidas excluidas: {data?.excludedCount ?? "—"}</li>
            <li>
              Análisis:{" "}
              {pending > 0 ? `${pending} decisiones pendientes` : data?.openCohort || data?.currentCohortId ? "completo" : "sin cohorte"}
            </li>
          </ul>
          <ul className="reason-list">
            {(data?.exclusionCounts ?? []).map((row) => (
              <li key={row.reason}>
                {REASONS[row.reason] ?? row.reason}: {row.count}
              </li>
            ))}
          </ul>
          <p className="muted small">
            Un timeout, un abandono o una rendición no se leen como debilidad. Las exclusiones tempranas siguen la regla congelada de la Fase 1.
          </p>
        </section>

        <section className="card">
          <h2>Baseline y cohorte actual</h2>
          {!data?.baseline?.metrics && (
            <p>El baseline todavía se está recalculando con el mismo presupuesto que las partidas nuevas. Hasta entonces no hay una comparación honesta.</p>
          )}
          {comparison ? (
            <>
              <p className={`badge ${comparison.status === "observed_improvement" ? "badge-high" : "badge-medium"}`}>
                {comparison.label}
              </p>
              <ul className="stat-list">
                <li>Baseline: {formatRate(comparison.baseline.eventsPer100)} eventos por 100 decisiones</li>
                <li>Partidas nuevas: {formatRate(comparison.transfer.eventsPer100)} eventos por 100 decisiones</li>
                <li>
                  Diferencia: {comparison.absoluteDifference === null ? "—" : formatRate(comparison.absoluteDifference)} por 100
                  {comparison.relativeDifference !== null
                    ? ` (${Math.round(comparison.relativeDifference * 100)} % relativo)`
                    : ""}
                </li>
                <li>
                  Intervalo: {formatRate(comparison.interval.low)} a {formatRate(comparison.interval.high)}
                </li>
                <li>
                  Muestra: {comparison.sample.transferGames} partidas nuevas y {comparison.sample.transferDecisions} decisiones, frente a {comparison.sample.baselineGames} y {comparison.sample.baselineDecisions} del baseline.
                </li>
                <li>
                  Partidas con el patrón: {comparison.transfer.gamesAffected} de {comparison.transfer.gamesAnalyzed}
                </li>
              </ul>
            </>
          ) : (
            <p className="muted">Cuando el análisis esté completo, aquí aparece la comparación.</p>
          )}
          <p className="tiny muted">Detector {data?.detectorId}</p>
        </section>
      </div>

      {comparison && (
        <section className="card">
          <h2>Qué significa</h2>
          <p>{comparison.meaning}</p>
          <p>{comparison.notMeaning}</p>
          <div className="grid-2">
            <div>
              <h3>Por fase</h3>
              <ul className="stat-list">
                {Object.entries(comparison.transfer.byPhase ?? {}).map(([phase, slice]) => (
                  <li key={phase}>
                    {PHASES[phase] ?? phase}: {slice.events} en {slice.decisions} decisiones
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Severidad y color</h3>
              <ul className="stat-list">
                <li>Notable: {comparison.transfer.severity.notable}</li>
                <li>Marcada: {comparison.transfer.severity.marcada}</li>
                <li>Grave: {comparison.transfer.severity.grave}</li>
                <li>Captura de pieza: {comparison.transfer.pieceCaptureEvents} eventos</li>
                <li>Blancas: {formatRate(comparison.transfer.byColor.white?.per100 ?? null)} por 100</li>
                <li>Negras: {formatRate(comparison.transfer.byColor.black?.per100 ?? null)} por 100</li>
              </ul>
            </div>
          </div>
        </section>
      )}

      <section className="card">
        <h2>Dos canales</h2>
        <div className="grid-2">
          <div>
            <h3>Ejercicios</h3>
            <ul className="stat-list">
              <li>Mejor jugada verificada: {profile.verified_best}</li>
              <li>Aceptable verificada: {profile.verified_acceptable}</li>
              <li>Jugable imprecisa: {profile.playable_inexact}</li>
              <li>Incorrecta: {profile.incorrect}</li>
              <li>Próxima revisión: {formatWhen(profile.nextReviewAt)}</li>
            </ul>
          </div>
          <div>
            <h3>Partidas reales</h3>
            <ul className="stat-list">
              <li>Estado: {comparison?.label ?? "Datos insuficientes"}</li>
              <li>Última sincronización: {formatWhen(data?.sync.lastSyncedAt ?? null)}</li>
              <li>Estos resultados no cambian el dominio de los ejercicios.</li>
            </ul>
          </div>
        </div>
        {narrative.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </section>

      <section className="card">
        <h2>Recomendación</h2>
        {pedagogy ? (
          <>
            <p className="badge badge-medium">{pedagogy.title}</p>
            <p>{pedagogy.explanation}</p>
            <p className="tiny muted">Regla {pedagogy.policyId}. No enseña un patrón nuevo.</p>
            {pedagogy.candidate && <p>{pedagogy.candidate.note}</p>}
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => run(() => postTrainingSummary(training, data?.pedagogy?.action ?? null))}
            >
              Guardar esta recomendación
            </button>
          </>
        ) : (
          <p className="muted">Aparece después de la primera lectura.</p>
        )}
        <div className="actions">
          <Link className="btn" to="/train">Seguir entrenando</Link>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !data?.openCohort || pending > 0 || data.openCohort.games === 0}
            onClick={() => data?.openCohort && run(() => freezeTransfer(data.openCohort!.id))}
          >
            Congelar cohorte
          </button>
          <a className="btn ghost" href="/api/transfer/export">Exportar JSON</a>
        </div>
      </section>

      <section className="card">
        <h2>Ejemplos de la cohorte</h2>
        {data?.examplesLocked ? (
          <p>Los ejemplos se muestran después de congelar la evaluación. Antes, la cohorte sigue abierta y no se convierte en ejercicios.</p>
        ) : examples.length === 0 ? (
          <p>No hay eventos confirmados para mostrar en esta cohorte.</p>
        ) : (
          <ul className="reason-list">
            {examples.slice(0, 12).map((example) => (
              <li key={example.key}>
                Jugada {example.moveNumber} · {example.color === "white" ? "blancas" : "negras"} · {example.severity}
                {example.pieceCaptureSubgroup ? " · captura de pieza" : ""}
                {example.url && (
                  <>
                    {" "}
                    <a href={example.url} target="_blank" rel="noreferrer">partida</a>
                  </>
                )}
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy || data?.exerciseCandidates.some((item) => item.key === example.key)}
                  onClick={() => data?.currentCohortId && run(() => promoteTransfer(data.currentCohortId!, example.key))}
                >
                  Guardar como ejercicio futuro
                </button>
              </li>
            ))}
          </ul>
        )}
        {!!data?.exerciseCandidates.length && (
          <p className="small">Ejercicios futuros guardados: {data.exerciseCandidates.length}. No entran solos al entrenador.</p>
        )}
      </section>
    </div>
  );
}
