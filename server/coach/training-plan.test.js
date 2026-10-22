import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTrainingPlan } from '../../shared/coach/training-plan.js';
import { createTrainingPlanService } from './training-plan.mjs';
import { createCoachStore } from './store.mjs';
const now = Date.parse('2026-10-14T12:00:00Z');
const pattern = (id, priority, overrides = {}) => ({ id, priority, kind: 'context', status: 'recurrent', confidence: 'limited', errors: 3, games: 3, opportunities: 30, practice: { attempts: 0, nextReviewAt: null }, transfer: { status: 'insufficient' }, ...overrides });
const summary = patterns => ({ revision: 1, updatedAt: null, analyzedGames: 3, eligibleGames: 4, verifiedDecisions: 100, job: { status: 'completed' }, patterns });
const coachHome = { primaryAction: 'start_session', sessionId: null };
describe('personal training plan', () => {
  it('uses current recurring evidence, adds an explicit intervention and caps priorities', () => {
    const plan = buildTrainingPlan({ summary: summary([pattern('closed-center', 2), pattern('piece-loss', 5), pattern('missed-mate', 9, { status: 'watching' }), pattern('forcing-reply', 3), pattern('endgame-decisions', 1)]), coachHome, now });
    expect(plan.primary.patternId).toBe('piece-loss');
    expect(plan.priorities.map(p => p.patternId)).toEqual(['piece-loss', 'forcing-reply', 'closed-center']);
    expect(plan.priorities[0].curriculum).toMatchObject({ slot: 'primary', action: 'diagnose' });
    expect(plan.coverage).toEqual({ analyzed: 3, eligible: 4, decisions: 100 });
  });
  it('offers general teaching without fabricating a diagnosis when evidence disappears', () => {
    const plan = buildTrainingPlan({ summary: { ...summary([]), analyzedGames: 0 }, coachHome, now });
    expect(plan.state).toBe('needs_analysis'); expect(plan.primary.kind).toBe('foundation'); expect(plan.priorities).toEqual([]);
  });
  it('respects scheduled reviews and preserves an active practice ahead of new priorities', () => {
    const data = summary([pattern('piece-loss', 10, { practice: { attempts: 1, nextReviewAt: '2026-10-16T12:00:00Z' } }), pattern('closed-center', 2)]);
    expect(buildTrainingPlan({ summary: data, coachHome, now }).primary.patternId).toBe('closed-center');
    const activePractice = { id: 'saved', patternId: 'piece-loss' };
    expect(buildTrainingPlan({ summary: data, coachHome, now, activePractice }).primary.href).toBe('/practice/saved');
  });
  it('prioritizes due lesson retention without pretending it is a personal pattern', () => {
    const plan = buildTrainingPlan({ summary: summary([pattern('piece-loss', 1)]), coachHome: { primaryAction: 'start_retention', sessionId: 'lesson' }, now });
    expect(plan.primary).toMatchObject({ kind: 'retention', patternId: null, sessionId: 'lesson' });
  });
  it('keeps maintenance behind active learning even when its raw severity is higher', () => {
    const maintenance = { version: 'adaptive-curriculum-v1', action: 'maintenance', reasonKey: 'generalized_and_transfer_improved', previousCategory: 'reply_search', targetCategory: 'reply_search', evidence: {} };
    const reteach = { version: 'adaptive-curriculum-v1', action: 'reteach', reasonKey: 'holdout_failed', previousCategory: 'reply_search', targetCategory: 'reply_search', evidence: {} };
    const plan = buildTrainingPlan({ summary: summary([
      pattern('piece-loss', 100, { curriculum: maintenance }),
      pattern('closed-center', 1, { curriculum: reteach }),
    ]), coachHome, now });
    expect(plan.primary.patternId).toBe('closed-center');
    expect(plan.priorities.map(p => [p.patternId, p.curriculum.slot])).toEqual([
      ['closed-center', 'primary'], ['piece-loss', 'maintenance'],
    ]);
  });
});
describe('plan orchestration and persistence', () => {
  let dir, store, data, active, starts, patterns, service;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-plan-')); store = createCoachStore(dir);
    data = summary([pattern('closed-center', 2)]); active = null; starts = 0;
    patterns = { summary: () => data, activePractice: id => !id || active?.patternId === id ? active : null,
      startPractice: id => { starts++; active = { id: 'saved', patternId: id }; return active; } };
    service = createTrainingPlanService({ patterns, coach: { home: () => ({ home: coachHome }) }, store, now: () => now });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  it('resumes the same exercise on repeated starts and after recreating the service', () => {
    expect(service.start()).toEqual({ href: '/practice/saved' });
    expect(service.start()).toEqual({ href: '/practice/saved' }); expect(starts).toBe(1);
    const restartedStore = createCoachStore(dir);
    expect(restartedStore.readPlan().plan.primary.kind).toBe('resume_pattern');
    const restarted = createTrainingPlanService({ patterns, coach: { home: () => ({ home: coachHome }) }, store: restartedStore, now: () => now });
    expect(restarted.start()).toEqual({ href: '/practice/saved' }); expect(starts).toBe(1);
  });
  it('rejects stale selections after new evidence and preserves sessions', () => {
    store.saveSession({ id: 'existing', status: 'closed' }); service.plan();
    data = summary([]);
    expect(() => service.start('closed-center')).toThrow('plan_changed');
    expect(store.listSessions()).toHaveLength(1); expect(starts).toBe(0);
    expect(store.readPlan().plan.priorities).toEqual([]);
  });
});
