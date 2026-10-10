export interface TransferMetrics {
  gamesAnalyzed: number;
  gamesAffected: number;
  decisions: number;
  events: number;
  eventsPer100: number | null;
  pieceCaptureEvents: number;
  pieceCapturePer100: number | null;
  byPhase: Record<string, { decisions: number; events: number; per100: number | null }>;
  byColor: Record<string, { decisions: number; events: number; per100: number | null }>;
  severity: { notable: number; marcada: number; grave: number };
  detectorId: string;
}

export interface TransferComparison {
  status: "insufficient_data" | "early_signal" | "observed_improvement" | "no_clear_reduction";
  label: string;
  meaning: string;
  notMeaning: string;
  absoluteDifference: number | null;
  relativeDifference: number | null;
  detectorId: string;
  interval: {
    low: number | null;
    high: number | null;
    relativeLow: number | null;
    relativeHigh: number | null;
    iterations: number;
  };
  sample: {
    baselineGames: number;
    baselineDecisions: number;
    transferGames: number;
    transferDecisions: number;
  };
  baseline: TransferMetrics;
  transfer: TransferMetrics;
}

export interface TransferState {
  version: string;
  detectorId: string;
  analysisFingerprint: string;
  baseline: {
    cohortId: string;
    games: number;
    cutoff: { endTime: number; gameId: string; endUtc: string };
    metrics: TransferMetrics | null;
    analysis: { done: number; total: number; complete?: boolean } | null;
  } | null;
  sync: {
    lastSyncedAt: string | null;
    lastError: string | null;
    lastSource: string | null;
    running: boolean;
    progress: { phase: string; done: number; total: number; message: string } | null;
  };
  openCohort: {
    id: string;
    frozen: boolean;
    pendingDecisions: number;
    games: number;
    decisions: number;
    analysisComplete: boolean;
    purpose?: string;
    exposureAudit?: CohortExposureAudit | null;
  } | null;
  currentCohortId: string | null;
  intervention: {
    protocolId: string;
    qualified: boolean;
    qualifiedAt: string | null;
  } | null;
  currentExposureAudit: CohortExposureAudit | null;
  v03ExposureAudit: CohortExposureAudit | null;
  context: {
    baseline: CompetitiveContext | null;
    cohort: CompetitiveContext | null;
    warning: { materialDifference: boolean; reasons: string[]; message: string | null } | null;
  };
  includedCount: number;
  excludedCount: number;
  exclusionCounts: { reason: string; count: number }[];
  exclusionSamples: { gameId: string | null; url: string | null; reason: string; detail: string }[];
  included: {
    gameId: string;
    url: string;
    color: string;
    result: string;
    endUtc: string;
    opening: { eco: string | null; name: string | null };
    ownDecisions: number;
    ratings?: { own: number | null; opponent: number | null };
    ratingDifference?: number | null;
    durationMoves?: number;
    phaseApproximate?: string | null;
    gameDate?: string;
    termination: { white: string | null; black: string | null };
  }[];
  comparison: TransferComparison | null;
  pedagogy: {
    action: string;
    title: string;
    explanation: string;
    policyId: string;
    teachNewPattern: boolean;
    candidate: { id: string; note: string; teachAutomatically: boolean } | null;
  } | null;
  exerciseCandidates: { id: string; key: string; gameId: string; cohortId: string }[];
  examplesLocked: boolean;
}

export type ExposureValidity =
  | "post_intervention_verified"
  | "mixed_exposure"
  | "pre_intervention"
  | "exposure_unknown";

export interface CohortExposureAudit {
  cohortId: string;
  exposureValidity: ExposureValidity;
  protocolId: string;
  qualifiedAt: string | null;
  gamesBeforeQualification: number | null;
  gamesAfterQualification: number | null;
  earliestGameAt: string;
  latestGameAt: string;
  auditedAt: string;
  auditVersion: "exposure-audit-v1";
  auditHash: string;
}

export interface CompetitiveContext {
  games: number;
  ownRatingMean: number | null;
  ownRatingMedian: number | null;
  opponentRatingMean: number | null;
  opponentRatingMedian: number | null;
  ratingDifferenceMean: number | null;
  ratingDifferenceMedian: number | null;
  whiteProportion: number | null;
  winProportion: number | null;
  lossProportion: number | null;
  drawProportion: number | null;
  decisionsPerGame: number | null;
}

export interface TransferExample {
  key: string;
  gameId: string;
  url?: string | null;
  ply: number;
  moveNumber: number;
  color: string;
  severity: string | null;
  pieceCaptureSubgroup: boolean;
}
