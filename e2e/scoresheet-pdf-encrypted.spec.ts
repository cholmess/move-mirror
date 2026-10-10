import { expect, test } from "@playwright/test";
import path from "node:path";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("move-mirror-locale-v1", "es"));
});

test("PDF cifrado muestra error claro", async ({ page }) => {
  await page.goto("/import/scoresheet");
  await page.locator('input[type="file"]').setInputFiles(path.join(process.cwd(), "fixtures/scoresheets/encrypted.pdf"));
  await expect(page.getByText(/pdf está protegido/i)).toBeVisible({ timeout: 10_000 });
});
