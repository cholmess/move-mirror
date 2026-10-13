import { describe, expect, it } from "vitest";
import { createCoachSession, applyCoachAction, publicView } from "./session.js";
import { assertEvalContentIndependent } from "./holdout-verify.js";
import { holdoutSecrets, retentionSecrets, holdoutPublicDto, retentionPublicDto } from "../../server/coach/eval-secrets.mjs";
import { coachDoseQualified } from "./planner.js";

const secrets = { holdout: holdoutSecrets(), retention: retentionSecrets() };

function act(session, action, body = {}) {
  return applyCoachAction(session, action, body, secrets).session;
}

describe("coach eval content", () => {
  it("keeps holdout and retention FENs out of client bundle", () => {
    expect(assertEvalContentIndependent({ fen: secrets.holdout.fen, sourceExerciseId: secrets.holdout.sourceKey }).ok).toBe(
      true,
    );
    expect(
      assertEvalContentIndependent({ fen: secrets.retention.fen, sourceExerciseId: secrets.retention.sourceKey }).ok,
    ).toBe(true);
  });
});

describe("coach session machine", () => {
  it("does not expose holdout refutation in public view", () => {
    const session = createCoachSession();
    session.phase = "holdout";
    session.holdoutStep = "candidate";
    session.holdout = { started: true, firstAttemptLocked: false, revealed: false };
    const view = publicView(session, holdoutPublicDto(), retentionPublicDto());
    const serialized = JSON.stringify(view);
    for (const token of secrets.holdout.defaultRefutations) {
      expect(serialized).not.toContain(token);
    }
  });

  it("locks holdout first attempt and reveals only generic feedback", () => {
    let session = createCoachSession();
    session.phase = "holdout";
    session.holdoutStep = "candidate";
    session.holdout = { started: true, firstAttemptLocked: false, revealed: false };
    session = act(session, "submit_move", { from: "g1", to: "h3", moveRole: "candidate" });
    expect(session.holdout.firstAttemptLocked).toBe(true);
    const replyFrom = "e6";
    const replyTo = "h3";
    const result = applyCoachAction(
      session,
      "submit_move",
      { from: replyFrom, to: replyTo, moveRole: "hostile_reply" },
      secrets,
    );
    expect(result.feedback.reveal?.genericKey).toBe("coach:holdoutRevealGeneric");
    expect(result.feedback.reveal?.primaryRefutationSan).toBeUndefined();
  });

  it("requires contrast before worked example path", () => {
    let session = createCoachSession();
    expect(session.phase).toBe("signal");
    session = act(session, "continue");
    expect(session.phase).toBe("contrast_safe");
  });

  it("records hypothesis evidence after probe task without definitive diagnosis", () => {
    let session = createCoachSession();
    session.phase = "probe_task";
    session.branch = "recognition";
    session.events.push({
      type: "coach_probe_self",
      answer: "not_seen",
      idempotencyKey: "probe:1",
    });
    const result = applyCoachAction(
      session,
      "submit_move",
      { from: "h2", to: "g4", moveRole: "hostile_reply" },
      secrets,
    );
    expect(result.session.events.some((e) => e.type === "coach_hypothesis_evidence")).toBe(true);
    expect(result.session.hypothesis?.status).toBe("tentative");
  });

  it("qualifies dose only after full v2 requirements", () => {
    const session = createCoachSession();
    expect(coachDoseQualified(session).qualified).toBe(false);
  });

  it("off-script explore candidate stays unverified without engine and does not count as success", () => {
    let session = createCoachSession();
    session.phase = "explore";
    session.exploreCandidateUci = "a8b8";
    session.exploreFen = "1r2r1k1/2p1n1p1/3p3p/1pb1p2P/p3Pq2/P1P2N2/RP3PPN/3Q1RK1 w - - 1 21";
    session.exploreReplyPending = true;
    const result = applyCoachAction(
      session,
      "submit_move",
      { from: "d1", to: "d2", moveRole: "hostile_reply" },
      secrets,
    );
    const attempt = result.session.events.find((e) => e.type === "coach_explore_attempt");
    expect(attempt.verificationStatus).toBe("unverified");
    expect(attempt.success).toBe(false);
    expect(attempt.countsForPracticeLearning).toBe(false);
  });

  it("holdout attempt records exposure uncertainty and excludes protected generalization", () => {
    let session = createCoachSession();
    session.phase = "holdout";
    session.holdoutStep = "reply";
    session.holdoutCandidateUci = "d5f6";
    session.holdout = { started: true, firstAttemptLocked: true, revealed: false };
    const result = applyCoachAction(
      session,
      "submit_move",
      { from: "d8", to: "f6", moveRole: "hostile_reply" },
      secrets,
    );
    const attempt = result.session.events.find((e) => e.type === "coach_holdout_attempt");
    expect(attempt.historicalExposureUncertain).toBe(true);
    expect(attempt.countsForProtectedGeneralization).toBe(false);
  });
});
