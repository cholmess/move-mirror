import { REVIEW_DAYS } from "./learning-config.js";

const DAY_MS = 86400000;

/**
 * @param {{ lifecycle: string, masteryEstimate: number }} domain
 * @param {{ kind: string }} evidence
 */
export function reviewIntervalDays(domain, evidence) {
  if (evidence.kind === "unverified" || evidence.kind === "guided_only" || evidence.kind === "holdout_invalid") {
    return REVIEW_DAYS.assisted_or_skipped;
  }
  if (evidence.kind === "independent_failure") return REVIEW_DAYS.independent_failure;
  if (domain.lifecycle === "stable") return REVIEW_DAYS.independent_success_stable;
  if (domain.lifecycle === "review") return REVIEW_DAYS.independent_success_review;
  return REVIEW_DAYS.independent_success_learning;
}

export function scheduleNextReview(domain, evidence, atIso, now = Date.now()) {
  const days = reviewIntervalDays(domain, evidence);
  const base = Math.max(Date.parse(atIso) || now, now);
  return new Date(base + days * DAY_MS).toISOString();
}

export function isReviewDue(nextReviewAt, now = Date.now()) {
  if (!nextReviewAt) return true;
  return Date.parse(nextReviewAt) <= now;
}
