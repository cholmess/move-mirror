import { useEffect, useMemo, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  confirmScoresheet,
  fetchScoresheetDraft,
  fetchScoresheetPagePreview,
  fileToUploadPayload,
  importScoresheetDraft,
  patchScoresheetDraft,
  preprocessScoresheet,
  recognizeScoresheet,
  resolveScoresheetMove,
  uploadScoresheet,
} from "../api/scoresheetClient";
import type { ScoresheetDraftPublic, ScoresheetPly } from "../types/scoresheet";
import { formatErrorCode } from "../i18n/presenters";
import type { SupportedLocale } from "../i18n/types";

type Step = "upload" | "prepare" | "metadata" | "moves" | "confirm" | "done";

function plyNeedsReview(ply: ScoresheetPly) {
  if (!ply.selectedUci) return true;
  if (ply.resolution === "high_confidence") return false;
  return !ply.confirmedByUser;
}

export function ScoresheetImport() {
  const { draftId } = useParams();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation(["scoresheet", "import", "common", "errors"]);
  const locale = i18n.language as SupportedLocale;
  const [draft, setDraft] = useState<ScoresheetDraftPublic | null>(null);
  const [step, setStep] = useState<Step>("upload");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [focusPly, setFocusPly] = useState(0);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [playerColor, setPlayerColor] = useState<"white" | "black">("white");
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0.05, y: 0.15, width: 0.9, height: 0.75 });
  const [deskewAngle, setDeskewAngle] = useState(0);
  const [movesRegion, setMovesRegion] = useState({ x: 0.05, y: 0.2, width: 0.9, height: 0.65 });

  useEffect(() => {
    if (!draftId) return;
    fetchScoresheetDraft(draftId)
      .then((loaded) => {
        setDraft(loaded);
        setStep(inferStep(loaded));
      })
      .catch((cause) => setError(formatErrorCode(String(cause instanceof Error ? cause.message : ""), locale)));
  }, [draftId, locale]);

  useEffect(() => {
    if (!draft?.id || !draft.source.processedPageCount) return;
    fetchScoresheetPagePreview(draft.id, 1)
      .then((page) => setPreview(`data:${page.mimeType};base64,${page.bytes}`))
      .catch(() => setPreview(null));
  }, [draft?.id, draft?.source.processedPageCount]);

  const boardFen = useMemo(() => {
    if (!draft) return undefined;
    const chess = new Chess(draft.transcription.startingFen);
    for (const ply of draft.transcription.plies.slice(0, focusPly)) {
      if (!ply.selectedUci) break;
      chess.move({
        from: ply.selectedUci.slice(0, 2),
        to: ply.selectedUci.slice(2, 4),
        promotion: ply.selectedUci[4],
      });
    }
    return chess.fen();
  }, [draft, focusPly]);

  const pendingPlies = useMemo(
    () => draft?.transcription.plies.filter((ply) => plyNeedsReview(ply)) ?? [],
    [draft],
  );

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError("");
    try {
      await fn();
    } catch (cause) {
      const err = cause as Error & { unresolvedPlies?: number[] };
      setError(formatErrorCode(err.message ?? "request_failed", locale));
      if (err.unresolvedPlies?.length) {
        setStep("moves");
        setFocusPly(err.unresolvedPlies[0] - 1);
      }
    } finally {
      setBusy("");
    }
  };

  const onUpload = async (file: File) => {
    await run("upload", async () => {
      const payload = await fileToUploadPayload(file);
      const created = await uploadScoresheet({
        ...payload,
        locale: locale.startsWith("de") ? "de" : locale.startsWith("en") ? "en" : "es",
      });
      navigate(`/import/scoresheet/${created.id}`, { replace: true });
      setDraft(created);
      setStep("prepare");
    });
  };

  const onDropBoard = (from: string, to: string, piece: string) => {
    if (!draft) return false;
    try {
      const chess = new Chess(boardFen);
      const promotion = piece.toLowerCase().endsWith("p") && (to.endsWith("8") || to.endsWith("1")) ? "q" : undefined;
      const move = chess.move({ from, to, promotion });
      if (!move) return false;
      void run("resolve", async () => {
        const updated = await resolveScoresheetMove(draft.id, {
          plyIndex: focusPly,
          uci: `${move.from}${move.to}${move.promotion ?? ""}`,
          san: move.san,
          recomputeFromPlyIndex: focusPly + 1,
        });
        setDraft(updated);
        setFocusPly((value) => Math.min(value + 1, updated.transcription.plies.length));
      });
      return true;
    } catch {
      return false;
    }
  };

  if (!draftId) {
    return (
      <div className="page scoresheet-import">
        <div className="page-head">
          <p className="eyebrow">{t("scoresheet:eyebrow")}</p>
          <h1>{t("scoresheet:betaTitle")}</h1>
          <p className="muted">{t("scoresheet:betaLead")}</p>
        </div>
        <p className="card privacy-note">{t("scoresheet:privacy")}</p>
        {error && <p className="card import-error" role="alert">{error}</p>}
        <section className="card import-card">
          <label className="btn primary">
            {t("scoresheet:chooseFile")}
            <input
              className="visually-hidden"
              type="file"
              accept="image/*,.pdf"
              capture="environment"
              onChange={(event) => event.target.files?.[0] && void onUpload(event.target.files[0])}
            />
          </label>
        </section>
        <Link className="btn ghost" to="/import">{t("scoresheet:backToImport")}</Link>
      </div>
    );
  }

  if (!draft) {
    return <p className="page muted">{t("common:loading")}</p>;
  }

  return (
    <div className="page scoresheet-import">
      <div className="page-head">
        <p className="eyebrow">{t("scoresheet:eyebrow")}</p>
        <h1>{t("scoresheet:betaTitle")}</h1>
        <p className="muted">{t("scoresheet:betaLead")}</p>
        <p className="small muted">{t(`scoresheet:status.${draft.status}`)}</p>
      </div>
      {error && <p className="card import-error" role="alert">{error}</p>}

      <div className="scoresheet-steps">
        {(["prepare", "metadata", "moves", "confirm"] as Step[]).map((item) => (
          <button
            key={item}
            type="button"
            className={`btn ghost ${step === item ? "active" : ""}`}
            onClick={() => setStep(item)}
          >
            {t(`scoresheet:steps.${item}`)}
          </button>
        ))}
      </div>

      {step === "prepare" && (
        <section className="card">
          {preview && <img className="scoresheet-preview" src={preview} alt={t("scoresheet:previewAlt")} />}
          <div className="actions">
            <p className="small muted">{t("scoresheet:movesRegionHint")}</p>
            <RegionSlider label={t("scoresheet:cropX")} value={crop.x} onChange={(x) => setCrop((c) => ({ ...c, x }))} />
            <RegionSlider label={t("scoresheet:cropWidth")} value={crop.width} onChange={(width) => setCrop((c) => ({ ...c, width }))} />
            <RegionSlider label={t("scoresheet:movesRegionY")} value={movesRegion.y} onChange={(y) => setMovesRegion((c) => ({ ...c, y }))} />
            <RegionSlider label={t("scoresheet:deskewAngle")} value={deskewAngle} min={-15} max={15} onChange={setDeskewAngle} />
            <button
              type="button"
              className="btn"
              data-testid="scoresheet-apply-preprocess"
              disabled={busy === "preprocess"}
              onClick={() => run("preprocess", async () => {
                await patchScoresheetDraft(draft.id, {
                  preprocessing: {
                    crop,
                    movesRegion,
                    contrastAdjusted: true,
                    deskew: { mode: deskewAngle ? "manual" : "automatic", appliedAngle: deskewAngle, detectedAngle: deskewAngle || null },
                  },
                });
                setDraft(await preprocessScoresheet(draft.id, {}));
              })}
            >
              {t("scoresheet:applyAdjustments")}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy === "rotate"}
              onClick={() => run("rotate", async () => {
                await patchScoresheetDraft(draft.id, {
                  preprocessing: { rotation: ((draft.preprocessing.rotation ?? 0) + 90) % 360, contrastAdjusted: true },
                });
                setDraft(await preprocessScoresheet(draft.id, {}));
              })}
            >
              {t("scoresheet:rotate")}
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={busy === "read"}
              onClick={() => run("read", async () => {
                let current = draft;
                if (!current.source.processedPageCount) {
                  current = await preprocessScoresheet(current.id, {});
                  setDraft(current);
                }
                const recognized = await recognizeScoresheet(current.id);
                setDraft(recognized);
                setStep("metadata");
              })}
            >
              {busy === "read" ? t("scoresheet:reading") : t("scoresheet:runRead")}
            </button>
          </div>
        </section>
      )}

      {step === "metadata" && (
        <section className="card scoresheet-metadata">
          <MetadataField
            label={t("scoresheet:white")}
            value={draft.transcription.metadata.whiteName ?? ""}
            onChange={(whiteName) => setDraft({
              ...draft,
              transcription: { ...draft.transcription, metadata: { ...draft.transcription.metadata, whiteName } },
            })}
          />
          <MetadataField
            label={t("scoresheet:black")}
            value={draft.transcription.metadata.blackName ?? ""}
            onChange={(blackName) => setDraft({
              ...draft,
              transcription: { ...draft.transcription, metadata: { ...draft.transcription.metadata, blackName } },
            })}
          />
          <label>
            {t("scoresheet:myColor")}
            <select value={playerColor} onChange={(e) => setPlayerColor(e.target.value as "white" | "black")}>
              <option value="white">{t("scoresheet:colorWhite")}</option>
              <option value="black">{t("scoresheet:colorBlack")}</option>
            </select>
          </label>
          <MetadataField
            label={t("scoresheet:result")}
            value={draft.transcription.result ?? draft.transcription.metadata.result ?? "*"}
            onChange={(result) => setDraft({
              ...draft,
              transcription: { ...draft.transcription, result },
            })}
          />
          <button
            type="button"
            className="btn primary"
            onClick={() => run("meta", async () => {
              const updated = await patchScoresheetDraft(draft.id, { transcription: draft.transcription });
              setDraft(updated);
              setStep("moves");
            })}
          >
            {t("scoresheet:continue")}
          </button>
        </section>
      )}

      {step === "moves" && (
        <section className="scoresheet-review-grid">
          <div className="card">
            {preview && <img className="scoresheet-preview" src={preview} alt={t("scoresheet:previewAlt")} />}
          </div>
          <div className="card" data-testid="scoresheet-board">
            <Chessboard
              id="scoresheet-board"
              position={boardFen}
              onPieceDrop={onDropBoard}
              onSquareClick={(square, piece) => {
                if (!selectedSquare) {
                  if (piece) setSelectedSquare(square);
                  return;
                }
                if (selectedSquare === square) setSelectedSquare(null);
                else onDropBoard(selectedSquare, square, piece ?? "wP");
              }}
            />
            <p className="small muted">{t("scoresheet:boardHint")}</p>
          </div>
          <div className="card move-review-list">
            {draft.transcription.plies.map((ply, index) => (
              <MoveRow
                key={ply.ply}
                ply={ply}
                active={index === focusPly}
                label={t(`scoresheet:resolution.${ply.resolution}`)}
                onSelect={() => setFocusPly(index)}
                needsReview={plyNeedsReview(ply)}
                confirmLabel={t("scoresheet:confirmMove")}
                onConfirm={() => run("confirm-ply", async () => {
                  const updated = await resolveScoresheetMove(draft.id, { plyIndex: index, confirmPly: true });
                  setDraft(updated);
                })}
                onChoose={(candidate) => run("pick", async () => {
                  const updated = await resolveScoresheetMove(draft.id, {
                    plyIndex: index,
                    uci: candidate.uci,
                    san: candidate.san,
                    recomputeFromPlyIndex: index + 1,
                  });
                  setDraft(updated);
                })}
              />
            ))}
            {pendingPlies.length > 0 && (
              <p className="warn small">{t("scoresheet:needsReviewCount", { count: pendingPlies.length })}</p>
            )}
            <button type="button" className="btn primary" disabled={pendingPlies.length > 0} onClick={() => setStep("confirm")}>
              {t("scoresheet:continue")}
            </button>
          </div>
        </section>
      )}

      {step === "confirm" && (
        <section className="card">
          <p>{t("scoresheet:summaryMoves", { count: draft.transcription.plies.length })}</p>
          <p className="small muted">
            {t("scoresheet:summaryCorrections", {
              corrected: draft.transcription.plies.filter((ply) => ply.resolution !== "high_confidence").length,
              manual: draft.transcription.plies.filter((ply) => ply.resolution === "manually_entered").length,
            })}
          </p>
          <label className="confirm-checkbox">
            <input data-testid="scoresheet-final-confirm" type="checkbox" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} />
            {t("scoresheet:confirmCheckbox")}
          </label>
          <button
            type="button"
            className="btn primary"
            disabled={!confirmChecked || busy === "import"}
            onClick={() => run("import", async () => {
              const confirmed = await confirmScoresheet(draft.id, true);
              setDraft(confirmed);
              const result = await importScoresheetDraft(draft.id, { playerColor, deleteOriginal: false });
              setDraft(result.draft);
              setStep("done");
            })}
          >
            {t("scoresheet:importGame")}
          </button>
        </section>
      )}

      {step === "done" && draft.import.canonicalGameId && (
        <section className="card">
          <p>{t("scoresheet:importDone")}</p>
          <Link className="btn primary" to={`/games/${draft.import.canonicalGameId}`}>{t("scoresheet:openGame")}</Link>
          <Link className="btn ghost" to="/games">{t("import:openLibrary")}</Link>
        </section>
      )}
    </div>
  );
}

function inferStep(draft: ScoresheetDraftPublic): Step {
  if (draft.status === "imported") return "done";
  if (draft.status === "confirmed" || draft.status === "ready_to_confirm") return "confirm";
  if (draft.transcription.plies.length) return "moves";
  if (draft.source.processedPageCount) return "prepare";
  return "prepare";
}

function MetadataField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      {label}
      <input className="input" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function RegionSlider({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="small">
      {label}
      <input type="range" min={min} max={max} step={0.01} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function MoveRow({
  ply,
  active,
  label,
  needsReview,
  confirmLabel,
  onSelect,
  onConfirm,
  onChoose,
}: {
  ply: ScoresheetPly;
  active: boolean;
  label: string;
  needsReview: boolean;
  confirmLabel: string;
  onSelect: () => void;
  onConfirm: () => void;
  onChoose: (candidate: ScoresheetPly["candidates"][number]) => void;
}) {
  return (
    <div className={`move-row ${active ? "active" : ""}`} data-testid={`scoresheet-ply-${ply.ply}`}>
      <button type="button" className="btn ghost" onClick={onSelect}>
        {ply.ply}. {ply.selectedSan ?? ply.rawText ?? "?"}
      </button>
      <span className={`badge resolution-${ply.resolution}`}>{label}</span>
      {active && ply.candidates.length > 1 && (
        <div className="candidate-list">
          {ply.candidates.map((candidate) => (
            <button key={candidate.uci} type="button" className="btn" onClick={() => onChoose(candidate)}>
              {candidate.displayedMove}
            </button>
          ))}
        </div>
      )}
      {active && needsReview && (
        <button type="button" className="btn primary" data-testid={`scoresheet-confirm-ply-${ply.ply}`} onClick={onConfirm}>
          {confirmLabel}
        </button>
      )}
    </div>
  );
}
