import { test, expect } from '@playwright/test';
const curriculum = { version: 'adaptive-curriculum-v1', patternId: 'closed-center', slot: 'primary', action: 'diagnose', reasonKey: 'hypothesis_required', previousCategory: null, targetCategory: 'insufficient_evidence', evidence: { hypothesisStatus: 'missing', holdoutOutcome: 'missing', holdoutAt: null, transferStatus: 'insufficient', differencePer100: null, causal: false } };
const base = { version: 'personal-training-plan-v4', evidenceRevision: 1, state: 'personalized', coverage: { analyzed: 12, eligible: 15, decisions: 240 }, job: { status: 'completed' }, curriculum: [curriculum], portfolio: { version: 'personal-skill-definitions-v1', evidencePolicy: 'pattern_isolated', primaryPatternId: 'closed-center', supportPatternId: null, maintenancePatternId: null },
  primary: { kind: 'pattern', patternId: 'closed-center' }, priorities: [{ patternId: 'closed-center', kind: 'context', confidence: 'limited', reason: 'new', evidence: { errors: 4, games: 3, opportunities: 30 }, practice: { attempts: 0 }, transfer: { status: 'insufficient' }, curriculum }] };
test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.setItem('move-mirror-locale-v1', 'es')); });
test('current plan, recovery, practice start and mobile layout', async ({ page }) => {
  let updated = false;
  await page.route('**/api/coach/plan', r => r.fulfill({ json: updated ? { ...base, primary: { kind: 'resume_pattern', patternId: 'closed-center' } } : base }));
  await page.route('**/api/coach/plan/start', r => { updated = true; return r.fulfill({ json: { href: '/practice/saved-plan' } }); });
  await page.route('**/api/patterns/practice/saved-plan', r => r.fulfill({ json: { id: 'saved-plan', patternId: 'closed-center', positionId: 'position', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', color: 'white', gameId: 'source', moveNumber: 1, completed: false } }));
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.getByTestId('plan-coverage')).toContainText('12 de 15');
  await expect(page.getByTestId('plan-closed-center')).toContainText('todavía no sabemos por qué');
  await expect(page.getByTestId('curriculum-closed-center')).toContainText('Foco principal');
  await expect(page.getByTestId('focus-portfolio')).toContainText('La evidencia permanece separada por habilidad');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByTestId('plan-start').click(); await expect(page.getByTestId('personal-practice')).toBeVisible();
  await page.goto('/'); await expect(page.getByTestId('plan-start')).toHaveText('Continuar mi práctica');
  await page.getByTestId('plan-start').click(); await expect(page).toHaveURL(/practice\/saved-plan$/);
});
test('missing evidence is not presented as a personal diagnosis; update refreshes focus', async ({ page }) => {
  let analyzed = false;
  await page.route('**/api/coach/plan', r => r.fulfill({ json: analyzed ? base : { ...base, state: 'needs_analysis', coverage: { analyzed: 0, eligible: 15, decisions: 0 }, priorities: [], primary: { kind: 'foundation', patternId: null } } }));
  await page.route('**/api/patterns/update', r => { analyzed = true; return r.fulfill({ json: {} }); });
  await page.goto('/coach');
  await expect(page.getByTestId('plan-start')).toHaveText('Entrenar fundamentos');
  await expect(page.getByText('No es un diagnóstico nuevo de tus partidas.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Analizar partidas y actualizar' }).click();
  await expect(page.getByTestId('plan-focus')).toHaveText('Decisiones en centros bloqueados');
  await expect(page.getByTestId('plan-start')).toHaveText('Entrenar conmigo');
});
test('a failed refresh has a visible recovery and never sends a stale start', async ({ page }) => {
  let fail = true;
  await page.route('**/api/coach/plan', r => r.fulfill(fail ? { status: 503, json: { error: 'offline' } } : { json: base }));
  await page.goto('/'); await expect(page.getByRole('alert')).toContainText('No pudimos actualizar');
  fail = false; await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.getByTestId('plan-start')).toBeEnabled();
});
