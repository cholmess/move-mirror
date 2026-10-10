import { agentTurnNumber } from "./chess-rules.js";
import { clockPublicDto } from "./clock.js";

const FORBIDDEN_SPOILER_KEYS = new Set([
  "candidates",
  "targetScore",
  "finalScore",
  "pv",
  "score",
  "cpLoss",
  "best",
  "evaluation",
  "pressureFeatures",
  "decision",
  "decisions",
  "profileSnapshot",
  "defenseResourceNeeds",
  "uncertainty",
  "pressureScore",
  "qualityReason",
  "fallbackToBest",
  "chosen",
  "policyVersion",
  "seed",
  "startingFen",
  "movesUci",
  "movesSan",
  "pendingAgentIdempotency",
  "enginePaused",
  "runningSinceMono",
  "monotonicEpochId",
  "pauseReason",
  "runningColor",
  "hintsUsed",
  "hintUsedPlies",
  "source",
  "pedagogicalGoalKey",
]);

const ACTIVE_SESSION_ALLOWED_TOP = new Set([
  "sessionId",
  "sessionStatus",
  "mode",
  "userColor",
  "style",
  "fen",
  "moveHistory",
  "clock",
  "agentTurnNumber",
  "reviewStatus",
  "practicePatternId",
  "result",
  "termination",
]);

export function agentMovePublicDto({ moveUci, moveSan, sessionStatus, clock, sessionId }) {
  return {
    ...(sessionId ? { sessionId } : {}),
    moveUci,
    moveSan,
    sessionStatus,
    clock,
  };
}

export function sessionPublicDto(session, fen, options = {}) {
  const terminal = ["completed", "resigned", "abandoned", "engine_error"].includes(session.status);
  const epochId = options.currentEpochId ?? session.clock?.monotonicEpochId ?? null;
  const dto = {
    sessionId: session.id,
    sessionStatus: session.status,
    mode: session.mode,
    userColor: session.userColor,
    style: session.style,
    fen,
    moveHistory: session.movesUci.map((uci, index) => ({
      uci,
      san: session.movesSan[index] ?? uci,
    })),
    clock: clockPublicDto(session.clock, epochId),
    agentTurnNumber: agentTurnNumber(session.movesUci, session.userColor, session.startingFen),
    reviewStatus: session.reviewStatus,
    practicePatternId: session.profileSnapshot?.patternId ?? session.source?.patternId ?? null,
  };
  if (terminal) {
    dto.result = session.result;
    dto.termination = session.termination;
  }
  return dto;
}

export function listSessionPublicDto(session) {
  return {
    sessionId: session.id,
    mode: session.mode,
    sessionStatus: session.status,
    userColor: session.userColor,
    result: session.result,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    reviewStatus: session.reviewStatus,
  };
}

function walkForbidden(value, path = "") {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = walkForbidden(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_SPOILER_KEYS.has(key)) return `${path}.${key}`;
    const nested = walkForbidden(value[key], `${path}.${key}`);
    if (nested) return nested;
  }
  return null;
}

export function assertNoSpoilers(payload) {
  return walkForbidden(payload) === null;
}

export function assertActiveSessionDto(dto) {
  if (!dto || typeof dto !== "object") return "invalid_dto";
  for (const key of Object.keys(dto)) {
    if (!ACTIVE_SESSION_ALLOWED_TOP.has(key)) return `unexpected_key:${key}`;
  }
  const spoiler = walkForbidden(dto);
  if (spoiler) return `spoiler:${spoiler}`;
  if (dto.reviewStatus === "completed" && dto.sessionStatus !== "completed" && dto.sessionStatus !== "resigned") {
    return "review_before_terminal";
  }
  return null;
}

export function sanitizePlayerMoveResponse({ session, agentMove, sessionId }) {
  const pub = sessionPublicDto(session, session.fen ?? session.startingFen);
  return {
    sessionId: sessionId ?? pub.sessionId,
    session: pub,
    ...(agentMove ? { agentMove } : {}),
  };
}
