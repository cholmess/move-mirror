import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("move-mirror-locale-v1", "es");
  });
});

test("Defense Lab oculta solución, confirma una jugada y no altera la dosis", async ({ page }) => {
  let confirmPosts = 0;
  let evaluatePosts = 0;
  let nextPosts = 0;
  const prompts = [
    {
      exerciseId: "def-game-1-1",
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      orientation: "white",
      phase: "opening",
      sourceContext: { playedAt: "2026-01-01T00:00:00Z", playerColor: "white", moveNumber: 1, opening: null },
      previousMoveSan: null,
      promptKey: "default",
      selectionReason: { key: "lowDomainEvidence" },
    },
    {
      exerciseId: "def-game-2-9",
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      orientation: "white",
      phase: "opening",
      sourceContext: { playedAt: "2026-01-02T00:00:00Z", playerColor: "white", moveNumber: 5, opening: null },
      previousMoveSan: "e5",
      promptKey: "default",
      selectionReason: { key: "adaptiveVariety" },
    },
  ];

  await page.route("**/api/evaluate", async (route) => {
    evaluatePosts += 1;
    await route.abort();
  });
  await page.route("**/api/defense/next", async (route) => {
    nextPosts += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, exercise: prompts[Math.min(nextPosts - 1, 1)] }),
    });
  });
  await page.route("**/api/defense/confirm", async (route) => {
    confirmPosts += 1;
    const request = route.request().postDataJSON();
    expect(request.perceivedThreat).toContain("capture");
    expect(request.defenseReasoning).toContain("centro");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        feedback: {
          exerciseId: request.exerciseId,
          evaluationStatus: "verified_acceptable",
          evaluationId: "eval-1",
          cpLoss: 20,
          opponentReplySan: "e5",
          threat: { type: "capture", description: "El rival podía capturar.", confidence: "high" },
          motif: {
            resource: "counterattack",
            confidence: "medium",
            evidence: ["La defensa gana un tiempo."],
            classifierVersion: "defense-motif-v1",
          },
          referenceDefenseSan: "d4",
          actualPlayedMoveSan: "a3",
          actualPunishmentLineSan: ["a3", "e5"],
          defenseReferenceLineSan: ["d4", "d5"],
          pedagogy: {
            observable: "Había una captura.",
            interpretation: "La defensa disputa el centro.",
            habitHypothesis: "Comprobar CCT.",
            confidence: "medium",
            transferableRule: "Comprueba la respuesta más forzante.",
          },
          sourceGameId: "game-1",
          phase: "opening",
          orientation: "white",
          moveSan: "e4",
          moveUci: "e2e4",
        },
      }),
    });
  });

  await page.goto("/defense");
  await expect(page.getByTestId("defense-root")).toBeVisible();
  const initialText = await page.getByTestId("defense-root").innerText();
  expect(initialText).not.toContain("d4");
  expect(initialText).not.toContain("Defensa recomendada");
  expect(confirmPosts).toBe(0);
  expect(evaluatePosts).toBe(0);

  await page.getByRole("button", { name: "He leído la posición" }).click();
  await page.getByLabel("Captura").check();
  await page.getByLabel(/Describe la respuesta/i).fill("El rival captura en el centro");
  await page.getByRole("button", { name: "Elige un recurso" }).click();
  await page.getByLabel(/tipo de recurso/i).selectOption("counterattack");
  await page.getByRole("button", { name: "Jugar en el tablero" }).click();

  await page.getByTestId("defense-root").locator("input.input").fill("e4");
  await page.getByRole("button", { name: "Validar jugada" }).click();

  await page.getByRole("button", { name: "Comprobación mental" }).click();
  await page.getByTestId("defense-root").locator("input.input").fill("e5");
  await page.getByTestId("defense-root").locator("textarea.textarea").fill("Controlo el centro y reduzco la amenaza.");
  await page.getByLabel(/Revisé los jaques/).check();
  expect(confirmPosts).toBe(0);
  await page.getByTestId("defense-confirm").click();

  await expect(page.getByTestId("defense-feedback")).toBeVisible();
  expect(confirmPosts).toBe(1);
  expect(evaluatePosts).toBe(0);
  await expect(page.getByText(/Defensa recomendada/)).toBeVisible();

  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("move-mirror-state-v4")!));
  expect(persisted.defenseLab.attempts).toHaveLength(1);
  expect(persisted.defenseLab.attempts[0].doseEligible).toBe(false);
  expect(persisted.interventionQualification.confirmedExercises).toBe(0);
  expect(persisted.interventionQualification.qualified).toBe(false);
  expect(persisted.pedagogyEvents).toHaveLength(0);

  await page.getByRole("button", { name: "Siguiente posición adaptada" }).click();
  await expect(page.getByTestId("defense-selection-reason")).toHaveText(/Variedad adaptativa/i);
});
