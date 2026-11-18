import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Chess } from "chess.js";
import { PlayBoard } from "./PlayBoard";
import { DrillExplanation, FactsSummary } from "./DrillExplanation";
import {
  answerReviewMoment, explainReviewMoment, fetchGameReview, fetchReviewGames,
  type GameReview as GameReviewData, type ReviewGameRow,
} from "../api/dailyClient";

const CAUSES = ["not_seen", "seen_misjudged", "time_pressure", "no_plan", "other"];

export function ReviewList() {
  const { t, i18n } = useTranslation("daily");
  const [games, setGames] = useState<ReviewGameRow[] | null>(null);
  useEffect(() => { fetchReviewGames().then(r => setGames(r.games)).catch(() => setGames([])); }, []);
  return <div className="page" data-testid="review-list">
    <h1>{t("review.title")}</h1>
    <p className="lede">{t("review.lede")}</p>
    {games && !games.length && <p className="muted">{t("review.empty")} <Link to="/daily">{t("home.syncCta")}</Link></p>}
    <ul className="review-games">{(games ?? []).map(g => <li key={g.id} className="card review-game">
      <div>
        <strong>{t(`review.outcome.${g.outcome}`)}</strong> {g.opponent && <span>{t("review.vs", { name: g.opponent })}</span>}
        <div className="muted small">{new Date(g.startedAt).toLocaleDateString(i18n.language)} · {g.control}{g.rating ? ` · ${g.rating}` : ""}</div>
      </div>
      <div>
        {!g.analysed ? <span className="badge">{t("review.analysing")}</span>
          : !g.moments ? <span className="badge badge-high">{t("review.noMoments")}</span>
          : <>
            <span className="muted small">{t("review.moments", { count: g.moments })}</span>{" "}
            {g.reviewed ? <span className="badge badge-high">{t("review.reviewed")}</span>
              : <Link className="btn primary" to={`/review/${g.id}`}>{g.started ? t("review.continueReview") : t("review.start")}</Link>}
          </>}
      </div>
    </li>)}</ul>
  </div>;
}

export function GameReview() {
  const { gameId = "" } = useParams();
  const { t, i18n } = useTranslation("daily");
  const [data, setData] = useState<GameReviewData | null>(null);
  const [index, setIndex] = useState(0);
  const [tryUci, setTryUci] = useState<string | null>(null);
  const [skipTry, setSkipTry] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetchGameReview(gameId).then(d => { setData(d); const first = d.moments.findIndex(m => !m.answered); setIndex(first === -1 ? 0 : first); }).catch(() => setData(null));
  }, [gameId]);
  if (!data) return <div className="page"><Link to="/review">{t("review.back")}</Link></div>;
  if (!data.analysed) return <div className="page"><p>{t("review.notAnalysed")}</p><Link to="/review">{t("review.back")}</Link></div>;
  const moment = data.moments[index];
  if (!moment) return <div className="page"><p>{t("review.noMoments")}</p><Link to="/review">{t("review.back")}</Link></div>;
  const trySan = tryUci ? (() => { try { return new Chess(moment.fen).move({ from: tryUci.slice(0, 2), to: tryUci.slice(2, 4), promotion: tryUci[4] })?.san ?? null; } catch { return null; } })() : null;
  async function answer(cause: string) {
    setBusy(true);
    try { setData(await answerReviewMoment(gameId, index, { tryUci, cause })); } finally { setBusy(false); }
  }
  function goNext() { setIndex(i => i + 1); setTryUci(null); setSkipTry(false); }
  const isLast = index === data.moments.length - 1;
  const a = moment.answer;
  return <div className="page" data-testid="game-review">
    <p><Link to="/review">{t("review.back")}</Link></p>
    <h1>{t("review.title")}</h1>
    <p className="muted">{t("review.momentTitle", { n: index + 1, total: data.moments.length, move: moment.moveNumber })}</p>
    <div className="daily-grid">
      <div className="daily-board">
        <PlayBoard fen={moment.fen} orientation={moment.color} disabled={busy || moment.answered || Boolean(tryUci) || skipTry}
          highlight={tryUci ? { from: tryUci.slice(0, 2), to: tryUci.slice(2, 4) } : undefined}
          onMove={(from, to, promotion) => { setTryUci(`${from}${to}${promotion ?? ""}`); return true; }} />
      </div>
      <div className="daily-panel">
        {!moment.answered && <>
          {!tryUci && !skipTry ? <>
            <p className="daily-prompt" data-testid="review-ask-try">{t("review.askTry")}</p>
            <button type="button" className="btn ghost" onClick={() => setSkipTry(true)}>{t("review.skipTry")}</button>
          </> : <>
            {trySan && <p className="mono">{t("review.tried", { move: trySan })}</p>}
            <p className="daily-prompt">{t("review.askCause")}</p>
            <div className="cause-choices" role="group" aria-label={t("review.askCause")}>
              {CAUSES.map(c => <button key={c} type="button" className="btn" disabled={busy} onClick={() => void answer(c)} data-testid={`cause-${c}`}>{t(`review.causes.${c}`)}</button>)}
            </div>
          </>}
        </>}
        {a && <div data-testid="review-reveal" aria-live="polite">
          {a.trySan && <p>{t("review.tried", { move: a.trySan })}{a.tryStatus && <> — {t(`review.tryStatus.${a.tryStatus}`, { defaultValue: "" })}</>}</p>}
          {a.facts.candidateSan && <p>{t("review.played", { move: a.facts.candidateSan })}</p>}
          {a.facts.punish?.firstSan && <p>{t("review.punish", { move: a.facts.punish.firstSan })}</p>}
          {a.facts.best && <p className="mono">{t("review.best", { line: a.facts.best.san.slice(0, 5).join(" ") })}</p>}
          <FactsSummary facts={a.facts} />
          <DrillExplanation key={index} showFacts={false} load={() => explainReviewMoment(gameId, index, i18n.language)} />
          {isLast ? <div className="card"><h2>{t("review.done")}</h2><p className="muted">{t("review.doneHint")}</p><Link className="btn primary" to="/daily">{t("session.backHome")}</Link></div>
            : <button type="button" className="btn primary" onClick={goNext} data-testid="review-next">{t("review.nextMoment")}</button>}
        </div>}
      </div>
    </div>
  </div>;
}
