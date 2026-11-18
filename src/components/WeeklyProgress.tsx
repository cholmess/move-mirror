import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchWeekly, type Weekly } from "../api/dailyClient";

interface Point { label: string; value: number | null; detail?: string }

/** Single-series line with optional dashed goal line; crosshair + tooltip on hover. */
function LineChart({ title, points, goal, goalLabel, testId, integer = false }: { title: string; points: Point[]; goal?: number; goalLabel?: string; testId: string; integer?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560, H = 180, L = 56, R = 16, T = 14, B = 26;
  const values = points.map(p => p.value).filter((v): v is number => v != null);
  if (!values.length) return null;
  const all = goal != null ? [...values, goal] : values;
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi === lo) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.15; lo = Math.max(0, lo - pad); hi += pad;
  const x = (i: number) => L + (points.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (points.length - 1));
  const y = (v: number) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  const ticks = [lo, (lo + hi) / 2, hi];
  const path = points.map((p, i) => (p.value == null ? null : `${x(i)},${y(p.value)}`)).filter(Boolean);
  const fmt = (v: number) => (integer || Math.abs(hi - lo) > 20 ? Math.round(v).toString() : v.toFixed(1));
  const h = hover != null ? points[hover] : null;
  return <figure className="viz-root weekly-chart" data-testid={testId}>
    <figcaption className="small">{title}</figcaption>
    <div className="weekly-chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}
        onMouseMove={e => { const r = e.currentTarget.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; let best = 0; points.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; }); setHover(best); }}
        onMouseLeave={() => setHover(null)}>
        {ticks.map(v => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="viz-grid" /><text x={L - 6} y={y(v) + 4} textAnchor="end" className="viz-tick">{fmt(v)}</text></g>)}
        {goal != null && <g><line x1={L} x2={W - R} y1={y(goal)} y2={y(goal)} className="viz-goal" /><text x={W - R} y={y(goal) - 5} textAnchor="end" className="viz-tick">{goalLabel}</text></g>}
        {path.length > 1 && <polyline points={path.join(" ")} className="viz-line" />}
        {points.map((p, i) => p.value == null ? null : <circle key={p.label} cx={x(i)} cy={y(p.value)} r={hover === i ? 5 : 4} className="viz-dot" />)}
        {points.map((p, i) => (i === 0 || i === points.length - 1 || points.length <= 6) && <text key={`l${p.label}`} x={x(i)} y={H - 6} textAnchor="middle" className="viz-tick">{p.label.slice(5)}</text>)}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="viz-cross" />}
      </svg>
      {h && h.value != null && <div className="viz-tooltip" style={{ left: `${(x(hover!) / W) * 100}%` }} role="status">
        <strong>{fmt(h.value)}</strong> <span className="muted">{h.label}</span>{h.detail && <div className="muted">{h.detail}</div>}
      </div>}
    </div>
  </figure>;
}

export function WeeklyProgress() {
  const { t } = useTranslation("daily");
  const [data, setData] = useState<Weekly | null>(null);
  const [table, setTable] = useState(false);
  useEffect(() => { fetchWeekly().then(setData).catch(() => setData(null)); }, []);
  if (!data) return null;
  const weeks = data.weeks.slice(-12);
  const withGames = weeks.filter(w => w.decisions > 0);
  const causes = weeks.reduce<Record<string, number>>((acc, w) => { for (const [k, v] of Object.entries(w.reports)) acc[k] = (acc[k] ?? 0) + v; return acc; }, {});
  const causeTotal = Object.values(causes).reduce((a, b) => a + b, 0);
  return <section className="card" data-testid="weekly-progress">
    <h2>{t("home.weeklyTitle")}</h2>
    {!withGames.length ? <p className="muted">{t("progress.empty")}</p> : <>
      <LineChart testId="chart-piece-loss" title={t("progress.metric")} goal={data.goalPieceLossPer100} goalLabel={t("progress.goal", { goal: data.goalPieceLossPer100 })}
        points={withGames.map(w => ({ label: w.week, value: w.pieceLossPer100, detail: `${w.games} · ${Object.entries(w.byControl).map(([k, v]) => `${k}: ${v.pieceLossPer100 ?? "–"}`).join(" · ")}` }))} />
      <LineChart testId="chart-rating" integer title={t("progress.rating")} points={withGames.map(w => ({ label: w.week, value: w.ratingEnd }))} />
      <p className="muted small">{t("progress.descriptive")}</p>
    </>}
    <button type="button" className="btn ghost" onClick={() => setTable(v => !v)} aria-expanded={table}>{t("progress.showTable")}</button>
    {table && <div className="table-scroll"><table className="weekly-table"><thead><tr>
      <th>{t("progress.week")}</th><th>{t("progress.games")}</th><th>{t("progress.pieceLoss")}</th><th>{t("progress.errors")}</th><th>{t("progress.ratingCol")}</th><th>{t("progress.training")}</th><th>{t("progress.accuracy")}</th>
    </tr></thead><tbody>{weeks.map(w => <tr key={w.week}><td className="mono">{w.week}</td><td>{w.games}</td><td>{w.pieceLossPer100 ?? "–"}</td><td>{w.errorsPer100 ?? "–"}</td><td>{w.ratingEnd ?? "–"}</td>
      <td>{t("progress.trainingCell", { minutes: w.trainingMinutes, days: w.trainingDays })}</td><td>{w.accuracy != null ? `${w.accuracy}%` : "–"}</td></tr>)}</tbody></table></div>}
    <h3 className="small">{t("progress.causes")}</h3>
    {causeTotal ? <ul className="cause-list">{Object.entries(causes).sort((a, b) => b[1] - a[1]).map(([k, v]) => <li key={k}><span>{t(`review.causes.${k}`)}</span><span className="cause-bar" style={{ width: `${(v / causeTotal) * 100}%` }} /><span className="mono">{v}</span></li>)}</ul>
      : <p className="muted small">{t("progress.noCause")}</p>}
    <p className="small">{t("progress.paceTip")}</p>
  </section>;
}
