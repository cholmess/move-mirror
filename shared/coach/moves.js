import { Chess } from "chess.js";

export function uciFromSquares(fen, from, to, promotion = "q") {
  try {
    const chess = new Chess(fen);
    const move = chess.move({ from, to, promotion });
    if (!move) return null;
    return `${move.from}${move.to}${move.promotion ?? ""}`;
  } catch {
    return null;
  }
}

export function sanFromUci(fen, uci) {
  try {
    const chess = new Chess(fen);
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
    return move?.san ?? null;
  } catch {
    return null;
  }
}

export function fenAfterUci(fen, uci) {
  try {
    const chess = new Chess(fen);
    chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
    return chess.fen();
  } catch {
    return null;
  }
}

export function uciSetHas(allowed, uci) {
  const norm = (u) => u.slice(0, 4) + (u.length > 4 ? u[4] : "");
  const target = norm(uci);
  return allowed.some((item) => norm(item) === target);
}

export function sideAfterMove(fen, uci) {
  const next = fenAfterUci(fen, uci);
  if (!next) return null;
  return new Chess(next).turn() === "w" ? "w" : "b";
}
