import { Chess } from "chess.js";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  advancePersonalPractice,
  advancePersonalSlot,
  fetchPersonalExercise,
  requestPatternHint,
  retryPersonalDecision,
  revealPatternSolution,
  startPersonalHoldout,
  startPersonalPractice,
  submitPersonalMove,
  submitPersonalReflection,
  type NextActivity,
  type PersonalExercise,
  type PersonalFeedback,
  type PersonalLesson,
  type SessionResult,
} from "../api/patternsClient";
import { PlayBoard } from "./PlayBoard";
import { formatEvaluationStatus } from "../i18n/presenters";
import type { SupportedLocale } from "../i18n/types";

function outcomeHeadline(outcomeKey: string) {
  const map: Record<string, string> = {
    holdout_independent_correct: "learning:outcome.holdoutCorrect.headline",
    learned_with_help: "learning:outcome.learnedWithHelp.headline",
    needs_reinforcement: "learning:outcome.needsReinforcement.headline",
    not_verifiable: "learning:outcome.notVerifiable.headline",
  };
  return map[outcomeKey] ?? "learning:outcome.incomplete.headline";
}

function outcomeDetail(outcomeKey: string) {
  const map: Record<string, string> = {
    holdout_independent_correct: "learning:outcome.holdoutCorrect.detail",
    learned_with_help: "learning:outcome.learnedWithHelp.detail",
    needs_reinforcement: "learning:outcome.needsReinforcement.detail",
    not_verifiable: "learning:outcome.notVerifiable.detail",
  };
  return map[outcomeKey] ?? "learning:outcome.incomplete.detail";
}

function PersonalLessonCard({ lesson }: { lesson: PersonalLesson }) {
  const { t } = useTranslation("patterns");
  const gameLike = lesson.spoilerPolicy === "game_like_hidden";
  return (
    <section className="card personal-lesson" data-testid="personal-lesson">
      <p className="eyebrow">{t("lesson.eyebrow")}</p>
      <h2>{t(`lesson.action.${lesson.action}`)}</h2>
      <p>{t(`lesson.method.${lesson.method}`)}</p>
      {!gameLike && lesson.narrative && <div data-testid="lesson-narrative">
        <p><strong>{t("lesson.hypothesis")}</strong> {lesson.narrative.statement}</p>
        {lesson.narrative.objective && <p><strong>{t("lesson.objective")}</strong> {lesson.narrative.objective}</p>}
        {lesson.narrative.explanation && <p>{lesson.narrative.explanation}</p>}
        {lesson.narrative.nextTest?.instruction && <p><strong>{t("lesson.nextTest")}</strong> {lesson.narrative.nextTest.instruction}</p>}
        <p className="small muted">{t(lesson.narrative.source === "llm" ? "lesson.groundedSynthesis" : "lesson.rulesSynthesis")}</p>
        {!!lesson.narrative.citations?.length && <details data-testid="lesson-citations"><summary>{t("lesson.citations")}</summary><ul>
          {lesson.narrative.citations.map((citation) => <li key={citation.evidenceId}><Link to={`/games/${citation.gameId}`}>{t("lesson.citation", { move: citation.moveNumber })}</Link></li>)}
        </ul></details>}
      </div>}
      {!gameLike && !lesson.narrative?.explanation && <div data-testid="lesson-rule">
        <p><strong>{t("lesson.rule")}</strong> {t(`catalog.${lesson.patternId}.rule`)}</p>
        <p className="muted">{t(`catalog.${lesson.patternId}.contrast`)}</p>
      </div>}
      {!gameLike && <details data-testid="lesson-evidence">
        <summary>{t("lesson.evidence", lesson.evidence)}</summary>
        <ul>{lesson.evidence.examples.map((example) => <li key={example.evidenceId}>
          <Link to={`/games/${example.gameId}`}>{t("lesson.example", { move: example.moveNumber })}</Link>
        </li>)}</ul>
        {lesson.evidence.contrast
          ? <p><Link to={`/games/${lesson.evidence.contrast.gameId}`}>{t("lesson.contrast", { move: lesson.evidence.contrast.moveNumber })}</Link></p>
          : <p className="muted">{t("lesson.noContrast")}</p>}
      </details>}
      <p>{t("lesson.sequence", { guided: lesson.sequence.guidedPositions })}</p>
      <p className="small muted">{t("lesson.boundary")}</p>
    </section>
  );
}

function SessionSummary({ result, nextActivity, patternId }: { result: SessionResult; nextActivity?: NextActivity; patternId: string }) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation(["learning", "patterns", "coach"]);
  const patternTitle = t(`patterns:catalog.${patternId}.title`);
  const minutes = result.durationMs ? Math.max(1, Math.round(result.durationMs / 60000)) : 0;
  return (
    <section className="callout" data-testid="practice-session-summary">
      <h2>{t("learning:session.title")}</h2>
      <p><strong>{t(outcomeHeadline(result.outcomeKey))}</strong></p>
      <p className="muted">{t(outcomeDetail(result.outcomeKey))}</p>
      {result.lesson && result.countsAsIndependentEvidence && <p data-testid="lesson-evidence-update">{t("patterns:lesson.completed")}</p>}
      {result.evidenceReasonKey && <p className="muted">{t(`learning:${result.evidenceReasonKey}`)}</p>}
      {result.domain.nextReviewAt && (
        <p data-testid="practice-next-review">
          {t("learning:session.nextReview", { date: new Date(result.domain.nextReviewAt).toLocaleDateString(i18n.language) })}
        </p>
      )}
      {minutes > 0 && <p>{t("learning:session.duration", { minutes })}</p>}
      {nextActivity && (
        <div data-testid="practice-next-activity">
          <h3>{t("learning:session.nextTitle")}</h3>
          {nextActivity.reasons.map((reason) => (
            <p key={reason.key}>
              {t(`learning:${reason.key}`, {
                ...reason.params,
                patternId: reason.params?.patternId ? t(`patterns:catalog.${reason.params.patternId}.title`) : patternTitle,
              })}
            </p>
          ))}
          {nextActivity.kind === "pattern" && nextActivity.patternId && (
            <button type="button" className="btn primary" data-testid="practice-next-start" onClick={() => {
              void startPersonalPractice(nextActivity.patternId!).then((ex) => { navigate(`/practice/${ex.id}`); });
            }}>
              {t("patterns:practice")}
            </button>
          )}
          {nextActivity.kind === "finish" && (
            <Link className="btn primary" to="/coach">{t("learning:session.finish")}</Link>
          )}
        </div>
      )}
    </section>
  );
}

export function PersonalPractice() {
  const { exerciseId = "" } = useParams();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation(["patterns", "learning"]);
  const [exercise, setExercise] = useState<PersonalExercise | null>(null);
  const [fen, setFen] = useState("");
  const [feedback, setFeedback] = useState<PersonalFeedback | null>(null);
  const [hint, setHint] = useState(false);
  const [demo, setDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const [candidate, setCandidate] = useState<{ uci: string; san: string; fen: string } | null>(null);
  const [prediction, setPrediction] = useState<{ uci: string; san: string } | null>(null);
  const [noReply, setNoReply] = useState(false);
  const [intention, setIntention] = useState("");
  const [positionEvaluation, setPositionEvaluation] = useState("");
  const [decisionConfidence, setDecisionConfidence] = useState<"" | "low" | "medium" | "high">("");
  useEffect(() => {
    let live = true;
    setExercise(null);
    setCandidate(null); setPrediction(null); setNoReply(false);
    setIntention(""); setPositionEvaluation("");
    setDecisionConfidence("");
    setFeedback(null);
    setHint(false);
    setDemo(false);
    setError("");
    void fetchPersonalExercise(exerciseId)
      .then((ex) => {
        if (live) {
          setExercise(ex);
          setFen(ex.fen);
          setFeedback(ex.feedback ?? null);
        }
      })
      .catch(() => { if (live) setError("exercise_unavailable"); });
    return () => { live = false; };
  }, [exerciseId]);
  async function action(run: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try { await run(); } catch (err) { setError(err instanceof Error ? err.message : "connection"); }
    finally { lock.current = false; setBusy(false); }
  }
  function submitDecision(uci: string, expected?: { replyUci: string | null }) {
    if (!exercise) return;
    void action(async () => {
      const reasoning = exercise.role === "holdout" ? undefined : {
        intention: intention.trim(), evaluation: positionEvaluation.trim(), confidence: decisionConfidence as "low" | "medium" | "high",
      };
      const result = await submitPersonalMove(exercise.id, uci, expected, reasoning);
      setCandidate(null); setPrediction(null); setNoReply(false);
      setFeedback(result);
      setFen(result.resultingFen);
      setExercise((current) => current ? {
        ...current, fen: result.resultingFen, decisionCount: result.decisionNumber,
        status: result.trainingStatus, awaitingNext: result.canContinue,
        canStartHoldout: result.trainingStatus === "ready_for_holdout",
        canAdvanceSlot: result.trainingStatus === "ready_for_next_slot",
        completed: result.trainingStatus === "completed", feedback: result,
        diagnostic: result.diagnostic ?? current.diagnostic,
      } : current);
    });
  }
  function play(from: string, to: string, promotion?: string) {
    if (!exercise || lock.current || feedback || demo || exercise.completed || prediction || noReply) return false;
    const uci = `${from}${to}${promotion ?? ""}`;
    if (exercise.role === "holdout") { submitDecision(uci); return true; }
    const board = new Chess(fen);
    let move;
    try { move = board.move({ from, to, promotion }); } catch { return false; }
    if (!move) return false;
    if (candidate) {
      setPrediction({ uci, san: move.san }); setFen(board.fen());
    } else {
      setCandidate({ uci, san: move.san, fen: board.fen() }); setFen(board.fen());
    }
    return true;
  }
  if (!exercise) {
    return <section className="card"><p>{error ? t(`errors.${error}`) : t("loading")}</p><Link to="/patterns">{t("back")}</Link></section>;
  }
  const holdout = exercise.role === "holdout";
  const gameLike = !holdout && (exercise.lesson?.spoilerPolicy === "game_like_hidden" || exercise.curriculum?.action === "bridge_transfer");
  const sessionProgress = exercise.sessionPositionTotal
    ? t("learning:practice.sessionProgress", { current: exercise.sessionPositionCurrent ?? 1, total: exercise.sessionPositionTotal })
    : t("path.progress", { current: feedback ? exercise.decisionCount : Math.min(exercise.decisionCount + 1, exercise.targetDecisions), total: exercise.targetDecisions });
  const sessionResult = feedback?.sessionResult;
  const reflection = exercise.diagnostic?.reflection;
  return (
    <div className="page" data-testid="personal-practice">
      <p className="eyebrow">{holdout ? t("path.holdoutEyebrow") : t("path.guidedEyebrow")}</p>
      <h1>{holdout ? t("path.holdoutTitle") : t("decision.title")}</h1>
      <p>{holdout ? t("path.holdoutGoal") : t("decision.intro")}</p>
      {!holdout && exercise.lesson && <PersonalLessonCard lesson={exercise.lesson} />}
      {!holdout && !exercise.lesson && !gameLike && exercise.evidenceSummary && (
        <p className="muted" data-testid="pedagogy-evidence-summary">
          {t("pedagogy.observed", exercise.evidenceSummary)} {t("pedagogy.unknown")}
        </p>
      )}
      {!holdout && !exercise.lesson && exercise.curriculum && (
        <section className="callout" data-testid="curriculum-decision">
          <strong>{t("curriculum.title")}</strong>
          <p>{t(`curriculum.action.${exercise.curriculum.action}`)}</p>
          <p className="small muted">{t(`curriculum.reason.${exercise.curriculum.reasonKey}`)}</p>
        </section>
      )}
      {!holdout && !exercise.lesson && !gameLike && exercise.hypothesis && !reflection && (
        <section className="callout" data-testid="pedagogy-memory">
          <strong>{t("pedagogy.checking")}</strong>
          <p>{exercise.hypothesis.statement}</p>
          {exercise.hypothesis.nextTest && <p><strong>{t("pedagogy.nextTest")}:</strong> {exercise.hypothesis.nextTest.instruction}</p>}
          <p className="muted">{t(`pedagogy.hypothesisStatus.${exercise.hypothesis.status}`, { defaultValue: t("pedagogy.stillTentative") })}</p>
          {exercise.hypothesis.evidence && <p className="small muted">{t("hypothesisTracking.counts", {
            probes: exercise.hypothesis.evidence.directProbeSupports,
            support: exercise.hypothesis.evidence.realGameSupports,
            contradict: exercise.hypothesis.evidence.realGameContradictions,
          })}</p>}
        </section>
      )}
      {!holdout && !exercise.lesson && !gameLike && exercise.probe && (
        <section className="callout" data-testid="hypothesis-probe">
          <strong>{t("probe.title")}</strong>
          <p>{t("probe.testing", { target: t(`probe.category.${exercise.probe.targetCategory}`) })}</p>
          {!!exercise.probe.comparedCategories.length && <p>{t("probe.comparing", { alternatives: exercise.probe.comparedCategories.map((category) => t(`probe.category.${category}`)).join(", ") })}</p>}
          {!!exercise.probe.selectionReasons.length && <ul>{exercise.probe.selectionReasons.map((reason) => <li key={reason}>{t(`probe.reason.${reason}`)}</li>)}</ul>}
          {exercise.probe.measurability === "partial" && <p className="muted">{t("probe.partial")}</p>}
        </section>
      )}
      {!holdout && (hint || demo || (feedback && !feedback.coaching)) && (
        <section className="callout" data-testid="pattern-teaching">
          <strong>{t("path.ruleLabel")}</strong>
          <p>{t(`catalog.${exercise.patternId}.rule`)}</p>
          <p className="muted">{t(`catalog.${exercise.patternId}.contrast`)}</p>
        </section>
      )}
      {!holdout && !gameLike && !!exercise.coachingHistory?.length && <p className="muted" data-testid="coaching-memory">{t("decision.memory", { count: exercise.coachingHistory.length })} {t(`decision.followup.${exercise.coachingHistory.at(-1)!.intervention}`)}</p>}
      {exercise.sessionShortfall && !holdout && (
        <p className="muted" data-testid="session-shortfall">{t("learning:session.shortfall", { count: exercise.sessionPositionTotal ?? 0 })}</p>
      )}
      <p className="muted">{sessionProgress}</p>
      {((!holdout && !gameLike) || feedback) && <Link to={`/games/${exercise.gameId}`}>{t("source", { move: exercise.moveNumber })}</Link>}
      <div className="train-grid">
        <section className="card board-panel"><PlayBoard fen={fen} orientation={exercise.color} disabled={busy || !!feedback || demo || exercise.completed || !!prediction || noReply} onMove={play} /></section>
        <aside className="card" aria-live="polite">
          {!feedback && !demo && <p>{busy ? t("checking") : holdout ? t("path.holdoutPrompt") : candidate ? t("decision.replyPrompt", { move: candidate.san }) : t("decision.choose")}</p>}
          {candidate && !feedback && <section data-testid="decision-prediction">
            {prediction && <p>{t("decision.prediction", { move: candidate.san, reply: prediction.san })}</p>}
            {noReply && <p>{t("pedagogy.noReplyRecorded")}</p>}
            {(prediction || noReply || new Chess(candidate.fen).isGameOver()) && !holdout && <div data-testid="pre-feedback-reasoning">
              <p><strong>{t("pedagogy.beforeFeedbackTitle")}</strong></p>
              <p className="muted">{t("pedagogy.beforeFeedbackNote")}</p>
              <label>
                {t("pedagogy.intentionLabel")}
                <textarea className="textarea" value={intention} maxLength={800} disabled={busy} onChange={(event) => setIntention(event.target.value)} />
              </label>
              <label>
                {t("pedagogy.evaluationLabel")}
                <textarea className="textarea" value={positionEvaluation} maxLength={800} disabled={busy} onChange={(event) => setPositionEvaluation(event.target.value)} />
              </label>
              <label>
                {t("pedagogy.decisionConfidenceLabel")}
                <select value={decisionConfidence} disabled={busy} onChange={(event) => setDecisionConfidence(event.target.value as typeof decisionConfidence)}>
                  <option value="">{t("pedagogy.selectConfidence")}</option>
                  <option value="low">{t("pedagogy.decisionConfidence.low")}</option>
                  <option value="medium">{t("pedagogy.decisionConfidence.medium")}</option>
                  <option value="high">{t("pedagogy.decisionConfidence.high")}</option>
                </select>
              </label>
            </div>}
            <div className="actions">
              <button className="btn" disabled={busy} onClick={() => { setFen(exercise.fen); setCandidate(null); setPrediction(null); setNoReply(false); setIntention(""); setPositionEvaluation(""); setDecisionConfidence(""); }}>{t("decision.change")}</button>
              {(prediction || noReply || new Chess(candidate.fen).isGameOver()) && <button className="btn primary" disabled={busy || intention.trim().length < 2 || positionEvaluation.trim().length < 2 || !decisionConfidence} onClick={() => submitDecision(candidate.uci, { replyUci: prediction?.uci ?? null })}>{t("decision.confirm")}</button>}
              {!prediction && !noReply && !new Chess(candidate.fen).isGameOver() && <button className="btn" disabled={busy} onClick={() => setNoReply(true)}>{t("decision.unsure")}</button>}
            </div>
          </section>}
          {feedback?.coaching && <section className="callout" data-testid="decision-coaching">
            <h2>{t(`decision.intervention.${feedback.coaching.intervention}.title`)}</h2>
            <p>{t(`decision.intervention.${feedback.coaching.intervention}.body`, { predicted: feedback.coaching.predictedSan, actual: feedback.replySan })}</p>
            <p>{t(`decision.intervention.${feedback.coaching.intervention}.task`)}</p>
            <p className="muted">{t("decision.hypothesis")}</p>
            <div className="actions">
              <button className="btn" onClick={() => setFen(feedback.coaching!.candidateFen)}>{t("decision.afterMine")}</button>
              <button className="btn" onClick={() => setFen(feedback.resultingFen)}>{t("decision.afterReply")}</button>
              {feedback.coaching.referenceFen && <button className="btn" onClick={() => setFen(feedback.coaching!.referenceFen!)}>{t("decision.reference", { move: feedback.referenceSan })}</button>}
            </div>
          </section>}
          {!holdout && feedback?.coaching && exercise.diagnostic && !reflection && (
            <section className="card" data-testid="pedagogy-reflection">
              <h2>{t("pedagogy.coachQuestion")}</h2>
              <p>{exercise.diagnostic.question}</p>
              {feedback.preFeedbackReasoning && <div className="callout" data-testid="captured-reasoning">
                <p><strong>{t("pedagogy.capturedBeforeFeedback")}</strong></p>
                <p>{feedback.preFeedbackReasoning.intention}</p>
                <p>{feedback.preFeedbackReasoning.evaluation}</p>
                <p className="muted">{t("pedagogy.recordedConfidence", { value: t(`pedagogy.decisionConfidence.${feedback.preFeedbackReasoning.confidence}`) })}</p>
              </div>}
              <button type="button" className="btn primary" data-testid="pedagogy-submit" disabled={busy || !feedback.preFeedbackReasoning} onClick={() => void action(async () => {
                const result = await submitPersonalReflection(exercise.id);
                setExercise((current) => current ? { ...current, diagnostic: current.diagnostic ? { ...current.diagnostic, status: "completed", source: result.source, reflection: result } : null } : current);
              })}>{busy ? t("pedagogy.thinking") : t("pedagogy.submit")}</button>
              <p className="muted small">{exercise.diagnostic.llm.configured ? t("pedagogy.explicitCost") : t("pedagogy.rulesFallback")}</p>
            </section>
          )}
          {!holdout && reflection && (
            <section className="callout" data-testid="pedagogy-result">
              <p className="eyebrow">{t("pedagogy.workingHypothesis")}</p>
              <h2>{reflection.output.primaryHypothesis.statement}</h2>
              <p className="muted">{t("pedagogy.confidence", { value: t(`pedagogy.confidenceValue.${reflection.output.primaryHypothesis.confidence}`) })}</p>
              <p>{reflection.output.teaching.explanation}</p>
              <h3>{t("pedagogy.contrastTitle")}</h3>
              <p><strong>{t("pedagogy.worksWhen")}</strong> {reflection.output.teaching.contrast.worksWhen}</p>
              <p><strong>{t("pedagogy.failsWhen")}</strong> {reflection.output.teaching.contrast.failsWhen}</p>
              <h3>{t("pedagogy.nextTest")}</h3>
              <p>{reflection.output.nextTest.instruction}</p>
              {!!reflection.output.alternativeHypotheses.length && (
                <details><summary>{t("pedagogy.alternatives")}</summary><ul>{reflection.output.alternativeHypotheses.map((row) => <li key={`${row.category}:${row.statement}`}>{row.statement}</li>)}</ul></details>
              )}
              <p className="muted small">{t(reflection.source === "llm" ? "pedagogy.llmSource" : "pedagogy.ruleSource")}</p>
            </section>
          )}
          {feedback && !sessionResult && (
            <div data-testid="personal-feedback">
              <h2>{formatEvaluationStatus(feedback.status, i18n.language as SupportedLocale)}</h2>
              <p>{feedback.chosenSan}{feedback.replySan ? ` → ${feedback.replySan}` : ""}</p>
              <p>{t("feedbackNote")}</p>
              {!holdout && feedback.referenceSan && feedback.status !== "verified_best" && (
                <p>{t(feedback.status === "verified_acceptable" ? "path.acceptableReference" : "path.compareReference", { move: feedback.referenceSan })}</p>
              )}
              {feedback.assisted && <p>{t("assisted")}</p>}
              {holdout && <p>{feedback.independent ? t("path.holdoutRecorded") : t("path.holdoutAssisted")}</p>}
            </div>
          )}
          {sessionResult && <SessionSummary result={sessionResult} nextActivity={feedback?.nextActivity} patternId={exercise.patternId} />}
          {hint && <p className="callout">{t(`catalog.${exercise.patternId}.hint`)}</p>}
          {demo && <p className="callout">{t("demonstration")}</p>}
          {error && <p role="alert">{t(`errors.${error}`, { defaultValue: t("errors.connection") })}</p>}
          <div className="actions">
            {!holdout && !gameLike && !feedback && !demo && !candidate && (
              <button type="button" className="btn" disabled={busy} onClick={() => void action(async () => { await requestPatternHint(exercise.id); setHint(true); })}>{t("hint")}</button>
            )}
            {!holdout && !gameLike && exercise.decisionCount === 0 && !candidate && (
              <button type="button" className="btn" disabled={busy} onClick={() => void action(async () => { const result = await revealPatternSolution(exercise.id); setFen(result.referenceFen); setDemo(true); })}>{t("showIdea")}</button>
            )}
            {feedback?.canContinue && (
              <button type="button" className="btn primary" data-testid="practice-next-decision" disabled={busy} onClick={() => void action(async () => {
                const next = await advancePersonalPractice(exercise.id);
                setExercise(next); setFen(next.fen); setFeedback(null); setHint(false); setDemo(false);
              })}>{t("path.nextDecision", { current: feedback.decisionNumber + 1, total: feedback.targetDecisions })}</button>
            )}
            {exercise.canAdvanceSlot && feedback && (
              <button type="button" className="btn primary" data-testid="practice-next-slot" disabled={busy} onClick={() => void action(async () => {
                const next = await advancePersonalSlot(exercise.id);
                navigate(`/practice/${next.id}`);
              })}>{t("learning:practice.nextPosition", { current: (exercise.slotIndex ?? 0) + 2, total: exercise.sessionPositionTotal ?? 1 })}</button>
            )}
            {!holdout && feedback && (
              <button type="button" className="btn" data-testid="practice-retry-decision" disabled={busy} onClick={() => void action(async () => {
                const next = await retryPersonalDecision(exercise.id);
                setExercise(next); setFen(next.fen); setFeedback(null); setHint(false); setDemo(false);
              })}>{t("path.retryDecision")}</button>
            )}
            {exercise.canStartHoldout && (
              <button type="button" className="btn primary" data-testid="practice-start-holdout" disabled={busy} onClick={() => void action(async () => {
                const next = await startPersonalHoldout(exercise.id);
                navigate(`/practice/${next.id}`);
              })}>{t("path.startHoldout")}</button>
            )}
            {holdout && exercise.completed && !sessionResult && (
              <Link className="btn primary" to="/coach">{t("path.finish")}</Link>
            )}
            {!holdout && (demo || (feedback && !feedback.canContinue && !exercise.canStartHoldout && !exercise.canAdvanceSlot)) && (
              <button type="button" className="btn" disabled={busy} onClick={() => void action(async () => {
                const next = await startPersonalPractice(exercise.patternId, exercise.positionId);
                navigate(`/practice/${next.id}`);
              })}>{t("retry")}</button>
            )}
            {exercise.completed && !holdout && (
              <Link className="btn" onClick={(e) => { if (busy) e.preventDefault(); }} to={`/sparring?topic=personal&practice=${exercise.id}`}>{t("continue")}</Link>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
