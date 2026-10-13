import { assertEvalContentIndependent } from "../../shared/coach/holdout-verify.js";

/** Server-only evaluation positions. Never import from client code. */
const HOLDOUT = {
  contentId: "coach-holdout-crt-v2-002",
  sourceKey: "d7d7d006-abd3-11f1-8acf-f45fe701000f:17",
  fen: "r2qkb1r/ppp2pp1/2npb2p/3Np3/2B1P3/3P1Q2/PPP2PPP/R3K1NR w KQkq - 4 9",
  sideToMove: "w",
  playedMoveUci: "g1h3",
  referenceCandidateUci: "d5f6",
  acceptableCandidates: ["d5f6", "d5b6", "d5c7", "c4d5", "f1e1"],
  refutationsByCandidate: {
    g1h3: ["e6h3"],
  },
  defaultRefutations: ["e6h3"],
  bundleExposure: "not_in_generated_exercise_fen_set",
};

const RETENTION = {
  contentId: "coach-retention-crt-v2-001",
  sourceKey: "d7d7d006-abd3-11f1-8acf-f45fe701000f:41",
  fen: "2kr1b1r/1p3p2/p1pp4/4p3/4P1Nq/1PPP3P/1P4P1/R2Q1RK1 w - - 0 21",
  sideToMove: "w",
  playedMoveUci: "g4e3",
  referenceCandidateUci: "d1d2",
  acceptableCandidates: ["d1d2", "d1e1", "d1c1", "d1b1"],
  refutationsByCandidate: {
    g4e3: ["h4h3"],
  },
  defaultRefutations: ["h4h3"],
  bundleExposure: "not_in_generated_exercise_fen_set",
};

function verifyOnBoot() {
  for (const content of [HOLDOUT, RETENTION]) {
    const report = assertEvalContentIndependent({
      fen: content.fen,
      sourceExerciseId: content.sourceKey,
    });
    if (!report.ok) {
      throw new Error(`coach_eval_content_compromised:${content.contentId}:${report.issues.join(",")}`);
    }
  }
}

verifyOnBoot();

export function holdoutSecrets() {
  return HOLDOUT;
}

export function retentionSecrets() {
  return RETENTION;
}

export function holdoutPublicDto() {
  const { contentId, fen, sideToMove } = HOLDOUT;
  return { contentId, fen, sideToMove };
}

export function retentionPublicDto() {
  const { contentId, fen, sideToMove } = RETENTION;
  return { contentId, fen, sideToMove };
}
