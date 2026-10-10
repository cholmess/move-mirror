import { expect, test } from "@playwright/test";
import path from "node:path";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("move-mirror-locale-v1", "es"));
});

test("ambigüedad bloqueada hasta confirmar jugada", async ({ page }) => {
  await page.goto("/import/scoresheet");
  await page.locator('input[type="file"]').setInputFiles(path.join(process.cwd(), "fixtures/scoresheets/ambiguous-legal-moves.png"));
  await page.getByRole("button", { name: /leer jugadas/i }).click();
  await expect(page.getByRole("button", { name: /^continuar$/i })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /^continuar$/i }).click();
  await page.getByRole("button", { name: /jugadas/i }).click();
  await expect(page.getByTestId("scoresheet-ply-1")).toBeVisible();
  await page.getByTestId("scoresheet-ply-3").getByRole("button").first().click();
  await expect(page.getByTestId("scoresheet-confirm-ply-3")).toBeVisible();
  await expect(page.getByRole("button", { name: /^continuar$/i })).toBeDisabled();
  const candidate = page.locator(".candidate-list button").first();
  await expect(candidate).toBeVisible();
  await candidate.click();
  await expect(page.getByRole("button", { name: /^continuar$/i })).toBeEnabled();
  await page.getByRole("button", { name: /^continuar$/i }).click();
  await page.getByRole("button", { name: /confirmar/i }).click();
  await page.getByTestId("scoresheet-final-confirm").check();
  await page.getByRole("button", { name: /importar partida/i }).click();
  await expect(page.getByText(/se importó/i)).toBeVisible({ timeout: 20_000 });
});
