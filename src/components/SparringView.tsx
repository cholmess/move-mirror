import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import {
  createSparringSession,
  fetchReview,
  fetchSparringPgn,
  fetchSparringSession,
  postAgentMove,
  postHint,
  postPlayerMove,
  postResign,
  postResume,
  postReview,
  type SparringSessionDto,
  type SparringStyle,
} from "../api/sparringClient";
import { fetchNextDefense } from "../api/defenseClient";
import { PATTERN_ID } from "../data/constants";
import { useApp } from "../context/AppContext";
import { TechnicalDetails, TechnicalRow } from "./TechnicalDetails";

const SESSION_KEY = "move-mirror-sparring-active-v1";

type Screen = "setup" | "play" | "finished";

function boardOrientation(session: SparringSessionDto) {
  return session.userColor;
}

function userToMove(session: SparringSessionDto) {
  const turn = session.fen.split(" ")[1];
  return (session.userColor === "white" && turn === "w") || (session.userColor === "black" && turn === "b");
}

function moveSans(session: SparringSessionDto) {
  return session.moveHistory.map((m) => m.san);
}

export function SparringView() {
  const { t } = useTranslation(["sparring", "navigation", "common"]);
  const { state } = useApp();
  const [screen, setScreen] = useState<Screen>("setup");
  const [mode, setMode] = useState<"targeted_position" | "full_game">("targeted_position");
  const [style, setStyle] = useState<SparringStyle>("balanced");
  const [color, setColor] = useState<"white" | "black" | "random">("white");
  const [clockMode, setClockMode] = useState<"untimed" | "10+0">("untimed");
  const [session, setSession] = useState<SparringSessionDto | null>(null);
  const [boardFen, setBoardFen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hintShown, setHintShown] = useState(false);
  const [review, setReview] = useState<Record<string, unknown> | null>(null);
  const [showTechnical, setShowTechnical] = useState(false);

  const syncSession = useCallback((next: SparringSessionDto) => {
    setSession(next);
    setBoardFen(next.fen);
    localStorage.setItem(SESSION_KEY, next.sessionId);
    if (next.sessionStatus === "completed" || next.sessionStatus === "resigned") setScreen("finished");
    else setScreen("play");
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const stored = localStorage.getItem(SESSION_KEY);
        if (!stored) return;
        const existing = await fetchSparringSession(stored);
        if (["active", "paused", "created"].includes(existing.sessionStatus)) {
          syncSession(existing);
        }
      } catch {
        localStorage.removeItem(SESSION_KEY);
      }
    })();
  }, [syncSession]);

  const startSession = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        mode,
        userColor: color,
        style,
        clockMode,
        patternId: PATTERN_ID,
        maxPlies: mode === "targeted_position" ? 40 : undefined,
      };
      if (mode === "targeted_position") {
        const defense = await fetchNextDefense(state.defenseLab.attempts, []);
        body.defenseExerciseId = defense.exerciseId;
      }
      const created = await createSparringSession(body);
      syncSession(created);
      if (!userToMove(created)) {
        await postAgentMove(created.sessionId);
        syncSession(await fetchSparringSession(created.sessionId));
      }
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      setError(t(`errors.${code}`, { defaultValue: t("loadError") }));
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (source: string, target: string) => {
    if (!session || busy || !userToMove(session)) return false;
    const chess = new Chess(boardFen);
    const move = chess.move({ from: source, to: target, promotion: "q" });
    if (!move) return false;
    const uci = `${move.from}${move.to}${move.promotion ?? ""}`;
    setBusy(true);
    setError(null);
    void postPlayerMove(session.sessionId, uci)
      .then(({ session: next }) => {
        syncSession(next);
      })
      .catch((err: Error) => {
        setError(t(`errors.${String(err.message).replace("Error: ", "")}`, { defaultValue: t("errors.illegal_move") }));
      })
      .finally(() => setBusy(false));
    return true;
  };

  const handleHint = async () => {
    if (!session) return;
    await postHint(session.sessionId);
    setHintShown(true);
  };

  const handleResign = async () => {
    if (!session) return;
    const next = await postResign(session.sessionId);
    syncSession(next);
  };

  const handleRetryEngine = async () => {
    if (!session) return;
    setBusy(true);
    try {
      await postResume(session.sessionId);
      await postAgentMove(session.sessionId);
      syncSession(await fetchSparringSession(session.sessionId));
    } catch {
      setError(t("errors.engine_unavailable"));
    } finally {
      setBusy(false);
    }
  };

  const handleContinueAfterRestart = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const next = await postResume(session.sessionId);
      syncSession(next);
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      setError(t(`errors.${code}`, { defaultValue: t("loadError") }));
    } finally {
      setBusy(false);
    }
  };

  const runReview = async () => {
    if (!session) return;
    setBusy(true);
    try {
      const r = await postReview(session.sessionId);
      setReview(r);
    } catch {
      setError(t("loadError"));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (screen !== "finished" || !session) return;
    void fetchReview(session.sessionId)
      .then(setReview)
      .catch(() => undefined);
  }, [screen, session]);

  const clockResumeRequired = session?.clock?.mode === "10+0" && Boolean(session.clock.resumeRequired);

  const clockLabel = useMemo(() => {
    if (!session?.clock || session.clock.mode === "untimed") return null;
    const ms =
      session.userColor === "white" ? session.clock.whiteRemainingMs : session.clock.blackRemainingMs;
    if (ms == null) return null;
    const sec = Math.ceil(ms / 1000);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  }, [session]);

  if (screen === "setup") {
    return (
      <div className="panel" data-testid="sparring-root">
        <h1>{t("title")}</h1>
        <p className="lede">{t("integrity")}</p>
        <div className="form-grid">
          <label>
            {t("modes.targeted")} / {t("modes.full")}
            <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="targeted_position">{t("modes.targeted")}</option>
              <option value="full_game">{t("modes.full")}</option>
            </select>
          </label>
          <label>
            {t("style.label")}
            <select value={style} onChange={(e) => setStyle(e.target.value as SparringStyle)}>
              <option value="instructional">{t("style.instructional")}</option>
              <option value="balanced">{t("style.balanced")}</option>
              <option value="strong">{t("style.strong")}</option>
            </select>
          </label>
          {mode === "full_game" && (
            <>
              <label>
                {t("color.label")}
                <select value={color} onChange={(e) => setColor(e.target.value as typeof color)}>
                  <option value="white">{t("color.white")}</option>
                  <option value="black">{t("color.black")}</option>
                  <option value="random">{t("color.random")}</option>
                </select>
              </label>
              <label>
                {t("clock.label")}
                <select value={clockMode} onChange={(e) => setClockMode(e.target.value as typeof clockMode)}>
                  <option value="untimed">{t("clock.untimed")}</option>
                  <option value="10+0">{t("clock.practice10")}</option>
                </select>
              </label>
            </>
          )}
        </div>
        <section className="callout">
          <strong>{mode === "targeted_position" ? t("targetedLead") : t("fullLead")}</strong>
          <p>{mode === "targeted_position" ? t("targetedBody") : t("whySelectedBody")}</p>
          <p>
            <strong>{t("whySelected")}</strong>: {t("whySelectedBody")}
          </p>
        </section>
        {error && <p className="error">{error}</p>}
        <button type="button" className="btn primary" disabled={busy} onClick={() => void startSession()}>
          {t("start")}
        </button>
      </div>
    );
  }

  if (screen === "play" && session) {
    return (
      <div className="panel train-layout" data-testid="sparring-root">
        <h1>{t("title")}</h1>
        <p className="muted">{t("noEval")}</p>
        {clockResumeRequired && (
          <div className="callout warn" data-testid="sparring-server-restart">
            <p>{t("serverRestartPaused")}</p>
            <button type="button" className="btn primary" onClick={() => void handleContinueAfterRestart()}>
              {t("continueSession")}
            </button>
          </div>
        )}
        {session.sessionStatus === "paused" && !clockResumeRequired && (
          <div className="callout warn">
            <p>{t("enginePaused")}</p>
            <button type="button" className="btn" onClick={() => void handleRetryEngine()}>
              {t("retryEngine")}
            </button>
          </div>
        )}
        <div className="train-board-row">
          <Chessboard
            position={boardFen}
            boardOrientation={boardOrientation(session)}
            onPieceDrop={onDrop}
            arePiecesDraggable={
              !busy && !clockResumeRequired && userToMove(session) && session.sessionStatus === "active"
            }
          />
          <aside>
            <p>{userToMove(session) ? t("yourTurn") : t("opponentTurn")}</p>
            {clockLabel && <p className="mono">{clockLabel}</p>}
            {!userToMove(session) && session.sessionStatus === "active" && <p>{t("opponentThinking")}</p>}
            <h3>{t("moveHistory")}</h3>
            <p className="mono" data-testid="sparring-move-history">
              {moveSans(session).join(" ")}
            </p>
            <button type="button" className="btn" onClick={() => void handleHint()} disabled={busy}>
              {t("hint")}
            </button>
            {hintShown && <p className="callout">{t("hintBody")}</p>}
            <button type="button" className="btn danger" onClick={() => void handleResign()} disabled={busy}>
              {t("resign")}
            </button>
            {error && <p className="error">{error}</p>}
          </aside>
        </div>
      </div>
    );
  }

  if (screen === "finished" && session) {
    return (
      <div className="panel" data-testid="sparring-root">
        <h1>{t("resultTitle")}</h1>
        <p>
          {session.result ?? "*"} —{" "}
          {session.termination ? t(`termination.${session.termination}`, { defaultValue: session.termination }) : ""}
        </p>
        {!review && (
          <button type="button" className="btn primary" disabled={busy} onClick={() => void runReview()}>
            {t("review.start")}
          </button>
        )}
        {review && (
          <section data-testid="sparring-review">
            <h2>{t("review.title")}</h2>
            <p>{t("review.opportunities", { count: Number(review.opportunityCount ?? 0) })}</p>
            <p>{t("review.resolved", { count: Number(review.resolvedCount ?? 0) })}</p>
            <p>{t("review.needsPractice", { count: Number(review.needsPracticeCount ?? 0) })}</p>
            <h3>{t("review.moments")}</h3>
            <ul>
              {(review.keyMoments as Array<{ playedMoveSan?: string; explanationKey?: string }> | undefined)?.map(
                (m, i) => (
                  <li key={i}>
                    {m.playedMoveSan} — {t(m.explanationKey?.replace("sparring.", "review.") ?? "review.neutral")}
                  </li>
                ),
              )}
            </ul>
            <p>{t(review.recommendationKey ? String(review.recommendationKey).replace("sparring.", "review.") : "review.recommend.continue")}</p>
          </section>
        )}
        <div className="btn-row">
          <button
            type="button"
            className="btn"
            onClick={() => {
              localStorage.removeItem(SESSION_KEY);
              setSession(null);
              setReview(null);
              setScreen("setup");
            }}
          >
            {t("retryPosition")}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() =>
              void fetchSparringPgn(session.sessionId).then((pgn) => navigator.clipboard.writeText(pgn))
            }
          >
            {t("exportPgn")}
          </button>
          <button type="button" className="btn link" onClick={() => setShowTechnical((v) => !v)}>
            {t("technical.title")}
          </button>
        </div>
        {showTechnical && session && (
          <TechnicalDetails defaultOpen>
            <p>{t("technical.title")}</p>
            <TechnicalRow label={t("technical.policy")} value="sparring-policy-v1" />
            <TechnicalRow label={t("technical.qualityGate")} value="sparring-quality-gate-v1" />
            <TechnicalRow label={t("technical.budget")} value="sparring-multipv-80k-v1" />
            <TechnicalRow label={t("technical.seed")} value={session.sessionId} />
          </TechnicalDetails>
        )}
      </div>
    );
  }

  return null;
}
