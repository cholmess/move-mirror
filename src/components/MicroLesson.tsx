import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Chessboard } from "react-chessboard";
import { microLesson, getLessonExampleFen } from "../data/microlesson";
import { getExercise } from "../data/exercises";
import { useApp } from "../context/AppContext";
import { formatDateTime } from "../i18n/presenters";
import type { SupportedLocale } from "../i18n/types";

function lessonStepCopy(order: number, t: (key: string) => string) {
  const title = t(`step${order}Title`);
  const body = t(`step${order}Body`);
  const checklist: string[] = [];
  for (let i = 1; i <= 3; i += 1) {
    const key = `step${order}Checklist${i}`;
    const line = t(key);
    if (line !== key) checklist.push(line);
  }
  return { title, body, checklist };
}

export function MicroLesson() {
  const { t, i18n } = useTranslation(["lesson", "common"]);
  const locale = i18n.language as SupportedLocale;
  const { completeLesson, startLesson, state } = useApp();
  const [stepIndex, setStepIndex] = useState(0);
  const steps = microLesson.steps;
  const step = steps[stepIndex]!;
  const copy = useMemo(() => lessonStepCopy(step.order, t), [step.order, t]);
  const fen = getLessonExampleFen(step);
  const example = step.exampleExerciseId ? getExercise(step.exampleExerciseId) : undefined;

  useEffect(() => {
    startLesson();
  }, [startLesson]);

  const onFinish = () => {
    completeLesson();
  };

  return (
    <div className="page lesson">
      <header className="lesson-header">
        <h1>{t("title")}</h1>
        <p className="muted">{t("subtitle", { username: state.username })}</p>
        <div className="step-dots">
          {steps.map((s, i) => {
            const dotCopy = lessonStepCopy(s.order, t);
            return (
              <button
                key={s.order}
                type="button"
                className={i === stepIndex ? "dot active" : "dot"}
                onClick={() => setStepIndex(i)}
                aria-label={dotCopy.title}
              />
            );
          })}
        </div>
      </header>

      <div className="lesson-body">
        <section className="card lesson-text">
          <p className="eyebrow">{t("stepLabel", { order: step.order, title: copy.title })}</p>
          <p className="lesson-copy">{copy.body}</p>
          {copy.checklist.length > 0 && (
            <ul>
              {copy.checklist.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
          {example && (
            <p className="small muted">
              {t("positionFromGame", { moveNumber: example.moveNumber })} —{" "}
              <a href={example.gameUrl} target="_blank" rel="noreferrer">
                {t("viewOnChesscom")}
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
              {t("common:previous")}
            </button>
            {stepIndex < steps.length - 1 ? (
              <button type="button" className="btn primary" onClick={() => setStepIndex((i) => i + 1)}>
                {t("common:next")}
              </button>
            ) : (
              <button type="button" className="btn primary" onClick={onFinish}>
                {t("markComplete")}
              </button>
            )}
          </div>
          {state.progress.lessonCompletedAt && (
            <p className="success small">
              {t("completedOn", {
                date: formatDateTime(state.progress.lessonCompletedAt, locale),
              })}
            </p>
          )}
          <Link className="btn ghost" to="/train">
            {t("goTrain")}
          </Link>
        </section>

        {fen && (
          <section className="card board-preview readonly-board">
            <Chessboard
              position={fen}
              arePiecesDraggable={false}
              boardOrientation={example?.sideToMove === "b" ? "black" : "white"}
            />
            <p className="center small muted">{t("boardHint")}</p>
          </section>
        )}
      </div>
    </div>
  );
}
