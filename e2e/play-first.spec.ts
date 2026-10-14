import { test, expect } from "@playwright/test";
import { Chess } from "chess.js";
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("move-mirror-locale-v1", "es"));
});
test("home offers playing instead of a compulsory teaching sequence", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("practice-home")).toBeVisible();
  await page.getByRole("link", { name: "Practicar mis errores" }).click();
  await expect(page.getByTestId("direct-practice")).toBeVisible();
  await expect(page.getByTestId("train-flow")).toHaveCount(0);
});
test("a board move immediately produces feedback and can be retried", async ({ page }) => {
  await page.route("**/api/evaluate", async route => route.fulfill({ json: { status: "verified_acceptable", verified: true, cpLoss: 12, opponentReplySan: null } }));
  await page.goto("/train");
  // Legal move selection is available to keyboard users without notation entry.
  const board = page.getByTestId("play-board");
  await board.locator("summary").click();
  const selects = board.locator("select");
  await selects.nth(0).selectOption({ index: 1 });
  await selects.nth(1).selectOption({ index: 1 });
  await board.getByRole("button", { name: "Jugar movimiento seleccionado" }).click();
  await expect(page.getByTestId("direct-feedback")).toBeVisible();
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expect(page.getByTestId("direct-feedback")).toHaveCount(0);
  await expect(page.getByText("Tu turno. Juega directamente en el tablero.")).toBeVisible();
});
test("closed position plays against a responding opponent and gives a requested move hint", async ({ page }) => {
  let session: any;
  let createBody: any;
  await page.route("**/api/sparring/sessions", async route => {
    createBody = route.request().postDataJSON();
    session = { sessionId: "practice-test", sessionStatus: "active", mode: createBody.mode, userColor: createBody.userColor, style: createBody.style,
      fen: createBody.startingFen, moveHistory: [], clock: { mode: "untimed" }, agentTurnNumber: 0, reviewStatus: "pending", practicePatternId: createBody.patternId };
    await route.fulfill({ json: { ok: true, session } });
  });
  await page.route("**/api/sparring/sessions/practice-test/player-move", async route => {
    const chess = new Chess(session.fen); const uci = route.request().postDataJSON().moveUci;
    const player = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    const reply = chess.moves({ verbose: true })[0]; chess.move(reply.san);
    session = { ...session, fen: chess.fen(), moveHistory: [{ san: player.san, uci }, { san: reply.san, uci: reply.from + reply.to }], agentTurnNumber: 1 };
    await route.fulfill({ json: { ok: true, session, agentMove: null } });
  });
  await page.route("**/api/sparring/sessions/practice-test/hint", async route => {
    const chess = new Chess(session.fen); const move = chess.moves({ verbose: true })[0];
    await route.fulfill({ json: { ok: true, hintUsed: true, fen: session.fen, moveSan: move.san } });
  });
  await page.goto("/sparring?topic=plans");
  await expect(page.getByTestId("practice-topic")).toHaveValue("plans");
  await page.getByRole("button", { name: "Comenzar sparring" }).click();
  expect(createBody.patternId).toBe("general-practice");
  expect(new Chess(createBody.startingFen).turn()).toBe("w");
  const board = page.getByTestId("play-board");
  await board.locator("summary").click();
  await board.locator("select").nth(0).selectOption({ index: 1 });
  await board.locator("select").nth(1).selectOption({ index: 1 });
  await board.getByRole("button", { name: "Jugar movimiento seleccionado" }).click();
  await expect(page.getByTestId("sparring-move-history")).not.toBeEmpty();
  expect(session.moveHistory).toHaveLength(2);
  await page.getByRole("button", { name: "Necesito una pista" }).click();
  await expect(page.getByText(/Es una sugerencia del motor/)).toBeVisible();
});
test("mobile home and practice board fit the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", "/train", "/sparring?topic=plans"]) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("real engine: play, request help, review and retry a closed position", async ({ request }) => {
  const base = `http://127.0.0.1:${process.env.E2E_ENGINE_PORT ?? "8791"}`;
  const health = await (await request.get(`${base}/health`)).json();
  test.skip(!health.engineAvailable, "Requires a running Stockfish engine");
  const chess = new Chess();
  for (const san of ["e4", "e6", "d4", "d5", "e5", "c5", "c3", "Nc6", "Nf3", "Qb6", "a3", "Nh6"]) chess.move(san);
  const startingFen = chess.fen();
  const created = await (await request.post(`${base}/api/sparring/sessions`, { data: { mode: "targeted_position", patternId: "general-practice", startingFen, userColor: "white", style: "balanced", clockMode: "untimed", maxPlies: 40 } })).json();
  const id = created.session.sessionId;
  const moved = await (await request.post(`${base}/api/sparring/sessions/${id}/player-move`, { data: { moveUci: "b1d2" } })).json();
  expect(moved.ok).toBe(true);
  expect(moved.session.moveHistory).toHaveLength(2);
  const hint = await (await request.post(`${base}/api/sparring/sessions/${id}/hint`)).json();
  expect(new Chess(moved.session.fen).moves()).toContain(hint.moveSan);
  await request.post(`${base}/api/sparring/sessions/${id}/resign`);
  const reviewed = await (await request.post(`${base}/api/sparring/sessions/${id}/review`)).json();
  expect(reviewed.review.keyMoments[0].fenBeforeMove).toBe(startingFen);
  const retry = await (await request.post(`${base}/api/sparring/sessions`, { data: { mode: "targeted_position", patternId: "general-practice", startingFen: reviewed.review.keyMoments[0].fenBeforeMove, userColor: "white", style: "balanced", clockMode: "untimed" } })).json();
  expect(retry.session.fen).toBe(startingFen);
});
