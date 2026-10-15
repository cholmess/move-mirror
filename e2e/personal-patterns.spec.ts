import { test, expect } from "@playwright/test";
import { Chess } from "chess.js";
import { randomUUID } from "node:crypto";
const base = `http://127.0.0.1:${process.env.E2E_ENGINE_PORT ?? "8791"}`;
test.beforeEach(async ({ page }) => {
  await page.addInitScript(()=>localStorage.setItem("move-mirror-locale-v1","es"));
});
test("patterns panel provides update, evidence and no unsupported diagnosis", async ({ page }) => {
  await page.route("**/api/patterns", route=>route.fulfill({json:{revision:1,eligibleGames:3,analyzedGames:3,verifiedDecisions:30,recommended:["closed-center"],job:{status:"completed"},patterns:[{
    id:"closed-center",kind:"context",errors:3,games:3,opportunities:12,status:"recurrent",confidence:"limited",examples:[],practice:{attempts:0},transfer:{status:"insufficient"}
  }]}}));
  await page.goto("/patterns");
  await expect(page.getByTestId("pattern-closed-center")).toContainText("3 errores en 3 partidas");
  await expect(page.getByText("Sabemos en qué contexto ocurrieron estos errores; todavía no sabemos por qué.")).toBeVisible();
  await expect(page.getByRole("button",{name:"Practicar este patrón"})).toBeEnabled();
});
test("real engine: imported games yield a new pattern that can be practiced and updated", async ({ page, request }) => {
  test.setTimeout(150000);
  const health = await (await request.get(`${base}/health`)).json();
  test.skip(!health.engineAvailable,"Requires Stockfish");
  // One isolated server per Playwright run; fresh pattern state, no frozen transfer cohort changes.
  const user = `patterns-${randomUUID().slice(0,8)}`;
  await request.patch(`${base}/api/player-identity`,{data:{pgnNameAliases:[user]}});
  const variations = ["Nc6","d6","Nf6"];
  const pgns = variations.map((reply,i)=>{
    const chess=new Chess();
    const tail = reply === "Nc6" ? ["Nf3","Nf6","Bc4","d6"] : reply === "d6" ? ["Nf3","Nc6","Bc4","Nf6"] : ["Nf3","Nc6","Bc4","d6"];
    for(const san of ["e4","e5","Qh5",reply,"Qxh7","Rxh7",...tail])chess.move(san);
    chess.header("Event",`Pattern test ${i}`,"White",user,"Black","opponent","Date",`2026.09.0${i+1}`,"UTCDate",`2026.09.0${i+1}`,"UTCTime","10:00:00","Result","0-1","TimeControl","600");
    return chess.pgn();
  });
  const imported=await (await request.post(`${base}/api/import/pgn-text`,{data:{pgn:pgns.join("\n\n")}})).json();
  expect(imported.summary.failed).toBe(0);
  // No explicit update: successful import must trigger analysis on its own.
  await expect.poll(async()=>{const s=await (await request.get(`${base}/api/patterns`)).json();if (s.job.status === "failed") throw new Error(s.job.error); return s.patterns.find((p:any)=>p.id==="piece-loss")?.status;},{timeout:120000,intervals:[1000]}).toBe("recurrent");
  await page.goto("/patterns");
  const card=page.getByTestId("pattern-piece-loss");
  await card.getByRole("button",{name:"Practicar este patrón"}).click();
  await expect(page.getByTestId("personal-practice")).toBeVisible();
  const exId=page.url().split("/").at(-1)!;
  const ex=await (await request.get(`${base}/api/patterns/practice/${exId}`)).json();
  expect(ex.referenceSan).toBeUndefined();
  await page.getByRole("button",{name:"Necesito una pista"}).click();
  const board=page.getByTestId("play-board");
  await board.locator("summary").click();
  await board.locator("select").nth(0).selectOption({index:1});
  await board.locator("select").nth(1).selectOption({index:1});
  await board.getByRole("button",{name:"Jugar movimiento seleccionado"}).click();
  await expect(page.getByTestId("personal-feedback")).toBeVisible({timeout:30000});
  await expect(page.getByText("Este intento sirve para practicar; no cuenta como un primer intento independiente.")).toBeVisible();
  await page.getByRole("button",{name:"Volver a intentar"}).click();
  await expect(page).not.toHaveURL(new RegExp(exId));
  await expect(page.getByTestId("personal-practice")).toBeVisible();
  const after=await (await request.get(`${base}/api/patterns`)).json();
  expect(after.patterns.find((p:any)=>p.id==="piece-loss").practice.independent).toBe(0);
  const revision=after.revision;
  await request.post(`${base}/api/patterns/update`);
  await expect.poll(async()=> (await (await request.get(`${base}/api/patterns`)).json()).job.status).toBe("completed");
  expect((await (await request.get(`${base}/api/patterns`)).json()).revision).toBe(revision);
});
test("mobile patterns fit the viewport", async ({ page }) => {
  await page.setViewportSize({width:390,height:844});await page.goto("/patterns");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test("real evaluator preserves root, score perspective and a legal opponent reply", async ({ request }) => {
  const health=await(await request.get(`${base}/health`)).json();test.skip(!health.engineAvailable,"Requires Stockfish");
  const chess=new Chess();const fen=chess.fen();
  const result=await(await request.post(`${base}/api/evaluate`,{data:{fen,moveUci:"e2e4"}})).json();
  expect(result.verified).toBe(true);expect(result.evalPipelineVersion).toBe("eval-pipeline-v0.2.2");
  expect(result.played.pvUci[0]).toBe("e2e4");
  chess.move("e4");const reply=result.opponentReplyUci;
  expect(()=>chess.move({from:reply.slice(0,2),to:reply.slice(2,4),promotion:reply[4]})).not.toThrow();
});
