/**
 * Weekly progress: the one number that matters (pieces lost per 100 own decisions) next to rating
 * and training volume. Descriptive only — no causal claim.
 */
export function isoWeek(dateLike) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function controlLabel(control) {
  if (!control) return "other";
  return `${Math.round((control.initialSeconds ?? 0) / 60)}+${control.incrementSeconds ?? 0}`;
}

/** Calendar day (YYYY-MM-DD) in the machine's local time zone: "today" means the player's today. */
export function localDay(dateLike) {
  const d = new Date(dateLike);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

const per100 = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

/**
 * @param {Array} rows analysed decisions ({ gameId, patternId })
 * @param {Array} games { id, startedAt, rating, control }
 * @param {Array} log training events ({ at, kind: "answer", correct, elapsedMs })
 */
export function weeklyMetrics({ rows, games, log = [], reports = [] }) {
  const gameById = new Map(games.map(g => [g.id, g]));
  const weeks = new Map();
  const ensure = w => {
    if (!weeks.has(w)) weeks.set(w, { week: w, games: new Set(), decisions: 0, pieceLoss: 0, errors: 0, ratings: [],
      byControl: {}, answers: 0, correct: 0, trainingMs: 0, trainingDays: new Set(), reports: {} });
    return weeks.get(w);
  };
  for (const row of rows) {
    const game = gameById.get(row.gameId); if (!game) continue;
    const w = isoWeek(game.startedAt); if (!w) continue;
    const bucket = ensure(w);
    bucket.games.add(game.id); bucket.decisions++;
    if (row.patternId) bucket.errors++;
    if (row.patternId === "piece-loss") bucket.pieceLoss++;
    const c = (bucket.byControl[game.control] ??= { games: new Set(), decisions: 0, pieceLoss: 0 });
    c.games.add(game.id); c.decisions++; if (row.patternId === "piece-loss") c.pieceLoss++;
  }
  for (const game of games) {
    const w = isoWeek(game.startedAt); if (!w || !weeks.has(w) || !game.rating) continue;
    weeks.get(w).ratings.push({ at: game.startedAt, rating: game.rating });
  }
  for (const event of log) {
    if (event.kind !== "answer") continue;
    const w = isoWeek(event.at); if (!w) continue;
    const bucket = ensure(w);
    bucket.answers++; if (event.correct) bucket.correct++;
    bucket.trainingMs += Math.min(event.elapsedMs ?? 0, 120_000);
    bucket.trainingDays.add(localDay(event.at));
  }
  for (const report of reports) {
    const w = isoWeek(report.at); if (!w) continue;
    const bucket = ensure(w); bucket.reports[report.cause] = (bucket.reports[report.cause] ?? 0) + 1;
  }
  return [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week)).map(b => {
    const ratings = b.ratings.sort((x, y) => String(x.at).localeCompare(String(y.at)));
    return { week: b.week, games: b.games.size, decisions: b.decisions, pieceLoss: b.pieceLoss, errors: b.errors,
      pieceLossPer100: per100(b.pieceLoss, b.decisions), errorsPer100: per100(b.errors, b.decisions),
      ratingEnd: ratings.at(-1)?.rating ?? null,
      byControl: Object.fromEntries(Object.entries(b.byControl).map(([k, v]) => [k, { games: v.games.size, decisions: v.decisions, pieceLossPer100: per100(v.pieceLoss, v.decisions) }])),
      answers: b.answers, accuracy: b.answers ? Math.round((b.correct / b.answers) * 100) : null,
      trainingMinutes: Math.round(b.trainingMs / 60_000), trainingDays: b.trainingDays.size, reports: b.reports };
  });
}

/** Training streak in consecutive days ending today (or yesterday, so the streak survives until you train). */
export function streakDays(log, now = Date.now()) {
  const days = new Set(log.filter(e => e.kind === "answer").map(e => localDay(e.at)));
  let streak = 0; let cursor = new Date(now);
  if (!days.has(localDay(cursor))) cursor = new Date(now - 86_400_000);
  while (days.has(localDay(cursor))) { streak++; cursor = new Date(cursor.getTime() - 86_400_000); }
  return streak;
}
