import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Chess, type Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import { Link } from "react-router-dom";
import { importManual } from "../api/gamesClient";
import type { ImportJob } from "../types/games";
import { formatErrorCode } from "../i18n/presenters";
import type { SupportedLocale } from "../i18n/types";
import { TechnicalDetails, TechnicalRow } from "./TechnicalDetails";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export function ManualImport() {
  const { t, i18n } = useTranslation(["import", "common", "games", "technical", "errors"]);
  const locale = i18n.language as SupportedLocale;
  const [startingFen, setStartingFen] = useState(START);
  const [fenInput, setFenInput] = useState("");
  const [moves, setMoves] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [result, setResult] = useState<"1-0" | "0-1" | "1/2-1/2" | "*">("*");
  const [playerColor, setPlayerColor] = useState<"white" | "black">("white");
  const [metadata, setMetadata] = useState({
    opponentName: "",
    date: new Date().toISOString().slice(0, 10),
    time: "",
    timeControl: "",
    ownRating: "",
    opponentRating: "",
    event: "",
    round: "",
    board: "",
    notes: "",
  });
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<ImportJob | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const game = useMemo(() => replay(startingFen, moves.slice(0, cursor)), [startingFen, moves, cursor]);
  const sanMoves = useMemo(() => replay(startingFen, moves).history(), [startingFen, moves]);

  const onDrop = (from: string, to: string, piece: string) => {
    try {
      const current = replay(startingFen, moves.slice(0, cursor));
      const promotion = piece.toLowerCase().endsWith("p") && (to.endsWith("8") || to.endsWith("1")) ? "q" : undefined;
      const move = current.move({ from, to, promotion });
      if (!move) return false;
      const next = [...moves.slice(0, cursor), `${move.from}${move.to}${move.promotion ?? ""}`];
      setMoves(next);
      setCursor(next.length);
      setError("");
      return true;
    } catch {
      setError(formatErrorCode("illegalMoveManual", locale));
      return false;
    }
  };

  const onSquareClick = (square: string, piece: string | undefined) => {
    const side = replay(startingFen, moves.slice(0, cursor)).turn();
    if (!selectedSquare) {
      if (piece?.startsWith(side === "w" ? "w" : "b")) setSelectedSquare(square);
      return;
    }
    if (selectedSquare === square) {
      setSelectedSquare(null);
      return;
    }
    const fromSquare = replay(startingFen, moves.slice(0, cursor)).get(selectedSquare as Square);
    const pieceCode = fromSquare ? `${fromSquare.color}${fromSquare.type.toUpperCase()}` : piece ?? "wP";
    if (onDrop(selectedSquare, square, pieceCode)) setSelectedSquare(null);
  };

  const applyFen = () => {
    try {
      const next = new Chess(fenInput.trim()).fen();
      setStartingFen(next);
      setMoves([]);
      setCursor(0);
      setError("");
    } catch {
      setError(formatErrorCode("invalidFen", locale));
    }
  };

  const save = async (draft: boolean) => {
    setError("");
    try {
      const job = await importManual({
        startingFen,
        movesUci: moves,
        result,
        playerColor,
        draft,
        metadata: {
          ...metadata,
          whiteName: playerColor === "white" ? t("localPlayerName") : metadata.opponentName,
          blackName: playerColor === "black" ? t("localPlayerName") : metadata.opponentName,
          whiteRating: playerColor === "white" ? metadata.ownRating : metadata.opponentRating,
          blackRating: playerColor === "black" ? metadata.ownRating : metadata.opponentRating,
        },
      });
      setSaved(job);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code ? formatErrorCode(code, locale) : t("errors:manualImportSaveFailed"));
    }
  };

  return (
    <div className="page manual-import">
      <div className="page-head">
        <p className="eyebrow">{t("manualEyebrow")}</p>
        <h1>{t("manualPageTitle")}</h1>
        <p className="muted">{t("manualPageLead")}</p>
      </div>
      {error && (
        <p className="card import-error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <section className="card success-panel">
          <h2>{t("gameSaved")}</h2>
          <p>{saved.summary.newCanonicalGames ? t("gameCreatedNew") : t("gameAlreadyInLibrary")}</p>
          <Link className="btn primary" to="/games">
            {t("openLibrary")}
          </Link>
          {exportedGameId(saved) && (
            <a className="btn" href={`/api/games/${exportedGameId(saved)}/pgn`} download>
              {t("games:exportPgn")}
            </a>
          )}
        </section>
      )}
      <div className="manual-grid">
        <section className="card board-panel">
          <div data-testid="manual-board" className="manual-board-frame" style={{ width: 480, height: 480 }}>
            <Chessboard
              position={game.fen()}
              onPieceDrop={onDrop}
              onSquareClick={onSquareClick}
              boardOrientation={playerColor}
              boardWidth={480}
            />
          </div>
          <div className="ply-controls">
            <button
              className="btn"
              disabled={cursor === 0}
              onClick={() => {
                setCursor(0);
                setSelectedSquare(null);
              }}
            >
              ⏮
            </button>
            <button
              className="btn"
              disabled={cursor === 0}
              onClick={() => {
                setCursor((value) => value - 1);
                setSelectedSquare(null);
              }}
            >
              {t("undoMove")}
            </button>
            <span className="mono" data-testid="ply-counter">
              {cursor} / {moves.length}
            </span>
            <button
              className="btn"
              disabled={cursor === moves.length}
              onClick={() => {
                setCursor((value) => value + 1);
                setSelectedSquare(null);
              }}
            >
              {t("redoMove")}
            </button>
            <button
              className="btn"
              disabled={cursor === moves.length}
              onClick={() => {
                setCursor(moves.length);
                setSelectedSquare(null);
              }}
            >
              ⏭
            </button>
          </div>
          <ol className="move-list">
            {sanMoves.map((san, index) => (
              <li key={`${index}-${san}`}>
                <button className={cursor === index + 1 ? "active-ply" : ""} onClick={() => setCursor(index + 1)}>
                  {san}
                </button>
              </li>
            ))}
          </ol>
        </section>
        <section className="card">
          <h2>{t("positionAndMetadata")}</h2>
          <label className="field">
            <span>{t("optionalStartFen")}</span>
            <input
              className="input mono"
              value={fenInput}
              onChange={(event) => setFenInput(event.target.value)}
              placeholder={t("standardStartPlaceholder")}
            />
          </label>
          <div className="actions">
            <button className="btn" disabled={!fenInput.trim()} onClick={applyFen}>
              {t("useStartPosition")}
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                setStartingFen(START);
                setFenInput("");
                setMoves([]);
                setCursor(0);
              }}
            >
              {t("standardPosition")}
            </button>
          </div>
          <TechnicalDetails>
            <TechnicalRow label={t("technical:fen")} value={startingFen} />
          </TechnicalDetails>
          <div className="form-grid">
            <label className="field">
              <span>{t("myColor")}</span>
              <select
                value={playerColor}
                onChange={(event) => setPlayerColor(event.target.value as "white" | "black")}
              >
                <option value="white">{t("common:white")}</option>
                <option value="black">{t("common:black")}</option>
              </select>
            </label>
            <label className="field">
              <span>{t("result")}</span>
              <select value={result} onChange={(event) => setResult(event.target.value as typeof result)}>
                <option value="*">{t("games:unfinished")}</option>
                <option value="1-0">1-0</option>
                <option value="0-1">0-1</option>
                <option value="1/2-1/2">½-½</option>
              </select>
            </label>
            <Field label={t("opponent")} value={metadata.opponentName} set={(value) => setMetadata({ ...metadata, opponentName: value })} />
            <Field label={t("date")} type="date" value={metadata.date} set={(value) => setMetadata({ ...metadata, date: value })} />
            <Field label={t("optionalTime")} type="time" value={metadata.time} set={(value) => setMetadata({ ...metadata, time: value })} />
            <Field label={t("timeControlExample")} value={metadata.timeControl} set={(value) => setMetadata({ ...metadata, timeControl: value })} />
            <Field label={t("myRating")} value={metadata.ownRating} set={(value) => setMetadata({ ...metadata, ownRating: value })} />
            <Field label={t("opponentRating")} value={metadata.opponentRating} set={(value) => setMetadata({ ...metadata, opponentRating: value })} />
            <Field label={t("event")} value={metadata.event} set={(value) => setMetadata({ ...metadata, event: value })} />
            <Field label={t("round")} value={metadata.round} set={(value) => setMetadata({ ...metadata, round: value })} />
            <Field label={t("boardNumber")} value={metadata.board} set={(value) => setMetadata({ ...metadata, board: value })} />
          </div>
          <label className="field">
            <span>{t("notesDuplicateHint")}</span>
            <textarea
              className="textarea"
              value={metadata.notes}
              onChange={(event) => setMetadata({ ...metadata, notes: event.target.value })}
            />
          </label>
          <div className="actions">
            <button type="button" className="btn" onClick={() => void save(true)}>
              {t("saveDraft")}
            </button>
            <button type="button" className="btn primary" disabled={!moves.length || result === "*"} onClick={() => void save(false)}>
              {t("confirmGame")}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function replay(fen: string, moves: string[]) {
  const chess = new Chess(fen);
  for (const uci of moves) chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  return chess;
}

function exportedGameId(job: ImportJob) {
  const checkpoint = job.checkpoint;
  if (!checkpoint || typeof checkpoint !== "object" || !("importedGameIds" in checkpoint)) return null;
  const ids = (checkpoint as { importedGameIds?: unknown }).importedGameIds;
  return Array.isArray(ids) && typeof ids[0] === "string" ? ids[0] : null;
}

function Field({
  label,
  value,
  set,
  type = "text",
}: {
  label: string;
  value: string;
  set: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input className="input" type={type} aria-label={label} value={value} onChange={(event) => set(event.target.value)} />
    </label>
  );
}
