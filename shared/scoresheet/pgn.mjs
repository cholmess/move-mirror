import { Chess } from "chess.js";
import { STANDARD_FEN } from "./constants.mjs";

export function buildPgnFromTranscription({ startingFen = STANDARD_FEN, plies, metadata = {}, result = "*" }) {
  const chess = new Chess(startingFen);
  chess.header(
    "Event", metadata.event || "Scoresheet",
    "Site", metadata.site || "MoveMirror",
    "Date", (metadata.date || "????.??.??").slice(0, 10).replaceAll("-", "."),
    "Round", metadata.round || "?",
    "White", metadata.whiteName || "?",
    "Black", metadata.blackName || "?",
    "Result", result || "*",
  );
  if (metadata.timeControl) chess.header("TimeControl", metadata.timeControl);
  if (startingFen !== STANDARD_FEN) chess.header("SetUp", "1", "FEN", startingFen);

  for (const ply of plies) {
    if (!ply.selectedUci) throw new Error("incomplete_transcription");
    const move = chess.move({
      from: ply.selectedUci.slice(0, 2),
      to: ply.selectedUci.slice(2, 4),
      promotion: ply.selectedUci[4],
    });
    if (!move) throw new Error(`illegal_move_at_ply_${ply.ply}`);
  }
  chess.header("Result", result || chess.isGameOver() ? chess.header().Result : "*");
  return chess.pgn();
}

export function parsedFromTranscription({ startingFen = STANDARD_FEN, plies, result = "*" }) {
  const chess = new Chess(startingFen);
  const movesUci = [];
  const movesSan = [];
  for (const ply of plies) {
    if (!ply.selectedUci) throw new Error("incomplete_transcription");
    const move = chess.move({
      from: ply.selectedUci.slice(0, 2),
      to: ply.selectedUci.slice(2, 4),
      promotion: ply.selectedUci[4],
    });
    if (!move) throw new Error(`illegal_move_at_ply_${ply.ply}`);
    movesUci.push(`${move.from}${move.to}${move.promotion ?? ""}`);
    movesSan.push(move.san);
  }
  return {
    headers: {},
    startingFen,
    movesUci,
    movesSan,
    result: result ?? "*",
    termination: null,
  };
}
