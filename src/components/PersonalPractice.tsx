import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { fetchPersonalExercise, requestPatternHint, revealPatternSolution, startPersonalPractice, submitPersonalMove, type PersonalExercise, type PersonalFeedback } from "../api/patternsClient";
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
    void action(async () => { const result = await submitPersonalMove(exercise.id, `${from}${to}${promotion ?? ""}`); setFeedback(result); setFen(result.resultingFen); }); return true;
  }
  if (!exercise) return <section className="card"><p>{error ? t(`errors.${error}`) : t("loading")}</p><Link to="/patterns">{t("back")}</Link></section>;
  return <div className="page" data-testid="personal-practice"><h1>{t(`catalog.${exercise.patternId}.title`)}</h1><p>{t(`catalog.${exercise.patternId}.goal`)}</p>
    <Link to={`/games/${exercise.gameId}`}>{t("source", { move: exercise.moveNumber })}</Link>
    <div className="train-grid"><section className="card board-panel"><PlayBoard fen={fen} orientation={exercise.color} disabled={busy || !!feedback || demo || exercise.completed} onMove={play} /></section>
      <aside className="card" aria-live="polite">
        {!feedback && !demo && <p>{busy ? t("checking") : t("playNow")}</p>}
        {feedback && <div data-testid="personal-feedback"><h2>{formatEvaluationStatus(feedback.status, i18n.language as SupportedLocale)}</h2><p>{feedback.chosenSan}{feedback.replySan ? ` → ${feedback.replySan}` : ""}</p><p>{t("feedbackNote")}</p>{feedback.assisted && <p>{t("assisted")}</p>}</div>}
        {hint && <p className="callout">{t(`catalog.${exercise.patternId}.hint`)}</p>}
        {demo && <p className="callout">{t("demonstration")}</p>}
        {error && <p role="alert">{t(`errors.${error}`, { defaultValue: t("errors.connection") })}</p>}
        <div className="actions">
          {!feedback && !demo && <button type="button" className="btn" disabled={busy} onClick={() => void action(async () => { await requestPatternHint(exercise.id); setHint(true); })}>{t("hint")}</button>}
          <button type="button" className="btn" disabled={busy} onClick={() => void action(async () => { const result = await revealPatternSolution(exercise.id); setFen(result.referenceFen); setDemo(true); })}>{t("showIdea")}</button>
          {(feedback || demo) && <button type="button" className="btn" disabled={busy} onClick={() => void action(async () => { const next = await startPersonalPractice(exercise.patternId, exercise.positionId); navigate(`/practice/${next.id}`); })}>{t("retry")}</button>}
          <button type="button" className="btn" disabled={busy} onClick={() => void action(async () => { const next = await startPersonalPractice(exercise.patternId); navigate(`/practice/${next.id}`); })}>{t("next")}</button>
          <Link className="btn primary" onClick={e => { if (busy) e.preventDefault(); }} to={`/sparring?topic=personal&practice=${exercise.id}`}>{t("continue")}</Link>
        </div>
      </aside></div>
  </div>;
}
