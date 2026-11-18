/**
 * Small SM-2 style scheduler for daily drill cards.
 * Grades come from observable behaviour (correctness, speed, reveal), not self-rating.
 */
export const DAY_MS = 86_400_000;
export const MIN_EASE = 1.3;
export const START_EASE = 2.3;

export function newCardState(now = Date.now()) {
  return { due: new Date(now).toISOString(), intervalDays: 0, ease: START_EASE, reps: 0, lapses: 0, lastGrade: null, lastReviewedAt: null };
}

/** again: wrong / revealed / timed out without answer; hard: right but over the time limit; good: right; easy: right in under a third of the limit. */
export function gradeAnswer({ correct, revealed = false, elapsedMs, limitMs }) {
  if (!correct || revealed) return "again";
  if (Number.isFinite(elapsedMs) && Number.isFinite(limitMs)) {
    if (elapsedMs > limitMs) return "hard";
    if (elapsedMs < limitMs / 3) return "easy";
  }
  return "good";
}

export function scheduleCard(state, grade, now = Date.now()) {
  const next = { ...state, reps: state.reps + 1, lastGrade: grade, lastReviewedAt: new Date(now).toISOString() };
  if (grade === "again") {
    next.lapses = state.lapses + 1;
    next.ease = Math.max(MIN_EASE, state.ease - 0.2);
    next.intervalDays = 0;
    // Same day is too soon to measure recall; retry tomorrow.
    next.due = new Date(now + DAY_MS).toISOString();
    return next;
  }
  const base = state.intervalDays || 0;
  let interval;
  if (grade === "hard") { interval = Math.max(1, Math.round(base * 1.2)); next.ease = Math.max(MIN_EASE, state.ease - 0.15); }
  else if (grade === "good") { interval = base < 1 ? 1 : base < 3 ? 3 : Math.round(base * state.ease); }
  else { interval = base < 1 ? 3 : Math.round(base * state.ease * 1.3); next.ease = state.ease + 0.15; }
  next.intervalDays = Math.min(interval, 180);
  next.due = new Date(now + next.intervalDays * DAY_MS).toISOString();
  return next;
}

export function isDue(state, now = Date.now()) {
  return Date.parse(state.due) <= now;
}
