export const SPARRING_POLICY_VERSION = "sparring-policy-v1";
export const SPARRING_QUALITY_GATE_VERSION = "sparring-quality-gate-v1";
export const SPARRING_PRESSURE_VERSION = "sparring-pressure-v1";
export const SPARRING_TARGET_SELECTION_VERSION = "sparring-target-selection-v1";
export const SPARRING_SESSION_VERSION = "sparring-session-v1";
export const SPARRING_REVIEW_VERSION = "sparring-review-v1";
export const SPARRING_PROFILE_VERSION = "sparring-profile-v1";

export const DEFAULT_PRIORITY_PATTERN_ID = "allowed-forcing-reply";

export const SPARRING_ENGINE_CONFIG = Object.freeze({
  multiPv: 6,
  candidateBudgetId: "sparring-multipv-80k-v1",
  candidateNodes: 80_000,
  threads: 1,
  hashMb: 128,
});

export const STYLE_MAX_LOSS_CP = Object.freeze({
  instructional: 100,
  balanced: 60,
  strong: 25,
});

export const STANDARD_START_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export const SPARRING_DOSE_ELIGIBLE = false;
export const SPARRING_TRANSFER_ELIGIBLE = false;
