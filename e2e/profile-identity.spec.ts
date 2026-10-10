import { expect, test } from "@playwright/test";

const CHESS = `E2EChess${Date.now()}`;
const LICHESS = `E2ELichess${Date.now()}`;
const PGN = `E2EPgn${Date.now()}`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("move-mirror-locale-v1", "es");
  });
});

test("administra identidad, rechaza duplicados y reconcilia unresolved", async ({ page, request }) => {
  await page.goto("/profile");
  await expect(page.getByTestId("player-identity-section")).toBeVisible();

  await page.getByTestId("identity-add-chess_com").fill(CHESS);
  await page.getByTestId("identity-chess_com").getByRole("button", { name: "Añadir" }).click();
  await expect(page.getByTestId("identity-chess_com").getByText(CHESS)).toBeVisible();

  await page.getByTestId("identity-add-lichess").fill(LICHESS);
  await page.getByTestId("identity-lichess").getByRole("button", { name: "Añadir" }).click();
  await expect(page.getByTestId("identity-lichess").getByText(LICHESS)).toBeVisible();

  await page.reload();
  await expect(page.getByText(CHESS)).toBeVisible();
  await expect(page.getByText(LICHESS)).toBeVisible();

  await page.getByTestId("identity-add-chess_com").fill(CHESS.toUpperCase());
  await page.getByTestId("identity-chess_com").getByRole("button", { name: "Añadir" }).click();
  await expect(page.getByRole("alert")).toContainText(/alias ya existe|Ese alias ya existe/i);

  await request.post("http://127.0.0.1:8787/api/import/pgn-text", {
    data: {
      pgn: `[Event "Identity reconcile"]\n[White "${PGN}"]\n[Black "OtherSide"]\n[TimeControl "600"]\n[Result "1-0"]\n\n1. Nf3 d5 1-0`,
    },
  });

  await page.getByTestId("identity-add-pgn").fill(PGN);
  await page.getByTestId("identity-pgn").getByRole("button", { name: "Añadir" }).click();
  await expect(page.getByTestId("identity-pgn").getByText(PGN)).toBeVisible();

  await page.getByTestId("reconcile-preview").click();
  await expect(page.getByText(/Se resolverían: [1-9]/)).toBeVisible();
  await page.getByTestId("reconcile-confirm").click();
  await expect(page.getByText(/Resueltas ahora: 1/)).toBeVisible();

  const sourcesBefore = await request.get("http://127.0.0.1:8787/api/games");
  const sourcesPayload = await sourcesBefore.json();
  expect(Array.isArray(sourcesPayload.games)).toBe(true);

  await page.getByTestId("identity-pgn").getByRole("button", { name: "Quitar" }).click();
  await expect(page.getByText(PGN)).toHaveCount(0);

  const sourcesAfter = await request.get("http://127.0.0.1:8787/api/games");
  const afterPayload = await sourcesAfter.json();
  expect(afterPayload.games.length).toBeGreaterThanOrEqual(sourcesPayload.games.length);
});
