import { readFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { dragChessMove } from "./helpers/chessboard";

const ENGINE = process.env.E2E_ENGINE_URL ?? "http://127.0.0.1:8791";

async function coachAct(request: import("@playwright/test").APIRequestContext, sessionId: string, action: string, body: Record<string, unknown> = {}) {
  const res = await request.post(`${ENGINE}/api/coach/session/${sessionId}/action`, {
    data: { action, ...body },
  });
  if (!res.ok()) {
    const err = await res.text();
    throw new Error(`coach_act_failed:${action}:${err}`);
  }
  return res.json();
}

function coachActionResponse(page: import("@playwright/test").Page) {
  return page.waitForResponse(
    (res) => res.url().includes("/api/coach/session/") && res.url().endsWith("/action") && res.request().method() === "POST",
  );
}

async function coachContinue(page: import("@playwright/test").Page) {
  const response = coachActionResponse(page);
  await page.getByTestId("coach-continue").click();
  await response;
}

async function coachMove(
  page: import("@playwright/test").Page,
  board: import("@playwright/test").Locator,
  from: string,
  to: string,
  orientation: "white" | "black",
) {
  await board.locator(`[data-square="${from}"]`).waitFor({ state: "visible" });
  const response = coachActionResponse(page);
  await dragChessMove(page, board, from, to, orientation);
  const action = await response;
  expect(action.ok()).toBeTruthy();
}

function coachBoard(page: import("@playwright/test").Page) {
  return page.locator(".coach-session .board-panel");
}

async function runCoachUiSegment(page: import("@playwright/test").Page) {
  const board = coachBoard(page);
  await expect(board).toBeVisible();

  await coachContinue(page);
  await coachMove(page, board, "f4", "e4", "black");
  await expect(page.getByTestId("coach-continue")).toBeVisible();
  await coachContinue(page);
  const applyDemo = coachActionResponse(page);
  await page.getByTestId("coach-apply-demo").click();
  await applyDemo;
  await coachMove(page, board, "h2", "g4", "white");
  const probe = coachActionResponse(page);
  await page.getByTestId("coach-probe-not_seen").click();
  await probe;
  await coachMove(page, board, "h2", "g4", "white");
  await coachMove(page, board, "f4", "g4", "black");
  await coachMove(page, board, "h2", "g4", "white");
  await coachMove(page, board, "h3", "h4", "black");
  await coachMove(page, board, "c2", "b3", "white");
  await coachMove(page, board, "g1", "h3", "white");
  await coachMove(page, board, "e6", "h3", "black");
  await expect(page.getByTestId("coach-holdout-reveal")).toBeVisible();
  await page.getByRole("button", { name: /Tras mover|After moving|Nachdem ich/ }).first().click();
  await expect(page.getByTestId("coach-finish")).toBeVisible();
}

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.describe("Coach Loop v1", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("move-mirror-locale-v1", "en");
    });
  });

  async function resetCoachSessions() {
    const storePath = path.join(process.cwd(), "data/test-coach/coach/sessions.json");
    await import("node:fs/promises").then((fs) => fs.writeFile(storePath, "[]\n", "utf8"));
  }

  test("desktop UI full session, reload resume, retention and generalization label", async ({ page }) => {
    await resetCoachSessions();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/coach");
    await page.getByTestId("plan-start").click();
    await expect(page.getByTestId("coach-session")).toBeVisible();
    await runCoachUiSegment(page);
    await page.reload();
    await expect(page.getByTestId("coach-session")).toBeVisible();
    await page.getByTestId("coach-finish").click();

    await page.goto("/profile");
    await expect(page.getByTestId("coach-progress-panel")).toBeVisible();
    await expect(page.getByTestId("coach-generalization-status")).toContainText(
      /novedad no confirmada|unconfirmed novelty|unbestätigter Neuheit/,
    );

    await page.goto("/coach");
    await page.getByTestId("plan-start").click();
    await expect(page.getByTestId("coach-session")).toBeVisible();
    const board = coachBoard(page);
    await coachMove(page, board, "g4", "e3", "white");
    await coachMove(page, board, "h4", "h3", "black");
    await page.getByTestId("coach-finish-retention").click();
  });

  test("mobile UI smoke walks signal through contrast", async ({ page }) => {
    await resetCoachSessions();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/coach");
    await page.getByTestId("plan-start").click();
    await expect(page.getByTestId("coach-session")).toBeVisible();
    await coachContinue(page);
    await expect(page.getByText("Phase: contrast_safe")).toBeVisible();
    const board = coachBoard(page);
    await coachMove(page, board, "f4", "e4", "black");
    await coachContinue(page);
    await expect(page.getByTestId("coach-apply-demo")).toBeVisible();
  });

  test("full loop, holdout protection, retention and dose v2", async ({ request }) => {
    await resetCoachSessions();
    const start = await request.post(`${ENGINE}/api/coach/session`);
    expect(start.ok()).toBeTruthy();
    const { view } = await start.json();
    const sessionId = view.sessionId as string;

    let v = (await coachAct(request, sessionId, "continue")).view;
    expect(v.phase).toBe("contrast_safe");

    v = (await coachAct(request, sessionId, "submit_move", { from: "f4", to: "e4", moveRole: "candidate" })).view;
    expect(v.phase).toBe("contrast_unsafe_intro");

    v = (await coachAct(request, sessionId, "continue")).view;
    v = (await coachAct(request, sessionId, "apply_demo")).view;
    expect(v.phase).toBe("worked_find_reply");

    const beforeHoldout = JSON.stringify(v);
    expect(beforeHoldout).not.toMatch(/e6h3|Bxh3/);

    v = (await coachAct(request, sessionId, "submit_move", { from: "h2", to: "g4", moveRole: "hostile_reply" })).view;
    v = (await coachAct(request, sessionId, "submit_probe", { answer: "not_seen" })).view;
    v = (await coachAct(request, sessionId, "submit_move", { from: "h2", to: "g4", moveRole: "hostile_reply" })).view;
    v = (await coachAct(request, sessionId, "submit_move", { from: "f4", to: "g4", moveRole: "candidate" })).view;
    v = (await coachAct(request, sessionId, "submit_move", { from: "h2", to: "g4", moveRole: "hostile_reply" })).view;
    v = (await coachAct(request, sessionId, "submit_move", { from: "h3", to: "h4", moveRole: "candidate" })).view;
    v = (await coachAct(request, sessionId, "submit_move", { from: "c2", to: "b3", moveRole: "hostile_reply" })).view;
    v = (await coachAct(request, sessionId, "submit_move", { from: "g1", to: "h3", moveRole: "candidate" })).view;
    const holdoutReply = await coachAct(request, sessionId, "submit_move", {
      from: "e6",
      to: "h3",
      moveRole: "hostile_reply",
    });
    expect(holdoutReply.feedback.reveal?.genericKey).toBeTruthy();
    expect(JSON.stringify(holdoutReply.feedback.reveal)).not.toContain("primaryRefutationSan");

    v = (await coachAct(request, sessionId, "submit_exit_rule", { ruleKey: "coach:exitRuleA" })).view;
    expect(v.phase).toBe("summary");
    v = (await coachAct(request, sessionId, "finish")).view;

    const retentionStart = await request.post(`${ENGINE}/api/coach/session/${sessionId}/retention`);
    expect(retentionStart.ok()).toBeTruthy();
    v = (await retentionStart.json()).view;
    expect(v.phase).toBe("retention");

    v = (await coachAct(request, sessionId, "submit_move", { from: "g4", to: "e3", moveRole: "candidate" })).view;
    v = (await coachAct(request, sessionId, "submit_move", { from: "h4", to: "h3", moveRole: "hostile_reply" })).view;
    expect(v.phase).toBe("retention_complete");
    await coachAct(request, sessionId, "finish_retention");

    const validation = await request.get(`${ENGINE}/api/validation/status`);
    const body = await validation.json();
    expect(body.status.coachDose?.qualified).toBe(true);
  });

  test("off-script explore stays unverified without engine", async ({ request }) => {
    await resetCoachSessions();
    const start = await request.post(`${ENGINE}/api/coach/session`);
    const { view } = await start.json();
    const sessionId = view.sessionId as string;
    await coachAct(request, sessionId, "continue");
    await coachAct(request, sessionId, "submit_move", { from: "f4", to: "e4", moveRole: "candidate" });
    await coachAct(request, sessionId, "continue");
    await coachAct(request, sessionId, "apply_demo");
    await coachAct(request, sessionId, "submit_move", { from: "h2", to: "g4", moveRole: "hostile_reply" });
    await coachAct(request, sessionId, "submit_probe", { answer: "not_seen" });
    await coachAct(request, sessionId, "submit_move", { from: "h2", to: "g4", moveRole: "hostile_reply" });
    await coachAct(request, sessionId, "submit_move", { from: "a8", to: "b8", moveRole: "candidate" });
    await coachAct(request, sessionId, "submit_move", { from: "d1", to: "d2", moveRole: "hostile_reply" });
    const storePath = path.join(process.cwd(), "data/test-coach/coach/sessions.json");
    const stored = JSON.parse(await readFile(storePath, "utf8"));
    const session = stored.find((row: { id: string }) => row.id === sessionId);
    const explore = session?.events?.find((e: { type: string }) => e.type === "coach_explore_attempt");
    expect(explore?.success).toBe(false);
    expect(explore?.countsForPracticeLearning).toBe(false);
    expect(["unverified", "incorrect", "playable_inexact"].includes(String(explore?.verificationStatus))).toBe(true);
  });

  test("engine unverified does not break coach session API", async ({ request }) => {
    const health = await request.get(`${ENGINE}/health`);
    const healthBody = await health.json();
    expect(healthBody.ok).toBe(true);
    const home = await request.get(`${ENGINE}/api/coach/home`);
    expect(home.ok()).toBeTruthy();
  });
});
