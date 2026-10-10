export const METADATA_MERGE_VERSION = "metadata-merge-v1";

/**
 * Field-level metadata precedence. Never apply a single global source ranking.
 * Confirmed values always beat inferred values. Conflicts are stored with the rule id.
 */
export const METADATA_MERGE_RULES = Object.freeze({
  "chess.movesUci": "legal_complete_mainline_wins",
  "chess.startingFen": "keep_separate_unless_fingerprint_matches",
  "chess.variant": "keep_separate_if_different",
  "timing.startedAt": "higher_date_precision",
  "timing.endedAt": "prefer_existing_unless_missing",
  "timing.datePrecision": "follows_started_at",
  "metadata.url": "preserve_official_platform_url",
  "metadata.opening": "prefer_existing_unless_missing_then_computed_sequence",
  "metadata.event": "prefer_existing_unless_missing",
  "metadata.site": "prefer_existing_unless_missing",
  "metadata.round": "prefer_existing_unless_missing",
  "metadata.board": "prefer_existing_unless_missing",
  "metadata.eco": "prefer_existing_unless_missing",
  "players.white.name": "prefer_existing_unless_missing",
  "players.black.name": "prefer_existing_unless_missing",
  "players.white.username": "preserve_official_platform_username",
  "players.black.username": "preserve_official_platform_username",
  "players.white.rating": "prefer_existing_unless_missing",
  "players.black.rating": "prefer_existing_unless_missing",
  "players.playerResolution": "verified_beats_unresolved",
});

export const CONFIRMED_FIELDS_KEY = "confirmedFields";
