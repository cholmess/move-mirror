import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EvalCache, makeCacheKey } from "./cache.js";
import { BUDGET_SHALLOW, BUDGET_DEEP } from "../shared/evaluation/budgets.js";

describe("EvalCache", () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-cache-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const base = {
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    uci: "e2e4",
    engineSha256: "abc123",
    threads: 1,
    hashMb: 128,
  };

  it("stores shallow and deep separately", () => {
    const cache = new EvalCache(dir);
    const shallowIn = { ...base, budgetId: BUDGET_SHALLOW.id };
    const deepIn = { ...base, budgetId: BUDGET_DEEP.id };
    cache.setShallow(shallowIn, { cpLoss: 1 });
    cache.setDeep(deepIn, { cpLoss: 2 });
    expect(cache.getShallow(shallowIn).entry.cpLoss).toBe(1);
    expect(cache.getDeep(deepIn).entry.cpLoss).toBe(2);
  });

  it("hash change invalidates lookup", () => {
    const cache = new EvalCache(dir);
    const shallowIn = { ...base, budgetId: BUDGET_SHALLOW.id };
    cache.setShallow(shallowIn, { cpLoss: 1 });
    const other = { ...shallowIn, engineSha256: "other" };
    expect(cache.getShallow(other).entry).toBeNull();
  });

  it("budget change invalidates lookup", () => {
    const k1 = makeCacheKey({ ...base, budgetId: BUDGET_SHALLOW.id });
    const k2 = makeCacheKey({ ...base, budgetId: BUDGET_DEEP.id });
    expect(k1).not.toBe(k2);
  });

  it("corrupt file returns null without breaking cache", () => {
    const cache = new EvalCache(dir);
    const shallowIn = { ...base, budgetId: BUDGET_SHALLOW.id };
    const { key } = cache.getShallow(shallowIn);
    const file = path.join(dir, "shallow", `${key}.json`);
    fs.writeFileSync(file, "{not-json");
    expect(cache.getShallow(shallowIn).entry).toBeNull();
    cache.setShallow(shallowIn, { ok: true });
    expect(cache.getShallow(shallowIn).entry.ok).toBe(true);
  });
});
