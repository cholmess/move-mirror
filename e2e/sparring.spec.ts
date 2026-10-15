import { test, expect } from "@playwright/test";

const ENGINE = process.env.E2E_ENGINE_URL ?? `http://127.0.0.1:${process.env.E2E_ENGINE_PORT ?? "8791"}`;

test.describe("Sparring", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("move-mirror-locale-v1", "es");
      localStorage.removeItem("move-mirror-sparring-active-v1");
    });
  });

  test("no spoilers in agent-move response", async ({ page, request }) => {
    const health = await request.get(`${ENGINE}/health`);
    const engineUp = (await health.json()).engineAvailable;

    await page.route("**/api/sparring/sessions/*/agent-move", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          moveUci: "e7e5",
          moveSan: "e5",
          sessionStatus: "active",
          clock: { mode: "untimed", whiteRemainingMs: null, blackRemainingMs: null, runningColor: "white", lastStartedAt: null },
        }),
      });
    });

    if (!engineUp) {
      test.skip();
    }

    await page.goto("/sparring");
    await expect(page.getByTestId("sparring-root")).toBeVisible();
    const body = await page.getByTestId("sparring-root").innerText();
    expect(body).not.toMatch(/centipawn|evaluación|\+?[0-9]\.[0-9]/i);
  });

  test("smoke setup screen ES", async ({ page }) => {
    await page.goto("/sparring");
    await expect(page.getByRole("heading", { name: /Rival de práctica/i })).toBeVisible();
    await expect(page.getByText(/Tu rival usa un motor/i)).toBeVisible();
  });
});

test.describe("Sparring locales", () => {
  test("EN navigation Play", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("move-mirror-locale-v1", "en"));
    await page.goto("/sparring");
    await expect(page.getByText(/Your opponent uses a chess engine/i)).toBeVisible();
  });

  test("DE integrity copy", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("move-mirror-locale-v1", "de"));
    await page.goto("/sparring");
    await expect(page.getByText(/Dein Gegner nutzt eine Schachengine/i)).toBeVisible();
  });
});
