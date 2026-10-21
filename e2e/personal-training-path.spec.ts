import { test, expect } from "@playwright/test";

const initial = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const afterReply = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
const guided = {
  id: "guided", positionId: "source-a", patternId: "piece-loss", fen: initial, originalFen: initial,
  color: "white", gameId: "game-a", moveNumber: 12, assisted: false, completed: false, repeated: false,
  role: "guided", status: "active", decisionCount: 0, targetDecisions: 3, awaitingNext: false,
  canStartHoldout: false, feedback: null,
};
const holdout = {
  ...guided, id: "holdout", positionId: "source-b", gameId: "game-b", moveNumber: 20,
  role: "holdout", targetDecisions: 1,
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("move-mirror-locale-v1", "es"));
});

test("guided decisions lead to an unlabeled independent holdout on mobile", async ({ page }) => {
  let guidedView: any = guided;
  let holdoutView: any = holdout;
  await page.route("**/api/patterns/practice/**", async route => {
    const url = new URL(route.request().url());
    const parts = url.pathname.split("/");
    const id = parts[4];
    const action = parts[5];
    if (route.request().method() === "GET") {
      return route.fulfill({ json: id === "holdout" ? holdoutView : guidedView });
    }
    if (id === "guided" && action === "move") {
      const result = {
        status: "verified_acceptable", chosenSan: "e4", replySan: "e5", resultingFen: afterReply,
        referenceSan: "e4", independent: false, assisted: false, decisionNumber: 1,
        targetDecisions: 3, canContinue: true, trainingStatus: "training",
      };
      guidedView = { ...guidedView, fen: afterReply, decisionCount: 1, status: "training", awaitingNext: true, feedback: result };
      return route.fulfill({ json: result });
    }
    if (id === "guided" && action === "retry") {
      guidedView = { ...guidedView, fen: initial, status: "active", decisionCount: 0, awaitingNext: false, feedback: null };
      return route.fulfill({ json: guidedView });
    }
    if (id === "guided" && action === "next") {
      guidedView = { ...guidedView, awaitingNext: false, feedback: null };
      return route.fulfill({ json: guidedView });
    }
    if (id === "guided" && action === "holdout") {
      guidedView = { ...guidedView, status: "completed", completed: true };
      return route.fulfill({ status: 201, json: holdoutView });
    }
    if (id === "holdout" && action === "move") {
      const result = {
        status: "verified_acceptable", chosenSan: "e4", replySan: "e5", resultingFen: afterReply,
        referenceSan: "e4", independent: true, assisted: false, decisionNumber: 1,
        targetDecisions: 1, canContinue: false, trainingStatus: "completed",
      };
      holdoutView = { ...holdoutView, fen: afterReply, decisionCount: 1, status: "completed", completed: true, feedback: result };
      return route.fulfill({ json: result });
    }
    return route.fulfill({ status: 400, json: { error: "unexpected_request" } });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/practice/guided");
  await expect(page.getByTestId("pattern-teaching")).toHaveCount(0);
  await page.getByTestId("play-board").locator('[data-square="e2"]').click();
  await page.getByTestId("play-board").locator('[data-square="e4"]').click();
  await page.getByRole("button", {name:"No encuentro una respuesta"}).click();
  await page.getByLabel("¿Qué intentabas conseguir con tu jugada?").fill("Quería ocupar el centro");
  await page.getByLabel("¿Cómo evaluabas la posición después de la respuesta que esperabas?").fill("Pensé que estaba igualada");
  await page.getByLabel("¿Qué tan seguro estabas de tu decisión?").selectOption("medium");
  await page.getByRole("button", {name:"Confirmar y analizar"}).click();
  await expect(page.getByTestId("personal-feedback")).toBeVisible();
  await page.getByTestId("practice-retry-decision").click();
  await expect(page.getByText("Decisión 1 de 3")).toBeVisible();
  guidedView = { ...guidedView, fen: afterReply, status: "training", decisionCount: 1, awaitingNext: true, feedback: {
    status: "verified_acceptable", chosenSan: "e4", replySan: "e5", resultingFen: afterReply, referenceSan: "e4",
    independent: false, assisted: false, decisionNumber: 1, targetDecisions: 3, canContinue: true, trainingStatus: "training" } };
  await page.reload();
  await page.getByTestId("practice-next-decision").click();
  await expect(page.getByText("Decisión 2 de 3")).toBeVisible();

  guidedView = { ...guidedView, status: "ready_for_holdout", canStartHoldout: true, decisionCount: 3,
    feedback: { status: "verified_best", chosenSan: "Nf3", replySan: "Nc6", resultingFen: afterReply,
      independent: false, assisted: false, decisionNumber: 3, targetDecisions: 3, canContinue: false,
      trainingStatus: "ready_for_holdout" } };
  await page.reload();
  await page.getByTestId("practice-start-holdout").click();
  await expect(page).toHaveURL(/practice\/holdout$/);
  await expect(page.getByRole("heading", { name: "Encuentra la decisión sin saber el tema" })).toBeVisible();
  await expect(page.getByText("Evitar perder piezas")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Necesito una pista" })).toHaveCount(0);
  await expect(page.getByText("De una partida tuya", { exact: false })).toHaveCount(0);

  await page.getByTestId("play-board").locator('[data-square="e2"]').click();
  await page.getByTestId("play-board").locator('[data-square="e4"]').click();
  await expect(page.getByText("Resultado registrado como comprobación independiente.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Volver a mi plan" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
