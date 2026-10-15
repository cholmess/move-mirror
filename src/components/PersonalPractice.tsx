import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  advancePersonalPractice,
  advancePersonalSlot,
  fetchPersonalExercise,
  requestPatternHint,
  retryPersonalDecision,
  revealPatternSolution,
  startPersonalHoldout,
  startPersonalPractice,
  submitPersonalMove,
  type NextActivity,
  type PersonalExercise,
  type PersonalFeedback,
  type SessionResult,
} from "../api/patternsClient";
import { PlayBoard } from "./PlayBoard";
import { formatEvaluationStatus } from "../i18n/presenters";
import type { SupportedLocale } from "../i18n/types";

function outcomeHeadline(outcomeKey: string) {
  const map: Record<string, string> = {
    holdout_independent_correct: "learning:outcome.holdoutCorrect.headline",
    learned_with_help: "learning:outcome.learnedWithHelp.headline",
    needs_reinforcement: "learning:outcome.needsReinforcement.headline",
    not_verifiable: "learning:outcome.notVerifiable.headline",
  };
  return map[outcomeKey] ?? "learning:outcome.incomplete.headline";
}

function outcomeDetail(outcomeKey: string) {
  const map: Record<string, string> = {
    holdout_independent_correct: "learning:outcome.holdoutCorrect.detail",
    learned_with_help: "learning:outcome.learnedWithHelp.detail",
    needs_reinforcement: "learning:outcome.needsReinforcement.detail",
    not_verifiable: "learning:outcome.notVerifiable.detail",
  };
  return map[outcomeKey] ?? "learning:outcome.incomplete.detail";
}

function SessionSummary({ result, nextActivity, patternId }: { result: SessionResult; nextActivity?: NextActivity; patternId: string }) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation(["learning", "patterns", "coach"]);
  const patternTitle = t(`patterns:catalog.${patternId}.title`);
  const minutes = result.durationMs ? Math.max(1, Math.round(result.durationMs / 60000)) : 0;
  return (
    <section className="callout" data-testid="practice-session-summary">
      <h2>{t("learning:session.title")}</h2>
      <p><strong>{t(outcomeHeadline(result.outcomeKey))}</strong></p>
      <p className="muted">{t(outcomeDetail(result.outcomeKey))}</p>
      {result.evidenceReasonKey && <p className="muted">{t(`learning:${result.evidenceReasonKey}`)}</p>}
      {result.domain.nextReviewAt && (
        <p data-testid="practice-next-review">
          {t("learning:session.nextReview", { date: new Date(result.domain.nextReviewAt).toLocaleDateString(i18n.language) })}
        </p>
      )}
      {minutes > 0 && <p>{t("learning:session.duration", { minutes })}</p>}
      {nextActivity && (
        <div data-testid="practice-next-activity">
          <h3>{t("learning:session.nextTitle")}</h3>
          {nextActivity.reasons.map((reason) => (
            <p key={reason.key}>
              {t(`learning:${reason.key}`, {
                ...reason.params,
                patternId: reason.params?.patternId ? t(`patterns:catalog.${reason.params.patternId}.title`) : patternTitle,
              })}
            </p>
          ))}
          {nextActivity.kind === "pattern" && nextActivity.patternId && (
            <button type="button" className="btn primary" data-testid="practice-next-start" onClick={() => {
              void startPersonalPractice(nextActivity.patternId!).then((ex) => { navigate(`/practice/${ex.id}`); });
            }}>
              {t("patterns:practice")}
            </button>
          )}
          {nextActivity.kind === "finish" && (
            <Link className="btn primary" to="/coach">{t("learning:session.finish")}</Link>
          )}
        </div>
      )}
    </section>
  );
}

export function PersonalPractice() {
  const { exerciseId = "" } = useParams();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation(["patterns", "learning"]);
  const [exercise, setExercise] = useState<PersonalExercise | null>(null);
  const [fen, setFen] = useState("");
  const [feedback, setFeedback] = useState<PersonalFeedback | null>(null);
  const [hint, setHint] = useState(false);
  const [demo, setDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  useEffect(() => {
    let live = true;
    setExercise(null);
    setFeedback(null);
    setHint(false);
    setDemo(false);
    setError("");
    void fetchPersonalExercise(exerciseId)
      .then((ex) => {
        if (live) {
          setExercise(ex);
          setFen(ex.fen);
          setFeedback(ex.feedback ?? null);
        }
      })
      .catch(() => { if (live) setError("exercise_unavailable"); });
    return () => { live = false; };
  }, [exerciseId]);
  async function action(run: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try { await run(); } catch (err) { setError(err instanceof Error ? err.message : "connection"); }
    finally { lock.current = false; setBusy(false); }
  }
  function play(from: string, to: string, promotion?: string) {
    if (!exercise || lock.current || feedback || demo || exercise.completed) return false;
    void action(async () => {
      const result = await submitPersonalMove(exercise.id, `${from}${to}${promotion ?? ""}`);
      setFeedback(result);
      setFen(result.resultingFen);
      setExercise((current) => current ? {
        ...current,
        fen: result.resultingFen,
        decisionCount: result.decisionNumber,
        status: result.trainingStatus,
        awaitingNext: result.canContinue,
        canStartHoldout: result.trainingStatus === "ready_for_holdout",
        canAdvanceSlot: result.trainingStatus === "ready_for_next_slot",
        completed: result.trainingStatus === "completed",
        feedback: result,
      } : current);
    });
    return true;
  }
  if (!exercise) {
    return <section className="card"><p>{error ? t(`errors.${error}`) : t("loading")}</p><Link to="/patterns">{t("back")}</Link></section>;
  }
  const holdout = exercise.role === "holdout";
  const sessionProgress = exercise.sessionPositionTotal
    ? t("learning:practice.sessionProgress", { current: exercise.sessionPositionCurrent ?? 1, total: exercise.sessionPositionTotal })
    : t("path.progress", { current: feedback ? exercise.decisionCount : Math.min(exercise.decisionCount + 1, exercise.targetDecisions), total: exercise.targetDecisions });
  const sessionResult = feedback?.sessionResult;
  return (
    <div className="page" data-testid="personal-practice">
      <p className="eyebrow">{holdout ? t("path.holdoutEyebrow") : t("path.guidedEyebrow")}</p>
      <h1>{holdout ? t("path.holdoutTitle") : t(`catalog.${exercise.patternId}.title`)}</h1>
      <p>{holdout ? t("path.holdoutGoal") : t(`catalog.${exercise.patternId}.goal`)}</p>
      {!holdout && (
        <section className="callout" data-testid="pattern-teaching">
          <strong>{t("path.ruleLabel")}</strong>
          <p>{t(`catalog.${exercise.patternId}.rule`)}</p>
          <p className="muted">{t(`catalog.${exercise.patternId}.contrast`)}</p>
        </section>
      )}
      {exercise.sessionShortfall && !holdout && (
        <p className="muted" data-testid="session-shortfall">{t("learning:session.shortfall", { count: exercise.sessionPositionTotal ?? 0 })}</p>
      )}
      <p className="muted">{sessionProgress}</p>
      {(!holdout || feedback) && <Link to={`/games/${exercise.gameId}`}>{t("source", { move: exercise.moveNumber })}</Link>}
      <div className="train-grid">
        <section className="card board-panel"><PlayBoard fen={fen} orientation={exercise.color} disabled={busy || !!feedback || demo || exercise.completed} onMove={play} /></section>
        <aside className="card" aria-live="polite">
          {!feedback && !demo && <p>{busy ? t("checking") : holdout ? t("path.holdoutPrompt") : t("playNow")}</p>}
          {feedback && !sessionResult && (
            <div data-testid="personal-feedback">
              <h2>{formatEvaluationStatus(feedback.status, i18n.language as SupportedLocale)}</h2>
              <p>{feedback.chosenSan}{feedback.replySan ? ` → ${feedback.replySan}` : ""}</p>
              <p>{t("feedbackNote")}</p>
              {!holdout && feedback.referenceSan && feedback.status !== "verified_best" && (
                <p>{t(feedback.status === "verified_acceptable" ? "path.acceptableReference" : "path.compareReference", { move: feedback.referenceSan })}</p>
              )}
              {feedback.assisted && <p>{t("assisted")}</p>}
              {holdout && <p>{feedback.independent ? t("path.holdoutRecorded") : t("path.holdoutAssisted")}</p>}
            </div>
          )}
          {sessionResult && <SessionSummary result={sessionResult} nextActivity={feedback?.nextActivity} patternId={exercise.patternId} />}
          {hint && <p className="callout">{t(`catalog.${exercise.patternId}.hint`)}</p>}
          {demo && <p className="callout">{t("demonstration")}</p>}
          {error && <p role="alert">{t(`errors.${error}`, { defaultValue: t("errors.connection") })}</p>}
          <div className="actions">
            {!holdout && !feedback && !demo && (
              <button type="button" className="btn" disabled={busy} onClick={() => void action(async () => { await requestPatternHint(exercise.id); setHint(true); })}>{t("hint")}</button>
            )}
            {!holdout && exercise.decisionCount === 0 && (
              <button type="button" className="btn" disabled={busy} onClick={() => void action(async () => { const result = await revealPatternSolution(exercise.id); setFen(result.referenceFen); setDemo(true); })}>{t("showIdea")}</button>
            )}
            {feedback?.canContinue && (
              <button type="button" className="btn primary" data-testid="practice-next-decision" disabled={busy} onClick={() => void action(async () => {
                const next = await advancePersonalPractice(exercise.id);
                setExercise(next); setFen(next.fen); setFeedback(null); setHint(false); setDemo(false);
              })}>{t("path.nextDecision", { current: feedback.decisionNumber + 1, total: feedback.targetDecisions })}</button>
            )}
            {exercise.canAdvanceSlot && feedback && (
              <button type="button" className="btn primary" data-testid="practice-next-slot" disabled={busy} onClick={() => void action(async () => {
                const next = await advancePersonalSlot(exercise.id);
                navigate(`/practice/${next.id}`);
              })}>{t("learning:practice.nextPosition", { current: (exercise.slotIndex ?? 0) + 2, total: exercise.sessionPositionTotal ?? 1 })}</button>
            )}
            {!holdout && feedback && (
              <button type="button" className="btn" data-testid="practice-retry-decision" disabled={busy} onClick={() => void action(async () => {
                const next = await retryPersonalDecision(exercise.id);
                setExercise(next); setFen(next.fen); setFeedback(null); setHint(false); setDemo(false);
              })}>{t("path.retryDecision")}</button>
            )}
            {exercise.canStartHoldout && (
              <button type="button" className="btn primary" data-testid="practice-start-holdout" disabled={busy} onClick={() => void action(async () => {
                const next = await startPersonalHoldout(exercise.id);
                navigate(`/practice/${next.id}`);
              })}>{t("path.startHoldout")}</button>
            )}
            {holdout && exercise.completed && !sessionResult && (
              <Link className="btn primary" to="/coach">{t("path.finish")}</Link>
            )}
            {!holdout && (demo || (feedback && !feedback.canContinue && !exercise.canStartHoldout && !exercise.canAdvanceSlot)) && (
              <button type="button" className="btn" disabled={busy} onClick={() => void action(async () => {
                const next = await startPersonalPractice(exercise.patternId, exercise.positionId);
                navigate(`/practice/${next.id}`);
              })}>{t("retry")}</button>
            )}
            {exercise.completed && !holdout && (
              <Link className="btn" onClick={(e) => { if (busy) e.preventDefault(); }} to={`/sparring?topic=personal&practice=${exercise.id}`}>{t("continue")}</Link>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
