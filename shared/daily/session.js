/**
 * Builds today's session: due reviews first (own positions before puzzles), then new own mistakes,
 * then new puzzles weighted toward the player's recurrent patterns and near their rating.
 * Deterministic for a given seed so tests and reloads are stable.
 */
import { isDue } from "./srs.js";

export const SESSION_DEFAULTS = { size: 30, maxNewOwn: 8, maxNewPuzzles: 15, minutes: 20 };

function rng(seed) {
  let s = 0; for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

/**
 * @param {object} input
 * @param {Array} input.cards all known cards (with .state when already scheduled)
 * @param {Array} input.puzzles candidate puzzle cards not yet introduced
 * @param {Record<string, number>} input.patternWeights e.g. { "piece-loss": 59, "forcing-reply": 33 }
 * @param {number|null} input.rating player's current rating
 */
export function buildDailySession({ cards, puzzles = [], patternWeights = {}, rating = null, now = Date.now(), seed = "", options = {} }) {
  const opts = { ...SESSION_DEFAULTS, ...options };
  const random = rng(seed || new Date(now).toISOString().slice(0, 10));
  const scheduled = cards.filter(c => c.state);
  const due = scheduled.filter(c => isDue(c.state, now))
    .sort((a, b) => (a.source === b.source ? 0 : a.source === "own" ? -1 : 1) || Date.parse(a.state.due) - Date.parse(b.state.due));
  const picked = due.slice(0, opts.size);

  const weight = id => (patternWeights[id] ?? 0) + 1;
  const freshOwn = cards.filter(c => !c.state && c.source === "own")
    // Most recurrent pattern first; within it, refutation drills train the diagnosed weakness directly.
    .map(c => ({ c, tie: random() }))
    .sort((a, b) => weight(b.c.patternId) - weight(a.c.patternId) || (a.c.kind === b.c.kind ? 0 : a.c.kind === "refutation" ? -1 : 1) || a.tie - b.tie)
    .map(x => x.c);
  for (const card of freshOwn.slice(0, opts.maxNewOwn)) if (picked.length < opts.size) picked.push(card);

  const target = rating ?? 1300;
  const scored = puzzles.map(p => ({ p, score: weight(p.patternId) / (1 + Math.abs((p.rating ?? target) - (target - 50)) / 150) * (0.5 + random()) }))
    .sort((a, b) => b.score - a.score);
  let newPuzzles = 0;
  for (const { p } of scored) {
    if (picked.length >= opts.size || newPuzzles >= opts.maxNewPuzzles) break;
    picked.push(p); newPuzzles++;
  }
  // Interleave kinds so attention does not drift into one mode.
  const ref = picked.filter(c => c.kind === "refutation"), find = picked.filter(c => c.kind !== "refutation");
  const ordered = []; while (ref.length || find.length) { if (ref.length) ordered.push(ref.shift()); if (ref.length) ordered.push(ref.shift()); if (find.length) ordered.push(find.shift()); }
  return { cardIds: ordered.map(c => c.id), dueCount: due.length, newOwn: Math.min(freshOwn.length, opts.maxNewOwn), newPuzzles, minutes: opts.minutes };
}

/** Rating used to pick puzzles: the player's rating in their most recent game, when known. */
export function latestRating(games) {
  const sorted = [...games].filter(g => g.rating).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  return sorted[0]?.rating ?? null;
}
