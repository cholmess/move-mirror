import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import { fetchNextDefense, confirmDefense } from "../api/defenseClient";
import { useApp } from "../context/AppContext";
import type {
  DefenseAttempt,
  DefenseFeedbackDto,
  DefensePromptDto,
  DefensiveResource,
} from "../types/defense";
import {
  formatDefenseSelectionReason,
  formatDefensiveResource,
  formatEvaluationStatus,
  formatEvidenceLevel,
  formatMoveForDisplay,
  formatPhase,
  formatSideToMove,
} from "../i18n/presenters";
import type { SupportedLocale } from "../i18n/types";
import { TechnicalDetails, TechnicalRow } from "./TechnicalDetails";

type Phase = "read" | "threat" | "resource" | "move" | "verify" | "feedback";
type FullFeedback = DefenseFeedbackDto & {
  sourceGameId: string;
  phase: "opening" | "middlegame" | "endgame";
  orientation: "white" | "black";
  moveSan: string;
  moveUci: string;
};

const THREAT_VALUES = ["check", "capture", "mate", "material", "positional", "not_sure"] as const;

const RESOURCE_VALUES: Array<DefensiveResource | "not_sure"> = [
  "countercheck",
  "capture_attacker",
  "move_attacked_piece",
  "defend_target",
  "block_or_interpose",
  "trade_attackers",
  "queen_trade",
  "create_escape_square",
  "remove_defender",
  "counterattack",
  "simplify",
  "prophylaxis",
  "not_sure",
];

export function DefenseLab() {
  const { t, i18n } = useTranslation(["defense", "common", "training", "technical"]);
  const locale = i18n.language as SupportedLocale;
  const { state, recordDefenseLabAttempt } = useApp();
  const [prompt, setPrompt] = useState<DefensePromptDto | null>(null);
  const [phase, setPhase] = useState<Phase>("read");
  const [threats, setThreats] = useState<string[]>([]);
  const [threatText, setThreatText] = useState("");
  const [resource, setResource] = useState<DefensiveResource | "not_sure">("not_sure");
  const [moveUci, setMoveUci] = useState("");
  const [moveSan, setMoveSan] = useState("");
  const [typedSan, setTypedSan] = useState("");
  const [boardFen, setBoardFen] = useState("");
  const [predictedReply, setPredictedReply] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [checked, setChecked] = useState(false);
  const [feedback, setFeedback] = useState<FullFeedback | null>(null);
  const [firstAttempt, setFirstAttempt] = useState<DefenseAttempt | null>(null);
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadNext = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchNextDefense(
        state.defenseLab.attempts,
        state.defenseLab.attempts
          .filter((attempt) => attempt.sessionId === currentDefenseSessionId())
          .map((attempt) => attempt.exerciseId),
      );
      setPrompt(next);
      setBoardFen(next.fen);
      setPhase("read");
      setThreats([]);
      setThreatText("");
      setResource("not_sure");
      setMoveUci("");
      setMoveSan("");
      setTypedSan("");
      setPredictedReply("");
      setReasoning("");
      setChecked(false);
      setFeedback(null);
      setFirstAttempt(null);
      setStartedAt(new Date().toISOString());
    } catch {
      setError(t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [state.defenseLab.attempts, t]);

  useEffect(() => {
    void loadNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDrop = (source: string, target: string) => {
    if (!prompt || phase !== "move") return false;
    const chess = new Chess(prompt.fen);
    const move = chess.move({ from: source, to: target, promotion: "q" });
    if (!move) return false;
    setMoveUci(`${move.from}${move.to}${move.promotion ?? ""}`);
    setMoveSan(move.san);
    setTypedSan(move.san);
    setBoardFen(chess.fen());
    return true;
  };

  const submit = async () => {
    if (!prompt) return;
    setLoading(true);
    setError(null);
    try {
      const result = await confirmDefense({
        exerciseId: prompt.exerciseId,
        moveUci,
        perceivedThreat: threats,
        perceivedThreatText: threatText,
        selectedResource: resource,
        predictedOpponentReply: predictedReply,
        defenseReasoning: reasoning,
        verificationConfirmed: checked,
      });
      const attempt = recordDefenseLabAttempt({
        exerciseId: prompt.exerciseId,
        startedAt,
        perceivedThreat: threats,
        perceivedThreatText: threatText,
        selectedResource: resource,
        predictedOpponentReply: predictedReply,
        defenseReasoning: reasoning,
        verificationConfirmed: checked,
        retryOfAttemptId: firstAttempt?.attemptId ?? null,
        feedback: result,
      });
      if (!firstAttempt) setFirstAttempt(attempt);
      setFeedback(result);
      setPhase("feedback");
    } catch {
      setError(t("verifyError"));
    } finally {
      setLoading(false);
    }
  };

  const retry = () => {
    if (!prompt) return;
    setBoardFen(prompt.fen);
    setMoveUci("");
    setMoveSan("");
    setTypedSan("");
    setPredictedReply("");
    setReasoning("");
    setChecked(false);
    setFeedback(null);
    setStartedAt(new Date().toISOString());
    setPhase("move");
  };

  if (loading && !prompt) {
    return (
      <div className="page">
        <p>{t("loading")}</p>
      </div>
    );
  }
  if (error && !prompt) {
    return (
      <div className="page">
        <p className="warn">{error}</p>
      </div>
    );
  }
  if (!prompt) return null;

  const openingSuffix = prompt.sourceContext.opening ? ` · ${prompt.sourceContext.opening}` : "";

  return (
    <div className="page defense" data-testid="defense-root">
      <div className="page-head">
        <p className="eyebrow">{t("eyebrow")}</p>
        <h1>{t("pageTitle")}</h1>
        <p className="reason" data-testid="defense-selection-reason">
          {formatDefenseSelectionReason(prompt.selectionReason, locale)}
        </p>
        {prompt.dataset && (
          <p className="tiny muted">
            {t("datasetMeta", {
              version: prompt.dataset.releaseVersion,
              selected: prompt.dataset.selected,
              eligible: prompt.dataset.technicallyEligible,
              analyzed: prompt.dataset.candidatesAnalyzed,
            })}
          </p>
        )}
        {prompt.dataset && (
          <TechnicalDetails>
            <TechnicalRow label={t("technical:datasetSelection")} value={prompt.dataset.selectionVersion} />
          </TechnicalDetails>
        )}
      </div>
      <div className="train-grid">
        <section className="card board-panel">
          <Chessboard
            position={boardFen}
            boardOrientation={prompt.orientation}
            onPieceDrop={onDrop}
            arePiecesDraggable={phase === "move"}
          />
          {moveSan && (
            <p className="mono center">
              {t("moveChosen", { move: formatMoveForDisplay(moveSan, locale) })}
            </p>
          )}
          <p className="muted small">
            {t("contextLine", {
              side: formatSideToMove(prompt.sourceContext.playerColor === "white" ? "w" : "b", locale),
              moveNumber: prompt.sourceContext.moveNumber,
              phase: formatPhase(prompt.phase, locale),
              opening: openingSuffix,
            })}
          </p>
          {prompt.previousMoveSan && (
            <p className="small">
              {t("lastOpponentMove", {
                move: formatMoveForDisplay(prompt.previousMoveSan, locale),
              })}
            </p>
          )}
        </section>

        <section className="card flow-panel">
          {phase === "read" && (
            <>
              <h2>{t("stepReadTitle")}</h2>
              <p data-testid="defense-exercise-prompt">
                {prompt.promptKey ? t("exercisePrompt") : (prompt.prompt ?? t("exercisePrompt"))}
              </p>
              <p className="muted small">{t("stepReadHint")}</p>
              <button className="btn primary" onClick={() => setPhase("threat")}>
                {t("stepReadDone")}
              </button>
            </>
          )}
          {phase === "threat" && (
            <>
              <h2>{t("stepThreatTitle")}</h2>
              <p>{t("stepThreatQuestion")}</p>
              <div className="choice-grid">
                {THREAT_VALUES.map((value) => (
                  <label key={value}>
                    <input
                      type="checkbox"
                      checked={threats.includes(value)}
                      onChange={() =>
                        setThreats((items) =>
                          items.includes(value)
                            ? items.filter((item) => item !== value)
                            : [...items, value],
                        )
                      }
                    />{" "}
                    {t(`threatType.${value}`)}
                  </label>
                ))}
              </div>
              <label className="field">
                <span>{t("stepThreatOptional")}</span>
                <textarea
                  className="textarea"
                  value={threatText}
                  onChange={(event) => setThreatText(event.target.value)}
                />
              </label>
              <button className="btn primary" disabled={!threats.length} onClick={() => setPhase("resource")}>
                {t("chooseResource")}
              </button>
            </>
          )}
          {phase === "resource" && (
            <>
              <h2>{t("stepResourceTitle")}</h2>
              <p>{t("stepResourceQuestion")}</p>
              <select
                aria-label={t("stepResourceQuestion")}
                value={resource}
                onChange={(event) => setResource(event.target.value as DefensiveResource | "not_sure")}
              >
                {RESOURCE_VALUES.map((value) => (
                  <option value={value} key={value}>
                    {formatDefensiveResource(value, locale)}
                  </option>
                ))}
              </select>
              <div className="actions">
                <button className="btn primary" onClick={() => setPhase("move")}>
                  {t("playOnBoard")}
                </button>
              </div>
            </>
          )}
          {phase === "move" && (
            <>
              <h2>{t("stepMoveTitle")}</h2>
              <p>{t("stepMoveHint")}</p>
              <label className="field">
                <span>{t("moveSanLabel")}</span>
                <input
                  className="input"
                  placeholder={t("movePlaceholder")}
                  value={typedSan}
                  onChange={(event) => setTypedSan(event.target.value)}
                />
              </label>
              <button
                className="btn"
                disabled={!typedSan.trim()}
                onClick={() => {
                  const chess = new Chess(prompt.fen);
                  try {
                    const move = chess.move(typedSan);
                    if (!move) return;
                    setMoveSan(move.san);
                    setMoveUci(`${move.from}${move.to}${move.promotion ?? ""}`);
                    setBoardFen(chess.fen());
                    setTypedSan(move.san);
                  } catch {
                    setMoveSan("");
                    setMoveUci("");
                    setBoardFen(prompt.fen);
                  }
                }}
              >
                {t("validateMove")}
              </button>
              {moveUci && (
                <div className="actions">
                  <button className="btn primary" onClick={() => setPhase("verify")}>
                    {t("mentalVerify")}
                  </button>
                  <button
                    className="btn ghost"
                    onClick={() => {
                      setMoveSan("");
                      setMoveUci("");
                      setTypedSan("");
                      setBoardFen(prompt.fen);
                    }}
                  >
                    {t("training:changeMove")}
                  </button>
                </div>
              )}
            </>
          )}
          {phase === "verify" && (
            <>
              <h2>{t("stepVerifyTitle")}</h2>
              <label className="field">
                <span>{t("predictedReplyLabel")}</span>
                <input
                  className="input"
                  value={predictedReply}
                  onChange={(event) => setPredictedReply(event.target.value)}
                />
              </label>
              <label className="field">
                <span>{t("whyHoldsLabel")}</span>
                <textarea
                  className="textarea"
                  value={reasoning}
                  onChange={(event) => setReasoning(event.target.value)}
                />
              </label>
              <label>
                <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />{" "}
                {t("verifyCheckbox")}
              </label>
              <div className="actions">
                <button
                  className="btn primary"
                  data-testid="defense-confirm"
                  disabled={
                    !checked ||
                    predictedReply.trim().length < 2 ||
                    reasoning.trim().length < 4 ||
                    loading
                  }
                  onClick={() => void submit()}
                >
                  {loading ? t("training:submitting") : t("confirmDefense")}
                </button>
                <button className="btn ghost" onClick={() => setPhase("move")}>
                  {t("training:changeMove")}
                </button>
              </div>
              {error && <p className="warn">{error}</p>}
            </>
          )}
          {phase === "feedback" && feedback && (
            <DefenseFeedback
              feedback={feedback}
              attempt={firstAttempt}
              locale={locale}
              onRetry={retry}
              onNext={() => void loadNext()}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function currentDefenseSessionId() {
  if (typeof sessionStorage === "undefined") return "defense-runtime";
  const key = "move-mirror-defense-session-v1";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
  }
  return id;
}

function DefenseFeedback({
  feedback,
  attempt,
  locale,
  onRetry,
  onNext,
}: {
  feedback: FullFeedback;
  attempt: DefenseAttempt | null;
  locale: SupportedLocale;
  onRetry: () => void;
  onNext: () => void;
}) {
  const { t } = useTranslation(["defense", "training", "technical"]);

  const resourceLabel =
    feedback.motif.confidence === "low"
      ? t("resourceNeutral")
      : formatDefensiveResource(feedback.motif.resource as DefensiveResource, locale);

  return (
    <div data-testid="defense-feedback">
      <h2>{t("feedbackTitle")}</h2>
      <ol className="feedback-sequence">
        <li>
          <strong>{t("threat")}:</strong> {feedback.threat.description}
        </li>
        <li>
          <strong>{t("yourMove")}:</strong>{" "}
          <span className="mono">{formatMoveForDisplay(feedback.moveSan, locale)}</span>
        </li>
        <li>
          <strong>{t("status")}:</strong>{" "}
          <span className={`result result-${feedback.evaluationStatus}`}>
            {formatEvaluationStatus(feedback.evaluationStatus, locale)}
          </span>
        </li>
        <li>
          <strong>{t("resourceLabel")}:</strong> {resourceLabel} (
          {formatEvidenceLevel(feedback.motif.confidence, locale)})
        </li>
        <li>
          <strong>{t("recommendedDefense")}:</strong>{" "}
          <span className="mono">{formatMoveForDisplay(feedback.referenceDefenseSan, locale)}</span>
        </li>
        <li>
          <strong>{t("opponentReply")}:</strong>{" "}
          <span className="mono">
            {feedback.opponentReplySan
              ? formatMoveForDisplay(feedback.opponentReplySan, locale)
              : t("notVerified")}
          </span>
        </li>
        <li>
          <strong>{t("inGame")}:</strong> {formatMoveForDisplay(feedback.actualPlayedMoveSan, locale)} ·{" "}
          {feedback.actualPunishmentLineSan
            .map((move) => formatMoveForDisplay(move, locale))
            .join(" ")}
        </li>
        <li>
          <strong>{t("shortLine")}:</strong>{" "}
          <span className="mono">
            {feedback.defenseReferenceLineSan
              .slice(0, 6)
              .map((move) => formatMoveForDisplay(move, locale))
              .join(" ")}
          </span>
        </li>
        <li>
          <strong>{t("transferRule")}:</strong> {feedback.pedagogy.transferableRule}
        </li>
      </ol>
      <p>
        <strong>{t("observable")}:</strong> {feedback.pedagogy.observable}
      </p>
      <p>
        <strong>{t("interpretation")}:</strong> {feedback.pedagogy.interpretation}
      </p>
      <p className="muted small">
        {t("habitHypothesis")}: {feedback.pedagogy.habitHypothesis} ·{" "}
        {formatEvidenceLevel(feedback.pedagogy.confidence, locale)}.
      </p>
      <TechnicalDetails>
        <TechnicalRow label={t("technical:uci")} value={feedback.moveUci} />
      </TechnicalDetails>
      {attempt?.retryOfAttemptId && (
        <p className="small">{t("retryCompareNote")}</p>
      )}
      <div className="actions">
        <button className="btn" onClick={onRetry}>
          {t("retryNoArrow")}
        </button>
        <button className="btn primary" onClick={onNext}>
          {t("nextAdapted")}
        </button>
      </div>
    </div>
  );
}
