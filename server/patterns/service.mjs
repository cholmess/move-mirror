import { decisionCoaching } from "../../shared/patterns/decision-coaching.js";
import {
  applyHypothesisEvidence,
  diagnosticQuestion,
  fallbackPedagogy,
  PEDAGOGY_VERSION,
  validatePedagogyOutput,
} from "../../shared/patterns/pedagogy.js";
import { classifyProbeObservation, planHypothesisProbe } from "../../shared/patterns/probe-selection.js";
import { hypothesisEvidenceSummary, reconcileRealGameHypotheses } from "../../shared/patterns/real-game-evidence.js";
import { buildCurriculumPlan, createHypothesisRevision, decideCurriculum } from "../../shared/patterns/curriculum.js";
import { Chess } from "chess.js";
import { randomUUID } from "node:crypto";
import { PATTERN_VERSION, MAX_PERSONAL_GAMES, patternExists } from "../../shared/patterns/catalog.js";
import { classifyDecision, hash, positionKey, playUci } from "../../shared/patterns/detect.js";
import { buildPatternProfile } from "../../shared/patterns/profile.js";
import { classifyPracticeEvidence } from "../../shared/patterns/evidence.js";
import { applyDomainEvidence, emptyPatternDomain } from "../../shared/patterns/mastery.js";
import { scheduleNextReview } from "../../shared/patterns/scheduler.js";
import { selectNextActivity } from "../../shared/patterns/next-activity.js";
import {
  completePracticeSession,
  createPracticeSession,
  guidedTargetDecisions,
  nextGuidedStatus,
  orderGuidedPlan,
  planSessionLayout,
} from "../../shared/patterns/session.js";
import { evaluateEligibility, STANDARD_FEN, normalizedStartingFen } from "../games/model.mjs";

export function selectPersonalGames(games) {
  return games.filter(g => !g.archived && evaluateEligibility(g).coachingEligible && ["white", "black"].includes(g.players.playerResolution.playerColor) && g.chess.movesUci.length > 8
    && normalizedStartingFen(g.chess.startingFen) === normalizedStartingFen(STANDARD_FEN)
    && !g.sources?.some(s => s.conflicts?.some(c => c.requiresReview)))
    .sort((a, b) => String(b.timing.startedAt ?? b.provenance.firstImportedAt).localeCompare(String(a.timing.startedAt ?? a.provenance.firstImportedAt)))
    .slice(0, MAX_PERSONAL_GAMES);
}

function sanFor(fen, uci) {
  const move = playUci(new Chess(fen), uci);
  return move?.san ?? null;
}

function compactFact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined));
}

export function buildPedagogyPacket({ record, attempt, records, profile }) {
  const facts = [compactFact({
    evidenceId: "current_decision", kind: "player_decision", fen: attempt.coaching.rootFen,
    gameId: record.gameId, moveNumber: record.moveNumber, chosenSan: attempt.chosenSan,
    resultStatus: attempt.status, playerExplanation: attempt.preFeedbackReasoning,
  })];
  if (attempt.prediction?.replyUci) facts.push(compactFact({
    evidenceId: "anticipated_reply", kind: "player_prediction", san: attempt.coaching.predictedSan,
    verifiedAsStrong: attempt.coaching.replyVerified,
  }));
  if (attempt.replySan) facts.push({ evidenceId: "engine_reply", kind: "engine_verified_reply", san: attempt.replySan });
  if (attempt.referenceSan) facts.push({ evidenceId: "reference_move", kind: "engine_verified_reference", san: attempt.referenceSan });
  facts.push({
    evidenceId: "pattern_frequency", kind: "aggregate",
    errors: profile?.errors ?? 0, games: profile?.games ?? 0, opportunities: profile?.opportunities ?? 0,
    confidence: profile?.confidence ?? "insufficient",
  });
  const seenGames = new Set([record.gameId]);
  const others = records.filter((row) => {
    if (row.patternId !== record.patternId || row.exerciseId === record.exerciseId || seenGames.has(row.gameId)) return false;
    seenGames.add(row.gameId); return true;
  }).slice(0, 2);
  others.forEach((row, index) => facts.push(compactFact({
    evidenceId: `similar_error_${index + 1}`, kind: "similar_error", fen: row.fen,
    gameId: row.gameId, moveNumber: row.moveNumber, playedSan: sanFor(row.fen, row.moveUci),
    referenceSan: row.referenceSan, lossCp: row.loss,
  })));
  const contrastGames = new Set();
  const contrasts = records.filter((row) => {
    if (!row.opportunities.includes(record.patternId) || row.patternId === record.patternId || contrastGames.has(row.gameId)) return false;
    contrastGames.add(row.gameId); return true;
  }).slice(0, 2);
  contrasts.forEach((row, index) => facts.push(compactFact({
    evidenceId: `contrast_${index + 1}`, kind: "comparable_non_error", fen: row.fen,
    gameId: row.gameId, moveNumber: row.moveNumber, playedSan: sanFor(row.fen, row.moveUci),
    referenceSan: row.referenceSan,
  })));
  // A contrast needs at least two distinct verified facts. Current decision and reference/reply remain valid when no clean non-error exists.
  return {
    version: PEDAGOGY_VERSION,
    pattern: { id: record.patternId, observableOnly: true },
    question: diagnosticQuestion(attempt.coaching.intervention),
    currentIntervention: attempt.coaching.intervention,
    facts,
  };
}

function fallbackEvidenceIds(packet) {
  const ids = packet.facts.map((fact) => fact.evidenceId);
  const contrast = packet.facts.find((fact) => fact.kind === "comparable_non_error")?.evidenceId;
  return contrast ? ["current_decision", contrast, ...ids.filter((id) => !["current_decision", contrast].includes(id))] : ids;
}
export function gameDecisions(game) {
  const chess = new Chess(game.chess.startingFen), rows = [];
  const user = game.players.playerResolution.playerColor === "white" ? "w" : "b";
  for (const [index, uci] of game.chess.movesUci.entries()) {
    const fen = chess.fen();
    if (chess.turn() === user) rows.push({ gameId: game.id, fen, moveUci: uci, ply: index + 1, moveNumber: Number(fen.split(" ")[5]),
      gameStartedAt: game.timing.startedAt, gameEndedAt: game.timing.endedAt, datePrecision: game.timing.datePrecision,
      importedAt: game.provenance.firstImportedAt });
    if (!playUci(chess, uci)) throw new Error("invalid_game");
  }
  return rows;
}
export function createPatternService({ store, gamesStore, evaluate, analyzerSignature, pedagogicalCoach = null, now = () => new Date().toISOString(), scheduleDelay = 500 }) {
  let task = null, timer = null, controller = null, dirty = false;
  const reflectionTasks = new Map();
  function mutate(fn, changedKeys = []) { const state = store.read(); fn(state); store.write(state, changedKeys); return state; }
  function signature() { return analyzerSignature() ?? store.read().lastAnalyzerSignature ?? null; }
  function key(game, sig = signature()) { return hash([PATTERN_VERSION, sig, game.fingerprint, game.players.playerResolution.playerColor]); }
  function rows() {
    const state = store.read(); const sig = signature();
    return selectPersonalGames(gamesStore.listGames()).flatMap(game => {
      const analysis = state.analyses[key(game, sig)];
      return analysis?.complete ? analysis.rows : [];
    });
  }
  function reconcileGames() {
    const current = new Map(gamesStore.listGames().map(g => [g.id, g]));
    const state = store.read();
    const validExercise = e => {
      const game = current.get(e.gameId);
      return game && evaluateEligibility(game).coachingEligible && game.players.playerResolution.playerColor === e.playerColor;
    };
    const invalid = new Set(state.exercises.filter(e => !validExercise(e)).map(e => e.id));
    const invalidAnalyses = Object.entries(state.analyses).filter(([,a]) => {
      const game = current.get(a.gameId);
      return !game || !evaluateEligibility(game).coachingEligible;
    }).map(([k]) => k);
    if (invalid.size || invalidAnalyses.length) mutate(s => {
      s.exercises = s.exercises.filter(e => !invalid.has(e.id));
      s.attempts = s.attempts.filter(a => !invalid.has(a.exerciseId));
      s.continuationAttempts = (s.continuationAttempts ?? []).filter(a => !invalid.has(a.exerciseId));
      s.exposures = s.exposures.filter(e => !invalid.has(e.exerciseId));
      for (const k of invalidAnalyses) delete s.analyses[k];
      const completeRecords = Object.values(s.analyses).filter((analysis) => analysis.complete).flatMap((analysis) => analysis.rows);
      s.hypotheses = reconcileRealGameHypotheses(s.hypotheses ?? [], completeRecords, s.exposures ?? []);
    });
  }
  function summary() {
    reconcileGames();
    const state = store.read(), games = selectPersonalGames(gamesStore.listGames()), records = rows();
    const latestHypotheses = new Map((state.hypotheses ?? []).map((row) => [row.patternId, row]));
    const patterns = buildPatternProfile(records, state.attempts, state.exposures, Date.parse(now()), state.patternDomains ?? {})
      .map((pattern) => {
        const hypothesis = latestHypotheses.get(pattern.id) ?? null;
        const curriculum = decideCurriculum(pattern, hypothesis);
        return { ...pattern, curriculum, hypothesis: hypothesis ? {
          category: hypothesis.category,
          statement: hypothesis.statement,
          status: hypothesis.status,
          confidence: hypothesis.confidence,
          evidence: hypothesisEvidenceSummary(hypothesis),
        } : null };
      });
    const curriculum = buildCurriculumPlan(patterns);
    return { version: PATTERN_VERSION, method: "evidence_rules", revision: state.revision, updatedAt: state.updatedAt, job: state.job,
      eligibleGames: games.length, analyzedGames: new Set(records.map(r => r.gameId)).size, verifiedDecisions: records.length,
      patterns, curriculum, recommended: curriculum.map(row => row.patternId) };
  }
  async function run() {
    const sig = analyzerSignature();
    if (!sig) { mutate(s => { s.job.status = "failed"; s.job.error = "engine_unavailable"; }); return summary(); }
    controller = new AbortController();
    const games = selectPersonalGames(gamesStore.listGames());
    const all = games.map(game => ({ game, key: key(game, sig), decisions: gameDecisions(game) }));
    mutate(s => { s.lastAnalyzerSignature = sig; s.job = { status: "running", error: null, totalGames: games.length,
      completedGames: 0, completedDecisions: 0, totalDecisions: all.reduce((n, g) => n + g.decisions.length, 0) }; });
    try {
      for (const entry of all) {
        let cached = store.read().analyses[entry.key];
        const completed = cached?.rows?.length ?? 0;
        if (!cached?.complete) {
          for (const decision of entry.decisions.slice(completed)) {
            if (controller.signal.aborted) throw new Error("cancelled");
            const result = await evaluate({ fen: decision.fen, moveUci: decision.moveUci }, controller.signal);
            if (controller.signal.aborted) throw new Error("cancelled");
            if (analyzerSignature() !== sig) throw new Error("engine_changed");
            const classified = classifyDecision(decision, result);
            if (!classified) throw new Error(result?.error === "engine_unavailable" ? "engine_unavailable" : "analysis_unverified");
            const record = { ...decision, ...classified, exerciseId: hash([entry.key, decision.ply]) };
            mutate(s => {
              const previous = s.analyses[entry.key] ?? { gameId: entry.game.id, signature: sig, rows: [], complete: false };
              s.analyses[entry.key] = { ...previous, rows: [...previous.rows, record] };
              s.job.completedDecisions++; }, [entry.key]);
          }
          mutate(s => { s.analyses[entry.key] = { ...s.analyses[entry.key], complete: true }; }, [entry.key]);
        }
        mutate(s => { s.job.completedGames++; s.job.completedDecisions += completed; });
      }
      mutate(s => {
        s.job.status = "completed"; s.job.error = null;
        const digest = hash(all.map(g => g.key));
        if (s.datasetDigest !== digest) { s.revision++; s.datasetDigest = digest; }
        s.updatedAt = now();
        // Obsolete analysis is reproducible; prune it, retaining exposure/attempt history.
        const retained = new Set(all.map(g => g.key));
        s.analyses = Object.fromEntries(Object.entries(s.analyses).filter(([k]) => retained.has(k)));
        const completeRecords = Object.values(s.analyses).filter((analysis) => analysis.complete).flatMap((analysis) => analysis.rows);
        s.hypotheses = reconcileRealGameHypotheses(s.hypotheses ?? [], completeRecords, s.exposures ?? []);
      });
    } catch (error) {
      mutate(s => { s.job.status = controller.signal.aborted ? "cancelled" : "failed";
        s.job.error = ["engine_unavailable", "engine_changed", "analysis_unverified", "cancelled"].includes(error.message) ? error.message : "analysis_failed"; });
    }
    return summary();
  }
  function update() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (task) return task;
    task = run().catch(() => {
      mutate(s => { s.job.status = "failed"; s.job.error = "analysis_failed"; });
      return summary();
    }).finally(() => { task = null; controller = null; if (dirty) { dirty = false; schedule(); } });
    return task;
  }
  function schedule() {
    if (task) { dirty = true; return; }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void update(); }, scheduleDelay);
    timer.unref?.();
  }
  function getRecord(id) { reconcileGames(); return rows().find(r => r.exerciseId === id && r.patternId) ?? null; }
  function assertRecord(exercise) {
    const record = getRecord(exercise.recordId);
    if (!record || record.patternId !== exercise.patternId) throw new Error("exercise_unavailable");
    return record;
  }
  function exerciseStatus(exercise) {
    if (exercise.status) return exercise.status;
    return exercise.attemptId ? "completed" : "active";
  }
  function sessionById(id) {
    return store.read().practiceSessions?.find(s => s.id === id) ?? null;
  }
  function practiceDto(exercise, record) {
    const status = exerciseStatus(exercise);
    const fen = exercise.currentFen ?? record.fen;
    const session = exercise.sessionId ? sessionById(exercise.sessionId) : null;
    const sessionPositionTotal = session?.positionRecordIds?.length ?? null;
    const sessionShortfall = session?.sessionShortfall ?? false;
    const state = store.read();
    const attempt = exercise.lastAttemptId
      ? [...state.attempts, ...(state.continuationAttempts ?? [])].find((row) => row.id === exercise.lastAttemptId)
      : null;
    const diagnostic = exercise.role !== "holdout" && attempt?.coaching ? {
      question: diagnosticQuestion(attempt.coaching.intervention),
      reflection: attempt.reflection?.result ?? null,
      status: attempt.reflection?.status ?? "available",
      source: attempt.reflection?.source ?? null,
      llm: pedagogicalCoach?.status?.() ?? { enabled: false, configured: false, provider: null, model: null },
    } : null;
    const storedHypothesis = exercise.role === "holdout" ? null : [...(state.hypotheses ?? [])].reverse().find((row) => row.patternId === record.patternId) ?? null;
    const hypothesis = storedHypothesis ? { ...storedHypothesis, evidence: hypothesisEvidenceSummary(storedHypothesis) } : null;
    const probeSlot = exercise.role === "holdout" ? null : session?.probePlan?.slots?.find((row) => row.recordId === record.exerciseId) ?? null;
    const probe = probeSlot ? {
      version: session.probePlan.version,
      hypothesisId: session.probePlan.hypothesisId,
      targetCategory: probeSlot.targetCategory,
      comparedCategories: [session.probePlan.primaryCategory, ...(session.probePlan.alternativeCategories ?? [])]
        .filter((category, index, list) => category !== probeSlot.targetCategory && list.indexOf(category) === index),
      selectionReasons: probeSlot.selectionReasons,
      measurability: probeSlot.measurability,
    } : null;
    const profile = buildPatternProfile(rows(), state.attempts, state.exposures, Date.parse(now()), state.patternDomains ?? {})
      .find((row) => row.id === record.patternId);
    return { id: exercise.id, positionId: record.exerciseId, patternId: record.patternId, fen, originalFen: record.fen, color: record.fen.split(" ")[1] === "w" ? "white" : "black",
      gameId: record.gameId, moveNumber: record.moveNumber, assisted: exercise.assisted,
      completed: status === "completed", repeated: exercise.repeated, role: exercise.role ?? "legacy", status,
      decisionCount: exercise.decisionCount ?? (exercise.attemptId ? 1 : 0),
      targetDecisions: exercise.targetDecisions ?? guidedTargetDecisions(exercise),
      awaitingNext: Boolean(exercise.awaitingNext), canStartHoldout: status === "ready_for_holdout",
      canAdvanceSlot: status === "ready_for_next_slot",
      sessionId: exercise.sessionId ?? null, slotIndex: exercise.slotIndex ?? null,
      sessionPositionTotal, sessionPositionCurrent: exercise.slotIndex != null ? exercise.slotIndex + 1 : null,
      sessionShortfall, diagnostic, hypothesis, probe, curriculum: exercise.role === "holdout" ? null : session?.curriculumDecision ?? null,
      evidenceSummary: exercise.role === "holdout" ? null : { errors: profile?.errors ?? 0, games: profile?.games ?? 0, opportunities: profile?.opportunities ?? 0, confidence: profile?.confidence ?? "insufficient" },
      coachingHistory: exercise.role === "holdout" ? [] : state.attempts.filter(a => a.patternId === record.patternId && a.coaching && !a.assisted)
        .slice(-5).map(a => ({ intervention: a.coaching.intervention, at: a.at, gameId: a.gameId })) };
  }
  function createExercise(patternId, record, { role = "guided", parentId = null, sessionId = null, slotIndex = null } = {}) {
    const state = store.read();
    const draft = { id: randomUUID(), patternId, recordId: record.exerciseId, startedAt: now(), gameId: record.gameId,
      playerColor: record.fen.split(" ")[1] === "w" ? "white" : "black", assisted: false,
      repeated: state.exposures.some(e => e.positionKey === positionKey(record.fen)), attemptId: null,
      role, parentId, sessionId, slotIndex, status: "active",
      targetDecisions: role === "holdout" ? 1 : guidedTargetDecisions({ sessionId }),
      decisionCount: 0, currentFen: record.fen, awaitingNext: false, lastAttemptId: null };
    mutate(s => { s.revision++; s.updatedAt = now(); s.exercises.push(draft); s.exposures.push({ exerciseId: draft.id, patternId, positionKey: positionKey(record.fen), gameId: record.gameId, at: draft.startedAt }); });
    return practiceDto(draft, record);
  }
  function startPractice(patternId, preferredId = null) {
    if (!patternExists(patternId)) throw new Error("pattern_unknown");
    if (!summary().recommended.includes(patternId) && summary().patterns.find(p => p.id === patternId)?.status !== "recurrent") throw new Error("pattern_not_recurrent");
    const state = store.read();
    const candidates = rows().filter(r => r.patternId === patternId);
    const layout = planSessionLayout(candidates, state.exposures);
    if (!layout.ok) throw new Error(layout.error);
    let hypothesis = [...(state.hypotheses ?? [])].reverse().find((row) => row.patternId === patternId) ?? null;
    const pattern = summary().patterns.find((row) => row.id === patternId);
    const curriculumDecision = pattern?.curriculum ?? decideCurriculum(pattern, hypothesis);
    const revised = createHypothesisRevision(hypothesis, curriculumDecision, { id: randomUUID(), at: now() });
    if (revised) {
      mutate(s => { s.hypotheses.push(revised); });
      hypothesis = revised;
    }
    const probe = planHypothesisProbe(layout.guided, hypothesis, state.exposures);
    const sessionPlan = orderGuidedPlan(probe.ordered, preferredId);
    const session = createPracticeSession(patternId, sessionPlan.map(r => r.exerciseId), {
      contentVersion: PATTERN_VERSION,
      detectorVersion: signature(),
      at: now(),
      reservedHoldoutRecordId: layout.holdout.exerciseId,
      sessionShortfall: layout.sessionShortfall,
      probePlan: probe.plan,
      curriculumDecision,
    });
    session.guidedExerciseIds = [];
    mutate(s => { s.practiceSessions.push(session); });
    const record = sessionPlan[0];
    const exercise = createExercise(patternId, record, { sessionId: session.id, slotIndex: 0 });
    mutate(s => {
      const live = s.practiceSessions.find(row => row.id === session.id);
      if (live) {
        live.guidedExerciseIds.push(exercise.id);
        live.currentExerciseId = exercise.id;
      }
    });
    return exercise;
  }
  function exerciseById(id) { const e = store.read().exercises.find(e => e.id === id); if (!e) throw new Error("exercise_unavailable"); return e; }
  function exerciseView(id) {
    const exercise = exerciseById(id), state = store.read();
    const feedback = exercise.lastAttemptId
      ? [...state.attempts, ...(state.continuationAttempts ?? [])].find(a => a.id === exercise.lastAttemptId)
      : null;
    const dto = practiceDto(exercise, assertRecord(exercise));
    return { ...dto, feedback: feedback ? { ...feedback, diagnostic: dto.diagnostic } : null };
  }
  function reveal(id, kind = "hint") {
    const exercise = exerciseById(id), record = assertRecord(exercise);
    if (!["hint", "solution"].includes(kind)) throw new Error("invalid_request");
    mutate(s => {
      const target = s.exercises.find(e => e.id === id);
      target.assisted = true;
      if (target.sessionId) {
        const session = s.practiceSessions.find(row => row.id === target.sessionId);
        if (session) {
          if (kind === "hint") session.hintsUsed += 1;
          if (kind === "solution") session.revealsUsed += 1;
        }
      }
    });
    if (kind === "hint") return { patternId: record.patternId, assisted: true };
    const chess = new Chess(record.fen); playUci(chess, record.referenceUci);
    return { patternId: record.patternId, assisted: true, referenceSan: record.referenceSan, referenceFen: chess.fen() };
  }
  async function submit(id, moveUci, prediction = null, reasoningInput = null) {
    const exercise = exerciseById(id), record = assertRecord(exercise);
    const status = exerciseStatus(exercise);
    if (["completed", "ready_for_holdout", "ready_for_next_slot"].includes(status) || exercise.awaitingNext) {
      const previous = exerciseView(id).feedback;
      if (previous) return previous;
      throw new Error("practice_not_ready");
    }
    const rootFen = exercise.currentFen ?? record.fen;
    const chess = new Chess(rootFen), move = playUci(chess, moveUci);
    if (!move) throw new Error("illegal_move");
    const candidateFen = chess.fen();
    const reasoning = reasoningInput === null ? null : {
      intention: normalizeReflectionText(reasoningInput?.intention),
      evaluation: normalizeReflectionText(reasoningInput?.evaluation),
      confidence: reasoningInput?.confidence,
    };
    if (reasoning && (reasoning.intention.length < 2 || reasoning.intention.length > 800
      || reasoning.evaluation.length < 2 || reasoning.evaluation.length > 800
      || !["low", "medium", "high"].includes(reasoning.confidence))) throw new Error("invalid_reflection");
    if (exercise.role === "holdout" && reasoning) throw new Error("invalid_request");
    const reasoningCapturedAt = reasoning ? now() : null;
    let predictedSan = null;
    if (prediction !== null) {
      if (exercise.role === "holdout" || typeof prediction !== "object" || !Object.hasOwn(prediction, "replyUci")
        || !(prediction.replyUci === null || typeof prediction.replyUci === "string")) throw new Error("invalid_request");
      if (prediction.replyUci !== null) {
        const predicted = playUci(new Chess(candidateFen), prediction.replyUci);
        if (!predicted) throw new Error("illegal_move");
        predictedSan = predicted.san;
      }
    }
    const result = await evaluate({ fen: rootFen, moveUci }, AbortSignal.timeout(120000));
    assertRecord(exercise); // Import edits/deletion may have happened while evaluating.
    const latest = exerciseById(id);
    if (latest.awaitingNext || ["completed", "ready_for_holdout", "ready_for_next_slot"].includes(exerciseStatus(latest))) return exerciseView(id).feedback;
    const verified = Boolean(result.verified && !["illegal", "unverified"].includes(result.status));
    if (!verified) throw new Error("analysis_unverified");
    let replyResult = null;
    // Only a failed decision with a proposed response needs a second local-engine query.
    // A different reply can be equally strong; never compare only to the principal move.
    if (prediction?.replyUci && ["incorrect", "playable_inexact"].includes(result.status)) {
      try { replyResult = await evaluate({ fen: candidateFen, moveUci: prediction.replyUci }, AbortSignal.timeout(120000)); }
      catch { /* Keep the verified move feedback; the cause stays unknown. */ }
      assertRecord(exercise);
      const refreshed = exerciseById(id);
      if (refreshed.awaitingNext || ["completed", "ready_for_holdout", "ready_for_next_slot"].includes(exerciseStatus(refreshed))) return exerciseView(id).feedback;
    }
    const reply = result.opponentReplyUci ? playUci(chess, result.opponentReplyUci) : null;
    if (result.opponentReplyUci && !reply) throw new Error("analysis_unverified");
    const firstDecision = !latest.attemptId;
    const nextCount = (latest.decisionCount ?? 0) + 1;
    const target = latest.targetDecisions ?? guidedTargetDecisions(latest);
    const session = latest.sessionId ? sessionById(latest.sessionId) : null;
    const canContinue = Boolean(result.opponentReplyUci && !chess.isGameOver() && nextCount < target && latest.role !== "holdout");
    const nextStatus = latest.role === "holdout"
      ? "completed"
      : canContinue
        ? "training"
        : nextGuidedStatus(latest, session);
    const referenceChess = new Chess(rootFen);
    const referenceMove = playUci(referenceChess, result.best?.firstMoveUci);
    const attempt = { id: randomUUID(), exerciseId: id, gameId: record.gameId, patternId: record.patternId, at: now(),
      independent: latest.role === "holdout" && !latest.assisted && !latest.repeated,
      assisted: latest.assisted || latest.repeated, verified, status: result.status, chosenSan: move.san, replySan: reply?.san ?? null,
      resultingFen: chess.fen(), referenceSan: referenceMove?.san ?? (firstDecision ? record.referenceSan : null),
      engineVersion: result.engineVersion, engineSha256: result.engineSha256,
      preFeedbackReasoning: reasoning ? { ...reasoning, capturedAt: reasoningCapturedAt, timing: "before_feedback" } : null,
      prediction, coaching: decisionCoaching({ result, prediction, replyResult, predictedSan, rootFen, candidateFen, referenceFen: referenceMove ? referenceChess.fen() : null }),
      decisionNumber: nextCount, targetDecisions: target, canContinue, trainingStatus: nextStatus };
    mutate(s => {
      s.revision++; s.updatedAt = now();
      if (firstDecision) { s.attempts.push(attempt); s.exercises.find(e => e.id === id).attemptId = attempt.id; }
      else (s.continuationAttempts ??= []).push(attempt);
      const targetExercise = s.exercises.find(e => e.id === id);
      targetExercise.currentFen = chess.fen(); targetExercise.decisionCount = nextCount;
      targetExercise.lastRootFen = rootFen;
      targetExercise.status = nextStatus; targetExercise.awaitingNext = canContinue; targetExercise.lastAttemptId = attempt.id;
      if (latest.role !== "holdout" && firstDecision) {
        const hypothesisIndex = [...(s.hypotheses ?? [])].map((row) => row.patternId).lastIndexOf(latest.patternId);
        const hypothesis = hypothesisIndex >= 0 ? s.hypotheses[hypothesisIndex] : null;
        if (hypothesis && hypothesis.sourceAttemptId !== attempt.id) {
          const probeSlot = session?.probePlan?.slots?.find((row) => row.recordId === record.exerciseId) ?? null;
          const observation = classifyProbeObservation(attempt, hypothesis, probeSlot);
          attempt.probeObservation = observation;
          if (observation) {
            s.hypotheses[hypothesisIndex] = applyHypothesisEvidence(hypothesis, {
              id: `practice-probe:${attempt.id}`, source: "practice_probe", direction: observation.direction,
              at: attempt.at, exerciseId: attempt.exerciseId, expectedCategory: observation.expectedCategory,
              observedCategory: observation.observedCategory, measurability: observation.measurability,
            });
          }
        }
      }
      if (latest.role === "holdout") {
        if (latest.sessionId) {
          const holdoutSession = s.practiceSessions.find(row => row.id === latest.sessionId);
          if (holdoutSession && holdoutSession.status !== "completed") {
            const completion = completePracticeSession({
              session: holdoutSession,
              holdoutExercise: targetExercise,
              holdoutAttempt: attempt,
              patternDomains: s.patternDomains ?? {},
              at: attempt.at,
              now: Date.parse(now()),
            });
            const idx = s.practiceSessions.findIndex(row => row.id === holdoutSession.id);
            s.practiceSessions[idx] = completion.session;
            s.patternDomains[latest.patternId] = completion.domain;
            if (!completion.duplicate) {
              attempt.sessionResult = completion.result;
              attempt.nextActivity = buildNextActivity(s, completion.result);
              const hypothesisIndex = [...(s.hypotheses ?? [])].map((row) => row.patternId).lastIndexOf(latest.patternId);
              if (hypothesisIndex >= 0) {
                const success = ["verified_best", "verified_acceptable"].includes(attempt.status);
                s.hypotheses[hypothesisIndex] = applyHypothesisEvidence(s.hypotheses[hypothesisIndex], {
                  id: `holdout:${attempt.id}`, source: "holdout", direction: "inconclusive",
                  at: attempt.at, exerciseId: attempt.exerciseId, skillOutcome: success ? "success" : "failure",
                });
              }
            }
          }
        } else {
          const evidence = classifyPracticeEvidence({
            role: "holdout",
            assisted: attempt.assisted,
            repeated: latest.repeated,
            verified: attempt.verified,
            status: attempt.status,
            independent: attempt.independent,
          });
          const domain = s.patternDomains[latest.patternId] ?? emptyPatternDomain(latest.patternId, attempt.at);
          const updated = applyDomainEvidence(domain, evidence, {
            status: attempt.status,
            at: attempt.at,
            role: "holdout",
            assisted: attempt.assisted,
          });
          if (evidence.countsForDomain || evidence.kind === "independent_failure") {
            updated.nextReviewAt = scheduleNextReview(updated, evidence, attempt.at, Date.parse(now()));
          }
          s.patternDomains[latest.patternId] = updated;
        }
      }
    });
    return exerciseView(id).feedback;
  }

  function reflectionAttempt(exercise) {
    const state = store.read();
    const attempt = [...state.attempts, ...(state.continuationAttempts ?? [])].find((row) => row.id === exercise.lastAttemptId);
    if (!attempt?.coaching || exercise.role === "holdout") throw new Error("reflection_not_available");
    return attempt;
  }

  function normalizeReflectionText(value) {
    return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
  }

  async function reflect(id) {
    const exercise = exerciseById(id);
    const attempt = reflectionAttempt(exercise);
    const answer = attempt.preFeedbackReasoning;
    if (!answer || answer.timing !== "before_feedback") throw new Error("reflection_not_available");
    const requestDigest = hash([attempt.id, answer]);
    if (attempt.reflection?.result) {
      return attempt.reflection.result;
    }
    if (reflectionTasks.has(attempt.id)) {
      if (attempt.reflection?.requestDigest && attempt.reflection.requestDigest !== requestDigest) throw new Error("reflection_locked");
      return reflectionTasks.get(attempt.id);
    }
    const work = (async () => {
      const live = reflectionAttempt(exerciseById(id));
      if (live.reflection?.status === "pending") {
        const packet = buildPedagogyPacket({ record: assertRecord(exercise), attempt: live, records: rows(), profile: summary().patterns.find((row) => row.id === live.patternId) });
        return saveReflection(live, packet, fallbackPedagogy({ intervention: live.coaching.intervention, evidenceIds: fallbackEvidenceIds(packet) }), "rules", { reason: "interrupted_request" });
      }
      mutate((state) => {
        const target = [...state.attempts, ...(state.continuationAttempts ?? [])].find((row) => row.id === attempt.id);
        target.reflection = { status: "pending", requestDigest, requestedAt: now() };
      });
      const packet = buildPedagogyPacket({ record: assertRecord(exercise), attempt, records: rows(), profile: summary().patterns.find((row) => row.id === attempt.patternId) });
      let output; let source = "rules"; let meta = { reason: "llm_disabled" };
      if (pedagogicalCoach?.status?.().configured) {
        try {
          const generated = await pedagogicalCoach.generate(packet);
          output = validatePedagogyOutput(generated.output, packet.facts);
          source = "llm"; meta = generated.meta;
        } catch {
          meta = { reason: "coach_llm_failed" };
        }
      }
      output ??= fallbackPedagogy({ intervention: attempt.coaching.intervention, evidenceIds: fallbackEvidenceIds(packet) });
      return saveReflection(attempt, packet, output, source, meta);
    })().finally(() => reflectionTasks.delete(attempt.id));
    reflectionTasks.set(attempt.id, work);
    return work;
  }

  function saveReflection(attempt, packet, output, source, meta) {
    assertRecord(exerciseById(attempt.exerciseId));
    const result = {
      id: randomUUID(), version: PEDAGOGY_VERSION, question: packet.question,
      answer: packet.facts[0].playerExplanation, source, generatedAt: now(), output,
      sources: packet.facts.filter((fact) => fact.gameId).map((fact) => ({ evidenceId: fact.evidenceId, gameId: fact.gameId, moveNumber: fact.moveNumber })),
      meta,
    };
    mutate((state) => {
      const target = [...state.attempts, ...(state.continuationAttempts ?? [])].find((row) => row.id === attempt.id);
      if (!target) throw new Error("exercise_unavailable");
      target.reflection = { ...target.reflection, status: "completed", source, completedAt: result.generatedAt, result };
      state.hypotheses ??= [];
      state.hypotheses.push({
        id: result.id, patternId: attempt.patternId, category: output.primaryHypothesis.category,
        statement: output.primaryHypothesis.statement, alternatives: output.alternativeHypotheses,
        confidence: "low", status: "tentative", createdAt: result.generatedAt, updatedAt: result.generatedAt,
        sourceAttemptId: attempt.id, intervention: output.nextTest.skill,
        nextTest: output.nextTest, teachingObjective: output.teaching.objective,
        observations: [{ id: `reflection:${result.id}`, source: "practice", direction: "support", at: result.generatedAt, exerciseId: attempt.exerciseId }],
      });
    });
    return result;
  }
  function buildNextActivity(state, sessionResult) {
    const summaryData = summary();
    const active = state.practiceSessions.find(s => s.status === "in_progress") ?? null;
    return selectNextActivity({
      patterns: summaryData.patterns,
      domains: state.patternDomains ?? {},
      activeSession: active,
      planPriorities: summaryData.recommended,
      sessionPositionsThisPattern: sessionResult?.positionRecordIds?.length ?? 0,
      now: Date.parse(now()),
    });
  }
  function advanceSlot(id) {
    const exercise = exerciseById(id);
    if (exerciseStatus(exercise) !== "ready_for_next_slot" || !exercise.sessionId) throw new Error("practice_not_ready");
    const session = sessionById(exercise.sessionId);
    if (!session) throw new Error("practice_not_ready");
    const nextIndex = (exercise.slotIndex ?? 0) + 1;
    const recordId = session.positionRecordIds[nextIndex];
    const record = rows().find(r => r.exerciseId === recordId);
    if (!record) throw new Error("exercise_unavailable");
    mutate(s => {
      const parent = s.exercises.find(e => e.id === id);
      parent.status = "completed"; parent.awaitingNext = false;
    });
    const next = createExercise(exercise.patternId, record, { sessionId: session.id, slotIndex: nextIndex });
    mutate(s => {
      const live = s.practiceSessions.find(row => row.id === session.id);
      live.guidedExerciseIds.push(next.id);
      live.currentExerciseId = next.id;
    });
    return next;
  }
  function sessionView(id) {
    const session = sessionById(id);
    if (!session) throw new Error("exercise_unavailable");
    const state = store.read();
    const domain = state.patternDomains?.[session.patternId] ?? emptyPatternDomain(session.patternId, now());
    const lastResult = session.status === "completed"
      ? {
          sessionId: session.id,
          patternId: session.patternId,
          outcomeKey: session.outcomeKey,
          countsAsIndependentEvidence: session.countsAsIndependentEvidence,
          evidenceReasonKey: session.evidenceReasonKey,
          nextReviewAt: domain.nextReviewAt,
          domain: {
            masteryEstimate: domain.masteryEstimate,
            confidence: domain.confidence,
            lifecycle: domain.lifecycle,
          },
          nextActivity: buildNextActivity(state, { positionRecordIds: session.positionRecordIds }),
        }
      : null;
    return { session, lastResult };
  }
  function advance(id) {
    const exercise = exerciseById(id);
    if (!exercise.awaitingNext || exerciseStatus(exercise) !== "training") throw new Error("practice_not_ready");
    mutate(s => { const target = s.exercises.find(e => e.id === id); target.awaitingNext = false; target.lastAttemptId = null; });
    return exerciseView(id);
  }
  function retryDecision(id) {
    const exercise = exerciseById(id);
    if (exercise.role === "holdout" || !exercise.lastAttemptId || !exercise.lastRootFen) throw new Error("practice_not_ready");
    mutate(s => {
      const target = s.exercises.find(e => e.id === id);
      target.currentFen = target.lastRootFen; target.decisionCount = Math.max(0, (target.decisionCount ?? 1) - 1);
      target.status = target.decisionCount ? "training" : "active"; target.awaitingNext = false; target.lastAttemptId = null;
      if (target.sessionId) {
        const session = s.practiceSessions.find(row => row.id === target.sessionId);
        if (session) session.retries += 1;
      }
    });
    return exerciseView(id);
  }
  function startHoldout(id) {
    const parent = exerciseById(id), record = assertRecord(parent);
    if (exerciseStatus(parent) !== "ready_for_holdout") throw new Error("practice_not_ready");
    const state = store.read();
    const session = parent.sessionId ? sessionById(parent.sessionId) : null;
    let holdoutRecord = null;
    if (session?.reservedHoldoutRecordId) {
      holdoutRecord = rows().find(r => r.exerciseId === session.reservedHoldoutRecordId && r.patternId === parent.patternId);
      const guidedKeys = new Set(
        session.positionRecordIds
          .map(rid => rows().find(r => r.exerciseId === rid))
          .filter(Boolean)
          .map(r => positionKey(r.fen)),
      );
      if (holdoutRecord && guidedKeys.has(positionKey(holdoutRecord.fen))) holdoutRecord = null;
    }
    if (!holdoutRecord) {
      const usedKeys = new Set(
        state.exercises
          .filter(e => e.patternId === parent.patternId && (e.sessionId === parent.sessionId || e.parentId === id || e.id === id))
          .map(e => assertRecord(e).exerciseId),
      );
      const candidates = rows().filter(r => r.patternId === parent.patternId && !usedKeys.has(r.exerciseId));
      candidates.sort((a, b) => {
        const exposed = r => state.exposures.some(e => e.positionKey === positionKey(r.fen)) ? 1 : 0;
        return exposed(a) - exposed(b) || (b.loss ?? 800) - (a.loss ?? 800);
      });
      holdoutRecord = candidates[0] ?? null;
    }
    if (!holdoutRecord) throw new Error("exercise_unavailable");
    mutate(s => {
      const target = s.exercises.find(e => e.id === id);
      target.status = "completed"; target.awaitingNext = false;
      if (parent.sessionId) {
        const session = s.practiceSessions.find(row => row.id === parent.sessionId);
        if (session) session.status = "awaiting_holdout";
      }
    });
    const holdout = createExercise(parent.patternId, holdoutRecord, {
      role: "holdout", parentId: id, sessionId: parent.sessionId ?? null,
    });
    if (parent.sessionId) {
      mutate(s => {
        const live = s.practiceSessions.find(row => row.id === parent.sessionId);
        if (live) {
          live.holdoutExerciseId = holdout.id;
          live.holdoutRecordId = holdoutRecord.exerciseId;
        }
      });
    }
    return holdout;
  }
  function activePractice(patternId = null) {
    reconcileGames();
    const available = new Map(rows().map(r => [r.exerciseId, r]));
    const exercise = [...store.read().exercises].reverse().filter(e => (!patternId || e.patternId === patternId) && available.get(e.recordId)?.patternId === e.patternId && exerciseStatus(e) !== "completed")
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    return exercise ? practiceDto(exercise, available.get(exercise.recordId)) : null;
  }
  return { summary, update, schedule, startPractice, exerciseView, reveal, submit, reflect, advance, advanceSlot, retryDecision, startHoldout, activePractice, sessionView,
    cancel() { dirty = false; if (timer) { clearTimeout(timer); timer = null; } controller?.abort(); },
    async wait() { if (timer) return update(); return task ?? summary(); } };
}
