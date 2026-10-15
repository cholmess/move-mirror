import { buildTrainingPlan } from '../../shared/coach/training-plan.js';
export function createTrainingPlanService({ patterns, coach, store, now = () => Date.now() }) {
  function plan() {
    const value = buildTrainingPlan({ summary: patterns.summary(), activePractice: patterns.activePractice(), coachHome: coach.home().home, now: now() });
    // Record decision changes, not polling timestamps. Current evidence remains authoritative.
    const signature = JSON.stringify([value.version, value.state, value.coverage, value.priorities, value.primary]);
    const previous = store.readPlan();
    if (previous?.signature !== signature) store.savePlan({ signature, changedAt: new Date(now()).toISOString(), plan: value });
    return value;
  }
  function start(patternId = null) {
    const current = plan();
    if (patternId !== null) {
      if (!current.priorities.some(p => p.patternId === patternId)) throw new Error('plan_changed');
      const active = patterns.activePractice(patternId);
      const exercise = active ?? patterns.startPractice(patternId);
      plan();
      return { href: `/practice/${exercise.id}` };
    }
    const action = current.primary;
    if (action.kind === 'pattern') return start(action.patternId);
    if (action.kind === 'retention') {
      const result = coach.startRetention(action.sessionId);
      if (!result.ok) throw new Error(result.error);
    }
    return { href: action.href };
  }
  return { plan, start };
}
