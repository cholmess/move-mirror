import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Chess } from "chess.js";
import { useTranslation } from "react-i18next";
import { useApp } from "../context/AppContext";
import { getExercise } from "../data/exercises";
import { selectNextExercise } from "../domain/adaptive";
import type { AttemptRecord } from "../types/learning";
import type { SupportedLocale } from "../i18n/types";
import { formatEvaluationStatus, formatObservableReason, formatSideToMove } from "../i18n/presenters";
import { PlayBoard } from "./PlayBoard";

export function DirectPractice() {
  const { t, i18n } = useTranslation("practice");
  const { state, submitExerciseAttempt } = useApp();
  const [id, setId] = useState(() => getExercise(state.progress.currentExerciseId ?? "")?.id ?? selectNextExercise(state).exercise.id);
  const exercise = getExercise(id)!;
  const [fen, setFen] = useState(exercise.fen);
  const [attempt, setAttempt] = useState<AttemptRecord | null>(null);
  const [hint, setHint] = useState(false);
  const [demo, setDemo] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const started = useRef(Date.now());
  function reset(nextId = id) {
    const next = getExercise(nextId)!;
    setId(nextId); setFen(next.fen); setAttempt(null); setHint(false); setDemo(false); setError(false); started.current = Date.now();
  }
  function play(from: string, to: string, promotion?: string) {
    if (lock.current || attempt || demo) return false;
    const chess = new Chess(exercise.fen);
    let move;
    try { move = chess.move({ from, to, promotion }); } catch { return false; }
    if (!move) return false;
    lock.current = true; setBusy(true); setError(false); setFen(chess.fen());
    void submitExerciseAttempt({ exerciseId: id, practiceMode: "direct", assisted: hint,
      cct: { checksConsidered: "", capturesConsidered: "", threatsConsidered: "", firstCandidate: move.san, opponentForcedResponse: "" },
      chosenMoveSan: move.san, reasoning: "", timeUsedSeconds: Math.round((Date.now() - started.current) / 1000),
    }).then(result => { if (!result) throw new Error("missing_attempt"); setAttempt(result); })
      .catch(() => { setError(true); setFen(exercise.fen); })
      .finally(() => { lock.current = false; setBusy(false); });
    return true;
  }
  function showIdea() {
    const chess = new Chess(exercise.fen);
    try { chess.move(exercise.solutionSan); setFen(chess.fen()); setDemo(true); setHint(true); } catch { setError(true); }
  }
  function showReply() {
    if (!attempt?.opponentReplySan) return;
    const chess = new Chess(exercise.fen);
    try { chess.move(attempt.chosenMoveSan); chess.move(attempt.opponentReplySan); setFen(chess.fen()); } catch { setError(true); }
  }
  return <div className="page" data-testid="direct-practice"><h1>{t("directTitle")}</h1><p>{formatSideToMove(exercise.sideToMove, i18n.language as SupportedLocale)} · {t("source")} · <a href={exercise.gameUrl} target="_blank" rel="noreferrer">Chess.com</a></p>
    <div className="train-grid"><section className="card board-panel"><PlayBoard fen={fen} orientation={exercise.sideToMove === "w" ? "white" : "black"} disabled={busy || !!attempt || demo} onMove={play} /></section>
    <aside className="card" aria-live="polite">
      {!attempt && !demo && <p>{busy ? t("busy") : t("yourTurn")}</p>}
      {error && <p role="alert">{t("error")}</p>}
      {attempt && <div data-testid="direct-feedback"><h2>{formatEvaluationStatus(attempt.evaluationStatus, i18n.language as SupportedLocale)}</h2>
        <p>{t("originalMistake")} {formatObservableReason(attempt.observableReason, i18n.language as SupportedLocale)}</p>
        {attempt.opponentReplySan && <button className="btn" type="button" onClick={showReply}>{t("response")}</button>}
      </div>}
      {hint && !demo && <p className="callout">{t("hintBody")}</p>}
      {demo && <p className="callout">{t("demonstration")}</p>}
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
