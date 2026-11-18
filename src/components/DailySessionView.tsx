import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PlayBoard } from "./PlayBoard";
import { DrillExplanation } from "./DrillExplanation";
import {
  explainDrill, fetchDailySession, finishDailySession, nextDrill, revealDrill, submitDrillMove,
  type DailySession, type DrillItem,
} from "../api/dailyClient";

function useClock(item: DrillItem | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!item || item.status !== "active") return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [item?.cardId, item?.status]);
  if (!item) return { remaining: 0, ratio: 0 };
  const elapsed = now - Date.parse(item.servedAt);
  return { remaining: Math.max(0, Math.ceil((item.limitMs - elapsed) / 1000)), ratio: Math.min(1, elapsed / item.limitMs) };
}

export function DailySessionView() {
  const { sessionId = "" } = useParams();
  const { t, i18n } = useTranslation(["daily", "patterns"]);
  const navigate = useNavigate();
  const [session, setSession] = useState<DailySession | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { fetchDailySession(sessionId).then(setSession).catch(e => setError(e.message)); }, [sessionId]);
  const item = session?.current ?? null;
  const clock = useClock(item);

  async function act(fn: () => Promise<{ item: DrillItem; status?: string; replySan?: string | null }>) {
    setBusy(true); setError(null);
    try {
      const result = await fn();
      setSession(s => (s ? { ...s, current: result.item } : s));
      setNotice(result.status === "continue" ? t("session.continue", { move: result.replySan ?? "" }) : null);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function advance() {
    setBusy(true); setNotice(null);
    try { setSession(await nextDrill(sessionId)); } finally { setBusy(false); }
  }

  if (error && !session) return <div className="page"><p className="error">{error}</p><Link to="/daily">{t("session.backHome")}</Link></div>;
  if (!session) return <div className="page"><p className="muted">{t("session.loading")}</p></div>;
  if (session.finishedAt || !item) {
    const minutes = Math.max(1, Math.round(((session.finishedAt ? Date.parse(session.finishedAt) : Date.now()) - Date.parse(session.startedAt)) / 60000));
    return <div className="page" data-testid="daily-summary"><h1>{t("session.summaryTitle")}</h1>
      <p className="lede">{session.total ? t("session.summary", { correct: session.correct, answered: session.answered, minutes }) : t("session.empty")}</p>
      <p className="muted">{t("session.summaryHint")}</p>
      <Link className="btn primary" to="/daily">{t("session.backHome")}</Link></div>;
  }

  const fb = item.feedback;
  const prompt = item.kind === "refutation"
    ? item.source === "own" ? t("session.refutationOwn", { n: item.moveNumber, move: item.candidateSan }) : t("session.refutationPrompt", { move: item.candidateSan })
    : item.source === "own" ? t("session.findPromptOwn", { n: item.moveNumber }) : t("session.findPrompt", { color: t(`colors.${item.solverColor}`) });
  const days = fb?.intervalDays ?? 0;

  return <div className="page daily-session" data-testid="daily-session">
    <div className="daily-topbar">
      <span className="mono" data-testid="daily-progress">{t("session.progress", { current: session.index + 1, total: session.total })}</span>
      <span className="badge">{item.source === "own" ? t("session.sourceOwn") : t("session.sourcePuzzle", { rating: item.rating })}</span>
      {item.patternId && <span className="badge badge-medium">{t(`patterns:catalog.${item.patternId}.title`)}</span>}
      {item.status === "active" && <span className={`mono daily-clock${clock.ratio >= 1 ? " late" : ""}`} aria-label={t("session.clock", { seconds: clock.remaining })}>{t("session.clock", { seconds: clock.remaining })}</span>}
    </div>
    <div className="daily-timebar" aria-hidden="true"><span style={{ width: `${(item.status === "active" ? clock.ratio : 1) * 100}%` }} /></div>
    {session.overTime && <p className="muted small">{t("session.overTime")}</p>}
    <div className="daily-grid">
      <div className="daily-board">
        <PlayBoard fen={item.status === "active" ? item.fen : fb?.startFen ?? item.fen} orientation={item.orientation} disabled={busy || item.status !== "active"}
          highlight={item.status === "active" ? item.lastMove ?? undefined : undefined}
          onMove={(from, to, promotion) => { void act(() => submitDrillMove(sessionId, `${from}${to}${promotion ?? ""}`)); return true; }} />
      </div>
      <div className="daily-panel">
        <p className="daily-prompt" data-testid="daily-prompt">{prompt}</p>
        {item.kind === "refutation" && item.status === "active" && <p className="muted small">{t("session.refutationHint")}</p>}
        {notice && <p className="status status-completed" aria-live="polite">{notice}</p>}
        {error && <p className="error">{error}</p>}
        {item.status === "active" && <button type="button" className="btn ghost" disabled={busy} onClick={() => void act(() => revealDrill(sessionId))}>{t("session.giveUp")}</button>}
        {fb && <div className="daily-feedback" data-testid="daily-feedback" aria-live="polite">
          <p className={fb.correct ? "status status-completed" : "status status-failed"}>
            {fb.unverified ? t("session.unverified") : fb.correct ? (fb.alternative ? t("session.correctAlt") : t("session.correct")) : fb.revealed ? t("session.revealed") : t("session.wrong")}
            {fb.grade && <> · {t(`session.grade.${fb.grade}`)}</>}
          </p>
          {fb.playedSan && !fb.correct && <p>{t("session.yourMove", { move: fb.playedSan })}</p>}
          <p className="mono" data-testid="daily-solution">{t("session.solution", { line: fb.solutionSan.join(" ") })}</p>
          {fb.nextDue && <p className="muted small">{days < 1 ? t("session.nextDueToday") : t("session.nextDue", { count: days })}</p>}
          <DrillExplanation key={item.cardId} load={() => explainDrill(sessionId, item.index, i18n.language)} />
          {item.puzzleId && <p className="muted small">{t("session.puzzleCredit", { id: item.puzzleId })}</p>}
          <div className="btn-row">
            <button type="button" className="btn primary" disabled={busy} onClick={() => void advance()} data-testid="daily-next">{t("session.next")}</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => { void finishDailySession(sessionId).then(setSession); }}>{t("session.finish")}</button>
          </div>
        </div>}
      </div>
    </div>
    {item.status === "active" && <p className="small"><button type="button" className="btn ghost" onClick={() => { void finishDailySession(sessionId).then(() => navigate("/daily")); }}>{t("session.finish")}</button></p>}
  </div>;
}
