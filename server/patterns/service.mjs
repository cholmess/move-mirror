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
export function createPatternService({ store, gamesStore, evaluate, analyzerSignature, now = () => new Date().toISOString(), scheduleDelay = 500 }) {
  let task = null, timer = null, controller = null, dirty = false;
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
    });
  }
  function summary() {
    reconcileGames();
    const state = store.read(), games = selectPersonalGames(gamesStore.listGames()), records = rows();
    const patterns = buildPatternProfile(records, state.attempts, state.exposures, Date.parse(now()), state.patternDomains ?? {});
    return { version: PATTERN_VERSION, method: "evidence_rules", revision: state.revision, updatedAt: state.updatedAt, job: state.job,
      eligibleGames: games.length, analyzedGames: new Set(records.map(r => r.gameId)).size, verifiedDecisions: records.length,
      patterns, recommended: patterns.filter(p => p.status === "recurrent").slice(0, 3).map(p => p.id) };
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
    return { id: exercise.id, positionId: record.exerciseId, patternId: record.patternId, fen, originalFen: record.fen, color: record.fen.split(" ")[1] === "w" ? "white" : "black",
      gameId: record.gameId, moveNumber: record.moveNumber, assisted: exercise.assisted,
      completed: status === "completed", repeated: exercise.repeated, role: exercise.role ?? "legacy", status,
      decisionCount: exercise.decisionCount ?? (exercise.attemptId ? 1 : 0),
      targetDecisions: exercise.targetDecisions ?? guidedTargetDecisions(exercise),
      awaitingNext: Boolean(exercise.awaitingNext), canStartHoldout: status === "ready_for_holdout",
      canAdvanceSlot: status === "ready_for_next_slot",
      sessionId: exercise.sessionId ?? null, slotIndex: exercise.slotIndex ?? null,
      sessionPositionTotal, sessionPositionCurrent: exercise.slotIndex != null ? exercise.slotIndex + 1 : null,
      sessionShortfall };
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
    const sessionPlan = layout.guided;
    const session = createPracticeSession(patternId, sessionPlan.map(r => r.exerciseId), {
      contentVersion: PATTERN_VERSION,
      detectorVersion: signature(),
      at: now(),
      reservedHoldoutRecordId: layout.holdout.exerciseId,
      sessionShortfall: layout.sessionShortfall,
    });
    session.guidedExerciseIds = [];
    mutate(s => { s.practiceSessions.push(session); });
    const record = preferredId ? sessionPlan.find(r => r.exerciseId === preferredId) ?? sessionPlan[0] : sessionPlan[0];
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
    return { ...practiceDto(exercise, assertRecord(exercise)), feedback };
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
  async function submit(id, moveUci) {
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
    const result = await evaluate({ fen: rootFen, moveUci }, AbortSignal.timeout(120000));
    assertRecord(exercise); // Import edits/deletion may have happened while evaluating.
    const latest = exerciseById(id);
    if (latest.awaitingNext || ["completed", "ready_for_holdout", "ready_for_next_slot"].includes(exerciseStatus(latest))) return exerciseView(id).feedback;
    const verified = Boolean(result.verified && !["illegal", "unverified"].includes(result.status));
    if (!verified) throw new Error("analysis_unverified");
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
      decisionNumber: nextCount, targetDecisions: target, canContinue, trainingStatus: nextStatus };
    mutate(s => {
      s.revision++; s.updatedAt = now();
      if (firstDecision) { s.attempts.push(attempt); s.exercises.find(e => e.id === id).attemptId = attempt.id; }
      else (s.continuationAttempts ??= []).push(attempt);
      const targetExercise = s.exercises.find(e => e.id === id);
      targetExercise.currentFen = chess.fen(); targetExercise.decisionCount = nextCount;
      targetExercise.lastRootFen = rootFen;
      targetExercise.status = nextStatus; targetExercise.awaitingNext = canContinue; targetExercise.lastAttemptId = attempt.id;
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
    return attempt;
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
  return { summary, update, schedule, startPractice, exerciseView, reveal, submit, advance, advanceSlot, retryDecision, startHoldout, activePractice, sessionView,
    cancel() { dirty = false; if (timer) { clearTimeout(timer); timer = null; } controller?.abort(); },
    async wait() { if (timer) return update(); return task ?? summary(); } };
}
