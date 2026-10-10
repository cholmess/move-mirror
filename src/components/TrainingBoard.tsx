import { useCallback, useEffect, useState } from "react";
import { Chessboard } from "react-chessboard";
import { Chess } from "chess.js";
import type { AttemptRecord, CctCapture } from "../types/learning";
import { useApp } from "../context/AppContext";
import { coreExercises, getExercise, poolExercises, exercises } from "../data/exercises";
import { selectNextExercise, formatSelectionExplanation } from "../domain/adaptive";
import {
  pedagogicalLabel,
  pedagogicalSummary,
  opponentStrongestReply,
  buildReflectionPrompt,
} from "../domain/pedagogy";

type Phase = "cct" | "move" | "reason" | "confirm" | "feedback";

const emptyCct = (): CctCapture => ({
  checksConsidered: "",
  capturesConsidered: "",
  threatsConsidered: "",
  firstCandidate: "",
  opponentForcedResponse: "",
});

function poolOptionsForSelect(currentId: string) {
  const inList = poolExercises.slice(0, 80);
  const current = poolExercises.find((e) => e.id === currentId);
  if (current && !inList.some((e) => e.id === currentId)) {
    return [current, ...inList];
  }
  return inList;
}

export function TrainingBoard() {
  const { state, submitExerciseAttempt } = useApp();
  const [exerciseId, setExerciseId] = useState(
    () => state.progress.currentExerciseId ?? exercises[0]!.id
  );
  const exercise = getExercise(exerciseId)!;

  const [phase, setPhase] = useState<Phase>("cct");
  const [cct, setCct] = useState<CctCapture>(emptyCct);
  const [chosenSan, setChosenSan] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [startedAt] = useState(() => Date.now());
  const [lastAttempt, setLastAttempt] = useState<AttemptRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const orientation = exercise.sideToMove === "w" ? "white" : "black";

  useEffect(() => {
    setExerciseId(state.progress.currentExerciseId ?? exercises[0]!.id);
  }, [state.progress.currentExerciseId]);

  const resetForExercise = useCallback((id: string) => {
    setExerciseId(id);
    setPhase("cct");
    setCct(emptyCct());
    setChosenSan("");
    setReasoning("");
    setLastAttempt(null);
  }, []);

  const onDrop = (source: string, target: string) => {
    if (phase !== "move" && phase !== "confirm") return false;
    const game = new Chess(exercise.fen);
    const move = game.move({ from: source, to: target, promotion: "q" });
    if (!move) return false;
    setChosenSan(move.san);
    if (phase === "move") setPhase("reason");
    return true;
  };

  const canAdvanceFromCct =
    cct.checksConsidered.trim().length >= 2 &&
    cct.capturesConsidered.trim().length >= 2 &&
    cct.threatsConsidered.trim().length >= 2 &&
    cct.firstCandidate.trim().length >= 2;

  const submit = async () => {
    setSubmitting(true);
    const timeUsedSeconds = Math.round((Date.now() - startedAt) / 1000);
    try {
      const attempt = await submitExerciseAttempt({
        exerciseId: exercise.id,
        cct,
        chosenMoveSan: chosenSan,
        reasoning,
        timeUsedSeconds,
      });
      setLastAttempt(attempt);
      setPhase("feedback");
    } finally {
      setSubmitting(false);
    }
  };

  const nextSel = selectNextExercise(state);

  return (
    <div className="page train">
      <div className="train-toolbar">
        <label className="small">
          Ejercicio{" "}
          <select
            value={exerciseId}
            onChange={(e) => resetForExercise(e.target.value)}
          >
            <optgroup label="Núcleo (5 · líneas completas)">
              {coreExercises.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  Mov. {ex.moveNumber} ({ex.sideToMove === "w" ? "Blancas" : "Negras"})
                </option>
              ))}
            </optgroup>
            <optgroup label={`Ampliado (${poolExercises.length} · CSV Fase 2)`}>
              {poolOptionsForSelect(exerciseId).map((ex) => (
                <option key={ex.id} value={ex.id}>
                  Mov. {ex.moveNumber} · sev.{ex.severity}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <a className="small" href={exercise.gameUrl} target="_blank" rel="noreferrer">
          Partida en Chess.com
        </a>
      </div>

      <p className="prompt">{exercise.prompt}</p>
      {exercise.tier === "pool" && (
        <p className="muted small">
          Banco ampliado — mejor jugada según análisis profundo (500k); línea SAN completa solo
          en ejercicios núcleo.
        </p>
      )}
      {phase === "feedback" && (
        <p className="muted small">
          En partida jugaste <strong>{exercise.playedMoveSan}</strong>
        </p>
      )}

      <div className="train-grid">
        <div className="card board-panel">
          <Chessboard
            position={exercise.fen}
            onPieceDrop={onDrop}
            boardOrientation={orientation}
            arePiecesDraggable={phase === "move" || phase === "confirm"}
          />
          {chosenSan && (
            <p className="mono center">
              Jugada elegida: <strong>{chosenSan}</strong>
            </p>
          )}
        </div>

        <div className="card flow-panel">
          {phase === "cct" && (
            <>
              <h2>CCT antes de mover</h2>
              <Field
                label="Jaques considerados"
                value={cct.checksConsidered}
                onChange={(v) => setCct((c) => ({ ...c, checksConsidered: v }))}
              />
              <Field
                label="Capturas consideradas"
                value={cct.capturesConsidered}
                onChange={(v) => setCct((c) => ({ ...c, capturesConsidered: v }))}
              />
              <Field
                label="Amenazas consideradas"
                value={cct.threatsConsidered}
                onChange={(v) => setCct((c) => ({ ...c, threatsConsidered: v }))}
              />
              <Field
                label="Primera candidata (SAN o idea)"
                value={cct.firstCandidate}
                onChange={(v) => setCct((c) => ({ ...c, firstCandidate: v }))}
              />
              <Field
                label="Mejor respuesta forzada del rival a esa candidata"
                value={cct.opponentForcedResponse}
                onChange={(v) =>
                  setCct((c) => ({ ...c, opponentForcedResponse: v }))
                }
              />
              <button
                type="button"
                className="btn primary"
                disabled={!canAdvanceFromCct}
                onClick={() => setPhase("move")}
              >
                Continuar al tablero
              </button>
            </>
          )}

          {phase === "move" && (
            <>
              <h2>Tu jugada</h2>
              <p>Mueve una pieza legalmente o escribe SAN:</p>
              <input
                className="input"
                placeholder="ej. Qxe4"
                value={chosenSan}
                onChange={(e) => setChosenSan(e.target.value)}
              />
              <button
                type="button"
                className="btn"
                disabled={!chosenSan.trim()}
                onClick={() => setPhase("reason")}
              >
                Confirmar jugada escrita
              </button>
            </>
          )}

          {phase === "reason" && (
            <>
              <h2>Razonamiento breve</h2>
              <textarea
                className="textarea"
                rows={4}
                placeholder="¿Por qué elegiste esta jugada? ¿Comprobaste la refutación?"
                value={reasoning}
                onChange={(e) => setReasoning(e.target.value)}
              />
              <button
                type="button"
                className="btn primary"
                disabled={reasoning.trim().length < 8}
                onClick={() => setPhase("confirm")}
              >
                Revisar antes de enviar
              </button>
            </>
          )}

          {phase === "confirm" && (
            <>
              <h2>Confirmar respuesta</h2>
              <ul className="confirm-list">
                <li>Jugada: {chosenSan}</li>
                <li>Razonamiento: {reasoning}</li>
              </ul>
              <p className="muted small">Aún no verás la solución oficial.</p>
              <button
                type="button"
                className="btn primary"
                disabled={submitting}
                onClick={() => void submit()}
              >
                {submitting ? "Verificando…" : "Enviar y recibir feedback"}
              </button>
              <button type="button" className="btn ghost" onClick={() => setPhase("move")}>
                Cambiar jugada
              </button>
            </>
          )}

          {phase === "feedback" && lastAttempt && (
            <FeedbackPanel
              exercise={exercise}
              attempt={lastAttempt}
              onRetry={() => {
                setPhase("cct");
                setCct(emptyCct());
                setChosenSan("");
                setReasoning("");
                setLastAttempt(null);
              }}
              onNext={() => resetForExercise(nextSel.exercise.id)}
              nextReason={formatSelectionExplanation(nextSel)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <textarea
        className="textarea"
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function FeedbackPanel({
  exercise,
  attempt,
  onRetry,
  onNext,
  nextReason,
}: {
  exercise: ReturnType<typeof getExercise>;
  attempt: AttemptRecord;
  onRetry: () => void;
  onNext: () => void;
  nextReason: string;
}) {
  if (!exercise) return null;

  const status = attempt.evaluationStatus;
  const rivalReply =
    attempt.opponentReplySan ??
    opponentStrongestReply(exercise, attempt.opponentReplySan);

  return (
    <div className="feedback">
      <h2>Feedback</h2>
      <dl className="feedback-dl">
        <dt>Tu jugada</dt>
        <dd>{attempt.chosenMoveSan}</dd>
        <dt>Clasificación</dt>
        <dd className={`result result-${status}`}>
          {pedagogicalLabel(status)} — {pedagogicalSummary(status)}
        </dd>
        <dt>Respuesta más fuerte del rival</dt>
        <dd className="mono">
          {rivalReply ?? "No disponible en esta posición"}
        </dd>
        <dt>Motivo observable</dt>
        <dd>{attempt.observableReason ?? exercise.observableReason ?? "—"}</dd>
        <dt>Alternativa recomendada</dt>
        <dd className="mono">
          {exercise.solutionSan}
          {exercise.referenceLineSan ? ` · ${exercise.referenceLineSan}` : ""}
        </dd>
        <dt>En partida jugaste</dt>
        <dd className="mono">{exercise.playedMoveSan}</dd>
      </dl>
      <p className="muted small">
        <strong>Reflexión:</strong>{" "}
        {attempt.reflectionPrompt ??
          buildReflectionPrompt(exercise, status)}
      </p>
      {status === "unverified" && (
        <p className="warn small">
          La jugada es legal, pero todavía no ha sido verificada.
        </p>
      )}
      <p className="tiny muted">
        Criterio: {attempt.evalCriterionVersion}
        {attempt.evalVerified ? " · evaluación verificada" : " · sin verificación motor"}
      </p>
      <div className="actions">
        {(status === "incorrect" ||
          status === "playable_inexact" ||
          status === "unverified") && (
          <button type="button" className="btn" onClick={onRetry}>
            Reintentar
          </button>
        )}
        <button type="button" className="btn primary" onClick={onNext}>
          Siguiente ejercicio adaptado
        </button>
      </div>
      <p className="reason small">Próxima selección: {nextReason}</p>
    </div>
  );
}
