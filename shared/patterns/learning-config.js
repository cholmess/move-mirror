/** Central, auditable thresholds for personal pattern learning (no ML). */
export const PATTERN_LEARNING_VERSION = "pattern-learning-v1";

export const SESSION_MIN_POSITIONS = 3;
export const SESSION_MAX_POSITIONS = 5;
export const GUIDED_DECISIONS_PER_SLOT = 1;
export const LEGACY_GUIDED_DECISIONS = 3;

export const DOMAIN_PRIOR_ALPHA = 1;
export const DOMAIN_PRIOR_BETA = 1;

/** Minimum independent successes before lifecycle can reach `stable`. */
export const STABLE_MIN_INDEPENDENT_ATTEMPTS = 3;
export const STABLE_MASTERY_MIN = 0.72;

export const CONFIDENCE_PER_INDEPENDENT = 0.08;
export const CONFIDENCE_CAP = 0.92;
export const CONFIDENCE_FLOOR = 0.35;

/** Spaced repetition intervals in days after an independent holdout outcome. */
export const REVIEW_DAYS = {
  independent_failure: 1,
  independent_success_learning: 2,
  independent_success_review: 4,
  independent_success_stable: 7,
  assisted_or_skipped: 1,
};

export const MAX_PLAN_PRIORITIES = 3;

/** Session fatigue: avoid more than this many positions of the same pattern in one sitting. */
export const SESSION_FATIGUE_POSITIONS = SESSION_MAX_POSITIONS;
