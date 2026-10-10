import { expect, test } from "@playwright/test";
import path from "node:path";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("move-mirror-locale-v1", "es"));
});

test("PDF de dos páginas atraviesa el pipeline", async ({ page }) => {
  await page.goto("/import/scoresheet");
  await page.locator('input[type="file"]').setInputFiles(path.join(process.cwd(), "fixtures/scoresheets/two-page-pdf.pdf"));
  await expect(page).toHaveURL(/\/import\/scoresheet\/[a-f0-9-]+/, { timeout: 15_000 });
  await expect(page.getByTestId("scoresheet-apply-preprocess")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("scoresheet-apply-preprocess").click();
  await page.getByRole("button", { name: /leer jugadas/i }).click();
  await expect(page.getByRole("button", { name: /^continuar$/i })).toBeVisible({ timeout: 20_000 });
});
