import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { advancePersonalPractice, fetchPersonalExercise, requestPatternHint, retryPersonalDecision, revealPatternSolution, startPersonalHoldout, startPersonalPractice, submitPersonalMove, type PersonalExercise, type PersonalFeedback } from "../api/patternsClient";
import { PlayBoard } from "./PlayBoard";
import { formatEvaluationStatus } from "../i18n/presenters";
import type { SupportedLocale } from "../i18n/types";
export function PersonalPractice() {
  const { exerciseId = "" } = useParams(); const navigate = useNavigate(); const { t, i18n } = useTranslation("patterns");
  const [exercise, setExercise] = useState<PersonalExercise | null>(null), [fen, setFen] = useState(""), [feedback, setFeedback] = useState<PersonalFeedback | null>(null);
  const [hint, setHint] = useState(false), [demo, setDemo] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const lock = useRef(false);
  useEffect(() => { let live = true; setExercise(null); setFeedback(null); setHint(false); setDemo(false); setError("");
    void fetchPersonalExercise(exerciseId).then(ex => { if (live) { setExercise(ex); setFen(ex.fen); setFeedback(ex.feedback ?? null); } }).catch(() => { if (live) setError("exercise_unavailable"); });
    return () => { live = false; };
  }, [exerciseId]);
  async function action(run: () => Promise<void>) { if (lock.current) return; lock.current = true; setBusy(true); setError(""); try { await run(); } catch (err) { setError(err instanceof Error ? err.message : "connection"); } finally { lock.current = false; setBusy(false); } }
  function play(from: string, to: string, promotion?: string) {
    if (!exercise || lock.current || feedback || demo || exercise.completed) return false;
    void action(async () => { const result = await submitPersonalMove(exercise.id, `${from}${to}${promotion ?? ""}`); setFeedback(result); setFen(result.resultingFen);
      setExercise(current => current ? { ...current, fen: result.resultingFen, decisionCount: result.decisionNumber,
        status: result.trainingStatus, awaitingNext: result.canContinue, canStartHoldout: result.trainingStatus === "ready_for_holdout",
        completed: result.trainingStatus === "completed", feedback: result } : current); }); return true;
  }
  if (!exercise) return <section className="card"><p>{error ? t(`errors.${error}`) : t("loading")}</p><Link to="/patterns">{t("back")}</Link></section>;
  const holdout = exercise.role === "holdout";
  return <div className="page" data-testid="personal-practice">
    <p className="eyebrow">{holdout ? t("path.holdoutEyebrow") : t("path.guidedEyebrow")}</p>
    <h1>{holdout ? t("path.holdoutTitle") : t(`catalog.${exercise.patternId}.title`)}</h1>
    <p>{holdout ? t("path.holdoutGoal") : t(`catalog.${exercise.patternId}.goal`)}</p>
    {!holdout && <section className="callout" data-testid="pattern-teaching"><strong>{t("path.ruleLabel")}</strong><p>{t(`catalog.${exercise.patternId}.rule`)}</p><p className="muted">{t(`catalog.${exercise.patternId}.contrast`)}</p></section>}
    <p className="muted">{t("path.progress", { current: feedback ? exercise.decisionCount : Math.min(exercise.decisionCount + 1, exercise.targetDecisions), total: exercise.targetDecisions })}</p>
    {(!holdout || feedback) && <Link to={`/games/${exercise.gameId}`}>{t("source", { move: exercise.moveNumber })}</Link>}
    <div className="train-grid"><section className="card board-panel"><PlayBoard fen={fen} orientation={exercise.color} disabled={busy || !!feedback || demo || exercise.completed} onMove={play} /></section>
      <aside className="card" aria-live="polite">
        {!feedback && !demo && <p>{busy ? t("checking") : holdout ? t("path.holdoutPrompt") : t("playNow")}</p>}
        {feedback && <div data-testid="personal-feedback"><h2>{formatEvaluationStatus(feedback.status, i18n.language as SupportedLocale)}</h2><p>{feedback.chosenSan}{feedback.replySan ? ` → ${feedback.replySan}` : ""}</p><p>{t("feedbackNote")}</p>{!holdout && feedback.referenceSan && feedback.status !== "verified_best" && <p>{t(feedback.status === "verified_acceptable" ? "path.acceptableReference" : "path.compareReference", { move: feedback.referenceSan })}</p>}{feedback.assisted && <p>{t("assisted")}</p>}{holdout && <p>{feedback.independent ? t("path.holdoutRecorded") : t("path.holdoutAssisted")}</p>}</div>}
        {hint && <p className="callout">{t(`catalog.${exercise.patternId}.hint`)}</p>}
        {demo && <p className="callout">{t("demonstration")}</p>}
        {error && <p role="alert">{t(`errors.${error}`, { defaultValue: t("errors.connection") })}</p>}
        <div className="actions">
          {!holdout && !feedback && !demo && <button type="button" className="btn" disabled={busy} onClick={() => void action(async () => { await requestPatternHint(exercise.id); setHint(true); })}>{t("hint")}</button>}
          {!holdout && exercise.decisionCount === 0 && <button type="button" className="btn" disabled={busy} onClick={() => void action(async () => { const result = await revealPatternSolution(exercise.id); setFen(result.referenceFen); setDemo(true); })}>{t("showIdea")}</button>}
          {feedback?.canContinue && <button type="button" className="btn primary" data-testid="practice-next-decision" disabled={busy} onClick={() => void action(async () => { const next = await advancePersonalPractice(exercise.id); setExercise(next); setFen(next.fen); setFeedback(null); setHint(false); setDemo(false); })}>{t("path.nextDecision", { current: feedback.decisionNumber + 1, total: feedback.targetDecisions })}</button>}
          {!holdout && feedback && <button type="button" className="btn" data-testid="practice-retry-decision" disabled={busy} onClick={() => void action(async () => { const next = await retryPersonalDecision(exercise.id); setExercise(next); setFen(next.fen); setFeedback(null); setHint(false); setDemo(false); })}>{t("path.retryDecision")}</button>}
          {exercise.canStartHoldout && <button type="button" className="btn primary" data-testid="practice-start-holdout" disabled={busy} onClick={() => void action(async () => { const next = await startPersonalHoldout(exercise.id); navigate(`/practice/${next.id}`); })}>{t("path.startHoldout")}</button>}
          {holdout && exercise.completed && <Link className="btn primary" to="/coach">{t("path.finish")}</Link>}
          {!holdout && (demo || (feedback && !feedback.canContinue && !exercise.canStartHoldout)) && <button type="button" className="btn" disabled={busy} onClick={() => void action(async () => { const next = await startPersonalPractice(exercise.patternId, exercise.positionId); navigate(`/practice/${next.id}`); })}>{t("retry")}</button>}
          {exercise.completed && !holdout && <Link className="btn" onClick={e => { if (busy) e.preventDefault(); }} to={`/sparring?topic=personal&practice=${exercise.id}`}>{t("continue")}</Link>}
        </div>
      </aside></div>
  </div>;
}
