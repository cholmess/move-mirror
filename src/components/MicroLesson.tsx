import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Chessboard } from "react-chessboard";
import { microLesson, getLessonExampleFen } from "../data/microlesson";
import { getExercise } from "../data/exercises";
import { useApp } from "../context/AppContext";

export function MicroLesson() {
  const { completeLesson, startLesson, state } = useApp();
  const [stepIndex, setStepIndex] = useState(0);
  const steps = microLesson.steps;
  const step = steps[stepIndex]!;
  const fen = getLessonExampleFen(step);
  const example = step.exampleExerciseId
    ? getExercise(step.exampleExerciseId)
    : undefined;

  useEffect(() => {
    startLesson();
  }, [startLesson]);

  const onFinish = () => {
    completeLesson();
  };

  return (
    <div className="page lesson">
      <header className="lesson-header">
        <h1>{microLesson.title}</h1>
        <p className="muted">
          Posiciones reales de {state.username} — la solución no se muestra aquí.
        </p>
        <div className="step-dots">
          {steps.map((s, i) => (
            <button
              key={s.order}
              type="button"
              className={i === stepIndex ? "dot active" : "dot"}
              onClick={() => setStepIndex(i)}
              aria-label={s.title}
            />
          ))}
        </div>
      </header>

      <div className="lesson-body">
        <section className="card lesson-text">
          <p className="eyebrow">
            Paso {step.order} · {step.title}
          </p>
          <p className="lesson-copy">{step.body}</p>
          {step.checklist && (
            <ul>
              {step.checklist.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
          {example && (
            <p className="small muted">
              Posición de tu partida (mov. {example.moveNumber}) —{" "}
              <a href={example.gameUrl} target="_blank" rel="noreferrer">
                ver en Chess.com
              </a>
            </p>
          )}
          <div className="lesson-nav">
            <button
              type="button"
              className="btn"
              disabled={stepIndex === 0}
              onClick={() => setStepIndex((i) => i - 1)}
            >
              Anterior
            </button>
            {stepIndex < steps.length - 1 ? (
              <button
                type="button"
                className="btn primary"
                onClick={() => setStepIndex((i) => i + 1)}
              >
                Siguiente
              </button>
            ) : (
              <button type="button" className="btn primary" onClick={onFinish}>
                Marcar lección completada
              </button>
            )}
          </div>
          {state.progress.lessonCompletedAt && (
            <p className="success small">
              Lección completada el{" "}
              {new Date(state.progress.lessonCompletedAt).toLocaleString("es")}
            </p>
          )}
          <Link className="btn ghost" to="/train">
            Ir a entrenamiento
          </Link>
        </section>

        {fen && (
          <section className="card board-preview readonly-board">
            <Chessboard
              position={fen}
              arePiecesDraggable={false}
              boardOrientation={example?.sideToMove === "b" ? "black" : "white"}
            />
            <p className="center small muted">Solo contexto — entrena en la pestaña Entrenar</p>
          </section>
        )}
      </div>
    </div>
  );
}
