import { Chess } from "chess.js";
function position(moves: string[]) {
  const chess = new Chess();
  for (const san of moves) chess.move(san);
  return chess.fen();
}
/** General training positions; no claim of player-specific weakness or optimal plan. */
export const practicePositions = [
  { id: "closedFrench", fen: position(["e4", "e6", "d4", "d5", "e5", "c5", "c3", "Nc6", "Nf3", "Qb6", "a3", "Nh6"]), color: "white" as const },
  { id: "closedKings", fen: position(["d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "e4", "d6", "Nf3", "O-O", "Be2", "e5", "O-O", "Nc6", "d5", "Ne7"]), color: "white" as const },
];
