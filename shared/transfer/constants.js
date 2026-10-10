import { BUDGET_DEEP, BUDGET_SHALLOW } from "../evaluation/budgets.js";

export const TRANSFER_VERSION = "0.3.1";
export const VALIDITY_PIPELINE_VERSION = "transfer-validity-pipeline-v0.3.1";
export const DETECTOR_ID = "allowed-forcing-reply-transfer-v1";
export const FILTER_RULES_ID = "fase1-filter-v1";
export const PHASE_PROXY_ID = "phase-proxy-material-v1";
export const CONFIRM_POLICY_ID = "transfer-confirm-v1";
export const ANALYSIS_CONFIG_ID = "transfer-analysis-v1";
export const LANGUAGE_POLICY_ID = "transfer-language-v1";
export const PEDAGOGY_POLICY_ID = "pedagogy-adapt-v1";
export const EXERCISE_QUALITY_ID = "transfer-exercise-quality-v1";
export const BOOTSTRAP_METHOD = "game-cluster-bootstrap-v1";
export const BASELINE_COHORT_ID = "baseline-fase2-200";
export const PLAYER_USERNAME = "cholmess21";
export const TIME_CONTROL = "600";
export const LOSS_THRESHOLD = 120;
export const PIECE_CAPTURE_MIN = 3;
export const CONFIRM_BAND = Object.freeze([105, 135]);
export const OPENING_MAX_PLY = 20;
export const ENDGAME_MAX_MATERIAL = 20;
export const MIN_GAMES = 10;
export const MIN_DECISIONS = 300;
export const OBSERVED_MIN_GAMES = 30;
export const OBSERVED_MIN_DECISIONS = 1000;
export const BOOTSTRAP_ITERATIONS = 2000;

export const PIECE_VALUE = Object.freeze({
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
});

/** Frozen detector. It is never fit on a cohort it evaluates. */
export const DETECTOR = Object.freeze({
  id: DETECTOR_ID,
  lossThreshold: LOSS_THRESHOLD,
  pieceValueMin: PIECE_CAPTURE_MIN,
  fitCohortId: null,
  adjustable: false,
  event:
    "Decisión propia, pérdida evaluativa >= 120 con el presupuesto fijo, y la respuesta principal del rival es captura, jaque o mate.",
});

export const TRANSFER_ANALYSIS_CONFIG = Object.freeze({
  id: ANALYSIS_CONFIG_ID,
  detectorId: DETECTOR_ID,
  filterRulesId: FILTER_RULES_ID,
  phaseProxyId: PHASE_PROXY_ID,
  confirmPolicyId: CONFIRM_POLICY_ID,
  shallow: BUDGET_SHALLOW,
  deep: BUDGET_DEEP,
  lossThreshold: LOSS_THRESHOLD,
  confirmationBand: CONFIRM_BAND,
  threads: 1,
  hashMb: 128,
  clearHash: true,
  searchMethod: "uci-searchmoves",
  mateScore: 100000,
  pov: "side-to-move",
});

export function analysisFingerprint(config = TRANSFER_ANALYSIS_CONFIG) {
  const c = config;
  return [
    c.id,
    c.detectorId,
    c.filterRulesId,
    c.phaseProxyId,
    c.confirmPolicyId,
    c.shallow.id,
    c.shallow.nodes,
    c.deep.id,
    c.deep.nodes,
    c.lossThreshold,
    c.confirmationBand.join("-"),
    c.threads,
    c.hashMb,
    String(c.clearHash),
    c.searchMethod,
    c.mateScore,
    c.pov,
  ].join("|");
}

export const FINGERPRINT = analysisFingerprint();
