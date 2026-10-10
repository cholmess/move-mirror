import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { fetchNewGames, loadFixtureGames, chesscomHeaders } from "./chesscom.mjs";
import { scriptedAnalyzeOne } from "../../shared/transfer/pipeline.js";
import { createStore } from "./store.mjs";
import { runSync } from "./sync.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixturesDir = path.join(root, "fixtures/chesscom");
const dirs = [];

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

function tempStore() {
  const dir = mkdtempSync(path.join(tmpdir(), "mm-transfer-"));
  dirs.push(dir);
  const store = createStore(dir);
  store.ensure();
  const manifest = JSON.parse(readFileSync(path.join(root, "data/transfer/baseline-manifest.json"), "utf8"));
  writeFileSync(path.join(dir, "baseline-manifest.json"), JSON.stringify(manifest));
  return store;
}

describe("chess.com sync", () => {
  it("loads fixtures without using the network", () => {
    const original = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error("network");
    };
    try {
      const loaded = loadFixtureGames(fixturesDir);
      expect(loaded.games.length).toBeGreaterThan(0);
      expect(loaded.fetched[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("retries rate limits and does not send credentials", async () => {
    expect(chesscomHeaders().Authorization).toBeUndefined();
    let calls = 0;
    const fetchImpl = async (_url, options) => {
      expect(options.headers.Authorization).toBeUndefined();
      calls += 1;
      if (calls === 1) {
        return { ok: false, status: 429, headers: { get: () => "0" }, text: async () => "" };
      }
      if (String(_url).endsWith("/archives")) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () => JSON.stringify({ archives: ["https://api.chess.com/pub/player/cholmess21/games/2026/08"] }),
        };
      }
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ games: [] }) };
    };
    const result = await fetchNewGames({
      username: "cholmess21",
      cutoffEndTime: 1791014756,
      fetchImpl,
      sleep: async () => {},
      pauseMs: 0,
    });
    expect(calls).toBeGreaterThan(1);
    expect(result.games).toEqual([]);
    const withoutSleep = await fetchNewGames({
      username: "cholmess21",
      cutoffEndTime: 1791014756,
      fetchImpl,
      pauseMs: 1,
    });
    expect(withoutSleep.games).toEqual([]);
  });

  it("is idempotent, resumable by checkpoint, and does not change a frozen cohort", async () => {
    const store = tempStore();
    const first = await runSync({
      store,
      source: "fixtures",
      username: "cholmess21",
      fixturesDir,
    });
    expect(first.includedCount).toBe(1);
    expect(first.excludedCount).toBeGreaterThanOrEqual(4);
    expect(first.exclusionCounts.map((row) => row.reason)).toEqual(
      expect.arrayContaining(["time_control_not_600", "not_standard_chess", "too_few_plies", "not_after_baseline_cutoff", "duplicate_game_id"])
    );
    const cohortId = first.openCohort.id;
    const before = store.exportBundle().cohorts[cohortId];
    expect(before.games).toHaveLength(1);
    expect(before.analysis.length).toBe(before.games[0].ownDecisions);

    const second = await runSync({
      store,
      source: "fixtures",
      username: "cholmess21",
      fixturesDir,
    });
    expect(second.includedCount).toBe(1);
    expect(second.excludedCount).toBe(first.excludedCount);
    expect(second.openCohort.id).toBe(cohortId);

    const metricsPath = path.join(store.root, "cohorts", cohortId, "metrics.json");
    const metrics = JSON.parse(readFileSync(metricsPath, "utf8"));
    store.freeze(cohortId, metrics, "2026-10-10T12:00:00.000Z");
    const frozenHash = createHash("sha256").update(readFileSync(metricsPath)).digest("hex");
    await runSync({
      store,
      source: "fixtures",
      username: "cholmess21",
      fixturesDir,
    });
    expect(createHash("sha256").update(readFileSync(metricsPath)).digest("hex")).toBe(frozenHash);
    expect(store.readMeta(cohortId).frozen).toBe(true);
    expect(() => store.addToCohort(cohortId, { games: [], exclusions: [] })).toThrow(/cohort_frozen/);
    expect(() => store.writeMetrics(cohortId, metrics)).toThrow(/cohort_frozen/);
  });

  it("does not let an offline fixture archive suppress a later live month", async () => {
    const store = tempStore();
    await runSync({ store, source: "fixtures", username: "cholmess21", fixturesDir });
    const requested = [];
    const fetchImpl = async (url) => {
      requested.push(String(url));
      const body = String(url).endsWith("/archives")
        ? { archives: ["https://api.chess.com/pub/player/cholmess21/games/2026/10"] }
        : { games: [] };
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) };
    };
    await runSync({
      store,
      source: "live",
      username: "cholmess21",
      fetchImpl,
      sleep: async () => {},
      analyzeOne: scriptedAnalyzeOne(),
    });
    expect(requested.some((url) => url.endsWith("/games/2026/10"))).toBe(true);
  });
});
