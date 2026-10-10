export const SPARRING_PATTERN_CATALOG_VERSION = "sparring-patterns-v1";

/** Catálogo versionado — no alterar patrones pedagógicos existentes. */
export const SPARRING_PATTERN_CATALOG = Object.freeze({
  "allowed-forcing-reply": {
    id: "allowed-forcing-reply",
    modes: Object.freeze(["targeted_position", "full_game"]),
    priorityPattern: true,
    goalKey: "sparring.patterns.allowedForcingReply",
  },
  "cct-opponent-refutation": {
    id: "cct-opponent-refutation",
    modes: Object.freeze(["targeted_position", "full_game"]),
    priorityPattern: true,
    goalKey: "sparring.patterns.allowedForcingReply",
    mapsToPriority: "allowed-forcing-reply",
  },
});

export function resolvePatternForMode(patternId, mode) {
  const entry = SPARRING_PATTERN_CATALOG[patternId];
  if (!entry) return { ok: false, error: "sparring_pattern_unknown" };
  if (!entry.modes.includes(mode)) {
    return { ok: false, error: "sparring_pattern_incompatible_mode" };
  }
  const priorityPatternId = entry.mapsToPriority ?? entry.id;
  return {
    ok: true,
    entry,
    priorityPatternId,
    pedagogicalGoalKey: entry.goalKey,
  };
}
