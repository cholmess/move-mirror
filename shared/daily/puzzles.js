/**
 * Lichess puzzle database support (CC0, https://database.lichess.org/#puzzles).
 * CSV columns: PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
 * In a Lichess puzzle, FEN is the position BEFORE the opponent's move; Moves[0] is that move,
 * and Moves[1..] is the solution (solver moves on odd indexes, forced replies on even ones).
 */
import { Chess } from "chess.js";

export const PUZZLE_BANK_VERSION = "lichess-puzzle-bank-v1";

/** Personal pattern → Lichess themes that train the same observable skill. */
export const PATTERN_THEMES = {
  "piece-loss": ["hangingPiece", "trappedPiece", "fork", "pin", "skewer", "discoveredAttack"],
  "forcing-reply": ["fork", "discoveredAttack", "doubleCheck", "skewer", "intermezzo", "attraction"],
  "missed-capture": ["hangingPiece", "capturingDefender", "crushing", "advantage"],
  "missed-mate": ["mateIn1", "mateIn2", "mateIn3", "backRankMate", "smotheredMate", "mate"],
  "endgame-decisions": ["endgame", "rookEndgame", "pawnEndgame", "advancedPawn", "promotion"],
  "closed-center": ["quietMove", "defensiveMove", "zugzwang"],
};
export const ALL_TRAINING_THEMES = [...new Set(Object.values(PATTERN_THEMES).flat())];

export function parseCsvLine(line) {
  const cols = String(line).trim().split(",");
  if (cols.length < 8 || cols[0] === "PuzzleId") return null;
  const [id, fen, moves, rating, , popularity, plays, themes] = cols;
  const list = moves.trim().split(/\s+/).filter(Boolean);
  if (!id || !fen || list.length < 2) return null;
  return { id, fen, moves: list, rating: Number(rating), popularity: Number(popularity), plays: Number(plays),
    themes: themes.trim().split(/\s+/).filter(Boolean) };
}

export function keepPuzzle(p, { minRating = 800, maxRating = 2000, minPopularity = 80, minPlays = 300, themes = ALL_TRAINING_THEMES } = {}) {
  if (!p || !Number.isFinite(p.rating)) return false;
  if (p.rating < minRating || p.rating > maxRating) return false;
  if (p.popularity < minPopularity || p.plays < minPlays) return false;
  if (p.moves.length > 8) return false;
  return p.themes.some(t => themes.includes(t));
}

/** Returns true when every move in the puzzle line is legal from its FEN. */
export function validatePuzzle(p) {
  try {
    const chess = new Chess(p.fen);
    for (const uci of p.moves) {
      if (!chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })) return false;
    }
    return true;
  } catch { return false; }
}

/** Compact on-disk row: [id, fen, moves, rating, themes]. */
export function compactPuzzle(p) { return [p.id, p.fen, p.moves.join(" "), p.rating, p.themes.join(" ")]; }
export function expandPuzzle(row) {
  return { id: row[0], fen: row[1], moves: row[2].split(" "), rating: row[3], themes: row[4].split(" ") };
}

export function patternsForThemes(themes) {
  return Object.entries(PATTERN_THEMES).filter(([, list]) => list.some(t => themes.includes(t))).map(([id]) => id);
}
