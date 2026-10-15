import { test, expect } from "@playwright/test";
import { Chess } from "chess.js";
import { randomUUID } from "node:crypto";

const ENGINE = process.env.E2E_ENGINE_URL ?? `http://127.0.0.1:${process.env.E2E_ENGINE_PORT ?? "8791"}`;

function legalMoveUci(fen: string) {
  const chess = new Chess(fen);
  const move = chess.moves({ verbose: true })[0];
  if (!move) throw new Error(`no_legal_move:${fen}`);
  return `${move.from}${move.to}${move.promotion ?? ""}`;
}

async function submitLegalMove(
  request: import("@playwright/test").APIRequestContext,
  exerciseId: string,
  fen: string,
) {
  const moveUci = legalMoveUci(fen);
  const res = await request.post(`${ENGINE}/api/patterns/practice/${exerciseId}/move`, { data: { moveUci } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return res.json();
}

async function ensureRecurrentPieceLoss(request: import("@playwright/test").APIRequestContext) {
  const health = await request.get(`${ENGINE}/health`);
  expect(health.ok(), "engine health").toBeTruthy();
  const healthBody = await health.json();
  expect(healthBody.engineAvailable, "Stockfish required for pattern E2E").toBe(true);

  const user = `adaptive-${randomUUID().slice(0, 8)}`;
  await request.patch(`${ENGINE}/api/player-identity`, { data: { pgnNameAliases: [user] } });
  const variations = ["Nc6", "d6", "Nf6"];
  const pgns = variations.map((reply, i) => {
    const chess = new Chess();
    const tail = reply === "Nc6" ? ["Nf3", "Nf6", "Bc4", "d6"] : reply === "d6" ? ["Nf3", "Nc6", "Bc4", "Nf6"] : ["Nf3", "Nc6", "Bc4", "d6"];
    for (const san of ["e4", "e5", "Qh5", reply, "Qxh7", "Rxh7", ...tail]) chess.move(san);
    chess.header(
      "Event",
      `Adaptive loop ${i}`,
      "White",
      user,
      "Black",
      "opponent",
      "Date",
      `2026.09.0${i + 1}`,
      "UTCDate",
      `2026.09.0${i + 1}`,
      "UTCTime",
      "10:00:00",
      "Result",
      "0-1",
      "TimeControl",
      "600",
    );
    return chess.pgn();
  });
  const imported = await (await request.post(`${ENGINE}/api/import/pgn-text`, { data: { pgn: pgns.join("\n\n") } })).json();
  expect(imported.summary.failed).toBe(0);

  await expect
    .poll(
      async () => {
        const summary = await (await request.get(`${ENGINE}/api/patterns`)).json();
        if (summary.job.status === "failed") throw new Error(summary.job.error);
        return summary.patterns.find((p: { id: string }) => p.id === "piece-loss")?.status;
      },
      { timeout: 120_000, intervals: [1000] },
    )
    .toBe("recurrent");
}

test.describe("Adaptive personal pattern learning loop", () => {
  test("API: full session, distinct holdout, domain, persistence and idempotency", async ({ request }) => {
    await ensureRecurrentPieceLoss(request);

    const patternId = "piece-loss";
    const start = await request.post(`${ENGINE}/api/patterns/practice`, { data: { patternId } });
    expect(start.ok(), await start.text()).toBeTruthy();
    let current = await start.json();
    const guidedPositionIds: string[] = [current.positionId];
    expect(current.sessionId).toBeTruthy();

    for (let step = 0; step < 20; step++) {
      const viewRes = await request.get(`${ENGINE}/api/patterns/practice/${current.id}`);
      expect(viewRes.ok()).toBeTruthy();
      const view = await viewRes.json();
      if (view.canStartHoldout) break;

      const feedback = await submitLegalMove(request, current.id, view.fen);
      if (feedback.trainingStatus === "ready_for_holdout") break;
      if (feedback.trainingStatus !== "ready_for_next_slot") {
        throw new Error(`unexpected_training_status:${feedback.trainingStatus}`);
      }
      const next = await request.post(`${ENGINE}/api/patterns/practice/${current.id}/slot`, { data: {} });
      expect(next.ok(), await next.text()).toBeTruthy();
      current = await next.json();
      guidedPositionIds.push(current.positionId);
    }

    const ready = await request.get(`${ENGINE}/api/patterns/practice/${current.id}`);
    expect(ready.ok()).toBeTruthy();
    expect((await ready.json()).canStartHoldout).toBe(true);

    const sessionBefore = await request.get(`${ENGINE}/api/patterns/session/${current.sessionId}`);
    expect(sessionBefore.ok()).toBeTruthy();
    const reserved = (await sessionBefore.json()).session.reservedHoldoutRecordId as string;
    expect(reserved).toBeTruthy();

    const holdoutStart = await request.post(`${ENGINE}/api/patterns/practice/${current.id}/holdout`, { data: {} });
    expect(holdoutStart.ok(), await holdoutStart.text()).toBeTruthy();
    const holdout = await holdoutStart.json();
    expect(guidedPositionIds.includes(holdout.positionId)).toBe(false);
    expect(holdout.positionId).toBe(reserved);

    const body = await submitLegalMove(request, holdout.id, holdout.fen);
    expect(body.sessionResult?.sessionId).toBeTruthy();
    expect(body.sessionResult?.countsAsIndependentEvidence).toBe(true);
    expect(body.sessionResult?.domain?.nextReviewAt).toBeTruthy();
    expect(body.nextActivity?.kind).toBeTruthy();

    const sessionId = body.sessionResult.sessionId as string;
    const sessionGet = await request.get(`${ENGINE}/api/patterns/session/${sessionId}`);
    expect(sessionGet.ok()).toBeTruthy();
    const persisted = await sessionGet.json();
    expect(persisted.session.status).toBe("completed");
    expect(persisted.lastResult?.nextReviewAt).toBeTruthy();

    const domainAttempts = body.sessionResult.domain.independentAttempts as number;
    const duplicate = await submitLegalMove(request, holdout.id, holdout.fen);
    expect(duplicate.sessionResult?.sessionId).toBe(sessionId);
    expect(duplicate.sessionResult?.domain?.independentAttempts).toBe(domainAttempts);

    const sessionAgain = await request.get(`${ENGINE}/api/patterns/session/${sessionId}`);
    const againBody = await sessionAgain.json();
    expect(againBody.session.completionKey).toBeTruthy();
    expect(againBody.lastResult?.outcomeKey).toBeTruthy();
  });
});
