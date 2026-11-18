import { isReviewDue } from '../patterns/scheduler.js';
import { MAX_PLAN_PRIORITIES } from '../patterns/learning-config.js';
import { buildCurriculumPlan } from '../patterns/curriculum.js';
import { SKILL_DEFINITION_VERSION, skillDefinitionFor } from '../patterns/skill-definitions.js';

/** A transparent plan from current evidence; never a mastery or causal claim. */
export const TRAINING_PLAN_VERSION = 'personal-training-plan-v4';
export function buildTrainingPlan({ summary, activePractice = null, coachHome, now = Date.now() }) {
  const curriculum = buildCurriculumPlan(summary.patterns).slice(0, MAX_PLAN_PRIORITIES);
  const byPattern = new Map(summary.patterns.map((pattern) => [pattern.id, pattern]));
  const priorities = curriculum.map((decision) => byPattern.get(decision.patternId)).filter(Boolean)
    .map(p => {
      const decision = curriculum.find((row) => row.patternId === p.id);
      const due = isReviewDue(p.practice.nextReviewAt, now);
      let reason = 'review';
      let reasonKey = 'coach:plan.reasonKey.review';
      if (!p.practice.attempts) {
        reason = 'new';
        reasonKey = 'coach:plan.reasonKey.new';
      } else if (p.practice.lifecycle === 'stable' && !due) {
        reason = 'stable';
        reasonKey = 'coach:plan.reasonKey.stable';
      } else if (!due) {
        reason = 'scheduled';
        reasonKey = 'coach:plan.reasonKey.scheduled';
      } else if (p.practice.lifecycle === 'learning') {
        reasonKey = 'coach:plan.reasonKey.lowEvidence';
      }
      return { patternId: p.id, kind: p.kind, confidence: p.confidence, skill: p.skill ?? skillDefinitionFor(p.id),
      evidence: { errors: p.errors, games: p.games, opportunities: p.opportunities },
      nextReviewAt: p.practice.nextReviewAt ?? null,
      reason, reasonKey,
      practice: p.practice, transfer: p.transfer, curriculum: decision };
    });
  const next = priorities.find(p => p.curriculum.slot !== 'maintenance' && p.reason !== 'scheduled')
    ?? priorities.find(p => p.reason !== 'scheduled');
  let primary = { kind: 'foundation', href: '/coach/session', patternId: null, sessionId: null };
  if (next) primary = { kind: 'pattern', patternId: next.patternId, sessionId: null, href: null };
  if (coachHome?.primaryAction === 'start_retention') primary = { kind: 'retention', patternId: null, sessionId: coachHome.sessionId, href: `/coach/session/${coachHome.sessionId}` };
  if (coachHome?.primaryAction === 'resume_session') primary = { kind: 'resume_lesson', patternId: null, sessionId: coachHome.sessionId, href: `/coach/session/${coachHome.sessionId}` };
  if (activePractice) primary = { kind: 'resume_pattern', patternId: activePractice.patternId, sessionId: activePractice.id, href: `/practice/${activePractice.id}` };
  const bySlot = (slot) => curriculum.find((row) => row.slot === slot)?.patternId ?? null;
  return { version: TRAINING_PLAN_VERSION, evidenceRevision: summary.revision, updatedAt: summary.updatedAt,
    coverage: { analyzed: summary.analyzedGames, eligible: summary.eligibleGames, decisions: summary.verifiedDecisions },
    job: summary.job, priorities, curriculum, primary, method: 'evidence_rules',
    portfolio: { version: SKILL_DEFINITION_VERSION, evidencePolicy: 'pattern_isolated',
      primaryPatternId: bySlot('primary'), supportPatternId: bySlot('support'), maintenancePatternId: bySlot('maintenance') },
    state: summary.analyzedGames === 0 ? 'needs_analysis' : priorities.length ? 'personalized' : 'observing' };
}
