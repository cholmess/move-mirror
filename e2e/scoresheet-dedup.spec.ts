import { expect, test } from "@playwright/test";
import path from "node:path";
import { finishScoresheetImport } from "./helpers/scoresheet-flow";

const PGN = `[Event "Dedup"]
[White "DedupAlice"]
[Black "DedupBob"]
[Result "*"]
1. a3 h6 2. b3 g6 *`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("move-mirror-locale-v1", "es"));
});

test("deduplicación scoresheet y PGN", async ({ page }) => {
  await page.goto("/import/scoresheet");
  await page.locator('input[type="file"]').setInputFiles(path.join(process.cwd(), "fixtures/scoresheets/dedup-scoresheet.png"));
  await page.getByRole("button", { name: /leer jugadas/i }).click();
  await expect(page.locator('input[value="DedupAlice"]')).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /^continuar$/i }).click();
  await page.getByRole("button", { name: /jugadas/i }).click();
  await finishScoresheetImport(page);

  await page.goto("/import");
  await page.getByLabel(/pgn pegado/i).fill(PGN);
  await page.getByRole("button", { name: /validar y previsualizar/i }).click();
  await page.getByRole("button", { name: /confirmar importación/i }).click();
  await expect(page.locator('[data-testid^="job-"]').first()).toContainText(/ya guardadas|already saved/i, { timeout: 20_000 });

  await page.goto("/games");
  await expect(page.getByTestId("canonical-game").filter({ hasText: "DedupBob" })).toHaveCount(1);
});
