import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Chessboard } from "react-chessboard";
import {
  coachSessionAction,
  fetchCoachSession,
  startCoachSession,
  type CoachSessionView,
} from "../api/coachClient";
import { moveFromSquares } from "../domain/trainingReasoning";

export function CoachSession() {
  const { t } = useTranslation(["coach", "common"]);
  const { sessionId: routeSessionId } = useParams();
  const navigate = useNavigate();
  const [view, setView] = useState<CoachSessionView | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [reveal, setReveal] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    const res = await fetchCoachSession(id);
    setView(res.view);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        if (routeSessionId) {
          await load(routeSessionId);
        } else {
          const started = await startCoachSession();
          setView(started.view);
          navigate(`/coach/session/${started.view.sessionId}`, { replace: true });
        }
      } catch {
        setError("load_failed");
      } finally {
        setLoading(false);
      }
    })();
  }, [routeSessionId, load, navigate]);

  useEffect(() => {
    setSelectedSquare(null);
  }, [view?.phase, view?.sessionId]);

  const runAction = async (action: string, body: Record<string, unknown> = {}) => {
    if (!view?.sessionId) return;
    try {
      const res = await coachSessionAction(view.sessionId, action, body);
      setView(res.view);
      if (res.feedback?.messageKey) {
        setFeedback(t(String(res.feedback.messageKey)));
      }
      if (res.feedback?.hypothesisKey) {
        setFeedback(t(String(res.feedback.hypothesisKey)));
      }
      if (res.feedback?.reveal) {
        const r = res.feedback.reveal as Record<string, string>;
        setReveal(r.genericKey ? { message: t(r.genericKey) } : r);
      }
    } catch {
      setError("action_failed");
    }
  };

  const board = view?.board;
  const orientation = board?.orientation ?? "white";
  const fen = board?.fen ?? "start";

  const customSquareStyles = useMemo(() => {
    const styles: Record<string, CSSProperties> = {};
    for (const sq of view?.highlightSquares ?? []) {
      styles[sq] = { backgroundColor: "rgba(255, 193, 7, 0.45)" };
    }
    if (selectedSquare) {
      styles[selectedSquare] = { backgroundColor: "rgba(33, 150, 243, 0.45)" };
    }
    return styles;
  }, [view?.highlightSquares, selectedSquare]);

  const onDrop = (source: string, target: string) => {
    if (!view?.actions?.includes("submit_move") || !board) return false;
    const move = moveFromSquares(fen, source, target);
    if (!move) {
      setFeedback(t("coach:illegalMove"));
      return false;
    }
    void runAction("submit_move", {
      from: source,
      to: target,
      moveRole: view.moveRole,
    });
    return true;
  };

  const onSquareClick = (square: string) => {
    if (!view?.actions?.includes("submit_move")) return;
    if (!selectedSquare) {
      setSelectedSquare(square);
      return;
    }
    if (selectedSquare === square) {
      setSelectedSquare(null);
      return;
    }
    if (onDrop(selectedSquare, square)) {
      setSelectedSquare(null);
    } else {
      setSelectedSquare(square);
    }
  };

  if (loading) return <p className="muted">{t("common:loading")}</p>;
  if (error && !view) {
    return (
      <div className="page">
        <p className="reasoning-error">{t("coach:engineRequired")}</p>
        <Link to="/">{t("coach:backToday")}</Link>
      </div>
    );
  }
  if (!view) return null;

  return (
    <div className="page coach-session" data-testid="coach-session">
      <div className="coach-session-layout">
        <div className="board-panel coach-board-panel" data-testid="coach-board">
          <Chessboard
            position={fen}
            boardOrientation={orientation}
            onPieceDrop={onDrop}
            onSquareClick={onSquareClick}
            customSquareStyles={customSquareStyles}
            arePiecesDraggable={view.actions?.includes("submit_move") ?? false}
          />
        </div>
        <div className="flow-panel coach-flow-panel">
          <p className="reasoning-progress">{t("coach:phaseLabel", { phase: view.phase })}</p>
          {view.instructionKey && <div className="board-instruction">{t(view.instructionKey)}</div>}
          {feedback && <p className="coach-feedback">{feedback}</p>}
          {reveal && (
            <div className="card coach-reveal" data-testid="coach-holdout-reveal">
              <p>{reveal.message ?? t("coach:holdoutRevealGeneric")}</p>
              <p className="muted small">{t(view.holdoutExposureNoteKey ?? "coach:holdoutExposureNote")}</p>
            </div>
          )}

          <div className="actions coach-actions">
            {view.actions?.includes("continue") && (
              <button
                type="button"
                className="btn btn-primary"
                data-testid="coach-continue"
                onClick={() => void runAction("continue")}
              >
                {t("coach:continue")}
              </button>
            )}
            {view.actions?.includes("apply_demo") && view.demoMove && (
              <button
                type="button"
                className="btn btn-primary"
                data-testid="coach-apply-demo"
                onClick={() => void runAction("apply_demo")}
              >
                {t("coach:applyDemo", { move: view.demoMove.san })}
              </button>
            )}
            {view.actions?.includes("request_hint") && (
              <button type="button" className="btn" onClick={() => void runAction("request_hint")}>
                {t("coach:hint", { level: view.hintLevel + 1 })}
              </button>
            )}
            {view.actions?.includes("submit_probe") &&
              view.probeOptions?.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="btn"
                  data-testid={`coach-probe-${option}`}
                  onClick={() => void runAction("submit_probe", { answer: option })}
                >
                  {t(`coach:probe.${option}`)}
                </button>
              ))}
            {view.actions?.includes("submit_exit_rule") &&
              view.ruleOptions?.map((ruleKey) => (
                <button
                  key={ruleKey}
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void runAction("submit_exit_rule", { ruleKey })}
                >
                  {t(ruleKey)}
                </button>
              ))}
            {view.actions?.includes("finish") && (
              <button type="button" className="btn btn-primary" data-testid="coach-finish" onClick={() => void runAction("finish")}>
                {t("coach:finish")}
              </button>
            )}
            {view.actions?.includes("finish_retention") && (
              <button
                type="button"
                className="btn btn-primary"
                data-testid="coach-finish-retention"
                onClick={() => void runAction("finish_retention")}
              >
                {t("coach:finishRetention")}
              </button>
            )}
          </div>

          {view.learningSummary && (
            <details className="technical-details">
              <summary>{t("coach:learningChannels")}</summary>
              <ul className="stat-list">
                <li>{t("coach:channelHints", { level: view.learningSummary.maxHintLevel ?? 0 })}</li>
                <li>{t("coach:channelPractice", { value: String(view.learningSummary.practiceFirstAttemptSuccess) })}</li>
                <li>{t("coach:channelHoldout", { value: String(view.learningSummary.holdoutFirstAttemptSuccess) })}</li>
                <li>{t("coach:channelRetention", { date: view.learningSummary.retentionDueAt ?? "—" })}</li>
              </ul>
            </details>
          )}

          <Link to="/" className="btn btn-link">
            {t("coach:backToday")}
          </Link>
        </div>
      </div>
    </div>
  );
}
