import { test, expect } from "@playwright/test";

const ENGINE = process.env.E2E_ENGINE_URL ?? `http://127.0.0.1:${process.env.E2E_ENGINE_PORT ?? "8791"}`;

test.describe("Sparring isolation", () => {
  test("completing sparring does not change games library or local training state", async ({
    page,
    request,
  }) => {
    const health = await request.get(`${ENGINE}/health`);
    if (!(await health.json()).engineAvailable) test.skip();

    await page.addInitScript(() => {
      localStorage.setItem("move-mirror-locale-v1", "en");
    });
    await page.goto("/");
    const before = await page.evaluate(() => {
      const raw = localStorage.getItem("move-mirror-state-v4");
      return raw ? JSON.parse(raw) : null;
    });
    const gamesBefore = await request.get(`${ENGINE}/api/games`);
    const gamesCountBefore = ((await gamesBefore.json()).games ?? []).length;
    const transferBefore = await request.get(`${ENGINE}/api/transfer/state`);

    const create = await request.post(`${ENGINE}/api/sparring/sessions`, {
      data: { mode: "full_game", userColor: "white", patternId: "cct-opponent-refutation" },
    });
    const { session } = await create.json();
    await request.post(`${ENGINE}/api/sparring/sessions/${session.sessionId}/player-move`, {
      data: { moveUci: "e2e4" },
    });
    await request.post(`${ENGINE}/api/sparring/sessions/${session.sessionId}/resign`);
    await request.post(`${ENGINE}/api/sparring/sessions/${session.sessionId}/review`);

    const gamesAfter = await request.get(`${ENGINE}/api/games`);
    const gamesCountAfter = ((await gamesAfter.json()).games ?? []).length;
    expect(gamesCountAfter).toBe(gamesCountBefore);

    const transferAfter = await request.get(`${ENGINE}/api/transfer/state`);
    expect(await transferAfter.json()).toEqual(await transferBefore.json());

    await page.reload();
    const after = await page.evaluate(() => {
      const raw = localStorage.getItem("move-mirror-state-v4");
      return raw ? JSON.parse(raw) : null;
    });
    if (before && after) {
      expect(after.attempts?.length).toBe(before.attempts?.length);
      expect(after.skills?.["cct-opponent-refutation"]?.alpha).toBe(
        before.skills?.["cct-opponent-refutation"]?.alpha,
      );
      expect(after.defenseLab?.attempts?.length).toBe(before.defenseLab?.attempts?.length);
    }

    const pgnRes = await request.get(`${ENGINE}/api/sparring/sessions/${session.sessionId}/pgn`);
    const pgn = await pgnRes.text();
    expect(pgn).toContain('[TrainingGame "true"]');
    const gamesList = await request.get(`${ENGINE}/api/games`);
    const allPgns = JSON.stringify(await gamesList.json());
    expect(allPgns).not.toContain('[TrainingGame "true"]');
  });
});
