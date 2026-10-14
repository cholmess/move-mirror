import { Chess } from "chess.js";
import type { Exercise } from "../data/exercises";
export interface ReplayFrame { fen: string; san: string | null; from?: string; to?: string; captured?: string; piece?: string }
/** Parse the verified line once; render legal frames rather than silently replaying the first move. */
export function buildReferenceReplay(exercise: Exercise) {
  const chess = new Chess(exercise.fen);
  const frames: ReplayFrame[] = [{ fen: chess.fen(), san: null }];
  const line = exercise.referenceLineUci?.length ? exercise.referenceLineUci : exercise.referenceMoveUci ? [exercise.referenceMoveUci] : [];
  if (line.length) {
    for (const uci of line) {
      try { const m=chess.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]}); frames.push({fen:chess.fen(),san:m.san,from:m.from,to:m.to,captured:m.captured,piece:m.piece}); } catch { break; }
    }
  } else {
    try { const m=chess.move(exercise.solutionSan); frames.push({fen:chess.fen(),san:m.san,from:m.from,to:m.to,captured:m.captured,piece:m.piece}); } catch { /* unavailable content */ }
  }
  const idea = frames[1]?.san?.includes("#") ? "mate" : frames[1]?.san?.includes("+") && frames[3]?.captured === "q" ? "checkWinQueen" : frames[1]?.san?.includes("+") ? "forcingCheck" : frames[1]?.captured ? "capture" : "improve";
  return { frames, idea };
}
export function matchesReference(exercise: Exercise, san: string) {
  try { const chess = new Chess(exercise.fen), move = chess.move(san); return move.from+move.to+(move.promotion??"") === exercise.referenceMoveUci; } catch { return false; }
}
