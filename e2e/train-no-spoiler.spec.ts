import { test, expect } from "@playwright/test";
import { dragChessMove } from "./helpers/chessboard";

test.describe("guided training reasoning", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("move-mirror-locale-v1", "es");
      localStorage.removeItem("move-mirror-state-v4");
    });
  });

  test("shows the original silent validation failure as a visible focused error", async ({ page }) => {
    await page.goto("/train");
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("Indica si viste algún jaque.");
    await expect(page.locator(".reasoning-category").first()).toBeFocused();
  });

  test("accepts a move using keyboard controls without typing SAN", async ({ page }) => {
    await page.goto("/train");
    const captures = page.locator(".reasoning-category").nth(1);
    await captures.getByRole("button", { name: "Añadir jugada" }).click();
    await page.getByLabel("Casilla de origen").selectOption("f4");
    await page.getByLabel("Casilla de destino").selectOption("e4");
    await page.getByRole("button", { name: "Jugar movimiento seleccionado" }).click();
    await expect(captures).toContainText("Qxe4");
    const exerciseBefore = await page.getByTestId("train-exercise-select").inputValue();
    await page.getByTestId("language-select").selectOption("en");
    await expect(captures).toContainText("Qxe4");
    expect(await page.getByTestId("train-exercise-select").inputValue()).toBe(exerciseBefore);
  });

  test("opens notation help with hover and keyboard inside a mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/train");
    for (const label of ["No vi ningún jaque", "No vi ninguna captura", "No vi ninguna amenaza"]) {
      await page.getByRole("button", { name: label }).click();
    }
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    const trigger = page.getByRole("button", { name: "¿Cómo se escriben las jugadas?" });
    await trigger.hover();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.mouse.move(380, 820);
    await expect(page.getByRole("dialog")).toBeHidden();
    await trigger.focus();
    await trigger.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeFocused();
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await dialog.press("Escape");
    await expect(trigger).toBeFocused();
  });

  test("uses board clicks, no spoiler, candidate change, and one ledger event", async ({ page }) => {
    let evaluatePosts = 0;
    await page.route("**/api/evaluate", async (route) => {
      evaluatePosts += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        ok: true, status: "verified_best", verified: true, cpLoss: 0,
        opponentReplySan: "Nxg4", engineVersion: "Mock", engineSha256: "mock",
        evalBudgetId: "nodes-80k-v1", evalInitialBudgetId: "nodes-80k-v1",
        evalFinalBudgetId: "nodes-80k-v1", evalEscalated: false,
        evalEscalationReason: null, evalInitialStatus: "verified_best",
        evalFinalStatus: "verified_best", evalCriterionVersion: "engine-validated-v2",
        evalPipelineVersion: "eval-pipeline-v0.2.1", cacheHit: false, error: null,
      }) });
    });

    await page.goto("/train");
    const board = page.locator(".board-panel");
    const categories = page.locator(".reasoning-category");
    await categories.nth(0).getByRole("button", { name: "No vi ningún jaque" }).click();
    await categories.nth(1).getByRole("button", { name: "Añadir jugada" }).click();
    await dragChessMove(page, board, "f4", "e4", "black");
    await expect(categories.nth(1)).toContainText("Qxe4");
    await categories.nth(2).getByRole("button", { name: "Añadir jugada" }).click();
    await dragChessMove(page, board, "f4", "g4", "black");
    await expect(categories.nth(2)).toContainText("Qg4");

    await page.getByRole("button", { name: "¿Cómo se escriben las jugadas?" }).click();
    await expect(page.getByRole("dialog")).toContainText("MoveMirror escribe las jugadas por ti");
    await page.getByRole("dialog").press("Escape");
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await page.getByRole("button", { name: "Qxe4", exact: true }).click();
    expect(evaluatePosts).toBe(0);
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await page.getByRole("button", { name: "Seleccionar respuesta en el tablero" }).click();
    await dragChessMove(page, board, "a2", "a1", "black");
    await page.getByRole("button", { name: "Continuar", exact: true }).click();

    await page.getByRole("button", { name: "Cambiar mi jugada" }).click();
    await page.getByRole("button", { name: "Qg4", exact: true }).click();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await page.getByRole("button", { name: "Seleccionar respuesta en el tablero" }).click();
    await dragChessMove(page, board, "h2", "g4", "black");
    await page.getByRole("button", { name: "Continuar", exact: true }).click();

    expect(evaluatePosts).toBe(0);
    await expect(page.getByTestId("train-root")).not.toContainText("Alternativa recomendada");
    await page.getByTestId("train-submit").click();
    await expect(page.getByTestId("train-feedback")).toBeVisible();
    expect(evaluatePosts).toBe(1);

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("move-mirror-state-v4")!));
    expect(stored.attempts).toHaveLength(1);
    expect(stored.attempts[0].reasoningV2.version).toBe("training-reasoning-v2");
    expect(stored.attempts[0].reasoningV2.candidate).toEqual({ uci: "f4g4", san: "Qg4" });
    const attemptId = stored.attempts[0].id;
    expect(stored.pedagogyEvents.filter((event: { attemptId: string }) => event.attemptId === attemptId)).toHaveLength(1);
  });

  for (const [locale, heading] of [["es", "Antes de decidirte"], ["en", "Before you decide"], ["de", "Prüfe deine Möglichkeiten"]] as const) {
    test(`renders the guided flow in ${locale}`, async ({ page }) => {
      await page.addInitScript((language) => localStorage.setItem("move-mirror-locale-v1", language), locale);
      await page.goto("/train");
      await expect(page.getByRole("heading", { name: new RegExp(heading) })).toBeVisible();
      await expect(page.locator(".reasoning-category")).toHaveCount(3);
    });
  }
});
