import { Chess } from "chess.js";
import { randomUUID } from "node:crypto";
import { PATTERN_VERSION, MAX_PERSONAL_GAMES, patternExists } from "../../shared/patterns/catalog.js";
import { classifyDecision, hash, positionKey, playUci } from "../../shared/patterns/detect.js";
import { buildPatternProfile } from "../../shared/patterns/profile.js";
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
      s.exposures = s.exposures.filter(e => !invalid.has(e.exerciseId));
      for (const k of invalidAnalyses) delete s.analyses[k];
    });
  }
  function summary() {
    reconcileGames();
    const state = store.read(), games = selectPersonalGames(gamesStore.listGames()), records = rows();
    const patterns = buildPatternProfile(records, state.attempts, state.exposures, Date.parse(now()));
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
  function practiceDto(exercise, record) {
    return { id: exercise.id, positionId: record.exerciseId, patternId: record.patternId, fen: record.fen, color: record.fen.split(" ")[1] === "w" ? "white" : "black",
      gameId: record.gameId, moveNumber: record.moveNumber, assisted: exercise.assisted,
      completed: Boolean(exercise.attemptId), repeated: exercise.repeated };
  }
  function startPractice(patternId, preferredId = null) {
    if (!patternExists(patternId)) throw new Error("pattern_unknown");
    if (!summary().recommended.includes(patternId) && summary().patterns.find(p => p.id === patternId)?.status !== "recurrent") throw new Error("pattern_not_recurrent");
    const state = store.read();
    const candidates = rows().filter(r => r.patternId === patternId);
    candidates.sort((a, b) => {
      const latest = r => state.exposures.filter(e => e.positionKey === positionKey(r.fen)).at(-1)?.at ?? "";
      return latest(a).localeCompare(latest(b)) || (b.loss ?? 800) - (a.loss ?? 800);
    });
    const record = preferredId ? candidates.find(r => r.exerciseId === preferredId) : candidates[0];
    if (!record) throw new Error("exercise_unavailable");
    const exercise = { id: randomUUID(), patternId, recordId: record.exerciseId, startedAt: now(), gameId: record.gameId, playerColor: record.fen.split(" ")[1] === "w" ? "white" : "black", assisted: false,
      repeated: state.exposures.some(e => e.positionKey === positionKey(record.fen)), attemptId: null };
    mutate(s => { s.revision++; s.updatedAt = now(); s.exercises.push(exercise); s.exposures.push({ exerciseId: exercise.id, patternId, positionKey: positionKey(record.fen), gameId: record.gameId, at: exercise.startedAt }); });
    return practiceDto(exercise, record);
  }
  function exerciseById(id) { const e = store.read().exercises.find(e => e.id === id); if (!e) throw new Error("exercise_unavailable"); return e; }
  function exerciseView(id) { const exercise = exerciseById(id); return { ...practiceDto(exercise, assertRecord(exercise)), feedback: exercise.attemptId ? store.read().attempts.find(a => a.id === exercise.attemptId) : null }; }
  function reveal(id, kind = "hint") {
    const exercise = exerciseById(id), record = assertRecord(exercise);
    if (!["hint", "solution"].includes(kind)) throw new Error("invalid_request");
    mutate(s => { s.exercises.find(e => e.id === id).assisted = true; });
    if (kind === "hint") return { patternId: record.patternId, assisted: true };
    const chess = new Chess(record.fen); playUci(chess, record.referenceUci);
    return { patternId: record.patternId, assisted: true, referenceSan: record.referenceSan, referenceFen: chess.fen() };
  }
  async function submit(id, moveUci) {
    const exercise = exerciseById(id), record = assertRecord(exercise);
    if (exercise.attemptId) { return store.read().attempts.find(a => a.id === exercise.attemptId); }
    const chess = new Chess(record.fen), move = playUci(chess, moveUci);
    if (!move) throw new Error("illegal_move");
    const result = await evaluate({ fen: record.fen, moveUci }, AbortSignal.timeout(120000));
    assertRecord(exercise); // Import edits/deletion may have happened while evaluating.
    const latest = exerciseById(id);
    if (latest.attemptId) return store.read().attempts.find(a => a.id === latest.attemptId);
    const verified = Boolean(result.verified && !["illegal", "unverified"].includes(result.status));
    if (!verified) throw new Error("analysis_unverified");
    const reply = result.opponentReplyUci ? playUci(chess, result.opponentReplyUci) : null;
    if (result.opponentReplyUci && !reply) throw new Error("analysis_unverified");
    const attempt = { id: randomUUID(), exerciseId: id, gameId: record.gameId, patternId: record.patternId, at: now(), independent: !latest.assisted && !latest.repeated,
      assisted: latest.assisted || latest.repeated, verified, status: result.status, chosenSan: move.san, replySan: reply?.san ?? null,
      resultingFen: chess.fen(), referenceSan: record.referenceSan, engineVersion: result.engineVersion, engineSha256: result.engineSha256 };
    mutate(s => { s.revision++; s.updatedAt = now(); s.attempts.push(attempt); s.exercises.find(e => e.id === id).attemptId = attempt.id; });
    return attempt;
  }
  return { summary, update, schedule, startPractice, exerciseView, reveal, submit,
    cancel() { dirty = false; if (timer) { clearTimeout(timer); timer = null; } controller?.abort(); },
    async wait() { if (timer) return update(); return task ?? summary(); } };
}
