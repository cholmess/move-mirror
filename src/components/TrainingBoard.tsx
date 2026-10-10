import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Chessboard } from "react-chessboard";
import { Chess } from "chess.js";
import type { AttemptRecord, CctCapture } from "../types/learning";
import { useApp } from "../context/AppContext";
import { coreExercises, getExercise, poolExercises, exercises } from "../data/exercises";
import { selectNextExercise } from "../domain/adaptive";
import { opponentStrongestReply, buildReflectionPrompt } from "../domain/pedagogy";
import {
  formatEvaluationStatus,
  formatEvaluationSummary,
  formatExercisePrompt,
  formatMoveForDisplay,
  formatObservableReason,
  formatSelectionReasons,
  formatSideToMove,
} from "../i18n/presenters";
import type { SupportedLocale } from "../i18n/types";
import { TechnicalDetails, TechnicalRow } from "./TechnicalDetails";

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
  const { t, i18n } = useTranslation(["training", "common"]);
  const locale = i18n.language as SupportedLocale;
  const { state, submitExerciseAttempt } = useApp();
  const [exerciseId, setExerciseId] = useState(
    () => state.progress.currentExerciseId ?? exercises[0]!.id,
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
  const promptText = formatExercisePrompt(exercise.playedMoveSan, locale);

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
    <div className="page train" data-testid="train-root">
      <div className="train-toolbar">
        <label className="small">
          {t("selectExercise")}{" "}
          <select
            data-testid="train-exercise-select"
            value={exerciseId}
            onChange={(e) => resetForExercise(e.target.value)}
          >
            <optgroup label={t("coreGroup", { count: coreExercises.length })}>
              {coreExercises.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {t("moveOption", {
                    number: ex.moveNumber,
                    side: formatSideToMove(ex.sideToMove, locale),
                  })}
                </option>
              ))}
            </optgroup>
            <optgroup label={t("poolGroup", { count: poolExercises.length })}>
              {poolOptionsForSelect(exerciseId).map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {t("moveOptionPool", { number: ex.moveNumber, severity: ex.severity })}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <a className="small" href={exercise.gameUrl} target="_blank" rel="noreferrer">
          {t("gameOnChesscom")}
        </a>
      </div>

      <p className="prompt">{promptText}</p>
      {exercise.tier === "pool" && <p className="muted small">{t("poolHint")}</p>}
      {phase === "feedback" && (
        <p className="muted small">
          {t("inGameYouPlayed", {
            move: formatMoveForDisplay(exercise.playedMoveSan, locale),
          })}
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
              {t("yourMove")}: <strong>{formatMoveForDisplay(chosenSan, locale)}</strong>
            </p>
          )}
        </div>

        <div className="card flow-panel" data-testid="train-flow">
          {phase === "cct" && (
            <>
              <h2>{t("cctTitle")}</h2>
              <Field
                label={t("checksLabel")}
                value={cct.checksConsidered}
                onChange={(v) => setCct((c) => ({ ...c, checksConsidered: v }))}
              />
              <Field
                label={t("capturesLabel")}
                value={cct.capturesConsidered}
                onChange={(v) => setCct((c) => ({ ...c, capturesConsidered: v }))}
              />
              <Field
                label={t("threatsLabel")}
                value={cct.threatsConsidered}
                onChange={(v) => setCct((c) => ({ ...c, threatsConsidered: v }))}
              />
              <Field
                label={t("firstCandidateLabel")}
                value={cct.firstCandidate}
                onChange={(v) => setCct((c) => ({ ...c, firstCandidate: v }))}
              />
              <Field
                label={t("opponentReplyLabel")}
                value={cct.opponentForcedResponse}
                onChange={(v) => setCct((c) => ({ ...c, opponentForcedResponse: v }))}
              />
              <button
                type="button"
                className="btn primary"
                disabled={!canAdvanceFromCct}
                onClick={() => setPhase("move")}
              >
                {t("continueBoard")}
              </button>
            </>
          )}

          {phase === "move" && (
            <>
              <h2>{t("yourMoveTitle")}</h2>
              <p>{t("yourMoveHint")}</p>
              <input
                className="input"
                placeholder={t("movePlaceholder")}
                value={chosenSan}
                onChange={(e) => setChosenSan(e.target.value)}
              />
              <button
                type="button"
                className="btn"
                disabled={!chosenSan.trim()}
                onClick={() => setPhase("reason")}
              >
                {t("confirmTypedMove")}
              </button>
            </>
          )}

          {phase === "reason" && (
            <>
              <h2>{t("reasonTitle")}</h2>
              <textarea
                className="textarea"
                rows={4}
                placeholder={t("reasonPlaceholder")}
                value={reasoning}
                onChange={(e) => setReasoning(e.target.value)}
              />
              <button
                type="button"
                className="btn primary"
                disabled={reasoning.trim().length < 8}
                onClick={() => setPhase("confirm")}
              >
                {t("reviewBeforeSend")}
              </button>
            </>
          )}

          {phase === "confirm" && (
            <>
              <h2>{t("confirmTitle")}</h2>
              <ul className="confirm-list">
                <li>
                  {t("confirmMove")}: {formatMoveForDisplay(chosenSan, locale)}
                </li>
                <li>
                  {t("confirmReasoning")}: {reasoning}
                </li>
              </ul>
              <p className="muted small">{t("noSolutionYet")}</p>
              <button
                type="button"
                className="btn primary"
                data-testid="train-submit"
                disabled={submitting}
                onClick={() => void submit()}
              >
                {submitting ? t("submitting") : t("submit")}
              </button>
              <button type="button" className="btn ghost" onClick={() => setPhase("move")}>
                {t("changeMove")}
              </button>
            </>
          )}

          {phase === "feedback" && lastAttempt && (
            <FeedbackPanel
              exercise={exercise}
              attempt={lastAttempt}
              locale={locale}
              onRetry={() => {
                setPhase("cct");
                setCct(emptyCct());
                setChosenSan("");
                setReasoning("");
                setLastAttempt(null);
              }}
              onNext={() => resetForExercise(nextSel.exercise.id)}
              nextReason={formatSelectionReasons(nextSel.reasons, locale)}
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
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function FeedbackPanel({
  exercise,
  attempt,
  locale,
  onRetry,
  onNext,
  nextReason,
}: {
  exercise: ReturnType<typeof getExercise>;
  attempt: AttemptRecord;
  locale: SupportedLocale;
  onRetry: () => void;
  onNext: () => void;
  nextReason: string;
}) {
  const { t } = useTranslation(["training", "common", "technical"]);
  if (!exercise) return null;

  const status = attempt.evaluationStatus;
  const rivalReply =
    attempt.opponentReplySan ?? opponentStrongestReply(exercise, attempt.opponentReplySan);

  const altLine = exercise.referenceLineSan
    ? `${formatMoveForDisplay(exercise.solutionSan, locale)} · ${exercise.referenceLineSan
        .split(/\s+/)
        .map((move) => formatMoveForDisplay(move, locale))
        .join(" ")}`
    : formatMoveForDisplay(exercise.solutionSan, locale);

  return (
    <div className="feedback" data-testid="train-feedback">
      <h2>{t("feedbackTitle")}</h2>
      <dl className="feedback-dl">
        <dt>{t("yourMove")}</dt>
        <dd>{formatMoveForDisplay(attempt.chosenMoveSan, locale)}</dd>
        <dt>{t("classification")}</dt>
        <dd className={`result result-${status}`} data-testid="train-feedback-classification">
          {formatEvaluationStatus(status, locale)} — {formatEvaluationSummary(status, locale)}
        </dd>
        <dt>{t("opponentStrongest")}</dt>
        <dd className="mono">
          {rivalReply ? formatMoveForDisplay(rivalReply, locale) : t("opponentUnavailable")}
        </dd>
        <dt>{t("observableReason")}</dt>
        <dd>
          {formatObservableReason(
            attempt.observableReason ?? exercise.observableReason ?? null,
            locale,
          )}
        </dd>
        <dt>{t("recommendedAlt")}</dt>
        <dd className="mono">{altLine}</dd>
        <dt>{t("playedInGame")}</dt>
        <dd className="mono">{formatMoveForDisplay(exercise.playedMoveSan, locale)}</dd>
      </dl>
      <p className="muted small">
        <strong>{t("reflection")}:</strong>{" "}
        {attempt.reflectionPrompt ?? buildReflectionPrompt(exercise, status, t)}
      </p>
      {status === "unverified" && <p className="warn small">{t("unverifiedWarn")}</p>}
      <TechnicalDetails>
        <TechnicalRow label={t("technical:criterion")} value={attempt.evalCriterionVersion} />
        <TechnicalRow
          label={t("technical:evaluation")}
          value={
            attempt.evalVerified ? t("technical:evalVerified") : t("technical:evalUnverified")
          }
        />
      </TechnicalDetails>
      <div className="actions">
        {(status === "incorrect" || status === "playable_inexact" || status === "unverified") && (
          <button type="button" className="btn" onClick={onRetry}>
            {t("retry")}
          </button>
        )}
        <button type="button" className="btn primary" onClick={onNext}>
          {t("nextAdaptive")}
        </button>
      </div>
      <p className="reason small">
        {t("nextSelection")}: {nextReason}
      </p>
    </div>
  );
}
