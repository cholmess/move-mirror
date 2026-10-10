import { resolvePatternForMode } from "./patterns.js";

const ALLOWED_CREATE_FIELDS = new Set([
  "mode",
  "userColor",
  "style",
  "clockMode",
  "clock",
  "patternId",
  "defenseExerciseId",
  "sourceGameId",
  "maxPlies",
  "startingFen",
]);

const FORBIDDEN_CLIENT_FIELDS = [
  "profileSnapshot",
  "defenseResourceNeeds",
  "uncertainty",
  "pressureScore",
  "pedagogicalGoalKey",
  "seed",
  "policyVersion",
];

export function sanitizeCreateSessionBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("sparring_invalid_body");
  }
  for (const field of FORBIDDEN_CLIENT_FIELDS) {
    if (body[field] != null) throw new Error("sparring_client_snapshot_forbidden");
  }
  for (const key of Object.keys(body)) {
    if (!ALLOWED_CREATE_FIELDS.has(key)) {
      throw new Error("sparring_invalid_field");
    }
  }
  const mode = body.mode;
  if (mode !== "targeted_position" && mode !== "full_game") {
    throw new Error("sparring_invalid_mode");
  }
  const patternId = body.patternId ?? "allowed-forcing-reply";
  const resolved = resolvePatternForMode(patternId, mode);
  if (!resolved.ok) throw new Error(resolved.error);

  const clockMode = body.clock?.mode ?? body.clockMode ?? (mode === "targeted_position" ? "untimed" : "untimed");
  if (clockMode !== "untimed" && clockMode !== "10+0") {
    throw new Error("sparring_invalid_clock");
  }

  return {
    mode,
    userColor: body.userColor ?? "white",
    style: body.style ?? "balanced",
    clockMode,
    patternId,
    priorityPatternId: resolved.priorityPatternId,
    pedagogicalGoalKey: resolved.pedagogicalGoalKey,
    defenseExerciseId: body.defenseExerciseId ?? null,
    sourceGameId: body.sourceGameId ?? null,
    maxPlies: body.maxPlies ?? null,
    startingFen: body.startingFen ?? null,
  };
}
