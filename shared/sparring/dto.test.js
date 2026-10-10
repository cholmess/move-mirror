import { describe, it, expect } from "vitest";
import { assertActiveSessionDto, sessionPublicDto, assertNoSpoilers } from "./dto.js";

describe("active session public contract", () => {
  const internal = {
    id: "11111111-1111-4111-8111-111111111111",
    status: "active",
    mode: "full_game",
    userColor: "white",
    style: "balanced",
    startingFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    movesUci: ["e2e4"],
    movesSan: ["e4"],
    clock: { mode: "untimed" },
    reviewStatus: "not_started",
    profileSnapshot: { patternId: "allowed-forcing-reply", sha256: "abc", defenseResourceNeeds: { x: 1 } },
    decisions: [{ chosen: { uci: "e7e5" } }],
    seed: "secret",
  };

  it("public dto strips spoilers", () => {
    const dto = sessionPublicDto(internal, internal.startingFen);
    expect(assertActiveSessionDto(dto)).toBeNull();
    expect(assertNoSpoilers(dto)).toBe(true);
    expect(dto).not.toHaveProperty("decisions");
    expect(dto).not.toHaveProperty("seed");
    expect(dto.moveHistory).toEqual([{ uci: "e2e4", san: "e4" }]);
  });

  it("fails when forbidden fields leak", () => {
    expect(assertActiveSessionDto({ ...sessionPublicDto(internal, internal.startingFen), candidates: [] })).toMatch(
      /unexpected_key:candidates|spoiler/,
    );
  });
});
