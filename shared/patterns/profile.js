import { PATTERNS, MIN_PATTERN_GAMES } from "./catalog.js";
import { positionKey } from "./detect.js";
import { skillDefinitionFor } from "./skill-definitions.js";
/** Rates use verified opportunities from complete games, never the puzzle bank. */
export function buildPatternProfile(records, attempts = [], exposures = [], now = Date.now(), patternDomains = {}) {
  return PATTERNS.map(pattern => {
    const relevant = records.filter(r => r.opportunities.includes(pattern.id));
    const errors = relevant.filter(r => r.patternId === pattern.id);
    const games = new Set(errors.map(r => r.gameId));
    const usable = [...new Map(errors.map(r => [positionKey(r.fen), r])).values()];
    const recurrent = games.size >= MIN_PATTERN_GAMES && usable.length >= 3;
    const ownAttempts = attempts.filter(a => a.patternId === pattern.id);
    const independent = ownAttempts.filter(a => a.independent && a.verified);
    const successes = independent.filter(a => ["verified_best", "verified_acceptable"].includes(a.status)).length;
    const failures = independent.filter(a => ["incorrect", "playable_inexact"].includes(a.status)).length;
    const firstPractice = exposures.filter(e => e.patternId === pattern.id).map(e => e.at).sort()[0] ?? null;
    // Only games dated strictly after the first exposure. Known training positions are excluded.
    const seen = new Set(exposures.map(e => e.positionKey));
    const temporal = relevant.filter(r => r.datePrecision === "exact");
    const before = firstPractice ? temporal.filter(r => r.gameStartedAt < firstPractice && ((r.gameEndedAt && r.gameEndedAt < firstPractice) || r.importedAt < firstPractice)) : [];
    const after = firstPractice ? temporal.filter(r => r.gameStartedAt > firstPractice && !seen.has(positionKey(r.fen))) : [];
    function stats(rows) { const n = rows.filter(r => r.patternId === pattern.id).length; return { games: new Set(rows.map(r => r.gameId)).size, decisions: rows.length, errors: n, ratePer100: rows.length ? 100 * n / rows.length : null }; }
    const b = stats(before), a = stats(after);
    const sufficient = b.games >= 5 && a.games >= 5 && b.decisions >= 30 && a.decisions >= 30;
    const rate = relevant.length ? 100 * errors.length / relevant.length : null;
    const domain = patternDomains[pattern.id];
    const estimate = domain
      ? domain.masteryEstimate
      : independent.length
        ? (1 + successes) / (2 + successes + failures)
        : null;
    const nextReviewAt = domain?.nextReviewAt ?? (() => {
      const lastIndependent = independent.map(a => a.at).filter(Boolean).sort().at(-1) ?? null;
      const reviewDelayDays = estimate !== null && estimate >= 0.75 ? 3 : 1;
      return lastIndependent ? new Date(Date.parse(lastIndependent) + reviewDelayDays * 86400000).toISOString() : null;
    })();
    const dueFactor = nextReviewAt && Date.parse(nextReviewAt) > now ? 0.5 : 1;
    const severity = errors.reduce((n, r) => n + Math.min(r.loss ?? 800, 800), 0);

    return { ...pattern, skill: skillDefinitionFor(pattern.id), errors: errors.length, games: games.size, analyzedGames: new Set(relevant.map(r => r.gameId)).size,
      opportunities: relevant.length, ratePer100: rate, status: recurrent ? "recurrent" : errors.length ? "watching" : "no_evidence",
      confidence: recurrent ? (games.size >= 6 ? "moderate" : "limited") : "insufficient", exerciseCount: usable.length,
      priority: recurrent ? severity * (1 - estimate) * (1 + 1 / Math.sqrt(2 + independent.length)) * dueFactor : 0,
      examples: usable.slice(0, 3).map(r => ({ gameId: r.gameId, moveNumber: r.moveNumber, exerciseId: r.exerciseId })),
      practice: {
        attempts: ownAttempts.length,
        independent: domain?.independentAttempts ?? independent.length,
        successes: domain?.independentSuccesses ?? successes,
        failures: domain?.independentFailures ?? failures,
        estimate: domain ? domain.masteryEstimate : independent.length ? estimate : null,
        nextReviewAt,
        lifecycle: domain?.lifecycle ?? (independent.length ? "learning" : "new"),
        confidence: domain?.confidence ?? null,
        assistedAttempts: domain?.assistedAttempts ?? ownAttempts.filter(a => a.assisted).length,
      },
      transfer: { status: sufficient ? "descriptive_comparison" : "insufficient", before: b, after: a, firstPracticeAt: firstPractice,
        differencePer100: sufficient ? a.ratePer100 - b.ratePer100 : null, causal: false },
    };
  }).sort((a, b) => b.priority - a.priority || b.errors - a.errors || a.id.localeCompare(b.id));
}
