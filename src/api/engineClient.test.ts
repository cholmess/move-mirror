import { describe, it, expect, vi, beforeEach } from "vitest";
import { evaluateMoveWithEngine } from "./engineClient";

describe("engineClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("motor ausente → unverified", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("connection refused"))
    );
    const r = await evaluateMoveWithEngine({ fen: "fen", moveSan: "e4" });
    expect(r.status).toBe("unverified");
    expect(r.verified).toBe(false);
  });
});
