import { describe, it, expect } from "vitest";
import { EvaluationQueue } from "./queue.js";

describe("EvaluationQueue", () => {
  it("FIFO serializes jobs", async () => {
    const q = new EvaluationQueue({ jobTimeoutMs: 5000 });
    const order = [];

    const p1 = q.enqueue(async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 30));
      return "a";
    });
    const p2 = q.enqueue(async () => {
      order.push(2);
      return "b";
    });

    expect(await p1).toBe("a");
    expect(await p2).toBe("b");
    expect(order).toEqual([1, 2]);
  });

  it("timeout yields rejection", async () => {
    const q = new EvaluationQueue({ jobTimeoutMs: 40 });
    await expect(
      q.enqueue(async () => {
        await new Promise((r) => setTimeout(r, 200));
        return 1;
      })
    ).rejects.toThrow(/timeout/);
  });
});
