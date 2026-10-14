import fs from "node:fs";
import { Chess } from "chess.js";
import { randomUUID } from "node:crypto";
import {
  SPARRING_ENGINE_CONFIG,
  SPARRING_POLICY_VERSION,
  STANDARD_START_FEN,
} from "../../shared/sparring/constants.js";
import { chooseAgentMove } from "../../shared/sparring/policy.js";
import {
  agentTurnNumber,
  applyUci,
  detectTermination,
  idempotencyKey,
  rebuildChess,
  sideToMoveIsAgent,
} from "../../shared/sparring/chess-rules.js";
import { agentMovePublicDto, sessionPublicDto } from "../../shared/sparring/dto.js";
import { buildProfileSnapshot, applyReviewToProfile, profileNeedsFromStore } from "../../shared/sparring/profile.js";
import {
  clockPublicDto,
  markClockExpired,
  markClockFinished,
  migratePersistedClock,
  pauseClock,
  pauseClockAfterMove,
  recoverClockAfterProcessChange,
  resumeClockAfterServerRestart,
  startClock,
  timeoutResult,
} from "../../shared/sparring/clock.js";
import { buildSparringReview, userDecisionPlies } from "../../shared/sparring/review.js";
import { sessionToPgn } from "../../shared/sparring/pgn.js";
import { sanitizeCreateSessionBody } from "../../shared/sparring/session-create.js";
import { makeSparringDecisionCacheKey, SparringCache } from "./cache.mjs";

function agentColor(userColor) {
  return userColor === "white" ? "black" : "white";
}

function uciToSan(fen, uci) {
  const chess = new Chess(fen);
  const move = chess.move({
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci[4],
  });
  return move?.san ?? uci;
}

function recentResourcesFromDecisions(decisions) {
  return decisions.map((d) => d.chosen?.pressureFeatures?.likelyDefensiveResource).filter(Boolean);
}

function lastMoveIsAgent(session) {
  const idx = session.movesUci.length - 1;
  if (idx < 0) return false;
  const isWhiteMove = idx % 2 === 0;
  const agentIsWhite = session.userColor === "black";
  return isWhiteMove === agentIsWhite;
}

function recentMotifsFromDecisions(decisions) {
  return decisions
    .map((d) => {
      const f = d.chosen?.pressureFeatures;
      if (!f) return "";
      return `${f.givesCheck ? "c" : ""}${f.createsForcingCapture ? "x" : ""}${f.createsNarrowDefense ? "n" : ""}`;
    })
    .filter(Boolean);
}

export function createSparringService({
  store,
  engine,
  engineAvailable,
  queue,
  evaluate,
  defenseDatasetFile,
  cacheRoot,
  monotonicEpochId = randomUUID(),
  validation = null,
}) {
  const cache = new SparringCache(cacheRoot);
  const resumeInflight = new Map();

  function hydrateSession(session) {
    if (!session?.clock) return { session, changed: false };
    const { clock, changed: clockChanged } = recoverClockAfterProcessChange(session.clock, monotonicEpochId);
    let changed = clockChanged;
    const next = { ...session, clock: migratePersistedClock(clock) };
    if (clockChanged) changed = true;
    return { session: next, changed };
  }

  function loadSession(id) {
    const raw = store.readSession(id);
    if (!raw) return null;
    const { session, changed } = hydrateSession(raw);
    if (changed) store.saveSession(session);
    return session;
  }

  function publicClock(session) {
    return clockPublicDto(session.clock, monotonicEpochId);
  }

  function sessionFen(session) {
    return rebuildChess(session.startingFen, session.movesUci).fen;
  }

  function publicSession(session) {
    return sessionPublicDto(session, sessionFen(session), { currentEpochId: monotonicEpochId });
  }

  function recordTerminal(session) {
    if (!validation?.recordSparringCompleted) return;
    if (session.status === "completed" || session.status === "resigned") {
      void validation.recordSparringCompleted(session);
    }
  }

  function declareTimeout(session, timeout, currentEpochId) {
    session.status = "completed";
    session.result = timeout.result;
    session.termination = timeout.termination;
    session.timeoutDeclared = true;
    session.completedAt = new Date().toISOString();
    session.clock = markClockExpired(session.clock, currentEpochId);
    recordTerminal(session);
  }

  function syncClockToTurn(session) {
    if (session.clock.mode === "untimed") return session.clock;
    if (session.status !== "active" || session.timeoutDeclared) {
      return markClockFinished(session.clock, monotonicEpochId);
    }
    if (session.enginePaused) {
      return pauseClock(session.clock, { reason: "engine_wait", currentEpochId: monotonicEpochId });
    }
    const migrated = migratePersistedClock(session.clock);
    if (migrated.status === "paused" && migrated.pauseReason === "server_restart") {
      return migrated;
    }
    const fen = sessionFen(session);
    const paused = pauseClock(session.clock, { currentEpochId: monotonicEpochId });
    const color = sideToMoveIsAgent(fen, session.userColor) ? agentColor(session.userColor) : session.userColor;
    const withActive = { ...paused, activeColor: color };
    return startClock(withActive, color, monotonicEpochId);
  }

  function activateSession(session) {
    if (session.status === "created") session.status = "active";
    session.clock = syncClockToTurn(session);
    return session;
  }

  async function runAgentDecision(session, fen) {
    const turnNo = agentTurnNumber(session.movesUci, session.userColor, session.startingFen);
    const turnKey = idempotencyKey(session.id, fen, turnNo);

    const existing = session.decisions.find((d) => d.idempotencyKey === turnKey);
    if (existing) return existing.chosen;

    session.clock = pauseClock(session.clock, { reason: "engine_wait", currentEpochId: monotonicEpochId });

    const cacheKey = makeSparringDecisionCacheKey({
      fen,
      candidateBudgetId: SPARRING_ENGINE_CONFIG.candidateBudgetId,
      engineSha256: engine?.engineSha256,
      multiPv: SPARRING_ENGINE_CONFIG.multiPv,
      profileSnapshotHash: session.profileSnapshot.sha256,
      style: session.style,
      seed: session.seed,
      turnKey,
    });

    let decisionPayload = cache.get(cacheKey);
    const cacheHit = Boolean(decisionPayload);

    if (!decisionPayload) {
      if (!engineAvailable || !engine) throw new Error("engine_unavailable");
      const multi = await queue.enqueue(
        (ctx) =>
          engine.analyseMultiPv(fen, {
            multiPv: SPARRING_ENGINE_CONFIG.multiPv,
            nodes: SPARRING_ENGINE_CONFIG.candidateNodes,
            threads: SPARRING_ENGINE_CONFIG.threads,
            hashMb: SPARRING_ENGINE_CONFIG.hashMb,
            signal: ctx.signal,
          }),
        {},
      );

      const lines = multi.lines.map((line) => ({
        ...line,
        san: uciToSan(fen, line.firstMoveUci),
      }));

      const policy = chooseAgentMove({
        fen,
        agentColor: agentColor(session.userColor),
        userColor: session.userColor,
        multiPvLines: lines,
        style: session.style,
        profileSnapshot: session.profileSnapshot,
        seed: session.seed,
        turnKey,
        recentDefensiveResources: recentResourcesFromDecisions(session.decisions),
        recentMotifs: recentMotifsFromDecisions(session.decisions),
      });

      decisionPayload = {
        ...policy,
        cacheKey,
        engineSha256: engine.engineSha256,
        candidateBudgetId: SPARRING_ENGINE_CONFIG.candidateBudgetId,
      };
      cache.set(cacheKey, decisionPayload);
    }

    const chosen = decisionPayload.chosen;
    if (!chosen?.uci) throw new Error("no_legal_candidate");

    const applied = applyUci(fen, chosen.uci);
    if (!applied) throw new Error("engine_illegal_move");

    session.decisions.push({
      idempotencyKey: turnKey,
      ply: session.movesUci.length + 1,
      fenBefore: fen,
      chosen,
      candidates: decisionPayload.candidates,
      fallbackToBest: decisionPayload.fallbackToBest,
      cacheHit,
      at: new Date().toISOString(),
    });
    session.pendingAgentIdempotency = turnKey;
    session.movesUci.push(chosen.uci);
    session.movesSan.push(applied.san);
    session.enginePaused = false;

    store.recordMetric({
      type: "agent_move",
      sessionId: session.id,
      cacheHit,
      fallback: decisionPayload.fallbackToBest,
      candidateCount: decisionPayload.candidates?.length ?? 0,
    });

    return chosen;
  }

  async function maybeAgentReply(session) {
    const fen = sessionFen(session);
    if (!sideToMoveIsAgent(fen, session.userColor)) return session;
    await runAgentDecision(session, fen);
    const chess = rebuildChess(session.startingFen, session.movesUci).chess;
    const term = detectTermination(chess);
    if (term) {
      session.status = "completed";
      session.result = term.result;
      session.termination = term.termination;
      session.completedAt = new Date().toISOString();
      session.clock = markClockFinished(session.clock, monotonicEpochId);
      recordTerminal(session);
    } else if (session.maxPlies && session.movesUci.length >= session.maxPlies) {
      session.status = "completed";
      session.result = "*";
      session.termination = "training_goal_reached";
      session.completedAt = new Date().toISOString();
      session.clock = markClockFinished(session.clock, monotonicEpochId);
      recordTerminal(session);
    } else {
      session.clock = syncClockToTurn(session);
    }
    return session;
  }

  function resolveStartingPosition(input) {
    if (input.defenseExerciseId && defenseDatasetFile) {
      const dataset = JSON.parse(fs.readFileSync(defenseDatasetFile, "utf8"));
      const exercise = dataset.exercises.find((e) => e.id === input.defenseExerciseId);
      if (!exercise) throw new Error("defense_exercise_not_found");
      return {
        startingFen: exercise.positionBeforeDecisionFen,
        source: {
          defenseExerciseId: exercise.id,
          sourceGameId: exercise.source?.gameId ?? null,
          patternId: input.patternId,
        },
        pedagogicalGoalKey: input.pedagogicalGoalKey,
        userColor: exercise.orientation ?? input.userColor,
      };
    }
    return {
      startingFen: input.startingFen ?? STANDARD_START_FEN,
      source: {
        defenseExerciseId: null,
        sourceGameId: input.sourceGameId ?? null,
        patternId: input.patternId,
      },
      pedagogicalGoalKey: input.pedagogicalGoalKey,
      userColor: input.userColor,
    };
  }

  function resolveStartingFen(input, resolved) {
    if (input.startingFen && !input.defenseExerciseId) return input.startingFen;
    return resolved.startingFen;
  }

  function getSession(id) {
    const session = loadSession(id);
    if (!session) return null;
    return publicSession(session);
  }

  return {
    createSession(rawInput) {
      store.ensure();
      const input = sanitizeCreateSessionBody(rawInput);
      const profile = store.readProfile();
      const snapshot = buildProfileSnapshot({
        patternId: input.priorityPatternId,
        defenseResourceNeeds: profileNeedsFromStore(profile),
        uncertainty: Object.fromEntries(
          Object.entries(profile.byResource ?? {}).map(([k, v]) => [k, v.uncertainty ?? 0.5]),
        ),
      });

      let userColor = input.userColor ?? "white";
      if (userColor === "random") userColor = Math.random() < 0.5 ? "white" : "black";

      const resolved = resolveStartingPosition({ ...input, userColor });
      const session = store.createSession({
        mode: input.mode,
        userColor: resolved.userColor,
        startingFen: resolveStartingFen(input, resolved),
        style: input.style ?? "balanced",
        seed: randomUUID(),
        policyVersion: SPARRING_POLICY_VERSION,
        profileSnapshot: snapshot,
        source: resolved.source,
        clockMode: input.clockMode,
        maxPlies: input.maxPlies ?? (input.mode === "targeted_position" ? 40 : null),
        pedagogicalGoalKey: resolved.pedagogicalGoalKey,
      });

      store.recordMetric({ type: "session_created", sessionId: session.id, mode: session.mode });
      return publicSession(session);
    },

    getSession,

    getSessionInternal(id) {
      return loadSession(id);
    },

    listSessions() {
      return store.listSessions().map((s) => ({
        sessionId: s.id,
        mode: s.mode,
        sessionStatus: s.status,
        userColor: s.userColor,
        result: s.result,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        reviewStatus: s.reviewStatus,
      }));
    },

    async applyPlayerMove(sessionId, { moveUci }) {
      let session = loadSession(sessionId);
      if (!session) throw new Error("session_not_found");
      if (session.timeoutDeclared || ["completed", "resigned", "abandoned"].includes(session.status)) {
        throw new Error("session_finished");
      }

      session = activateSession(session);
      session.clock = pauseClock(session.clock, { currentEpochId: monotonicEpochId });
      const timeoutBefore = timeoutResult(session.clock, monotonicEpochId);
      if (timeoutBefore) {
        declareTimeout(session, timeoutBefore, monotonicEpochId);
        store.saveSession(session);
        return { session: publicSession(session), agentMove: null };
      }

      const fen = sessionFen(session);
      if (sideToMoveIsAgent(fen, session.userColor)) throw new Error("agent_turn");

      const applied = applyUci(fen, moveUci);
      if (!applied) throw new Error("illegal_move");

      session.movesUci.push(moveUci);
      session.movesSan.push(applied.san);
      session.clock = pauseClockAfterMove(session.clock, monotonicEpochId);

      const chess = applied.chess;
      let term = detectTermination(chess);
      if (!term && session.maxPlies && session.movesUci.length >= session.maxPlies) {
        term = { result: "*", termination: "training_goal_reached" };
      }
      if (term) {
        session.status = "completed";
        session.result = term.result;
        session.termination = term.termination;
        session.completedAt = new Date().toISOString();
        session.clock = markClockFinished(session.clock, monotonicEpochId);
        recordTerminal(session);
        store.saveSession(session);
        return { session: publicSession(session), agentMove: null };
      }

      store.saveSession(session);

      try {
        session = await maybeAgentReply(session);
        store.saveSession(session);
        const agentMove =
          lastMoveIsAgent(session) && session.movesUci.length
            ? agentMovePublicDto({
                sessionId: session.id,
                moveUci: session.movesUci.at(-1),
                moveSan: session.movesSan.at(-1),
                sessionStatus: session.status,
                clock: publicClock(session),
              })
            : null;
        return { session: publicSession(session), agentMove };
      } catch (err) {
        session.status = "paused";
        session.enginePaused = true;
        session.clock = pauseClock(session.clock, { reason: "engine_error", currentEpochId: monotonicEpochId });
        store.saveSession(session);
        throw err;
      }
    },

    async agentMove(sessionId) {
      let session = loadSession(sessionId);
      if (!session) throw new Error("session_not_found");
      if (session.timeoutDeclared || ["completed", "resigned", "abandoned"].includes(session.status)) {
        throw new Error("session_finished");
      }

      session = activateSession(session);
      const fen = sessionFen(session);
      const turnNo = agentTurnNumber(session.movesUci, session.userColor, session.startingFen);
      const key = idempotencyKey(session.id, fen, turnNo);
      const existing = session.decisions.find((d) => d.idempotencyKey === key);
      if (existing) {
        return agentMovePublicDto({
          sessionId: session.id,
          moveUci: existing.chosen.uci,
          moveSan: uciToSan(existing.fenBefore, existing.chosen.uci),
          sessionStatus: session.status,
          clock: publicClock(session),
        });
      }

      if (!sideToMoveIsAgent(fen, session.userColor)) {
        const last = session.decisions.at(-1);
        if (last && session.movesUci.at(-1) === last.chosen.uci) {
          return agentMovePublicDto({
            sessionId: session.id,
            moveUci: last.chosen.uci,
            moveSan: uciToSan(last.fenBefore, last.chosen.uci),
            sessionStatus: session.status,
            clock: publicClock(session),
          });
        }
        throw new Error("not_agent_turn");
      }

      session.clock = pauseClock(session.clock, { reason: "engine_wait", currentEpochId: monotonicEpochId });
      try {
        const chosen = await runAgentDecision(session, fen);
        const chess = rebuildChess(session.startingFen, session.movesUci).chess;
        const term = detectTermination(chess);
        if (term) {
          session.status = "completed";
          session.result = term.result;
          session.termination = term.termination;
          session.completedAt = new Date().toISOString();
          session.clock = markClockFinished(session.clock, monotonicEpochId);
        } else {
          session.clock = syncClockToTurn(session);
        }
        store.saveSession(session);
        return agentMovePublicDto({
          sessionId: session.id,
          moveUci: chosen.uci,
          moveSan: uciToSan(fen, chosen.uci),
          sessionStatus: session.status,
          clock: publicClock(session),
        });
      } catch (err) {
        session.status = "paused";
        session.enginePaused = true;
        session.clock = pauseClock(session.clock, { reason: "engine_error", currentEpochId: monotonicEpochId });
        store.saveSession(session);
        store.recordMetric({ type: "engine_error", sessionId, error: String(err.message ?? err) });
        throw err;
      }
    },

    async hint(sessionId) {
      const session = loadSession(sessionId);
      if (!session) throw new Error("session_not_found");
      if (!["active", "created"].includes(session.status)) throw new Error("session_finished");
      const fen = sessionFen(session);
      if (sideToMoveIsAgent(fen, session.userColor)) throw new Error("agent_turn");
      session.hintsUsed += 1;
      session.hintUsedPlies.push(session.movesUci.length);
      store.saveSession(session);
      if (!engineAvailable || !engine) return { hintUsed: true, moveSan: null };
      const multi = await queue.enqueue(ctx => engine.analyseMultiPv(fen, {
        multiPv: 1, nodes: SPARRING_ENGINE_CONFIG.candidateNodes,
        threads: SPARRING_ENGINE_CONFIG.threads, hashMb: SPARRING_ENGINE_CONFIG.hashMb, signal: ctx.signal,
      }), {});
      const uci = multi.lines[0]?.firstMoveUci;
      if (!uci) return { hintUsed: true, moveSan: null };
      const moveSan = uciToSan(fen, uci);
      return { hintUsed: true, fen, moveSan, from: uci.slice(0, 2), to: uci.slice(2, 4) };
    },

    resign(sessionId) {
      const session = loadSession(sessionId);
      if (!session) throw new Error("session_not_found");
      session.status = "resigned";
      session.result = session.userColor === "white" ? "0-1" : "1-0";
      session.termination = "resignation";
      session.completedAt = new Date().toISOString();
      session.clock = markClockFinished(session.clock, monotonicEpochId);
      recordTerminal(session);
      store.saveSession(session);
      return publicSession(session);
    },

    resume(sessionId) {
      const run = () => {
        const session = loadSession(sessionId);
        if (!session) throw new Error("session_not_found");
        if (session.timeoutDeclared || ["completed", "resigned", "abandoned"].includes(session.status)) {
          throw new Error("session_finished");
        }

        const migrated = migratePersistedClock(session.clock);
        if (migrated.mode === "10+0") {
          if (migrated.status === "running" && migrated.monotonicEpochId === monotonicEpochId) {
            return publicSession(session);
          }
          if (migrated.pauseReason === "server_restart") {
            if (session.status !== "active") throw new Error("not_active");
            const { clock } = resumeClockAfterServerRestart(session.clock, monotonicEpochId);
            session.clock = clock;
            store.saveSession(session);
            return publicSession(session);
          }
        }

        if (session.status !== "paused") throw new Error("not_paused");
        session.status = "active";
        session.enginePaused = false;
        session.clock = syncClockToTurn(session);
        store.saveSession(session);
        return publicSession(session);
      };

      if (resumeInflight.has(sessionId)) return resumeInflight.get(sessionId);
      const result = run();
      resumeInflight.set(sessionId, result);
      resumeInflight.delete(sessionId);
      return result;
    },

    async runReview(sessionId) {
      const existing = store.readReview(sessionId);
      if (existing) return existing;

      const session = loadSession(sessionId);
      if (!session) throw new Error("session_not_found");
      if (session.status !== "completed" && session.status !== "resigned") throw new Error("session_not_finished");
      if (session.reviewStatus === "completed") {
        const review = store.readReview(sessionId);
        if (review) return review;
      }

      session.reviewStatus = "running";
      store.saveSession(session);

      const plies = userDecisionPlies(session);
      const evaluated = [];
      for (const ply of plies) {
        const { fen } = rebuildChess(session.startingFen, session.movesUci.slice(0, ply.moveIndex));
        const evalResult = await evaluate({ fen, moveUci: ply.uci });
        const agentDecision = session.decisions.find((d) => d.ply === ply.moveIndex && ply.moveIndex > 0);
        evaluated.push({
          ply: ply.ply,
          fenBeforeMove: fen,
          playedMoveUci: ply.uci,
          playedMoveSan: ply.san,
          evaluation: evalResult,
          matchedPriorityPattern: agentDecision?.chosen?.pressureFeatures?.matchesPriorityPattern ?? false,
          defensiveResource: agentDecision?.chosen?.pressureFeatures?.likelyDefensiveResource ?? null,
          hintUsed: session.hintUsedPlies?.includes(ply.moveIndex) ?? false,
          agentCreated: Boolean(agentDecision),
        });
      }

      const review = buildSparringReview(session, evaluated);
      store.saveReview(review);
      session.reviewStatus = "completed";
      store.saveSession(session);

      const profile = applyReviewToProfile(store.readProfile(), review, {
        eligible: !session.fixture && session.status !== "engine_error" && session.profileSnapshot?.patternId !== "general-practice",
      });
      store.saveProfile(profile);

      return review;
    },

    getReview(sessionId) {
      const session = loadSession(sessionId);
      if (!session) throw new Error("session_not_found");
      if (session.status !== "completed" && session.status !== "resigned") {
        throw new Error("review_not_available");
      }
      return store.readReview(sessionId);
    },

    exportPgn(sessionId) {
      const session = loadSession(sessionId);
      if (!session) throw new Error("session_not_found");
      return sessionToPgn(session);
    },

    getProfile() {
      return store.readProfile();
    },
  };
}
