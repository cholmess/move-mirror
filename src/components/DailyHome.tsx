import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { fetchDailyOverview, startDailySession, syncRecentGames, type DailyOverview } from "../api/dailyClient";
import { WeeklyProgress } from "./WeeklyProgress";

/** Compact entry point shown on the home page: one button, no decisions. */
export function DailyHero() {
  const { t } = useTranslation("daily");
  const navigate = useNavigate();
  const [overview, setOverview] = useState<DailyOverview | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetchDailyOverview().then(setOverview).catch(() => setOverview(null)); }, []);
  if (!overview) return null;
  const active = overview.session && !overview.session.finishedAt;
  async function start() { setBusy(true); try { const s = await startDailySession(); navigate(`/daily/session/${s.id}`); } finally { setBusy(false); } }
  return <section className="card daily-hero" data-testid="daily-hero">
    <div>
      <h2>{t("title")}</h2>
      <p className="muted small">{overview.streak ? t("home.streak", { count: overview.streak }) : t("home.streakNone")} · {t("home.due", { count: overview.dueCards })}</p>
    </div>
    <div className="btn-row">
      {overview.finishedToday && !active ? <Link className="btn" to="/daily">{t("home.weeklyTitle")}</Link>
        : <button type="button" className="btn primary" disabled={busy} onClick={() => void start()} data-testid="daily-hero-start">{active ? t("home.resume") : t("home.start")}</button>}
      {overview.pendingReviews > 0 && <Link className="btn ghost" to="/review">{t("home.reviewsPending", { count: overview.pendingReviews })}</Link>}
    </div>
  </section>;
}

export function DailyHome() {
  const { t } = useTranslation("daily");
  const navigate = useNavigate();
  const [overview, setOverview] = useState<DailyOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [sync, setSync] = useState<"idle" | "running" | "done" | "failed">("idle");
  const load = () => fetchDailyOverview().then(setOverview).catch(() => setOverview(null));
  useEffect(() => { void load(); }, []);
  async function start() { setBusy(true); try { const s = await startDailySession(); navigate(`/daily/session/${s.id}`); } finally { setBusy(false); } }
  async function fetchGames() {
    setSync("running");
    try { await syncRecentGames(); setSync("done"); void load(); } catch { setSync("failed"); }
  }
  if (!overview) return <div className="page"><h1>{t("title")}</h1></div>;
  const active = overview.session && !overview.session.finishedAt;
  const job = overview.analysis;
  return <div className="page" data-testid="daily-home">
    <h1>{t("title")}</h1>
    <p className="lede">{t("lede")}</p>
    <section className="card daily-hero">
      <div>
        <p className="daily-streak" data-testid="daily-streak">{overview.streak ? t("home.streak", { count: overview.streak }) : t("home.streakNone")}</p>
        <p className="muted small">{t("home.due", { count: overview.dueCards })}{overview.bank.available && <> · {t("home.bankCount", { count: overview.bank.count })}</>}</p>
      </div>
      <div className="btn-row">
        {overview.finishedToday && !active ? <>
          <p>{t("home.doneToday")}</p>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => void start()}>{t("home.again")}</button>
        </> : <button type="button" className="btn primary" disabled={busy} onClick={() => void start()} data-testid="daily-start">{active ? t("home.resume") : t("home.start")}</button>}
      </div>
    </section>
    {!overview.bank.available && <p className="muted small" data-testid="bank-missing">{t("home.bankMissing")}</p>}
    {overview.bank.source === "fixture" && <p className="muted small">{t("home.bankFixture")}</p>}
    <section className="card">
      <h2>{t("review.title")}</h2>
      <p className="muted">{t("review.lede")}</p>
      {overview.pendingReviews > 0 && <p>{t("home.reviewsPending", { count: overview.pendingReviews })}</p>}
      {job.status === "running" && <p className="muted small">{t("home.analysis", { done: job.completedGames, total: job.totalGames })}</p>}
      <div className="btn-row">
        <Link className="btn primary" to="/review">{t("home.reviewCta")}</Link>
        <button type="button" className="btn" disabled={sync === "running"} onClick={() => void fetchGames()} data-testid="daily-sync">{sync === "running" ? t("home.syncing") : t("home.syncCta")}</button>
      </div>
      {sync === "done" && <p className="muted small" aria-live="polite">{t("home.syncDone")}</p>}
      {sync === "failed" && <p className="error small" aria-live="polite">{t("home.syncFailed")}</p>}
    </section>
    <WeeklyProgress />
  </div>;
}
