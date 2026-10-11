import { test, expect } from "@playwright/test";

const ENGINE = "http://127.0.0.1:8787";

test.describe("Personal validation ledger", () => {
  test("dashboard shows server validation progress", async ({ page, request }) => {
    const status = await request.get(`${ENGINE}/api/validation/status`);
    expect(status.ok()).toBeTruthy();

    await page.goto("/");
    await expect(page.getByTestId("validation-ledger-card")).toBeVisible();
    await expect(page.getByTestId("validation-ledger-card")).toContainText(/Validación personal|Personal validation|Persönliche Validierung/);
  });

  test("server ledger survives without localStorage cache", async ({ request }) => {
    const migrate = await request.post(`${ENGINE}/api/validation/migrate`, {
      data: { pedagogyEvents: [], attempts: [], progress: {}, interventionQualification: { qualified: false, qualifiedAt: null } },
    });
    expect(migrate.ok()).toBeTruthy();
    const after = await request.get(`${ENGINE}/api/validation/status`);
    const body = await after.json();
    expect(body.status.canonicalSource).toBe("server");
    expect(body.status.qualificationReached).toBe(false);
  });
});
