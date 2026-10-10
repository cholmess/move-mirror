import { test, expect } from "@playwright/test";

/**
 * Garantía de UX: no spoiler en pantalla antes de confirmar.
 * Nota: la solución puede existir en el bundle JS; esto no es secreto criptográfico.
 */
test.describe("Train no-spoiler", () => {
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
    await page.evaluate(() => localStorage.removeItem("move-mirror-state-v2"));

    const attemptsBefore = await page.evaluate(() => {
      const raw = localStorage.getItem("move-mirror-state-v2");
      if (!raw) return 0;
      return JSON.parse(raw).attempts?.length ?? 0;
    });

    await page.getByLabel(/Jaques considerados/i).fill("Qg4 jaque lateral");
    await page.getByLabel(/Capturas consideradas/i).fill("Qxe4 captura");
    await page.getByLabel(/Amenazas consideradas/i).fill("presión e4");
    await page.getByLabel(/Primera candidata/i).fill("Qxe4");
    await page.getByLabel(/Mejor respuesta forzada del rival/i).fill("Nxg4");

    await page.getByRole("button", { name: /Continuar al tablero/i }).click();

    const solutionNeedle = "Qxe4";
    const bodyText = await page.locator("[data-testid=train-root]").innerText();
    expect(bodyText).not.toContain("Alternativa recomendada");
    expect(bodyText).not.toMatch(/Óptima|Incorrecta|No verificada/);
    expect(evaluatePosts).toBe(0);

    await page.getByPlaceholder("ej. Qxe4").fill(solutionNeedle);
    await page.getByRole("button", { name: /Confirmar jugada escrita/i }).click();

    await page
      .getByPlaceholder(/Por qué elegiste esta jugada/i)
      .fill("Verifiqué jaque y captura del rival antes de mover.");

    await page.getByRole("button", { name: /Revisar antes de enviar/i }).click();

    const preConfirm = await page.locator("[data-testid=train-root]").innerText();
    expect(preConfirm).not.toContain("Línea recomendada");
    expect(preConfirm).not.toMatch(/Clasificación/i);
    expect(evaluatePosts).toBe(0);

    await page.getByTestId("train-submit").click();

    await expect(page.getByTestId("train-feedback")).toBeVisible();
    expect(evaluatePosts).toBe(1);

    const post = await page.locator("[data-testid=train-feedback]").innerText();
    expect(post).toMatch(/Clasificación|Óptima|Aceptable|Imprecisa|Incorrecta|No verificada/);

    const attemptsAfter = await page.evaluate(() => {
      const raw = localStorage.getItem("move-mirror-state-v2");
      return JSON.parse(raw!).attempts.length;
    });
    expect(attemptsAfter).toBe(attemptsBefore + 1);
  });
});
