import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDailyStore } from "./store.mjs";
import { createDailyService } from "./service.mjs";
import { createExplainService } from "../explain/service.mjs";

const FIXTURE = path.resolve(new URL("../../fixtures/puzzles/sample.csv", import.meta.url).pathname);
const GAME = { id: "g1", archived: false, chess: { result: "0-1", movesUci: Array(20).fill("e2e4") },
  players: { white: { name: "me", rating: 1250 }, black: { name: "them", rating: 1260 }, playerResolution: { playerColor: "white" } },
  timing: { startedAt: "2026-11-17T10:00:00.000Z", timeControl: { initialSeconds: 900, incrementSeconds: 10 } }, provenance: {} };
const ROW = { gameId: "g1", ply: 5, moveNumber: 3, exerciseId: "e1", patternId: "piece-loss", loss: 900,
  fen: "rnbqkb1r/pppp1ppp/5n2/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 2 3", moveUci: "d1h5", replyUci: "f6h5", referenceUci: "g1f3", referencePv: ["g1f3", "b8c6"] };
const QUIET = { gameId: "g1", ply: 7, moveNumber: 4, patternId: null, fen: "8/8/8/8/8/8/8/K6k w - - 0 1", moveUci: "a1a2" };

let root; let clock; let evaluations;
function makeService(extra = {}) {
  clock = Date.parse("2026-11-18T09:00:00Z"); evaluations = [];
  const patterns = {
    decisionRows: () => [ROW, QUIET], personalGames: () => [GAME], schedule: () => {},
    summary: () => ({ patterns: [{ id: "piece-loss", status: "recurrent", errors: 40 }], job: { status: "completed" } }),
  };
  const evaluate = async (body) => { evaluations.push(body); return { verified: true, status: body.moveUci === "g1e2" ? "verified_acceptable" : "incorrect" }; };
  const explain = createExplainService({ cacheFile: path.join(root, "explain.json"), enabled: false });
  return createDailyService({ store: createDailyStore(root), patterns, puzzleBankFile: FIXTURE, evaluate, explain, now: () => clock, ...extra });
}

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "daily-")); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("daily training service", () => {
  it("builds today's session from own mistakes and the puzzle bank, and resumes it", () => {
    const service = makeService();
    const overview = service.overview();
    expect(overview.bank).toMatchObject({ available: true, source: "fixture" });
    const session = service.startSession();
    const sources = session.total;
    expect(sources).toBeGreaterThanOrEqual(5);
    expect(session.current.status).toBe("active");
    expect(service.startSession().id).toBe(session.id);
  });

  it("drills a refutation: wrong answer is graded again and shows the line; right answer schedules a review", async () => {
    const service = makeService();
    let session = service.startSession();
    // Walk to the own refutation card.
    let guard = 0;
    while (!(session.current.source === "own" && session.current.kind === "refutation") && guard++ < 20) {
      await service.reveal(session.id); session = service.next(session.id);
    }
    expect(session.current.candidateSan).toBe("Qh5");
    expect(session.current.solverColor).toBe("black");
    clock += 8_000;
    const result = await service.move(session.id, "f6h5");
    expect(result.status).toBe("correct");
    expect(result.item.feedback).toMatchObject({ correct: true, grade: "easy", solutionSan: ["Nxh5"] });
    expect(Date.parse(result.item.feedback.nextDue)).toBeGreaterThan(clock);
    await expect(service.move(session.id, "f6h5")).rejects.toThrow("item_not_active");
    const explained = await service.explainItem(session.id, session.index, "es");
    expect(explained.facts.punish).toMatchObject({ firstSan: "Nxh5", firstCaptures: "queen" });
    expect(explained.llm.status).toBe("disabled");
  });

  it("accepts engine-verified alternatives for own find-move cards", async () => {
    const service = makeService();
    let session = service.startSession(); let guard = 0;
    while (!(session.current.source === "own" && session.current.kind === "find-move") && guard++ < 20) {
      await service.reveal(session.id); session = service.next(session.id);
    }
    const result = await service.move(session.id, "g1e2");
    expect(result.item.feedback).toMatchObject({ correct: true, alternative: true });
    expect(evaluations.at(-1)).toMatchObject({ moveUci: "g1e2" });
  });

  it("plays forced replies inside multi-move puzzles", async () => {
    const service = makeService();
    let session = service.startSession(); let guard = 0;
    while (session.current?.puzzleId !== "mmfx04" && guard++ < 20) { await service.reveal(session.id); session = service.next(session.id); }
    if (session.current?.kind !== "refutation") return; // framing depends on the id hash
    const first = await service.move(session.id, "d4e2");
    expect(first).toMatchObject({ status: "continue", replySan: "Kf1" });
    const second = await service.move(session.id, "e2c1");
    expect(second.status).toBe("correct");
  });

  it("reviews a fresh game: asks first, then reveals facts and records the cause", async () => {
    const service = makeService();
    expect(service.reviewList()[0]).toMatchObject({ id: "g1", analysed: true, moments: 1, reviewed: false, control: "15+10" });
    const view = service.reviewGame("g1");
    expect(view.moments[0]).toMatchObject({ answered: false, answer: null });
    expect(JSON.stringify(view.moments[0])).not.toContain("Nxh5");
    const after = await service.answerMoment("g1", 0, { tryUci: "g1f3", cause: "not_seen" });
    expect(after.completedAt).not.toBeNull();
    expect(after.moments[0].answer).toMatchObject({ cause: "not_seen", trySan: "Nf3", tryStatus: "verified_best", facts: { punish: { firstSan: "Nxh5" } } });
    await expect(service.answerMoment("g1", 0, { cause: "nope" })).rejects.toThrow("invalid_request");
    const weekly = service.weekly();
    expect(weekly.weeks[0]).toMatchObject({ week: "2026-W47", decisions: 2, pieceLoss: 1, reports: { not_seen: 1 } });
  });
});

describe("grounded explanation service", () => {
  it("rejects model text that mentions moves outside the verified lines and caches accepted text", async () => {
    const facts = { candidateSan: "Qh5", punish: { san: ["Nxh5"], attackedAfter: [] }, best: { san: ["Nf3"] } };
    let calls = 0; let text = "Qh5 hangs the queen: Nxh5. Check captures first; Nf3 develops.";
    const fake = { beta: { messages: { create: async () => { calls++; return { stop_reason: "end_turn", model: "claude-opus-5-5", content: [{ type: "text", text }] }; } } } };
    const service = createExplainService({ cacheFile: path.join(root, "c.json"), enabled: true, clientFactory: () => fake });
    expect(await service.explain({ facts, locale: "en", kind: "refutation" })).toMatchObject({ status: "ok", cached: false });
    expect(await service.explain({ facts, locale: "en", kind: "refutation" })).toMatchObject({ status: "ok", cached: true });
    expect(calls).toBe(1);
    text = "Better was Bc4 and Qxf7#.";
    expect(await service.explain({ facts, locale: "es", kind: "refutation" })).toMatchObject({ status: "rejected" });
  });
});
