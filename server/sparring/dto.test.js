import { describe, it, expect } from "vitest";
import { assertNoSpoilers, agentMovePublicDto } from "../../shared/sparring/dto.js";

describe("sparring agent-move contract", () => {
  it("rejects spoiler fields", () => {
    expect(assertNoSpoilers({ moveUci: "e2e4", candidates: [] })).toBe(false);
    expect(assertNoSpoilers({ moveUci: "e2e4", pv: ["e2e4"] })).toBe(false);
    expect(
      assertNoSpoilers(
        agentMovePublicDto({
          moveUci: "e2e4",
          moveSan: "e4",
          sessionStatus: "active",
          clock: { mode: "untimed" },
        }),
      ),
    ).toBe(true);
  });
});
