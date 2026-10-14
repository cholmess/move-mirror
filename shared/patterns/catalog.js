export const PATTERN_VERSION = "personal-patterns-v1";
export const MIN_PATTERN_GAMES = 3;
export const MAX_PERSONAL_GAMES = 200;
export const LOSS_THRESHOLD = 120;
export const PATTERNS = [
  { id: "piece-loss", kind: "tactical", cause: "unknown" },
  { id: "missed-capture", kind: "tactical", cause: "unknown" },
  { id: "missed-mate", kind: "tactical", cause: "unknown" },
  { id: "forcing-reply", kind: "tactical", cause: "unknown" },
  { id: "closed-center", kind: "context", cause: "unknown" },
  { id: "endgame-decisions", kind: "context", cause: "unknown" },
];
export function patternExists(id) { return PATTERNS.some(p => p.id === id); }
