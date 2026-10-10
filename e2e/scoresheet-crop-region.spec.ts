import { expect, test } from "@playwright/test";
import path from "node:path";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("move-mirror-locale-v1", "es"));
});

test("crop y región aplican preprocesamiento", async ({ page }) => {
  await page.goto("/import/scoresheet");
  await page.locator('input[type="file"]').setInputFiles(path.join(process.cwd(), "fixtures/scoresheets/clear-en.png"));
  await page.getByTestId("scoresheet-apply-preprocess").click();
  await expect(page.getByRole("button", { name: /leer jugadas/i })).toBeEnabled();
});
