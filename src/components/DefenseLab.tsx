import { useCallback, useEffect, useState } from "react";
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

type Phase = "read" | "threat" | "resource" | "move" | "verify" | "feedback";
type FullFeedback = DefenseFeedbackDto & {
  sourceGameId: string;
  phase: "opening" | "middlegame" | "endgame";
  orientation: "white" | "black";
  moveSan: string;
  moveUci: string;
};

const threatOptions = [
  ["check", "Jaque"],
  ["capture", "Captura"],
  ["mate", "Amenaza de mate"],
  ["material", "Ganancia de material"],
  ["positional", "Presión posicional"],
  ["not_sure", "No estoy seguro"],
] as const;

const resources: Array<[DefensiveResource | "not_sure", string]> = [
  ["countercheck", "Contra-jaque"],
  ["capture_attacker", "Capturar al atacante"],
  ["move_attacked_piece", "Retirar la pieza atacada"],
  ["defend_target", "Defender el objetivo"],
  ["block_or_interpose", "Bloquear o interponer"],
  ["trade_attackers", "Cambiar atacantes"],
  ["queen_trade", "Cambiar damas"],
  ["create_escape_square", "Crear una casilla de escape"],
  ["remove_defender", "Eliminar al defensor"],
  ["counterattack", "Contraatacar"],
  ["simplify", "Simplificar"],
  ["prophylaxis", "Profilaxis"],
  ["not_sure", "No estoy seguro"],
];

const statusLabel: Record<string, string> = {
  verified_best: "Defensa óptima verificada",
  verified_acceptable: "Defensa aceptable verificada",
  playable_inexact: "Jugable, pero imprecisa",
  incorrect: "No neutraliza el peligro",
  unverified: "No verificada",
  illegal: "Jugada ilegal",
};

export function DefenseLab() {
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
      setError("No fue posible cargar una posición defensiva verificada.");
    } finally {
      setLoading(false);
    }
  }, [state.defenseLab.attempts]);

  useEffect(() => {
    void loadNext();
    // The exercise changes only through the explicit next action.
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
      setError("No fue posible verificar la defensa. El intento no se marcó como correcto.");
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

  if (loading && !prompt) return <div className="page"><p>Cargando Defense Lab…</p></div>;
  if (error && !prompt) return <div className="page"><p className="warn">{error}</p></div>;
  if (!prompt) return null;

  return (
    <div className="page defense" data-testid="defense-root">
      <div className="page-head">
        <p className="eyebrow">Defense Lab · te toca defender</p>
        <h1>Neutraliza la amenaza antes de jugar automático</h1>
        <p className="reason">{prompt.selectionReason}</p>
        {prompt.dataset && (
          <p className="tiny muted">
            Dataset {prompt.dataset.releaseVersion} · {prompt.dataset.selected} seleccionados de{" "}
            {prompt.dataset.technicallyEligible} elegibles · universo completo{" "}
            {prompt.dataset.candidatesAnalyzed} · {prompt.dataset.selectionVersion}
          </p>
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
          {moveSan && <p className="mono center">Jugada elegida: <strong>{moveSan}</strong></p>}
          <p className="muted small">
            {prompt.sourceContext.playerColor === "white" ? "Blancas" : "Negras"} · movimiento{" "}
            {prompt.sourceContext.moveNumber} · {prompt.phase}
            {prompt.sourceContext.opening ? ` · ${prompt.sourceContext.opening}` : ""}
          </p>
          {prompt.previousMoveSan && (
            <p className="small">Última jugada rival: <span className="mono">{prompt.previousMoveSan}</span></p>
          )}
        </section>

        <section className="card flow-panel">
          {phase === "read" && (
            <>
              <h2>1. Lee la posición</h2>
              <p>{prompt.prompt}</p>
              <p className="muted small">Sin evaluación, flechas ni jugada de la partida.</p>
              <button className="btn primary" onClick={() => setPhase("threat")}>Ya leí la posición</button>
            </>
          )}
          {phase === "threat" && (
            <>
              <h2>2. Identifica la amenaza</h2>
              <p>¿Qué intenta conseguir tu rival si juegas de manera automática?</p>
              <div className="choice-grid">
                {threatOptions.map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="checkbox"
                      checked={threats.includes(value)}
                      onChange={() =>
                        setThreats((items) =>
                          items.includes(value) ? items.filter((item) => item !== value) : [...items, value],
                        )
                      }
                    />{" "}{label}
                  </label>
                ))}
              </div>
              <label className="field">
                <span>Describe la respuesta más incómoda del rival (opcional)</span>
                <textarea className="textarea" value={threatText} onChange={(event) => setThreatText(event.target.value)} />
              </label>
              <button className="btn primary" disabled={!threats.length} onClick={() => setPhase("resource")}>
                Elegir recurso
              </button>
            </>
          )}
          {phase === "resource" && (
            <>
              <h2>3. Elige qué recurso buscar</h2>
              <p>¿Qué tipo de recurso buscarías primero?</p>
              <select aria-label="Recurso defensivo" value={resource} onChange={(event) => setResource(event.target.value as DefensiveResource | "not_sure")}>
                {resources.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
              <div className="actions"><button className="btn primary" onClick={() => setPhase("move")}>Jugar en el tablero</button></div>
            </>
          )}
          {phase === "move" && (
            <>
              <h2>4. Juega tu defensa</h2>
              <p>Arrastra una pieza. También puedes escribir SAN y validarla localmente.</p>
              <label className="field">
                <span>Jugada en SAN</span>
                <input
                  className="input"
                  placeholder="ej. Nf3"
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
                Validar jugada
              </button>
              {moveUci && (
                <div className="actions">
                  <button className="btn primary" onClick={() => setPhase("verify")}>Verificación mental</button>
                  <button className="btn ghost" onClick={() => { setMoveSan(""); setMoveUci(""); setTypedSan(""); setBoardFen(prompt.fen); }}>Cambiar jugada</button>
                </div>
              )}
            </>
          )}
          {phase === "verify" && (
            <>
              <h2>5. Verifica antes de confirmar</h2>
              <label className="field">
                <span>Respuesta más forzante del rival</span>
                <input className="input" value={predictedReply} onChange={(event) => setPredictedReply(event.target.value)} />
              </label>
              <label className="field">
                <span>¿Por qué debería resistir tu defensa?</span>
                <textarea className="textarea" value={reasoning} onChange={(event) => setReasoning(event.target.value)} />
              </label>
              <label>
                <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />{" "}
                Comprobé jaques, capturas y amenazas del rival después de mi jugada.
              </label>
              <div className="actions">
                <button
                  className="btn primary"
                  data-testid="defense-confirm"
                  disabled={!checked || predictedReply.trim().length < 2 || reasoning.trim().length < 4 || loading}
                  onClick={() => void submit()}
                >
                  {loading ? "Verificando…" : "Confirmar defensa"}
                </button>
                <button className="btn ghost" onClick={() => setPhase("move")}>Cambiar jugada</button>
              </div>
              {error && <p className="warn">{error}</p>}
            </>
          )}
          {phase === "feedback" && feedback && (
            <DefenseFeedback
              feedback={feedback}
              attempt={firstAttempt}
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
  onRetry,
  onNext,
}: {
  feedback: FullFeedback;
  attempt: DefenseAttempt | null;
  onRetry: () => void;
  onNext: () => void;
}) {
  return (
    <div data-testid="defense-feedback">
      <h2>Feedback defensivo</h2>
      <ol className="feedback-sequence">
        <li><strong>Amenaza:</strong> {feedback.threat.description}</li>
        <li><strong>Tu jugada:</strong> <span className="mono">{feedback.moveSan}</span></li>
        <li><strong>Estado:</strong> <span className={`result result-${feedback.evaluationStatus}`}>{statusLabel[feedback.evaluationStatus]}</span></li>
        <li><strong>Recurso:</strong> {feedback.motif.confidence === "low" ? "Defensa neutral" : feedback.motif.resource} ({feedback.motif.confidence})</li>
        <li><strong>Defensa recomendada:</strong> <span className="mono">{feedback.referenceDefenseSan}</span></li>
        <li><strong>Respuesta rival más fuerte:</strong> <span className="mono">{feedback.opponentReplySan ?? "no verificada"}</span></li>
        <li><strong>En la partida:</strong> {feedback.actualPlayedMoveSan} · {feedback.actualPunishmentLineSan.join(" ")}</li>
        <li><strong>Línea corta:</strong> <span className="mono">{feedback.defenseReferenceLineSan.slice(0, 6).join(" ")}</span></li>
        <li><strong>Regla transferible:</strong> {feedback.pedagogy.transferableRule}</li>
      </ol>
      <p><strong>Hecho observable:</strong> {feedback.pedagogy.observable}</p>
      <p><strong>Explicación ajedrecística:</strong> {feedback.pedagogy.interpretation}</p>
      <p className="muted small">
        Hipótesis de hábito: {feedback.pedagogy.habitHypothesis} · confianza {feedback.pedagogy.confidence}.
      </p>
      {attempt?.retryOfAttemptId && <p className="small">Este resultado se compara con tu primer intento.</p>}
      <div className="actions">
        <button className="btn" onClick={onRetry}>Reintentar sin flecha</button>
        <button className="btn primary" onClick={onNext}>Siguiente posición adaptada</button>
      </div>
    </div>
  );
}
