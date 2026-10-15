import { test, expect } from '@playwright/test';
const api = `http://127.0.0.1:${process.env.E2E_ENGINE_PORT ?? '8791'}`;
test('plan API reflects current evidence and rejects unknown selections', async ({ request }) => {
  const response = await request.get(`${api}/api/coach/plan`);
  expect(response.ok()).toBeTruthy();
  const plan = await response.json();
  expect(plan.version).toBe('personal-training-plan-v1');
  expect(plan.priorities.length).toBeLessThanOrEqual(3);
  const summary = await request.get(`${api}/api/patterns`);
  expect(summary.ok()).toBeTruthy();
  const evidence = await summary.json();
  expect(plan.coverage.analyzed).toBe(evidence.analyzedGames);
  const invalid = await request.post(`${api}/api/coach/plan/start`, { data: { patternId: 'nonexistent' } });
  expect(invalid.status()).toBe(400);
  expect((await invalid.json()).error).toBe('plan_changed');
});
