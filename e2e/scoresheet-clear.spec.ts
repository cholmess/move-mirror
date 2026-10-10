import { expect, test } from "@playwright/test";
import path from "node:path";
import { finishScoresheetImport } from "./helpers/scoresheet-flow";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("move-mirror-locale-v1", "es"));
});

test("flujo claro", async ({ page }) => {
  await page.goto("/import/scoresheet");
  await page.locator('input[type="file"]').setInputFiles(path.join(process.cwd(), "fixtures/scoresheets/clear-en.png"));
  await expect(page.getByText(/transcripción de planilla/i)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /leer jugadas/i }).click();
  await expect(page.locator('input[value="ScoresheetAlice"]')).toBeVisible({ timeout: 20_000 });
  await finishScoresheetImport(page);
  await page.goto("/games");
  await expect(page.getByTestId("canonical-game").filter({ hasText: "ScoresheetBob" })).toHaveCount(1);
});
