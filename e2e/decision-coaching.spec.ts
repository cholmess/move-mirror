import { test, expect } from '@playwright/test';
import { Chess } from 'chess.js';

test('candidate and expected reply precede feedback; observation survives reload; holdout stays blind', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('move-mirror-locale-v1', 'es'));
  const root = new Chess(); const initialFen = root.fen(); root.move('e4'); const candidateFen = root.fen(); root.move('e5');
  const resultingFen = root.fen(); let submitted: any = null; let feedback: any = null; let reflection: any = null;
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/api/patterns/practice/demo', route => route.fulfill({ json: {
    id:'demo', positionId:'p1', patternId:'piece-loss', fen: feedback ? resultingFen : initialFen,
    originalFen: initialFen, color:'white', gameId:'g1', moveNumber:1, assisted:false,
    completed:false, repeated:false, role:'guided', status:feedback ? 'training':'active',
    decisionCount:feedback ? 1:0, targetDecisions:3, awaitingNext:!!feedback, feedback,
    evidenceSummary:{errors:4,games:3,opportunities:20,confidence:'limited'},
    diagnostic: feedback?.diagnostic ? {...feedback.diagnostic,reflection} : null,
  }}));
  await page.route('**/api/patterns/practice/demo/move', async route => {
    submitted = route.request().postDataJSON();
    feedback = { status:'incorrect', chosenSan:'e4', replySan:'e5', resultingFen, referenceSan:'d4', independent:false, assisted:false,
      decisionNumber:1, targetDecisions:3, canContinue:true, trainingStatus:'training',
      coaching:{intervention:'evaluate', hypothesis:'consequences', predictedSan:'e5',replyVerified:true,rootFen:initialFen,candidateFen,referenceFen:null},
      diagnostic:{question:'¿Cómo evaluabas la posición?',status:'available',source:null,reflection:null,llm:{enabled:true,configured:true,provider:'fake',model:'fixture'}} };
    await route.fulfill({json:feedback});
  });
  await page.route('**/api/patterns/practice/demo/reflection', async route => {
    reflection={id:'r1',source:'llm',question:'¿Cómo evaluabas la posición?',generatedAt:'2026-10-21T10:00:00Z',sources:[{evidenceId:'current_decision',gameId:'g1',moveNumber:1}],output:{
      primaryHypothesis:{category:'consequence_evaluation',statement:'Calculaste la respuesta, pero probablemente valoraste de forma distinta sus consecuencias.',confidence:'low',supportingEvidenceIds:['current_decision'],contradictingEvidenceIds:[]},
      alternativeHypotheses:[{category:'calculation_depth',statement:'También es posible que hayas detenido la variante demasiado pronto.'}],
      teaching:{objective:'Separar cálculo y evaluación',explanation:'Compara material, rey y actividad al final de la variante.',evidenceIds:['current_decision'],contrast:{worksWhen:'La actividad compensa la concesión.',failsWhen:'La respuesta rival gana material sin compensación.',evidenceIds:['current_decision','engine_reply']}},
      nextTest:{skill:'consequence_evaluation',instruction:'Evalúa la posición final antes de escoger.',successSignal:'Reconoce la consecuencia sin pistas.'}
    }};
    await route.fulfill({json:reflection});
  });
  await page.goto('/practice/demo');
  await expect(page.getByTestId('pattern-teaching')).toHaveCount(0);
  async function move(from:string,to:string) {
    const board=page.getByTestId('play-board');
    await board.locator('details').evaluate((el:HTMLDetailsElement)=>el.open=true);
    await board.locator('select').nth(0).selectOption(from);
    await board.locator('select').nth(1).selectOption(to);
    await board.getByRole('button',{name:'Jugar movimiento seleccionado'}).click();
  }
  await move('e2','e4');
  await expect(page.getByTestId('decision-prediction')).toBeVisible();
  expect(submitted).toBeNull();
  await move('e7','e5');
  expect(submitted).toBeNull();
  await page.getByRole('button',{name:'Confirmar y analizar'}).click();
  await expect(page.getByTestId('decision-coaching')).toContainText('Viste una respuesta fuerte');
  expect(submitted).toEqual({moveUci:'e2e4',prediction:{replyUci:'e7e5'}});
  await page.getByLabel('¿Qué intentabas conseguir con tu jugada?').fill('Quería ganar espacio en el centro');
  await page.getByLabel('¿Cómo evaluabas la posición después de la respuesta que esperabas?').fill('Pensé que estaba igualada');
  await page.getByTestId('pedagogy-submit').click();
  await expect(page.getByTestId('pedagogy-result')).toContainText('Calculaste la respuesta');
  await expect(page.getByTestId('pedagogy-result')).toContainText('Otras explicaciones');
  await page.getByRole('button',{name:'Después de mi jugada',exact:true}).click();
  await page.reload();
  await expect(page.getByTestId('decision-coaching')).toContainText('Viste una respuesta fuerte');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.route('**/api/patterns/practice/blind', route=>route.fulfill({json:{id:'blind',patternId:'piece-loss',fen:initialFen,originalFen:initialFen,color:'white',role:'holdout',status:'active',decisionCount:0,targetDecisions:1}}));
  await page.goto('/practice/blind');
  await expect(page.getByTestId('pattern-teaching')).toHaveCount(0);
  await expect(page.getByTestId('decision-prediction')).toHaveCount(0);
  await expect(page.getByText('Encuentra la decisión sin saber el tema')).toBeVisible();
});
