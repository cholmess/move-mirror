import { expect, test } from "@playwright/test";
import { dragChessMove } from "./helpers/chessboard";

const ENGINE = process.env.E2E_ENGINE_URL ?? `http://127.0.0.1:${process.env.E2E_ENGINE_PORT ?? "8791"}`;

const PGN = `[Event "Import Hub E2E"]
[Site "Local"]
[Date "2026.10.10"]
[White "ImportAlice"]
[Black "ImportBob"]
[Result "1-0"]
[TimeControl "600"]

1. a3 h6 2. b3 g6 3. c3 f6 4. d3 e6 5. e3 d6 1-0`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("move-mirror-locale-v1", "es");
  });
});

test("pegar PGN, revisar identidad y reimportar sin duplicar", async ({ page }) => {
  await page.goto("/import");
  await page.getByLabel("PGN pegado").fill(PGN);
  await page.getByRole("button", { name: "Validar y previsualizar" }).click();
  await expect(page.locator(".preview-box strong")).toHaveText(/1 partida detectada/i);
  const confirmImport = page.getByRole("button", { name: "Confirmar importación" });
  await expect(confirmImport).toBeEnabled();
  const importResponse = page.waitForResponse(
    (res) => res.url().includes("/api/import/pgn-text") && res.ok(),
  );
  await confirmImport.click();
  await importResponse;
  await expect(page.locator('[data-testid^="job-"]').first()).toContainText(/1 encontradas|1 found/i, {
    timeout: 15_000,
  });

  await page.goto("/games");
  const card = page.getByTestId("canonical-game").filter({ hasText: "ImportAlice" });
  await expect(card).toHaveCount(1);
  await expect(card.locator(".badge", { hasText: "Confirma tu color" })).toBeVisible();
  await card.getByRole("button", { name: "Jugué con blancas" }).click();
  const resolved = page.getByTestId("canonical-game").filter({ hasText: "ImportBob" });
  await expect(resolved.getByText("Identidad confirmada")).toBeVisible();
  await expect(resolved.getByText("Elegible para coaching")).toBeVisible();

  await page.goto("/import");
  await page.getByLabel("PGN pegado").fill(PGN);
  await page.getByRole("button", { name: "Validar y previsualizar" }).click();
  await expect(page.locator(".preview-box strong")).toHaveText(/1 partida detectada/i);
  const reimport = page.getByRole("button", { name: "Confirmar importación" });
  await expect(reimport).toBeEnabled();
  const reimportResponse = page.waitForResponse(
    (res) => res.url().includes("/api/import/pgn-text") && res.ok(),
  );
  await reimport.click();
  await reimportResponse;
  await expect(page.locator('[data-testid^="job-"]').first()).toContainText(/ya guardadas|already saved/i, {
    timeout: 15_000,
  });
  await page.goto("/games");
  await expect(page.getByTestId("canonical-game").filter({ hasText: "ImportBob" })).toHaveCount(1);
});

test("entrada manual con tablero real: mover, deshacer y corregir continuación", async ({ page, request }) => {
  await page.goto("/import/manual");
  await expect(page.getByText("Inicio estándar")).toBeVisible();

  const board = page.getByTestId("manual-board");
  await expect(board).toBeVisible();

  await dragChessMove(page, board, "e2", "e4", "white");
  await expect(page.getByTestId("ply-counter")).toHaveText("1 / 1");
  await dragChessMove(page, board, "e7", "e5", "white");
  await expect(page.getByTestId("ply-counter")).toHaveText("2 / 2");

  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(page.getByTestId("ply-counter")).toHaveText("1 / 2");

  await dragChessMove(page, board, "c7", "c5", "white");
  await expect(page.getByTestId("ply-counter")).toHaveText("2 / 2");
  await expect(page.locator(".move-list")).toContainText("e4");
  await expect(page.locator(".move-list")).toContainText("c5");
  await expect(page.locator(".move-list")).not.toContainText("e5");

  await page.getByRole("textbox", { name: "Rival", exact: true }).fill("ManualRivalE2E");
  await page.getByRole("textbox", { name: /Ritmo \(p\. ej\. 10 minutos\)/i }).fill("600+0");
  await page.locator("label.field", { hasText: "Resultado" }).getByRole("combobox").selectOption("1-0");
  await page.locator("label.field", { hasText: "Mi color" }).getByRole("combobox").selectOption("white");
  await page.getByRole("button", { name: /Confirmar partida/i }).click();
  await expect(page.getByRole("heading", { name: /Partida guardada/i })).toBeVisible({ timeout: 15_000 });

  await page.getByRole("link", { name: "Abrir biblioteca" }).click();
  const card = page.getByTestId("canonical-game").filter({ hasText: "ManualRivalE2E" });
  await expect(card).toBeVisible();
  const pgnHref = await card.getByRole("link", { name: /Exportar PGN|Export PGN/i }).getAttribute("href");
  expect(pgnHref).toMatch(/\/api\/games\/.+\/pgn/);
  const pgnResponse = await request.get(`${ENGINE}${pgnHref}`);
  const pgnText = await pgnResponse.text();
  expect(pgnText).toMatch(/1\. e4 c5/);
  expect(pgnText).not.toMatch(/1\. e4 e5/);
});

test("rutas productivas siguen disponibles", async ({ page }) => {
  for (const route of ["/", "/train", "/defense", "/transfer", "/profile"]) {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByText("not found")).toHaveCount(0);
  }
});
