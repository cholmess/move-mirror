import { expect, type Page } from "@playwright/test";

export async function confirmPendingPlies(page: Page) {
  for (let ply = 1; ply <= 80; ply += 1) {
    const confirm = page.getByTestId(`scoresheet-confirm-ply-${ply}`);
    if (!(await confirm.count())) continue;
    await page.getByTestId(`scoresheet-ply-${ply}`).getByRole("button").first().click();
    await confirm.click();
  }
}

export async function finishScoresheetImport(page: Page) {
  await confirmPendingPlies(page);
  await page.getByRole("button", { name: /^continuar$/i }).click();
  await page.getByRole("button", { name: /jugadas/i }).click();
  await page.getByRole("button", { name: /^continuar$/i }).click();
  await page.getByRole("button", { name: /confirmar/i }).click();
  await page.getByTestId("scoresheet-final-confirm").check();
  await page.getByRole("button", { name: /importar partida/i }).click();
  await expect(page.getByText(/se importó/i)).toBeVisible({ timeout: 20_000 });
}
