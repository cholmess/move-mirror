import { PATTERN_LEARNING_VERSION } from "./learning-config.js";
import { classifyPracticeEvidence } from "./evidence.js";
import { applyDomainEvidence, emptyPatternDomain } from "./mastery.js";
import { scheduleNextReview } from "./scheduler.js";

/**
 * Ensures patternDomains + practiceSessions exist; rebuilds domains from historical holdout attempts once.
 */
export function migrateLearningState(state, nowIso) {
  state.patternDomains ??= {};
  state.practiceSessions ??= [];
  if (state.learningMigrationVersion === PATTERN_LEARNING_VERSION) return state;
  const attempts = [...(state.attempts ?? [])];
  const exercises = state.exercises ?? [];
  const byExercise = new Map(exercises.map((e) => [e.id, e]));
  for (const attempt of attempts) {
    const exercise = byExercise.get(attempt.exerciseId);
    if (!exercise) continue;
    const role = exercise.role ?? "legacy";
    const evidence = classifyPracticeEvidence({
      role,
      assisted: attempt.assisted,
      repeated: exercise.repeated,
      verified: attempt.verified,
      status: attempt.status,
      independent: attempt.independent,
    });
    const patternId = attempt.patternId;
    const domain = state.patternDomains[patternId] ?? emptyPatternDomain(patternId, nowIso);
    state.patternDomains[patternId] = applyDomainEvidence(domain, evidence, {
      status: attempt.status,
      at: attempt.at,
      role,
      assisted: attempt.assisted,
    });
    if (evidence.countsForDomain) {
      state.patternDomains[patternId].nextReviewAt = scheduleNextReview(
        state.patternDomains[patternId],
        evidence,
        attempt.at,
      );
    }
  }
  state.learningMigrationVersion = PATTERN_LEARNING_VERSION;
  return state;
}
