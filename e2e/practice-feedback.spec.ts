import { test, expect } from "@playwright/test";
const routePath="/train?exercise=ex-183971526340-m42";
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem("move-mirror-locale-v1","es"));});
test("reference move with failed verification is recognized and the idea visibly continues",async({page})=>{
  await page.route("**/api/evaluate",r=>r.fulfill({json:{verified:false,status:"unverified",error:"engine_unavailable"}}));
  await page.goto(routePath);
  const board=page.getByTestId("play-board");
  await board.locator('[data-square="b7"]').click();await board.locator('[data-square="b1"]').click();
  await expect(page.getByTestId("direct-feedback")).toContainText("Coincide con la solución del ejercicio");
  await expect(page.getByTestId("direct-feedback")).not.toContainText("Movimiento tranquilo de peón");
  await expect(page.getByText("El motor no está disponible.",{exact:false})).toBeVisible();
  await page.getByRole("button",{name:"Mostrar la idea en el tablero"}).click();
  await expect(page.getByTestId("reference-replay")).toContainText("la dama bloquea el jaque");
  await page.getByRole("button",{name:"Ver la continuación"}).click();
  await expect(board.locator('[data-square="f1"] [data-piece="wQ"]')).toBeVisible();
  await page.getByRole("button",{name:"Ver la continuación"}).click();
  await expect(board.locator('[data-square="f1"] [data-piece="bR"]')).toBeVisible();
  await expect(board.locator('[data-piece="wQ"]')).toHaveCount(0);
  await page.getByRole("button",{name:"Jugada anterior"}).click();
  await expect(board.locator('[data-square="f1"] [data-piece="wQ"]')).toBeVisible();
});
test("same move can be reevaluated when the service becomes available",async({page})=>{
  let calls=0;await page.route("**/api/evaluate",r=>r.fulfill({json:++calls===1?{verified:false,status:"unverified",error:"network_error"}:{verified:true,status:"verified_best",cpLoss:0}}));
  await page.goto(routePath);const board=page.getByTestId("play-board");
  await board.locator('[data-square="b7"]').click();await board.locator('[data-square="b1"]').click();
  await page.getByRole("button",{name:"Reintentar evaluación"}).click();
  await expect(page.getByRole("button",{name:"Reintentar evaluación"})).toHaveCount(0);
  await expect(page.getByTestId("direct-feedback")).not.toContainText("Evaluación pendiente");
  expect(calls).toBe(2);
});
test("reported rook move is verified with a live engine",async({page,request})=>{
  const health=await(await request.get(`http://127.0.0.1:${process.env.E2E_ENGINE_PORT??"8791"}/health`)).json();
  test.skip(!health.engineAvailable,"Requires Stockfish");
  await page.goto(routePath);const board=page.getByTestId("play-board");
  await board.locator('[data-square="b7"]').click();await board.locator('[data-square="b1"]').click();
  await expect(page.getByRole("button",{name:"Mostrar la respuesta del rival"})).toBeVisible({timeout:30000});
  await expect(page.getByTestId("direct-feedback")).not.toContainText("Evaluación pendiente");
  await expect(page.getByRole("button",{name:"Reintentar evaluación"})).toHaveCount(0);
});
