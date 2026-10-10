import { test, expect } from "@playwright/test";

/**
 * Garantía de UX: no spoiler en pantalla antes de confirmar.
 * Nota: la solución puede existir en el bundle JS; esto no es secreto criptográfico.
 */
test.describe("Train no-spoiler", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("move-mirror-locale-v1", "es");
    });
  });

  test("sin evaluación ni solución antes de confirmar", async ({ page }) => {
    let evaluatePosts = 0;
    await page.route("**/api/evaluate", async (route) => {
      evaluatePosts += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          status: "verified_best",
          verified: true,
          cpLoss: 0,
          opponentReplySan: "Nxg4",
          engineVersion: "Mock",
          engineSha256: "mock",
          evalBudgetId: "nodes-80k-v1",
          evalInitialBudgetId: "nodes-80k-v1",
          evalFinalBudgetId: "nodes-80k-v1",
          evalEscalated: false,
          evalEscalationReason: null,
          evalInitialStatus: "verified_best",
          evalFinalStatus: "verified_best",
          evalCriterionVersion: "engine-validated-v2",
          evalPipelineVersion: "eval-pipeline-v0.2.1",
          cacheHit: false,
          error: null,
        }),
      });
    });

    await page.goto("/train");
    await page.evaluate(() => localStorage.removeItem("move-mirror-state-v4"));

    const attemptsBefore = await page.evaluate(() => {
      const raw = localStorage.getItem("move-mirror-state-v4");
      if (!raw) return 0;
      return JSON.parse(raw).attempts?.length ?? 0;
    });

    const cctFields = page.getByTestId("train-flow").getByRole("textbox");
    await cctFields.nth(0).fill("Qg4 jaque lateral");
    await cctFields.nth(1).fill("Qxe4 captura");
    await cctFields.nth(2).fill("presión e4");
    await cctFields.nth(3).fill("Qxe4");
    await cctFields.nth(4).fill("Nxg4");

    await page.getByRole("button", { name: /Continuar al tablero/i }).click();

    const solutionNeedle = "Qxe4";
    const bodyText = await page.locator("[data-testid=train-root]").innerText();
    expect(bodyText).not.toContain("Alternativa recomendada");
    expect(bodyText).not.toMatch(/Óptima|Incorrecta|No verificada/);
    expect(evaluatePosts).toBe(0);

    await page.getByTestId("train-flow").locator("input.input").fill(solutionNeedle);
    await page.getByRole("button", { name: /Confirmar jugada escrita/i }).click();

    await page
      .getByTestId("train-flow")
      .locator("textarea.textarea")
      .last()
      .fill("Verifiqué jaque y captura del rival antes de mover.");

    await page.getByRole("button", { name: /Revisar antes de enviar/i }).click();

    const preConfirm = await page.locator("[data-testid=train-root]").innerText();
    expect(preConfirm).not.toContain("Línea recomendada");
    expect(preConfirm).not.toMatch(/Clasificación/i);
    expect(evaluatePosts).toBe(0);

    await page.getByTestId("train-submit").click();

    await expect(page.getByTestId("train-feedback")).toBeVisible();
    expect(evaluatePosts).toBe(1);

    await expect(page.getByTestId("train-feedback-classification")).toContainText(/Mejor opción/i);

    const attemptsAfter = await page.evaluate(() => {
      const raw = localStorage.getItem("move-mirror-state-v4");
      return JSON.parse(raw!).attempts.length;
    });
    expect(attemptsAfter).toBe(attemptsBefore + 1);
  });
});
