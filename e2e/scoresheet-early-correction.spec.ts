import { expect, test } from "@playwright/test";
import path from "node:path";
import { dragChessMoveByCoords } from "./helpers/chessboard";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("move-mirror-locale-v1", "es"));
});

test("corrección temprana invalida continuación", async ({ page }) => {
  await page.goto("/import/scoresheet");
  await page.locator('input[type="file"]').setInputFiles(path.join(process.cwd(), "fixtures/scoresheets/clear-en.png"));
  await page.getByRole("button", { name: /leer jugadas/i }).click();
  await expect(page.locator('input[value="ScoresheetAlice"]')).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /^continuar$/i }).click();
  await page.getByRole("button", { name: /jugadas/i }).click();
  await page.getByTestId("scoresheet-ply-1").getByRole("button").first().click();
  const board = page.getByTestId("scoresheet-board");
  await board.waitFor({ state: "visible" });
  await dragChessMoveByCoords(page, board, "d2", "d4", "white");
  await expect(page.getByTestId("scoresheet-ply-2")).toBeVisible();
  await page.getByTestId("scoresheet-ply-2").getByRole("button").first().click();
  await dragChessMoveByCoords(page, board, "d7", "d5", "black");
  await page.getByTestId("scoresheet-ply-3").getByRole("button").first().click();
  await dragChessMoveByCoords(page, board, "g1", "f3", "white");
  await page.getByTestId("scoresheet-ply-4").getByRole("button").first().click();
  await dragChessMoveByCoords(page, board, "b8", "c6", "black");
  for (const ply of [2, 3, 4]) {
    const confirm = page.getByTestId(`scoresheet-confirm-ply-${ply}`);
    if (await confirm.count()) await confirm.click();
  }
  await page.getByRole("button", { name: /^continuar$/i }).click();
  await page.getByRole("button", { name: /confirmar/i }).click();
  await page.getByTestId("scoresheet-final-confirm").check();
  await page.getByRole("button", { name: /importar partida/i }).click();
  await expect(page.getByText(/se importó/i)).toBeVisible({ timeout: 20_000 });
});
