import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { cancelPatternUpdate, fetchPatterns, startPersonalPractice, updatePatterns, type PatternSummary } from "../api/patternsClient";
export function PersonalPatterns({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation("patterns"); const navigate = useNavigate();
  const [summary, setSummary] = useState<PatternSummary | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true; let poll: ReturnType<typeof setTimeout>;
    async function refresh() {
      let delay = 15000;
      try { const data = await fetchPatterns(); if (live) { setSummary(data); setError(""); }
        if (["running", "queued"].includes(data.job.status)) delay = 2500; }
      catch { if (live) setError("connection"); }
      if (live) poll = setTimeout(refresh, delay);
    }
    void refresh(); return () => { live = false; clearTimeout(poll); };
  }, []);
  async function update() { setBusy(true); try { setSummary(await updatePatterns()); setError(""); } catch { setError("connection"); } finally { setBusy(false); } }
  async function practice(id: string) { setBusy(true); try { const exercise = await startPersonalPractice(id); navigate(`/practice/${exercise.id}`); } catch (err) { setError(err instanceof Error ? err.message : "connection"); } finally { setBusy(false); } }
  const active = summary?.job.status === "running" || summary?.job.status === "queued";
  const patterns = summary?.patterns.filter(p => compact ? summary.recommended.includes(p.id) : p.status !== "no_evidence") ?? [];
  return <section className="card personal-patterns" data-testid="personal-patterns"><h2>{t("title")}</h2><p>{t("intro")}</p>
    <div className="btn-row"><button type="button" className="btn" disabled={busy || active} onClick={() => void update()}>{t("update")}</button>
      <Link className="btn" to="/import">{t("import")}</Link>{compact && <Link className="btn" to="/patterns">{t("all")}</Link>}
      {active && <button type="button" className="btn" onClick={() => void cancelPatternUpdate().then(setSummary).catch(() => setError("connection"))}>{t("cancel")}</button>}
    </div>
    {error && <p role="alert">{t(`errors.${error}`, { defaultValue: t("errors.connection") })}</p>}
    {summary && <>
      <p className="muted">{t("coverage", { analyzed: summary.analyzedGames, eligible: summary.eligibleGames, decisions: summary.verifiedDecisions })}</p>
      {active && <p role="status">{t("progress", { done: summary.job.completedDecisions, total: summary.job.totalDecisions })}</p>}
      {summary.job.error && <p role="alert">{t(`errors.${summary.job.error}`, { defaultValue: t("errors.connection") })}</p>}
      {!patterns.length && <p>{t("empty")}</p>}
      <div className="practice-cards">{patterns.map(p => <article className="card" key={p.id} data-testid={`pattern-${p.id}`}>
        <h3>{t(`catalog.${p.id}.title`)}</h3><p>{t(`catalog.${p.id}.observation`)}</p>
        <p>{t("evidence", { errors: p.errors, games: p.games, opportunities: p.opportunities })}</p>
        <p className="muted">{t(`confidence.${p.confidence}`)} · {t(`status.${p.status}`)}</p>
        {p.kind === "context" && <p className="muted">{t("causeUnknown")}</p>}
        <ul>{p.examples.map(ex => <li key={ex.exerciseId}><Link to={`/games/${ex.gameId}`}>{t("example", { move: ex.moveNumber })}</Link></li>)}</ul>
        {p.practice.attempts > 0 && <p>{t("practiceEvidence", { independent: p.practice.independent, successes: p.practice.successes, attempts: p.practice.attempts })}</p>}
        {p.hypothesis && <section className="callout" data-testid={`hypothesis-evidence-${p.id}`}>
          <strong>{t("hypothesisTracking.title")}</strong>
          <p>{p.hypothesis.statement}</p>
          <p>{t(`hypothesisTracking.status.${p.hypothesis.status}`)}</p>
          <p className="small muted">{t("hypothesisTracking.counts", {
            probes: p.hypothesis.evidence.directProbeSupports,
            support: p.hypothesis.evidence.realGameSupports,
            contradict: p.hypothesis.evidence.realGameContradictions,
          })}</p>
          {!p.hypothesis.evidence.gate.eligible && p.hypothesis.evidence.gate.reason && <p className="small muted">{t(`hypothesisTracking.gate.${p.hypothesis.evidence.gate.reason}`)}</p>}
        </section>}
        <p className="small">{p.transfer.status === "insufficient" ? t("transferPending") : t("transferObserved", { before: p.transfer.before.ratePer100?.toFixed(1), after: p.transfer.after.ratePer100?.toFixed(1) })}</p>
        <button type="button" className="btn primary" disabled={busy || p.status !== "recurrent"} onClick={() => void practice(p.id)}>{t("practice")}</button>
      </article>)}</div>
      {!compact && <details className="muted"><summary>{t("howSelected")}</summary><p>{t("method")}</p></details>}
    </>}
  </section>;
}
