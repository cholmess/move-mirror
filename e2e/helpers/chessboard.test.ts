import { describe, expect, it } from "vitest";
import { squareCenter } from "./chessboard";

describe("dragChessMove geometry", () => {
  const box = { x: 100, y: 200, width: 480, height: 480 };

  it("maps white orientation squares to board centers", () => {
    const e2 = squareCenter(box, "e2", "white");
    const e4 = squareCenter(box, "e4", "white");
    expect(e2.x).toBeCloseTo(e4.x, 0);
    expect(e2.y).toBeGreaterThan(e4.y);
    expect(squareCenter(box, "e7", "white").y).toBeLessThan(e4.y);
  });

  it("mirrors files for black orientation", () => {
    const whiteA1 = squareCenter(box, "a1", "white");
    const blackA1 = squareCenter(box, "a1", "black");
    expect(whiteA1.x).not.toBe(blackA1.x);
  });
});
