import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ENGINE = "http://127.0.0.1:8787";
const SPARRING_DIR = path.join(process.cwd(), "data/test-sparring/sessions");

test.describe("Sparring clock after server restart", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("move-mirror-locale-v1", "es");
      localStorage.removeItem("move-mirror-sparring-active-v1");
    });
  });

  test("shows localized pause and continues without losing time before resume", async ({ page, request }) => {
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

    const file = path.join(SPARRING_DIR, `${sessionId}.json`);
    const persisted = JSON.parse(fs.readFileSync(file, "utf8"));
    persisted.status = "active";
    persisted.clock = {
      mode: "10+0",
      whiteRemainingMs: 555_000,
      blackRemainingMs: 600_000,
      activeColor: "white",
      status: "running",
      runningSinceMono: 1,
      monotonicEpochId: "00000000-0000-4000-8000-000000000001",
    };
    fs.writeFileSync(file, `${JSON.stringify(persisted, null, 2)}\n`);

    const hydrated = await request.get(`${ENGINE}/api/sparring/sessions/${sessionId}`);
    const body = await hydrated.json();
    expect(body.session.clock.resumeRequired).toBe(true);
    const msBefore = body.session.clock.whiteRemainingMs as number;

    await page.waitForTimeout(1200);
    const again = await request.get(`${ENGINE}/api/sparring/sessions/${sessionId}`);
    expect((await again.json()).session.clock.whiteRemainingMs).toBe(msBefore);

    await page.addInitScript((id) => {
      localStorage.setItem("move-mirror-sparring-active-v1", id);
    }, sessionId);

    await page.goto("/sparring");
    await expect(page.getByTestId("sparring-server-restart")).toContainText("servidor se reinició");

    await page.getByRole("button", { name: "Continuar" }).click();
    await expect.poll(async () => {
      const res = await request.get(`${ENGINE}/api/sparring/sessions/${sessionId}`);
      return (await res.json()).session.clock.status;
    }).toBe("running");

    await page.reload();
    await expect(page.getByTestId("sparring-root")).toBeVisible();
    await expect(page.getByTestId("sparring-server-restart")).toHaveCount(0);

    const resign = await request.post(`${ENGINE}/api/sparring/sessions/${sessionId}/resign`);
    expect(resign.ok()).toBeTruthy();
    const review1 = await request.post(`${ENGINE}/api/sparring/sessions/${sessionId}/review`);
    const review2 = await request.post(`${ENGINE}/api/sparring/sessions/${sessionId}/review`);
    expect(review1.ok()).toBeTruthy();
    expect(review2.ok()).toBeTruthy();
    expect((await review1.json()).review.sessionId).toBe((await review2.json()).review.sessionId);
  });
});
