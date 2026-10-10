import { test, expect } from "@playwright/test";

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
      prompt: "Te toca defender. Lee la posición antes de elegir una jugada.",
      selectionReason: "Poca evidencia de dominio.",
    },
    {
      exerciseId: "def-game-2-9",
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      orientation: "white",
      phase: "opening",
      sourceContext: { playedAt: "2026-01-02T00:00:00Z", playerColor: "white", moveNumber: 5, opening: null },
      previousMoveSan: "e5",
      prompt: "Te toca defender. Lee la posición antes de elegir una jugada.",
      selectionReason: "Variedad adaptativa.",
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

  await page.getByRole("button", { name: "Ya leí la posición" }).click();
  await page.getByLabel("Captura").check();
  await page.getByText("Describe la respuesta").locator("..").getByRole("textbox").fill("El rival captura en el centro");
  await page.getByRole("button", { name: "Elegir recurso" }).click();
  await page.getByLabel("Recurso defensivo").selectOption("counterattack");
  await page.getByRole("button", { name: "Jugar en el tablero" }).click();

  await page.getByPlaceholder("ej. Nf3").fill("e4");
  await page.getByRole("button", { name: "Validar jugada" }).click();

  await page.getByRole("button", { name: "Verificación mental" }).click();
  await page.getByText("Respuesta más forzante").locator("..").getByRole("textbox").fill("e5");
  await page.getByText("¿Por qué debería").locator("..").getByRole("textbox").fill("Controlo el centro y reduzco la amenaza.");
  await page.getByLabel(/Comprobé jaques/).check();
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
  await expect(page.getByText("Variedad adaptativa.")).toBeVisible();
});
