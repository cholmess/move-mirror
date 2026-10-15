/** A transparent plan from current evidence; never a mastery or causal claim. */
export const TRAINING_PLAN_VERSION = 'personal-training-plan-v1';
export function buildTrainingPlan({ summary, activePractice = null, coachHome, now = Date.now() }) {
  const priorities = summary.patterns.filter(p => p.status === 'recurrent')
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)).slice(0, 3)
    .map(p => ({ patternId: p.id, kind: p.kind, confidence: p.confidence,
      evidence: { errors: p.errors, games: p.games, opportunities: p.opportunities },
      nextReviewAt: p.practice.nextReviewAt ?? null,
      reason: !p.practice.attempts ? 'new' : p.practice.nextReviewAt && Date.parse(p.practice.nextReviewAt) > now ? 'scheduled' : 'review',
      practice: p.practice, transfer: p.transfer }));
  const next = priorities.find(p => p.reason !== 'scheduled');
  let primary = { kind: 'foundation', href: '/coach/session', patternId: null, sessionId: null };
  if (next) primary = { kind: 'pattern', patternId: next.patternId, sessionId: null, href: null };
  if (coachHome?.primaryAction === 'start_retention') primary = { kind: 'retention', patternId: null, sessionId: coachHome.sessionId, href: `/coach/session/${coachHome.sessionId}` };
  if (coachHome?.primaryAction === 'resume_session') primary = { kind: 'resume_lesson', patternId: null, sessionId: coachHome.sessionId, href: `/coach/session/${coachHome.sessionId}` };
  if (activePractice) primary = { kind: 'resume_pattern', patternId: activePractice.patternId, sessionId: activePractice.id, href: `/practice/${activePractice.id}` };
  return { version: TRAINING_PLAN_VERSION, evidenceRevision: summary.revision, updatedAt: summary.updatedAt,
    coverage: { analyzed: summary.analyzedGames, eligible: summary.eligibleGames, decisions: summary.verifiedDecisions },
    job: summary.job, priorities, primary, method: 'evidence_rules',
    state: summary.analyzedGames === 0 ? 'needs_analysis' : priorities.length ? 'personalized' : 'observing' };
}
