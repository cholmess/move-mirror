export type SourceType = "chess_com" | "lichess" | "pgn_file" | "pgn_text" | "manual" | "scoresheet";

export type PlayerResolution = {
  playerColor: "white" | "black" | null;
  method: "source_username" | "pgn_alias" | "manual_confirmation" | "unresolved";
  matchedAlias: string | null;
  confidence: "verified" | "probable" | "unknown";
};

export type PlayerIdentity = {
  id: string;
  displayName: string;
  chessComUsernames: string[];
  lichessUsernames: string[];
  pgnNameAliases: string[];
  createdAt: string;
  updatedAt: string;
  version: "player-identity-v1";
};

export type IdentityAliasStat = {
  platform: "chess_com" | "lichess" | "pgn";
  alias: string;
  active: boolean;
  linkedGames: number;
};

export type PlayerIdentityPublic = PlayerIdentity & {
  aliases: IdentityAliasStat[];
};

export type ReconcileSummary = {
  candidates: number;
  wouldResolve: number;
  resolved: number;
  ambiguous: number;
  skippedProtected: number;
  skippedVerified: number;
  unchanged: number;
  gameIds: string[];
};

export type MetadataConflict = {
  field: string;
  existingValue: unknown;
  incomingValue: unknown;
  chosenValue: unknown;
  resolutionRule: string;
  requiresReview: boolean;
};

export type GameSourceRecord = {
  id: string;
  sourceType: SourceType;
  externalId: string | null;
  importedAt: string;
  importJobId: string;
  rawSha256: string;
  rawLocation?: string | null;
  rawAvailable?: boolean;
  parsedMetadata?: Record<string, unknown>;
  canonicalGameId: string;
  duplicateDisposition: "new_canonical_game" | "merged_with_existing" | "exact_duplicate";
  conflicts: MetadataConflict[];
};

export type CanonicalGame = {
  id: string;
  version: "canonical-game-v1";
  fingerprint: string;
  chess: {
    variant: "standard";
    startingFen: string;
    movesUci: string[];
    movesSan: string[];
    result: "1-0" | "0-1" | "1/2-1/2" | "*";
    termination: string | null;
  };
  players: {
    white: { name: string | null; username: string | null; rating: number | null };
    black: { name: string | null; username: string | null; rating: number | null };
    playerResolution: PlayerResolution;
  };
  timing: {
    startedAt: string | null;
    endedAt: string | null;
    datePrecision: "exact" | "minute" | "day" | "month" | "year" | "unknown";
    timeControl: {
      raw: string | null;
      initialSeconds: number | null;
      incrementSeconds: number | null;
      category: "bullet" | "blitz" | "rapid" | "classical" | "correspondence" | "unknown" | string;
    };
  };
  metadata: {
    event: string | null;
    site: string | null;
    round: string | null;
    board: string | null;
    eco: string | null;
    opening: string | null;
    url: string | null;
  };
  provenance: {
    sourceIds: string[];
    firstImportedAt: string;
    lastImportedAt: string;
    importJobIds: string[];
  };
  eligibility: {
    stored: boolean;
    coachingEligible: boolean;
    coachingPolicyId: string | null;
    transferEligible: boolean;
    transferPolicyId: string | null;
    reasons: string[];
  };
  sources: GameSourceRecord[];
  archived?: boolean;
  analysisSelected?: boolean;
  confirmedFields?: string[];
  protection?: string[];
};

export type ImportJob = {
  id: string;
  sourceType: SourceType;
  status: "queued" | "running" | "awaiting_review" | "completed" | "completed_with_errors" | "cancelled" | "failed";
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  checkpoint?: unknown;
  summary: {
    discovered: number;
    parsed: number;
    newCanonicalGames: number;
    mergedDuplicates: number;
    exactDuplicates: number;
    requiresReview: number;
    excluded: number;
    failed: number;
  };
  errors: Array<{ code: string; message: string; gameIndex?: number; ply?: number | null; excluded?: boolean }>;
};

export type AnalysisScope = {
  id: string;
  name: string;
  policyVersion: string;
  gameIds: string[];
  timeControlCategories: string[];
  createdAt: string;
  frozenAt: string | null;
};

export type PgnPreview = {
  detected: number;
  valid: number;
  excluded: number;
  failed: number;
  games: Array<{
    index: number;
    excluded: boolean;
    error: { code: string; message: string; ply?: number | null } | null;
    white: string | null;
    black: string | null;
    result: string | null;
    moves: number;
  }>;
};
