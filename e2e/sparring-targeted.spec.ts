import { test, expect } from "@playwright/test";

const ENGINE = process.env.E2E_ENGINE_URL ?? `http://127.0.0.1:${process.env.E2E_ENGINE_PORT ?? "8791"}`;

test.describe("Sparring targeted position", () => {
  test("defense-linked session completes review without defense lab mutation", async ({ page, request }) => {
    const health = await request.get(`${ENGINE}/health`);
    if (!(await health.json()).engineAvailable) test.skip();

    await page.addInitScript(() => localStorage.setItem("move-mirror-locale-v1", "es"));
    await page.goto("/defense");
    const defenseBefore = await page.evaluate(() => {
      const raw = localStorage.getItem("move-mirror-state-v4");
      return raw ? JSON.parse(raw).defenseLab?.attempts?.length ?? 0 : 0;
    });

    const defenseNext = await request.post(`${ENGINE}/api/defense/next`, { data: { attempts: [], sessionExerciseIds: [] } });
    const exercise = (await defenseNext.json()).exercise;

    const create = await request.post(`${ENGINE}/api/sparring/sessions`, {
      data: {
        mode: "targeted_position",
        userColor: "white",
        patternId: "cct-opponent-refutation",
        defenseExerciseId: exercise.exerciseId,
        maxPlies: 8,
      },
    });
    expect(create.ok()).toBeTruthy();
    const { session } = await create.json();
    expect(session.mode).toBe("targeted_position");
    expect(session.practicePatternId).toBe("allowed-forcing-reply");

    if (session.sessionStatus === "active") {
      const fenTurn = session.fen.split(" ")[1];
      const isWhite = fenTurn === "w";
      if (!isWhite) {
        await request.post(`${ENGINE}/api/sparring/sessions/${session.sessionId}/agent-move`, { data: {} });
      }
    }

    await page.goto("/sparring");
    await expect(page.getByRole("heading", { name: /Rival de práctica/i })).toBeVisible();

    const internal = await request.get(`${ENGINE}/api/sparring/sessions/${session.sessionId}`);
    const s = (await internal.json()).session;
    const resign = await request.post(`${ENGINE}/api/sparring/sessions/${session.sessionId}/resign`);
    expect(resign.ok()).toBeTruthy();
    await request.post(`${ENGINE}/api/sparring/sessions/${session.sessionId}/review`);

    await page.goto("/defense");
    const defenseAfter = await page.evaluate(() => {
      const raw = localStorage.getItem("move-mirror-state-v4");
      return raw ? JSON.parse(raw).defenseLab?.attempts?.length ?? 0 : 0;
    });
    expect(defenseAfter).toBe(defenseBefore);
    expect(Array.isArray(s.moveHistory)).toBe(true);
  });
});
