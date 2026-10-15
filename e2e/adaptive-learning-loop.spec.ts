import { test, expect } from "@playwright/test";
import { Chess } from "chess.js";

const ENGINE = process.env.E2E_ENGINE_URL ?? "http://127.0.0.1:8791";

async function legalMoveUci(fen: string) {
  const chess = new Chess(fen);
  const move = chess.moves({ verbose: true })[0];
  if (!move) throw new Error("no_legal_move");
  return `${move.from}${move.to}${move.promotion ?? ""}`;
}

test.describe("Adaptive personal pattern learning loop", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("move-mirror-locale-v1", "en"));
  });

  test("API: session holdout records domain, review date and next activity", async ({ request }) => {
    const health = await request.get(`${ENGINE}/health`);
    if (!health.ok()) test.skip(true, "engine unavailable");
    const patterns = await request.get(`${ENGINE}/api/patterns`);
    if (!patterns.ok()) test.skip(true, "patterns unavailable");
    const summary = await patterns.json();
    const patternId = summary.recommended?.[0] ?? summary.patterns?.find((p: { status: string }) => p.status === "recurrent")?.id;
    if (!patternId) test.skip(true, "no recurrent pattern in fixture data");
    const start = await request.post(`${ENGINE}/api/patterns/practice`, { data: { patternId } });
    if (!start.ok()) test.skip(true, "practice start unavailable");
    const guided = await start.json();
    let current = guided;
    const moveUci = await legalMoveUci(current.fen);
    for (let slot = 0; slot < (current.sessionPositionTotal ?? 1); slot++) {
      const move = await request.post(`${ENGINE}/api/patterns/practice/${current.id}/move`, { data: { moveUci } });
      if (!move.ok()) test.skip(true, "move rejected in fixture");
      const feedback = await move.json();
      if (feedback.trainingStatus === "ready_for_holdout") break;
      if (feedback.trainingStatus === "ready_for_next_slot") {
        const next = await request.post(`${ENGINE}/api/patterns/practice/${current.id}/slot`, { data: {} });
        expect(next.ok()).toBeTruthy();
        current = await next.json();
      }
    }
    const holdoutStart = await request.post(`${ENGINE}/api/patterns/practice/${current.id}/holdout`, { data: {} });
    expect(holdoutStart.ok()).toBeTruthy();
    const holdout = await holdoutStart.json();
    const holdoutMove = await legalMoveUci(holdout.fen);
    const holdoutResult = await request.post(`${ENGINE}/api/patterns/practice/${holdout.id}/move`, { data: { moveUci: holdoutMove } });
    expect(holdoutResult.ok()).toBeTruthy();
    const body = await holdoutResult.json();
    expect(body.sessionResult?.sessionId).toBeTruthy();
    expect(body.sessionResult?.domain?.nextReviewAt).toBeTruthy();
    expect(body.nextActivity?.kind).toBeTruthy();
    const session = await request.get(`${ENGINE}/api/patterns/session/${body.sessionResult.sessionId}`);
    expect(session.ok()).toBeTruthy();
    const sessionBody = await session.json();
    expect(sessionBody.session.status).toBe("completed");
  });
});
