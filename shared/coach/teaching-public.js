import { COACH_LESSON_SPEC_VERSION, COACH_PATTERN_ID, COACH_SKILL_ID } from "./constants.js";

/** Public lesson graph — no holdout solutions. Verified against deep-500k-v1 / exercises.core. */
export const WORKED_EXAMPLE = {
  contentId: "ex-184070622900-m20",
  lessonSpecVersion: COACH_LESSON_SPEC_VERSION,
  patternId: COACH_PATTERN_ID,
  skillId: COACH_SKILL_ID,
  gameUrl: "https://www.chess.com/game/live/184070622900",
  fen: "r4rk1/2p1n1p1/3p3p/1pb1p2P/p3Pq2/P1P2N2/RP3PPN/3Q1RK1 b - - 0 20",
  sideToMove: "b",
  playedMoveSan: "Qg4",
  playedMoveUci: "f4g4",
  primaryRefutationSan: "Nxg4",
  primaryRefutationUci: "h2g4",
  referenceCandidateSan: "Qxe4",
  referenceCandidateUci: "f4e4",
  signalSquares: ["g4"],
  hintSquares: ["h2", "g4"],
};

export const PRACTICE_EXAMPLE = {
  contentId: "ex-174256061220-m61",
  tier: "practice",
  fen: "8/1k6/8/pP6/P7/2R4r/2K5/8 b - - 0 61",
  sideToMove: "b",
  playedMoveSan: "Rxc3+",
  playedMoveUci: "h3c3",
  primaryRefutationSan: "Kxc3",
  primaryRefutationUci: "c2c3",
  referenceCandidateSan: "Rh4",
  referenceCandidateUci: "h3h4",
  /** Safe candidate: no immediate capture of the moved piece. */
  safeContrastCandidateSan: "Rh4",
  safeContrastCandidateUci: "h3h4",
};

export const SIGNAL_CONTRAST = {
  safeFen: "r4rk1/2p1n1p1/3p3p/1pb1p2P/p3Pq2/P1P2N2/RP3PPN/3Q1RK1 b - - 0 20",
  safeCandidateSan: "Qxe4",
  safeCandidateUci: "f4e4",
  safeAfterFen: null,
  unsafeCandidateSan: "Qg4",
  unsafeCandidateUci: "f4g4",
};

export function lessonHomePayload(evidence) {
  return {
    protocolId: COACH_LESSON_SPEC_VERSION,
    skillId: COACH_SKILL_ID,
    patternId: COACH_PATTERN_ID,
    focusTitleKey: "coach:focusTitle",
    whyNowKey: "coach:whyNow",
    learnTodayKey: "coach:learnToday",
    applyRuleKey: "coach:applyRulePreview",
    evidence,
    estimatedMinutes: 8,
  };
}
