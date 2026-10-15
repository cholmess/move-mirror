import { forwardRef, useCallback, useEffect, useRef, useState, type ForwardedRef, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Chessboard } from "react-chessboard";
import type { AttemptRecord, ReasoningMove, TrainingReasoningV2 } from "../types/learning";
import { useApp } from "../context/AppContext";
import { coreExercises, getExercise, poolExercises, exercises } from "../data/exercises";
import { selectNextExercise } from "../domain/adaptive";
import { opponentStrongestReply, buildReflectionPrompt } from "../domain/pedagogy";
import {
  formatEvaluationStatus,
  formatEvaluationSummary,
  formatExercisePrompt,
  formatMoveForDisplay,
  formatObservableReason,
  formatSelectionReasons,
  formatSideToMove,
} from "../i18n/presenters";
import type { SupportedLocale } from "../i18n/types";
import { TechnicalDetails, TechnicalRow } from "./TechnicalDetails";
import {
  addUniqueMove,
  isCheckmateAfterMove,
  legacyCctFromReasoning,
  moveFromSquares,
  positionAfterMove,
  type ReasoningCategory,
} from "../domain/trainingReasoning";

type Phase = "options" | "candidate" | "reply" | "decide" | "feedback";
type CategoryDraft = {
  status: "moves_selected" | "none_seen" | null;
  moves: Array<ReasoningMove & { note?: string }>;
};

const emptyCategory = (): CategoryDraft => ({ status: null, moves: [] });

function poolOptionsForSelect(currentId: string) {
  const inList = poolExercises.slice(0, 80);
  const current = poolExercises.find((e) => e.id === currentId);
  if (current && !inList.some((e) => e.id === currentId)) {
    return [current, ...inList];
  }
  return inList;
}

export function TrainingBoard() {
  const { t, i18n } = useTranslation(["training", "common"]);
  const locale = i18n.language as SupportedLocale;
  const { state, submitExerciseAttempt } = useApp();
  const [exerciseId, setExerciseId] = useState(
    () => state.progress.currentExerciseId ?? exercises[0]!.id,
  );
  const exercise = getExercise(exerciseId)!;

  const [phase, setPhase] = useState<Phase>("options");
  const [checks, setChecks] = useState<CategoryDraft>(emptyCategory);
  const [captures, setCaptures] = useState<CategoryDraft>(emptyCategory);
  const [threats, setThreats] = useState<CategoryDraft>(emptyCategory);
  const [candidate, setCandidate] = useState<ReasoningMove | null>(null);
  const [predictedReply, setPredictedReply] = useState<TrainingReasoningV2["predictedReply"] | null>(null);
  const [selectionTarget, setSelectionTarget] = useState<ReasoningCategory | "candidate" | "reply" | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [keyboardFrom, setKeyboardFrom] = useState("");
  const [keyboardTo, setKeyboardTo] = useState("");
  const [validationError, setValidationError] = useState("");
  const [startedAt] = useState(() => Date.now());
  const [lastAttempt, setLastAttempt] = useState<AttemptRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const checksRef = useRef<HTMLDivElement>(null);
  const capturesRef = useRef<HTMLDivElement>(null);
  const threatsRef = useRef<HTMLDivElement>(null);
  const candidateRef = useRef<HTMLDivElement>(null);
  const replyRef = useRef<HTMLDivElement>(null);

  const orientation = exercise.sideToMove === "w" ? "white" : "black";
  const promptText = formatExercisePrompt(exercise.playedMoveSan, locale);

  useEffect(() => {
    setExerciseId(state.progress.currentExerciseId ?? exercises[0]!.id);
  }, [state.progress.currentExerciseId]);

  const resetForExercise = useCallback((id: string) => {
    setExerciseId(id);
    setPhase("options");
    setChecks(emptyCategory());
    setCaptures(emptyCategory());
    setThreats(emptyCategory());
    setCandidate(null);
    setPredictedReply(null);
    setSelectionTarget(null);
    setSelectedSquare(null);
    setKeyboardFrom("");
    setKeyboardTo("");
    setValidationError("");
    setLastAttempt(null);
  }, []);

  const candidateFen = candidate ? positionAfterMove(exercise.fen, candidate) : null;
  const boardFen = phase === "reply" || phase === "decide" ? candidateFen ?? exercise.fen : exercise.fen;

  const acceptBoardMove = (source: string, target: string) => {
    if (!selectionTarget) return false;
    const sourceFen = selectionTarget === "reply" ? candidateFen : exercise.fen;
    if (!sourceFen) return false;
    const move = moveFromSquares(sourceFen, source, target);
    if (!move) {
      setValidationError(t("illegalMove"));
      return false;
    }
    setValidationError("");
    setSelectedSquare(null);
    if (selectionTarget === "checks") {
      setChecks((value) => ({ status: "moves_selected", moves: addUniqueMove(value.moves, move) }));
    } else if (selectionTarget === "captures") {
      setCaptures((value) => ({ status: "moves_selected", moves: addUniqueMove(value.moves, move) }));
    } else if (selectionTarget === "threats") {
      setThreats((value) => ({ status: "moves_selected", moves: addUniqueMove(value.moves, move) }));
    } else if (selectionTarget === "candidate") {
      setCandidate(move);
      setPredictedReply(null);
    } else {
      setPredictedReply({ status: "move_selected", move });
    }
    setSelectionTarget(null);
    return true;
  };

  const onDrop = (source: string, target: string) => acceptBoardMove(source, target);
  const onSquareClick = (square: string) => {
    if (!selectionTarget) return;
    if (!selectedSquare) {
      setSelectedSquare(square);
      return;
    }
    if (selectedSquare === square) {
      setSelectedSquare(null);
      return;
    }
    if (!acceptBoardMove(selectedSquare, square)) setSelectedSquare(square);
  };

  const focusError = (message: string, ref: RefObject<HTMLDivElement>) => {
    setValidationError(message);
    requestAnimationFrame(() => ref.current?.focus());
  };

  const continueOptions = () => {
    if (!checks.status) return focusError(t("missingChecks"), checksRef);
    if (!captures.status) return focusError(t("missingCaptures"), capturesRef);
    if (!threats.status) return focusError(t("missingThreats"), threatsRef);
    setValidationError("");
    setSelectionTarget(null);
    setPhase("candidate");
  };

  const continueCandidate = () => {
    if (!candidate) return focusError(t("missingCandidate"), candidateRef);
    setValidationError("");
    setSelectionTarget(null);
    if (isCheckmateAfterMove(exercise.fen, candidate)) {
      setPredictedReply({ status: "not_applicable_checkmate" });
      setPhase("decide");
    } else {
      setPhase("reply");
    }
  };

  const continueReply = () => {
    if (!predictedReply) return focusError(t("missingReply"), replyRef);
    setValidationError("");
    setSelectionTarget(null);
    setPhase("decide");
  };

  const submit = async () => {
    if (!candidate || !predictedReply || !checks.status || !captures.status || !threats.status) return;
    setSubmitting(true);
    const timeUsedSeconds = Math.round((Date.now() - startedAt) / 1000);
    try {
      const reasoningV2: TrainingReasoningV2 = {
        version: "training-reasoning-v2",
        checks: { status: checks.status, moves: checks.moves },
        captures: { status: captures.status, moves: captures.moves },
        threats: { status: threats.status, moves: threats.moves },
        candidate,
        predictedReply,
        keptCandidateAfterReply: true,
      };
      const attempt = await submitExerciseAttempt({
        exerciseId: exercise.id,
        cct: legacyCctFromReasoning(reasoningV2),
        reasoningV2,
        chosenMoveSan: candidate.san,
        reasoning: t("generatedReasoning"),
        timeUsedSeconds,
      });
      setLastAttempt(attempt);
      setPhase("feedback");
    } finally {
      setSubmitting(false);
    }
  };

  const nextSel = selectNextExercise(state);

  return (
    <div className="page train" data-testid="train-root">
      <div className="train-toolbar">
        <label className="small">
          {t("selectExercise")}{" "}
          <select
            data-testid="train-exercise-select"
            value={exerciseId}
            onChange={(e) => resetForExercise(e.target.value)}
          >
            <optgroup label={t("coreGroup", { count: coreExercises.length })}>
              {coreExercises.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {t("moveOption", {
                    number: ex.moveNumber,
                    side: formatSideToMove(ex.sideToMove, locale),
                  })}
                </option>
              ))}
            </optgroup>
            <optgroup label={t("poolGroup", { count: poolExercises.length })}>
              {poolOptionsForSelect(exerciseId).map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {t("moveOptionPool", { number: ex.moveNumber, severity: ex.severity })}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <a className="small" href={exercise.gameUrl} target="_blank" rel="noreferrer">
          {t("gameOnChesscom")}
        </a>
      </div>

      <p className="prompt">{promptText}</p>
      {exercise.tier === "pool" && <p className="muted small">{t("poolHint")}</p>}
      {phase === "feedback" && (
        <p className="muted small">
          {t("inGameYouPlayed", {
            move: formatMoveForDisplay(exercise.playedMoveSan, locale),
          })}
        </p>
      )}

      <div className="train-grid">
        <div className="card board-panel">
          <Chessboard
            position={boardFen}
            onPieceDrop={onDrop}
            onSquareClick={onSquareClick}
            boardOrientation={orientation}
            arePiecesDraggable={!!selectionTarget}
          />
          {selectionTarget && <p className="board-instruction" aria-live="polite">{t(`select.${selectionTarget}`)}</p>}
          {selectionTarget && <KeyboardMovePicker from={keyboardFrom} to={keyboardTo} onFrom={setKeyboardFrom} onTo={setKeyboardTo} onPlay={() => { if (keyboardFrom && keyboardTo && acceptBoardMove(keyboardFrom, keyboardTo)) { setKeyboardFrom(""); setKeyboardTo(""); } }} />}
          {candidate && (
            <p className="mono center">
              {t("yourMove")}: <strong>{candidate.san}</strong>
            </p>
          )}
        </div>

        <div className="card flow-panel" data-testid="train-flow">
          <div className="reasoning-progress" aria-label={t("progressLabel")}>{t("step", { current: phase === "options" ? 1 : phase === "candidate" ? 2 : phase === "reply" ? 3 : phase === "decide" ? 4 : 4 })}</div>
          {validationError && <div className="reasoning-error" role="alert">{validationError}</div>}
          {phase === "options" && (
            <>
              <h2>{t("optionsTitle")}</h2>
              <p>{t("boardExplainer")}</p>
              <CategoryBlock ref={checksRef} title={t("checksTitle")} question={t("checksQuestion")} value={checks} active={selectionTarget === "checks"} onAdd={() => setSelectionTarget("checks")} onNone={() => { setChecks({ status: "none_seen", moves: [] }); setSelectionTarget(null); }} onRemove={(uci) => setChecks((v) => ({ ...v, status: v.moves.length === 1 ? null : v.status, moves: v.moves.filter((m) => m.uci !== uci) }))} noneLabel={t("noChecks")} removeLabel={t("removeMove")} addLabel={t("addMove")} />
              <CategoryBlock ref={capturesRef} title={t("capturesTitle")} question={t("capturesQuestion")} value={captures} active={selectionTarget === "captures"} onAdd={() => setSelectionTarget("captures")} onNone={() => { setCaptures({ status: "none_seen", moves: [] }); setSelectionTarget(null); }} onRemove={(uci) => setCaptures((v) => ({ ...v, status: v.moves.length === 1 ? null : v.status, moves: v.moves.filter((m) => m.uci !== uci) }))} noneLabel={t("noCaptures")} removeLabel={t("removeMove")} addLabel={t("addMove")} />
              <CategoryBlock ref={threatsRef} title={t("threatsTitle")} question={t("threatsQuestion")} value={threats} active={selectionTarget === "threats"} onAdd={() => setSelectionTarget("threats")} onNone={() => { setThreats({ status: "none_seen", moves: [] }); setSelectionTarget(null); }} onRemove={(uci) => setThreats((v) => ({ ...v, status: v.moves.length === 1 ? null : v.status, moves: v.moves.filter((m) => m.uci !== uci) }))} onNote={(uci, note) => setThreats((v) => ({ ...v, moves: v.moves.map((m) => m.uci === uci ? { ...m, note } : m) }))} noneLabel={t("noThreats")} removeLabel={t("removeMove")} addLabel={t("addMove")} noteLabel={t("threatNote")} />
              {(checks.moves.length > 0 || captures.moves.length > 0 || threats.moves.length > 0) && <NotationHelp />}
              <button type="button" className="btn primary" onClick={continueOptions}>{t("continue")}</button>
            </>
          )}

          {phase === "candidate" && (
            <>
              <div ref={candidateRef} tabIndex={-1}><h2>{t("candidateTitle")}</h2></div>
              <p>{t("candidateHint")}</p>
              <MoveChoices moves={[...checks.moves, ...captures.moves, ...threats.moves].filter((move, index, all) => all.findIndex((item) => item.uci === move.uci) === index)} selected={candidate?.uci} onSelect={(move) => { setCandidate(move); setPredictedReply(null); }} />
              {candidate && <p className="selected-sequence">{t("yourCandidate", { move: candidate.san })}</p>}
              <button type="button" className={`btn ${selectionTarget === "candidate" ? "primary" : ""}`} onClick={() => setSelectionTarget("candidate")}>{t("selectAnother")}</button>
              <NotationHelp />
              <button type="button" className="btn primary" onClick={continueCandidate}>{t("continue")}</button>
            </>
          )}

          {phase === "reply" && candidate && (
            <>
              <div ref={replyRef} tabIndex={-1}><h2>{t("replyTitle", { move: candidate.san })}</h2></div>
              <p>{t("replyHint")}</p>
              {predictedReply?.status === "move_selected" && <p className="selected-sequence">{t("predictedReply", { move: predictedReply.move.san })}</p>}
              <button type="button" className={`btn ${selectionTarget === "reply" ? "primary" : ""}`} onClick={() => setSelectionTarget("reply")}>{t("selectReply")}</button>
              <button type="button" className="btn ghost" onClick={() => { setPredictedReply({ status: "none_found" }); setSelectionTarget(null); }}>{t("noneFound")}</button>
              <button type="button" className="btn primary" onClick={continueReply}>{t("continue")}</button>
            </>
          )}

          {phase === "decide" && candidate && predictedReply && (
            <>
              <h2>{t("decideTitle")}</h2>
              <p className="selected-sequence">{t("yourMove")}: <strong>{candidate.san}</strong></p>
              {predictedReply.status === "move_selected" && <p className="selected-sequence">{t("predictedReply", { move: predictedReply.move.san })}</p>}
              {predictedReply.status === "none_found" && <p>{t("noneFoundRecorded")}</p>}
              {predictedReply.status === "not_applicable_checkmate" && <p>{t("checkmateEnds")}</p>}
              <p>{t("keepQuestion")}</p>
              <p className="muted small">{t("noSolutionYet")}</p>
              <button
                type="button"
                className="btn primary"
                data-testid="train-submit"
                disabled={submitting}
                onClick={() => void submit()}
              >
                {submitting ? t("submitting") : t("keepCandidate")}
              </button>
              <button type="button" className="btn ghost" onClick={() => { setPhase("candidate"); setPredictedReply(null); setSelectionTarget(null); }}>
                {t("changeCandidate")}
              </button>
            </>
          )}

          {phase === "feedback" && lastAttempt && (
            <FeedbackPanel
              exercise={exercise}
              attempt={lastAttempt}
              locale={locale}
              onRetry={() => {
                resetForExercise(exercise.id);
              }}
              onNext={() => resetForExercise(nextSel.exercise.id)}
              nextReason={formatSelectionReasons(nextSel.reasons, locale)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

type CategoryBlockProps = { title: string; question: string; value: CategoryDraft; active: boolean; onAdd: () => void; onNone: () => void; onRemove: (uci: string) => void; onNote?: (uci: string, note: string) => void; noneLabel: string; removeLabel: string; addLabel: string; noteLabel?: string };

const CategoryBlock = forwardRef<HTMLDivElement, CategoryBlockProps>(CategoryBlockImpl);

function CategoryBlockImpl(props: CategoryBlockProps, ref: ForwardedRef<HTMLDivElement>) { return CategoryBlockInner(props, ref); }
function CategoryBlockInner({ title, question, value, active, onAdd, onNone, onRemove, onNote, noneLabel, removeLabel, addLabel, noteLabel }: CategoryBlockProps, ref: ForwardedRef<HTMLDivElement>) {
  return <div className="reasoning-category" ref={ref} tabIndex={-1}><h3>{title}</h3><p>{question}</p><div className="move-chips">{value.moves.map((move) => <span className="move-chip" key={move.uci}><span className="mono">{move.san}</span><button type="button" aria-label={`${removeLabel} ${move.san}`} onClick={() => onRemove(move.uci)}>×</button>{onNote && <input aria-label={`${noteLabel} ${move.san}`} placeholder={noteLabel} value={move.note ?? ""} onChange={(e) => onNote(move.uci, e.target.value)} />}</span>)}</div>{value.status === "none_seen" && <p className="muted small">{noneLabel}</p>}<div className="actions"><button type="button" className={`btn ${active ? "primary" : ""}`} onClick={onAdd}>{addLabel}</button><button type="button" className="btn ghost" onClick={onNone}>{noneLabel}</button></div></div>;
}

function MoveChoices({ moves, selected, onSelect }: { moves: ReasoningMove[]; selected?: string; onSelect: (move: ReasoningMove) => void }) { return <div className="move-choices">{moves.map((move) => <button type="button" className={`btn move-choice ${selected === move.uci ? "primary" : ""}`} key={move.uci} onClick={() => onSelect(move)}>{move.san}</button>)}</div>; }

const BOARD_SQUARES = [..."abcdefgh"].flatMap((file) => [..."12345678"].map((rank) => `${file}${rank}`));
function KeyboardMovePicker({ from, to, onFrom, onTo, onPlay }: { from: string; to: string; onFrom: (square: string) => void; onTo: (square: string) => void; onPlay: () => void }) {
  const { t } = useTranslation("training");
  return <div className="keyboard-move-controls"><label>{t("originSquare")}<select value={from} onChange={(e) => onFrom(e.target.value)}><option value="">—</option>{BOARD_SQUARES.map((square) => <option key={square}>{square}</option>)}</select></label><label>{t("destinationSquare")}<select value={to} onChange={(e) => onTo(e.target.value)}><option value="">—</option>{BOARD_SQUARES.map((square) => <option key={square}>{square}</option>)}</select></label><button type="button" className="btn" onClick={onPlay}>{t("playSelectedMove")}</button></div>;
}

function NotationHelp() {
  const { t } = useTranslation("training");
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) popoverRef.current?.focus(); }, [open]);
  return <span className="notation-help" onMouseEnter={() => setOpen(true)} onMouseLeave={() => { if (!pinned) setOpen(false); }}><button type="button" className="btn ghost notation-trigger" aria-expanded={open} aria-controls="training-notation-help" onClick={() => { const next = !pinned; setPinned(next); setOpen(next); }}>{t("notationHelpButton")}</button>{open && <div id="training-notation-help" ref={popoverRef} className="notation-popover" role="dialog" aria-label={t("notationHelpButton")} tabIndex={-1} onKeyDown={(e) => { if (e.key === "Escape") { setPinned(false); setOpen(false); (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus(); } }}><p><strong>{t("notationAuto")}</strong></p><p>{t("notationPieces")}</p><p>{t("notationSymbols")}</p><p>{t("notationExamples")}</p><p className="small">{t("notationInternational")}</p></div>}</span>;
}

function FeedbackPanel({
  exercise,
  attempt,
  locale,
  onRetry,
  onNext,
  nextReason,
}: {
  exercise: ReturnType<typeof getExercise>;
  attempt: AttemptRecord;
  locale: SupportedLocale;
  onRetry: () => void;
  onNext: () => void;
  nextReason: string;
}) {
  const { t } = useTranslation(["training", "common", "technical"]);
  if (!exercise) return null;

  const status = attempt.evaluationStatus;
  const rivalReply =
    attempt.opponentReplySan ?? opponentStrongestReply(exercise, attempt.opponentReplySan);

  const altLine = exercise.referenceLineSan
    ? `${formatMoveForDisplay(exercise.solutionSan, locale)} · ${exercise.referenceLineSan
        .split(/\s+/)
        .map((move) => formatMoveForDisplay(move, locale))
        .join(" ")}`
    : formatMoveForDisplay(exercise.solutionSan, locale);

  return (
    <div className="feedback" data-testid="train-feedback">
      <h2>{t("feedbackTitle")}</h2>
      <dl className="feedback-dl">
        <dt>{t("yourMove")}</dt>
        <dd>{formatMoveForDisplay(attempt.chosenMoveSan, locale)}</dd>
        <dt>{t("classification")}</dt>
        <dd className={`result result-${status}`} data-testid="train-feedback-classification">
          {formatEvaluationStatus(status, locale)} — {formatEvaluationSummary(status, locale)}
        </dd>
        <dt>{t("opponentStrongest")}</dt>
        <dd className="mono">
          {rivalReply ? formatMoveForDisplay(rivalReply, locale) : t("opponentUnavailable")}
        </dd>
        <dt>{t("observableReason")}</dt>
        <dd>
          {formatObservableReason(
            attempt.observableReason ?? exercise.observableReason ?? null,
            locale,
          )}
        </dd>
        <dt>{t("recommendedAlt")}</dt>
        <dd className="mono">{altLine}</dd>
        <dt>{t("playedInGame")}</dt>
        <dd className="mono">{formatMoveForDisplay(exercise.playedMoveSan, locale)}</dd>
      </dl>
      <p className="muted small">
        <strong>{t("reflection")}:</strong>{" "}
        {attempt.reflectionPrompt ?? buildReflectionPrompt(exercise, status, t)}
      </p>
      {status === "unverified" && <p className="warn small">{t("unverifiedWarn")}</p>}
      <TechnicalDetails>
        <TechnicalRow label={t("technical:criterion")} value={attempt.evalCriterionVersion} />
        <TechnicalRow
          label={t("technical:evaluation")}
          value={
            attempt.evalVerified ? t("technical:evalVerified") : t("technical:evalUnverified")
          }
        />
      </TechnicalDetails>
      <div className="actions">
        {(status === "incorrect" || status === "playable_inexact" || status === "unverified") && (
          <button type="button" className="btn" onClick={onRetry}>
            {t("retry")}
          </button>
        )}
        <button type="button" className="btn primary" onClick={onNext}>
          {t("nextAdaptive")}
        </button>
      </div>
      <p className="reason small">
        {t("nextSelection")}: {nextReason}
      </p>
    </div>
  );
}
