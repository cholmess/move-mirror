import { test, expect } from "@playwright/test";

const ENGINE = "http://127.0.0.1:8787";

test.describe("Sparring resume", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("move-mirror-locale-v1", "es");
      localStorage.removeItem("move-mirror-sparring-active-v1");
    });
  });

  test("full game survives reload and continues without duplicate agent move", async ({ page, request }) => {
    const health = await request.get(`${ENGINE}/health`);
    if (!(await health.json()).engineAvailable) test.skip();

    const create = await request.post(`${ENGINE}/api/sparring/sessions`, {
      data: {
        mode: "full_game",
        userColor: "white",
        style: "balanced",
        clockMode: "10+0",
        patternId: "cct-opponent-refutation",
      },
    });
    expect(create.ok()).toBeTruthy();
    const { session } = await create.json();
    const sessionId = session.sessionId as string;

    const move1 = await request.post(`${ENGINE}/api/sparring/sessions/${sessionId}/player-move`, {
      data: { moveUci: "e2e4" },
    });
    expect(move1.ok()).toBeTruthy();
    const after1 = (await move1.json()).session;
    expect(after1.moveHistory.length).toBeGreaterThanOrEqual(1);
    const fenAfter = after1.fen as string;
    const agentTurn1 = after1.agentTurnNumber as number;

    await page.addInitScript((id) => {
      localStorage.setItem("move-mirror-sparring-active-v1", id);
    }, sessionId);

    await page.goto("/sparring");
    await expect(page.getByTestId("sparring-root")).toBeVisible();
    await expect(page.getByTestId("sparring-move-history")).toContainText("e4");

    await page.reload();
    await expect(page.getByTestId("sparring-move-history")).toContainText("e4");

    const reloaded = await request.get(`${ENGINE}/api/sparring/sessions/${sessionId}`);
    const body = await reloaded.json();
    expect(body.session.fen).toBe(fenAfter);
    expect(body.session.agentTurnNumber).toBe(agentTurn1);
    expect(body.session.userColor).toBe("white");
    expect(body.session.mode).toBe("full_game");
    expect(body.session.style).toBe("balanced");
    expect(body.session.decisions).toBeUndefined();

    const move2 = await request.post(`${ENGINE}/api/sparring/sessions/${sessionId}/player-move`, {
      data: { moveUci: "g1f3" },
    });
    expect(move2.ok()).toBeTruthy();
    const after2 = (await move2.json()).session;
    expect(after2.moveHistory.length).toBeGreaterThan(after1.moveHistory.length);

    const resign = await request.post(`${ENGINE}/api/sparring/sessions/${sessionId}/resign`);
    expect(resign.ok()).toBeTruthy();

    const review1 = await request.post(`${ENGINE}/api/sparring/sessions/${sessionId}/review`);
    const review2 = await request.post(`${ENGINE}/api/sparring/sessions/${sessionId}/review`);
    expect(review1.ok()).toBeTruthy();
    expect(review2.ok()).toBeTruthy();
    const r1 = await review1.json();
    const r2 = await review2.json();
    expect(r1.review.sessionId).toBe(r2.review.sessionId);

    const pgn = await request.get(`${ENGINE}/api/sparring/sessions/${sessionId}/pgn`);
    expect(pgn.ok()).toBeTruthy();
    const text = await pgn.text();
    expect(text).toContain('[TrainingGame "true"]');
    expect(text).toContain('[SparringPolicy "sparring-policy-v1"]');

    const games = await request.get(`${ENGINE}/api/games`);
    const gamesJson = await games.json();
    const titles = (gamesJson.games ?? []).map((g: { id: string }) => g.id);
    expect(titles.some((id: string) => id === sessionId)).toBe(false);
  });
});
