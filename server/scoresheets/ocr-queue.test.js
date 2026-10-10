import { describe, expect, it } from "vitest";
import { ScoresheetOcrQueue } from "./ocr-queue.mjs";

describe("scoresheet ocr queue", () => {
  it("rejects when queue is full", async () => {
    const queue = new ScoresheetOcrQueue({ maxQueue: 1, jobTimeoutMs: 5000 });
    let release = () => {};
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const first = queue.enqueue(async () => gate);
    await expect(queue.enqueue(async () => true)).rejects.toThrow(/SCORESHEET_OCR_QUEUE_FULL/);
    release();
    await first;
  });
});
