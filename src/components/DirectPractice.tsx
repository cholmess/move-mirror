import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Chess } from "chess.js";
import { useTranslation } from "react-i18next";
import { useApp } from "../context/AppContext";
import { getExercise } from "../data/exercises";
import { selectNextExercise } from "../domain/adaptive";
import type { AttemptRecord } from "../types/learning";
import type { SupportedLocale } from "../i18n/types";
import { formatEvaluationStatus, formatObservableReason, formatSideToMove } from "../i18n/presenters";
import { buildReferenceReplay, matchesReference } from "../domain/referenceReplay";
import { formatMoveForDisplay } from "../i18n/presenters";
import { PlayBoard } from "./PlayBoard";

export function DirectPractice() {
  const { t, i18n } = useTranslation("practice");
  const { state, submitExerciseAttempt } = useApp();
  const [params] = useSearchParams();
  const [id, setId] = useState(() => getExercise(params.get("exercise") ?? "")?.id ?? getExercise(state.progress.currentExerciseId ?? "")?.id ?? selectNextExercise(state).exercise.id);
  const exercise = getExercise(id)!;
  const [fen, setFen] = useState(exercise.fen);
  const [attempt, setAttempt] = useState<AttemptRecord | null>(null);
  const [hint, setHint] = useState(false);
  const [demo, setDemo] = useState(false);
  const [replayStep, setReplayStep] = useState(0);
  const replay = buildReferenceReplay(exercise);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const started = useRef(Date.now());
  function reset(nextId = id) {
    const next = getExercise(nextId)!;
    setId(nextId); setFen(next.fen); setAttempt(null); setHint(false); setDemo(false); setReplayStep(0); setError(false); started.current = Date.now();
  }
  function play(from: string, to: string, promotion?: string) {
    if (lock.current || attempt || demo) return false;
    const chess = new Chess(exercise.fen);
    let move;
    try { move = chess.move({ from, to, promotion }); } catch { return false; }
    if (!move) return false;
    void evaluateCandidate(move.san, chess.fen());
    return true;
  }
  async function evaluateCandidate(san: string, playedFen: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(false); setDemo(false); setFen(playedFen);
    try {
      const result = await submitExerciseAttempt({ exerciseId: id, practiceMode: "direct", assisted: hint,
        cct: { checksConsidered: "", capturesConsidered: "", threatsConsidered: "", firstCandidate: san, opponentForcedResponse: "" },
        chosenMoveSan: san, reasoning: "", timeUsedSeconds: Math.round((Date.now() - started.current) / 1000),
      });
      if (!result) throw new Error("missing_attempt");
      setAttempt(result);
    } catch { setError(true); }
    finally { lock.current = false; setBusy(false); }
  }
  function showIdea() {
    if (replay.frames.length < 2) { setError(true); return; }
    setReplayStep(1); setFen(replay.frames[1].fen); setDemo(true); setHint(true);
  }
  function stepReplay(step: number) {
    setReplayStep(step); setFen(replay.frames[step].fen);
  }

  function showReply() {
    if (!attempt?.opponentReplySan) return;
    const chess = new Chess(exercise.fen);
    try { chess.move(attempt.chosenMoveSan); chess.move(attempt.opponentReplySan); setFen(chess.fen()); } catch { setError(true); }
  }
  return <div className="page" data-testid="direct-practice"><h1>{t("directTitle")}</h1><p>{formatSideToMove(exercise.sideToMove, i18n.language as SupportedLocale)} · {t("source")} · <a href={exercise.gameUrl} target="_blank" rel="noreferrer">Chess.com</a></p>
    <div className="train-grid"><section className="card board-panel"><PlayBoard fen={fen} orientation={exercise.sideToMove === "w" ? "white" : "black"} disabled={busy || !!attempt || demo} onMove={play} highlight={demo && replay.frames[replayStep].from ? { from: replay.frames[replayStep].from!, to: replay.frames[replayStep].to! } : undefined} /></section>
    <aside className="card" aria-live="polite">
      {!attempt && !demo && <p>{busy ? t("busy") : t("yourTurn")}</p>}
      {error && <p role="alert">{t("error")}</p>}
      {attempt && <div data-testid="direct-feedback">{busy && <p role="status">{t("busy")}</p>}<h2>{attempt.evaluationStatus === "unverified" ? t(matchesReference(exercise, attempt.chosenMoveSan) ? "referenceMatch" : "verificationUnavailable") : formatEvaluationStatus(attempt.evaluationStatus, i18n.language as SupportedLocale)}</h2>
        <p>{t("played", { move: formatMoveForDisplay(attempt.chosenMoveSan, i18n.language as SupportedLocale) })}</p>
        {attempt.evaluationStatus === "unverified" && <><p>{t("notJudged")}</p><p role="status">{t(`verificationErrors.${attempt.evalError ?? "unknown"}`, { defaultValue: t("verificationErrors.unknown") })}</p>
          <button type="button" className="btn" disabled={busy} onClick={() => { const c = new Chess(exercise.fen); c.move(attempt.chosenMoveSan); void evaluateCandidate(attempt.chosenMoveSan, c.fen()); }}>{t("verifyAgain")}</button></>}
        {attempt.evaluationStatus !== "unverified" && <details><summary>{t("originalMistake")}</summary><p>{formatObservableReason(attempt.observableReason, i18n.language as SupportedLocale)}</p></details>}
        {attempt.opponentReplySan && <button className="btn" type="button" onClick={showReply}>{t("response")}</button>}
      </div>}
      {hint && !demo && <p className="callout">{t("hintBody")}</p>}
      {demo && <section className="callout" data-testid="reference-replay">
        <h3>{t("ideaTitle", { move: formatMoveForDisplay(exercise.solutionSan, i18n.language as SupportedLocale) })}</h3>
        <p>{t(`ideas.${replay.idea}`)}</p>
        <p>{t("replayStep", { current: replayStep, total: replay.frames.length - 1 })}{replay.frames[replayStep].san && ` · ${formatMoveForDisplay(replay.frames[replayStep].san!, i18n.language as SupportedLocale)}`}</p>
        <div className="btn-row"><button type="button" className="btn" disabled={replayStep === 0} onClick={() => stepReplay(replayStep - 1)}>{t("previousMove")}</button><button type="button" className="btn primary" disabled={replayStep === replay.frames.length - 1} onClick={() => stepReplay(replayStep + 1)}>{t("nextMove")}</button></div>
      </section>}
      <div className="actions">
        {!attempt && !demo && <button className="btn" disabled={busy} type="button" onClick={() => setHint(true)}>{t("hint")}</button>}
        <button className="btn" disabled={busy} type="button" onClick={showIdea}>{t("showIdea")}</button>
        {(attempt || demo) && <button className="btn" disabled={busy} type="button" onClick={() => { reset(); setHint(true); }}>{t("retry")}</button>}
        <button className="btn" disabled={busy} type="button" onClick={() => { const next = selectNextExercise(state, id).exercise; reset(next.id); }}>{t("next")}</button>
        <Link className="btn primary" aria-disabled={busy} onClick={e => { if (busy) e.preventDefault(); }} to={`/sparring?topic=own&exercise=${encodeURIComponent(id)}`}>{t("continue")}</Link>
      </div>
    </aside></div>
  </div>;
}
