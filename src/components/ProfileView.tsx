import { useEffect, useMemo, useState } from "react";
import { visibleSkills } from "../data/skills";
import { useApp } from "../context/AppContext";
import { aggregateEvidence } from "../domain/profile";
import { exportAttempts } from "../storage/persistence";
import { FUTURE_MODULES } from "../contracts/future";
import { PATTERN_ID } from "../data/constants";
import { fetchTransferState } from "../api/transferClient";
import type { TransferState } from "../types/transfer";
import { summarizeTraining } from "@shared/transfer/pedagogy.js";
import { buildDefenseProfile } from "../domain/defenseProfile";

export function ProfileView() {
  const { state, resetAll } = useApp();

  const [transfer, setTransfer] = useState<TransferState | null>(null);
  useEffect(() => {
    fetchTransferState().then(setTransfer).catch(() => setTransfer(null));
  }, []);
  const training = useMemo(() => {
    const related = state.attempts.filter(
      (attempt) => attempt.patternId === PATTERN_ID || attempt.skillIds.includes(PATTERN_ID)
    );
    const count = (status: string) => related.filter((attempt) => attempt.evaluationStatus === status).length;
    return summarizeTraining({
      verified_best: count("verified_best"),
      verified_acceptable: count("verified_acceptable"),
      playable_inexact: count("playable_inexact"),
      incorrect: count("incorrect"),
      unverified: count("unverified"),
      attempts: related.length,
      mastery: state.skills[PATTERN_ID]?.masteryEstimate ?? null,
      nextReviewAt: state.skills[PATTERN_ID]?.nextReviewAt ?? null,
    });
  }, [state.attempts, state.skills]);
  const defense = useMemo(
    () => buildDefenseProfile(state.defenseLab.attempts),
    [state.defenseLab.attempts],
  );

  const downloadLog = () => {
    const blob = new Blob([exportAttempts(state)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `move-mirror-attempts-${state.username}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page profile">
      <h1>Perfil vivo</h1>
      <p className="muted">
        Actualización bayesiana simple (Beta-Binomial por habilidad). Sin ML opaco en MVP.
      </p>

      <div className="skills-grid">
        {visibleSkills.map((sk) => {
          const st = state.skills[sk.id];
          const agg = aggregateEvidence(sk.id, state.attempts);
          return (
            <article key={sk.id} className="card skill-detail">
              <h2>{sk.name}</h2>
              <div className="meter">
                <div
                  className="meter-fill"
                  style={{ width: `${Math.round((st?.masteryEstimate ?? 0) * 100)}%` }}
                />
              </div>
              <ul className="stat-list small">
                <li>
                  Dominio estimado: {Math.round((st?.masteryEstimate ?? 0) * 100)}% (α=
                  {st?.alpha.toFixed(1)}, β={st?.beta.toFixed(1)})
                </li>
                <li>
                  Confianza: {Math.round((st?.confidence ?? 0) * 100)}% · Verificados ok{" "}
                  {st?.successes} · Errores {st?.failures} · Imprecisos {st?.partials} · Sin
                  verificar {st?.unverifiedCount ?? 0}
                </li>
                <li>
                  Última práctica:{" "}
                  {st?.lastPracticeAt
                    ? new Date(st.lastPracticeAt).toLocaleString("es")
                    : "—"}
                </li>
                <li>
                  Próxima revisión sugerida:{" "}
                  {st?.nextReviewAt
                    ? new Date(st.nextReviewAt).toLocaleDateString("es")
                    : "—"}
                </li>
                <li>
                  Evidencia review: {agg.reviewEvidence.validationPositions} pos. validación
                  · Práctica MoveMirror: {agg.practiceAttempts} intentos
                </li>
              </ul>
              {st && st.history.length > 1 && (
                <div className="history">
                  <p className="eyebrow">Evolución reciente</p>
                  <ul className="mono tiny">
                    {st.history.slice(-5).map((h) => (
                      <li key={h.at + h.event}>
                        {new Date(h.at).toLocaleDateString("es")} —{" "}
                        {Math.round(h.mastery * 100)}% — {h.event}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <section className="card">
        <h2>Tres canales separados</h2>
        <p className="muted small">
          El dominio de ejercicios (α/β) solo cambia con intentos verificados. Las partidas reales no lo modifican.
        </p>
        <ul className="stat-list">
          <li>
            Ejercicios: {training.verified_best} mejor jugada, {training.verified_acceptable} aceptables,{" "}
            {training.playable_inexact} imprecisas, {training.incorrect} incorrectas.
          </li>
          <li>Partidas reales: {transfer?.comparison?.label ?? "Datos insuficientes"}.</li>
          <li>
            Exposición pedagógica: {state.interventionQualification.qualified
              ? `dosis completada (${new Date(state.interventionQualification.qualifiedAt!).toLocaleString("es")})`
              : "dosis en progreso"}.
          </li>
          <li>Validez de la cohorte: {transfer?.currentExposureAudit?.exposureValidity ?? "exposure_unknown"}.</li>
          <li>
            Última sincronización:{" "}
            {transfer?.sync.lastSyncedAt
              ? new Date(transfer.sync.lastSyncedAt).toLocaleString("es")
              : "sin sincronizar"}
            .
          </li>
        </ul>
      </section>

      <section className="card">
        <h2>Registro de aprendizaje</h2>
        {state.attempts.length === 0 ? (
          <p className="muted">Aún no hay intentos. Entrena un ejercicio.</p>
        ) : (
          <table className="attempts-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Ejercicio</th>
                <th>Resultado</th>
                <th>Jugada</th>
                <th>Refutación registrada</th>
              </tr>
            </thead>
            <tbody>
              {[...state.attempts].reverse().slice(0, 20).map((a) => (
                <tr key={a.id}>
                  <td>{new Date(a.recordedAt).toLocaleString("es")}</td>
                  <td className="mono">{a.exerciseId}</td>
                  <td>{a.evaluationStatus}</td>
                  <td>{a.chosenMoveSan}</td>
                  <td>{a.foundOpponentForcedResponse ? "sí" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <button type="button" className="btn" onClick={downloadLog}>
          Exportar intentos (JSON)
        </button>
      </section>

      <section className="card">
        <h2>Defense Lab</h2>
        <ul className="stat-list">
          <li>Posiciones intentadas: {defense.positionsAttempted}</li>
          <li>Resultados verificados: {defense.verifiedResults}</li>
          <li>Defensas aceptables: {Math.round(defense.acceptableRate * 100)}%</li>
          <li>Recursos practicados: {defense.resourcesPracticed.join(", ") || "—"}</li>
          <li>Última práctica: {defense.lastPracticeAt ? new Date(defense.lastPracticeAt).toLocaleString("es") : "—"}</li>
          <li>Próxima revisión: {defense.nextReviewAt ? new Date(defense.nextReviewAt).toLocaleDateString("es") : "—"}</li>
        </ul>
        <p><strong>Observación:</strong> {defense.observation}</p>
        <p><strong>Hipótesis:</strong> {defense.hypothesis}</p>
        <p className="muted small">
          Confianza {defense.confidence}. Se exige evidencia de 5 posiciones, 3 partidas y 2 sesiones
          antes de presentar una hipótesis específica.
        </p>
        {state.defenseLab.attempts.length > 0 && (
          <ul className="mono tiny">
            {state.defenseLab.attempts.slice(-5).reverse().map((attempt) => (
              <li key={attempt.attemptId}>
                {new Date(attempt.confirmedAt).toLocaleDateString("es")} · {attempt.motif} · {attempt.evaluationStatus}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card muted-arch">
        <h2>Arquitectura futura (contratos only)</h2>
        <ul>
          {Object.values(FUTURE_MODULES).map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <p className="small">Ver <code>src/contracts/future.ts</code></p>
      </section>

      <button type="button" className="btn danger" onClick={resetAll}>
        Reiniciar progreso local
      </button>
    </div>
  );
}
