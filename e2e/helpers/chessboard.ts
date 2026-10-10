import type { Locator, Page } from "@playwright/test";

export type BoardOrientation = "white" | "black";

const WHITE_COLUMNS: Record<string, number> = { a: 0, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7 };
const BLACK_COLUMNS: Record<string, number> = { a: 7, b: 6, c: 5, d: 4, e: 3, f: 2, g: 1, h: 0 };
const WHITE_ROWS = [7, 6, 5, 4, 3, 2, 1, 0];
const BLACK_ROWS = [0, 1, 2, 3, 4, 5, 6, 7];

export function squareCenter(
  box: { x: number; y: number; width: number; height: number },
  square: string,
  orientation: BoardOrientation,
) {
  const file = square.charAt(0);
  const rank = Number(square.charAt(1));
  if (!(file in WHITE_COLUMNS) || rank < 1 || rank > 8) {
    throw new Error(`invalid_square:${square}`);
  }
  const squareWidth = box.width / 8;
  const columns = orientation === "white" ? WHITE_COLUMNS : BLACK_COLUMNS;
  const rows = orientation === "white" ? WHITE_ROWS : BLACK_ROWS;
  const x = box.x + columns[file] * squareWidth + squareWidth / 2;
  const y = box.y + rows[rank - 1] * squareWidth + squareWidth / 2;
  return { x, y };
}

async function clickSquareElement(boardLocator: Locator, square: string) {
  const target = boardLocator.locator(`[data-square="${square}"]`);
  await target.waitFor({ state: "visible", timeout: 10_000 });
  await target.click();
}

/**
 * Selects the origin square and completes the move on the destination square.
 * react-chessboard exposes `data-square` on each square; this uses the same click path as manual entry.
 */
export async function dragChessMove(
  page: Page,
  boardLocator: Locator,
  from: string,
  to: string,
  _orientation: BoardOrientation = "white",
) {
  void page;
  await clickSquareElement(boardLocator, from);
  await clickSquareElement(boardLocator, to);
}

export async function dragChessMoveByCoords(
  page: Page,
  boardLocator: Locator,
  from: string,
  to: string,
  orientation: BoardOrientation = "white",
) {
  const box = await boardLocator.boundingBox();
  if (!box) throw new Error("manual_board_not_visible");
  const fromPoint = squareCenter(box, from, orientation);
  const toPoint = squareCenter(box, to, orientation);
  await page.mouse.move(fromPoint.x, fromPoint.y);
  await page.mouse.down();
  await page.mouse.move(toPoint.x, toPoint.y, { steps: 20 });
  await page.mouse.up();
}
