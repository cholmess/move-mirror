import { useEffect, useMemo, useState } from "react";
import { Chess, type Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import { useTranslation } from "react-i18next";

/** One legal move path for touch, drag, keyboard and all promotions. */
export function PlayBoard({ fen, orientation, disabled = false, onMove }: {
  fen: string; orientation: "white" | "black"; disabled?: boolean;
  onMove: (from: string, to: string, promotion?: string) => boolean;
}) {
  const { t } = useTranslation(["practice", "training"]);
  const [selected, setSelected] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
  const chess = useMemo(() => new Chess(fen), [fen]);
  const origins = [...new Set(chess.moves({ verbose: true }).map(m => m.from))];
  const destinations = selected ? [...new Set(chess.moves({ square: selected as Square, verbose: true }).map(m => m.to))] : [];
  useEffect(() => { setSelected(null); setTarget(""); setPromotion(null); }, [fen, disabled]);
  function play(from: string, to: string) {
    if (disabled) return false;
    const options = chess.moves({ square: from as Square, verbose: true }).filter(m => m.to === to);
    if (!options.length) return false;
    if (options.some(m => m.promotion)) { setPromotion({ from, to }); return false; }
    const accepted = onMove(from, to);
    if (accepted) { setSelected(null); setTarget(""); }
    return accepted;
  }
  return <div data-testid="play-board">
    <Chessboard position={fen} boardOrientation={orientation} arePiecesDraggable={!disabled && !promotion}
      onPieceDrop={play} onSquareClick={square => {
        if (disabled || promotion) return;
        if (selected && play(selected, square)) return;
        setSelected(origins.includes(square as Square) ? square : null);
      }} customSquareStyles={selected ? { [selected]: { backgroundColor: "rgba(255,210,70,.55)" }, ...Object.fromEntries(destinations.map(square => [square, { backgroundColor: "rgba(90,170,100,.35)" }])) } : {}} />
    {promotion && <div role="group" aria-label={t("promotion")} className="btn-row">{["q", "r", "b", "n"].map(piece => <button type="button" className="btn" key={piece} disabled={disabled} onClick={() => { if (onMove(promotion.from, promotion.to, piece)) setPromotion(null); }}>{({ q: "♕", r: "♖", b: "♗", n: "♘" })[piece as "q"]}</button>)}</div>}
    <details className="small"><summary>{t("training:playSelectedMove")}</summary><div className="btn-row">
      <label>{t("training:originSquare")}<select disabled={disabled} value={selected ?? ""} onChange={e => { setSelected(e.target.value || null); setTarget(""); }}><option value="">—</option>{origins.map(s => <option key={s}>{s}</option>)}</select></label>
      <label>{t("training:destinationSquare")}<select disabled={disabled} value={target} onChange={e => setTarget(e.target.value)}><option value="">—</option>{destinations.map(s => <option key={s}>{s}</option>)}</select></label>
      <button type="button" className="btn" disabled={disabled || !selected || !target} onClick={() => { if (selected) play(selected, target); }}>{t("training:playSelectedMove")}</button>
    </div></details>
  </div>;
}
