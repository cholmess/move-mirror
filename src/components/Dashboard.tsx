import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchTransferState } from "../api/transferClient";
import type { TransferState } from "../types/transfer";
import { primaryPattern } from "../data/pattern";
import { visibleSkills } from "../data/skills";
import { microLesson } from "../data/microlesson";
import { coreExercises, exercises, dataManifest } from "../data/exercises";
import { useApp } from "../context/AppContext";
import { getExercise } from "../data/exercises";

export function Dashboard() {
  const { state } = useApp();
  const ev = primaryPattern.evidence;
  const currentId = state.progress.currentExerciseId;
  const currentEx = currentId ? getExercise(currentId) : exercises[0];

  const lessonDone = !!state.progress.lessonCompletedAt;
  const solvedCount = state.progress.exercisesCompleted.length;
  const [transfer, setTransfer] = useState<TransferState | null>(null);

  useEffect(() => {
    fetchTransferState().then(setTransfer).catch(() => setTransfer(null));
  }, []);

  return (
    <div className="page dashboard">
      <section className="hero-card">
        <p className="eyebrow">Patrón prioritario</p>
        <h1>{primaryPattern.title}</h1>
        <p className="lead">{primaryPattern.plainExplanation}</p>
        <div className="confidence-row">
          <span className="badge badge-high">
            Confianza del patrón: {primaryPattern.patternConfidence}
          </span>
          <span className="badge badge-medium">
            Hipótesis pedagógica: {primaryPattern.hypothesisConfidence}
          </span>
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <h2>Evidencia (observable)</h2>
          <ul className="stat-list">
            <li>
              <strong>Descubrimiento:</strong> {ev.discoveryPositions} posiciones en{" "}
              {ev.discoveryGames} partidas distintas ({ev.pctDiscovery}% de alertas
              confirmadas)
            </li>
            <li>
              <strong>Validación temporal:</strong> {ev.validationPositions} posiciones en{" "}
              {ev.validationGames} partidas ({ev.pctValidation}% — estable)
            </li>
            <li>
              <strong>Muestra:</strong> {ev.sampleGames} partidas Rapid 10+0 ·{" "}
              {ev.sampleDecisions.toLocaleString()} decisiones analizadas
            </li>
          </ul>
          <p className="muted small">
            Evento observable: tras tu jugada, el rival tenía captura, jaque o secuencia
            forzada. Causa probable: {primaryPattern.pedagogicalHypothesis}
          </p>
        </section>

        <section className="card">
          <h2>Progreso y próxima sesión</h2>
          <div className="progress-blocks">
            <div>
              <span className="progress-label">Microlección</span>
              <span>{lessonDone ? "Completada" : "Pendiente"}</span>
            </div>
            <div>
              <span className="progress-label">Ejercicios acertados</span>
              <span>
                {solvedCount} / {coreExercises.length} núcleo · banco{" "}
                {exercises.length} pos.
              </span>
            </div>
            <div>
              <span className="progress-label">Intentos registrados</span>
              <span>{state.attempts.length}</span>
            </div>
          </div>
          {currentEx && (
            <div className="next-box">
              <p className="small muted">Siguiente ejercicio sugerido</p>
              <p>
                Movimiento {currentEx.moveNumber} ·{" "}
                {currentEx.sideToMove === "w" ? "Blancas" : "Negras"}
              </p>
              {state.progress.lastSelectionReason && (
                <p className="reason">{state.progress.lastSelectionReason}</p>
              )}
            </div>
          )}
          <div className="actions">
            {!lessonDone && (
              <Link className="btn primary" to="/lesson">
                Comenzar microlección
              </Link>
            )}
            <Link className="btn" to="/train">
              Entrenar ahora
            </Link>
          </div>
        </section>
      </div>

      <section className="card">
        <h2>Transferencia a partidas nuevas</h2>
        {transfer?.comparison ? (
          <p>
            {transfer.comparison.label}. En las partidas nuevas el patrón aparece{" "}
            {transfer.comparison.transfer.eventsPer100?.toLocaleString("es", { maximumFractionDigits: 1 })}{" "}
            veces por 100 decisiones, frente a{" "}
            {transfer.comparison.baseline.eventsPer100?.toLocaleString("es", { maximumFractionDigits: 1 })}{" "}
            en el baseline.
          </p>
        ) : (
          <p>
            {transfer?.sync.lastSyncedAt
              ? "Hay una sincronización, pero la comparación todavía no está cerrada."
              : "Todavía no hay una comparación entre el baseline y partidas nuevas."}
          </p>
        )}
        <p className="muted small">
          Última sincronización:{" "}
          {transfer?.sync.lastSyncedAt
            ? new Date(transfer.sync.lastSyncedAt).toLocaleString("es")
            : "sin sincronizar"}
          . Partidas nuevas válidas: {transfer?.includedCount ?? 0}. Excluidas: {transfer?.excludedCount ?? 0}.
        </p>
        {transfer?.pedagogy && <p>{transfer.pedagogy.explanation}</p>}
        <Link className="btn" to="/transfer">
          Ver transferencia
        </Link>
      </section>

      <section className="card">
        <h2>Habilidades visibles (máx. 3)</h2>
        <div className="skills-grid">
          {visibleSkills.map((sk) => {
            const st = state.skills[sk.id];
            const pct = Math.round((st?.masteryEstimate ?? 0) * 100);
            return (
              <article key={sk.id} className="skill-card">
                <h3>{sk.name}</h3>
                <p className="small">{sk.description}</p>
                <div className="meter">
                  <div className="meter-fill" style={{ width: `${pct}%` }} />
                </div>
                <p className="mono small">
                  Dominio estimado {pct}% · confianza{" "}
                  {Math.round((st?.confidence ?? sk.initialConfidence) * 100)}%
                </p>
                <p className="muted tiny">
                  Evidencia review: {sk.initialEvidence.discoveryPositions} pos. /{" "}
                  {sk.initialEvidence.discoveryGames} partidas → validación{" "}
                  {sk.initialEvidence.validationPositions} /{" "}
                  {sk.initialEvidence.validationGames}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      <p className="muted small center">
        Lección: {microLesson.title} · Banco Fase 2: {dataManifest.counts.core} núcleo +{" "}
        {dataManifest.counts.pool} ampliado ({dataManifest.poolFilter.motif}) · Sin centipawns
        en pantalla principal.
      </p>
    </div>
  );
}
