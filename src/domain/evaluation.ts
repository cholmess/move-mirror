import { Chess } from "chess.js";
import type { Exercise } from "../data/exerciseTypes";

export function isLegalMove(fen: string, san: string): boolean {
  try {
    const chess = new Chess(fen);
    return chess.move(san) !== null;
  } catch {
    return false;
  }
}

export function userFoundForcedResponse(
  opponentField: string,
  exercise: Exercise
): boolean {
  const text = opponentField.toLowerCase();
  if (text.length < 3) return false;
  const firstReal = exercise.realLineSan?.split(/\s+/)[1]?.toLowerCase() ?? "";
  if (firstReal && text.includes(firstReal.replace(/[+#!?]/g, ""))) return true;
  return text.length >= 8;
}
