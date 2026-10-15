import { describe, expect, it } from "vitest";
import { classifyPracticeEvidence, sessionOutcomeKey } from "./evidence.js";
import { applyDomainEvidence, emptyPatternDomain } from "./mastery.js";
import { migrateLearningState } from "./migrate-learning.js";
import { selectNextActivity } from "./next-activity.js";
import { isReviewDue, reviewIntervalDays, scheduleNextReview } from "./scheduler.js";
import { completePracticeSession, createPracticeSession, planSessionLayout, planSessionPositions } from "./session.js";
import { positionKey } from "./detect.js";

const at = "2026-10-14T12:00:00Z";

describe("practice evidence rules", () => {
  it("does not let guided or assisted attempts affect domain", () => {
    expect(classifyPracticeEvidence({ role: "guided", verified: true, status: "verified_best", independent: false }).countsForDomain).toBe(false);
    expect(classifyPracticeEvidence({ role: "holdout", verified: true, status: "verified_best", independent: false, assisted: true }).countsForDomain).toBe(false);
  });
  it("counts independent verified holdout success and failure", () => {
    expect(classifyPracticeEvidence({ role: "holdout", verified: true, status: "verified_best", independent: true, assisted: false }).kind).toBe("independent_success");
    expect(classifyPracticeEvidence({ role: "holdout", verified: true, status: "incorrect", independent: true, assisted: false }).kind).toBe("independent_failure");
  });
  it("rejects repeated holdout positions", () => {
    expect(classifyPracticeEvidence({ role: "holdout", verified: true, status: "verified_best", independent: false, repeated: true }).kind).toBe("holdout_invalid");
  });
  it("treats unverified engine output as non-domain", () => {
    expect(classifyPracticeEvidence({ role: "holdout", verified: false, status: "unverified", independent: true }).kind).toBe("unverified");
  });
});

describe("domain mastery", () => {
  it("does not declare stable mastery after one independent success", () => {
    let domain = emptyPatternDomain("piece-loss", at);
    const evidence = classifyPracticeEvidence({ role: "holdout", verified: true, status: "verified_best", independent: true, assisted: false });
    domain = applyDomainEvidence(domain, evidence, { status: "verified_best", at, role: "holdout" });
    expect(domain.independentAttempts).toBe(1);
    expect(domain.lifecycle).toBe("learning");
  });
});

describe("scheduler", () => {
  it("shortens interval after independent failure", () => {
    const domain = { lifecycle: "review", masteryEstimate: 0.6 };
    expect(reviewIntervalDays(domain, { kind: "independent_failure" })).toBe(1);
    expect(reviewIntervalDays(domain, { kind: "independent_success" })).toBeGreaterThan(1);
  });
  it("marks overdue reviews as due", () => {
    expect(isReviewDue("2026-10-01T00:00:00Z", Date.parse("2026-10-14T00:00:00Z"))).toBe(true);
    expect(isReviewDue("2026-10-20T00:00:00Z", Date.parse("2026-10-14T00:00:00Z"))).toBe(false);
  });
  it("schedules from injectable clock", () => {
    const domain = { lifecycle: "learning", masteryEstimate: 0.5 };
    const next = scheduleNextReview(domain, { kind: "independent_success" }, at, Date.parse(at));
    expect(Date.parse(next)).toBe(Date.parse(at) + 2 * 86400000);
  });
});

describe("session completion idempotency", () => {
  it("does not double-apply domain updates", () => {
    const session = createPracticeSession("piece-loss", ["a", "b", "c"], { contentVersion: "v1", detectorVersion: "eng", at });
    const holdoutAttempt = { id: "att-1", at, status: "verified_best", assisted: false, repeated: false, verified: true, independent: true };
    const holdoutExercise = { id: "ex-h", recordId: "hold" };
    const first = completePracticeSession({ session, holdoutExercise, holdoutAttempt, patternDomains: {}, at, now: Date.parse(at) });
    const second = completePracticeSession({
      session: first.session,
      holdoutExercise,
      holdoutAttempt,
      patternDomains: { "piece-loss": first.domain },
      at,
      now: Date.parse(at),
    });
    expect(second.duplicate).toBe(true);
    expect(second.domain.independentAttempts).toBe(first.domain.independentAttempts);
  });
});

describe("next activity selection", () => {
  const patterns = [
    { id: "piece-loss", priority: 10, status: "recurrent", practice: { nextReviewAt: "2026-10-20T00:00:00Z", attempts: 2 } },
    { id: "closed-center", priority: 5, status: "recurrent", practice: { nextReviewAt: "2026-10-01T00:00:00Z", attempts: 1 } },
  ];
  it("prioritizes due review", () => {
    const pick = selectNextActivity({ patterns, domains: {}, planPriorities: ["piece-loss"], now: Date.parse("2026-10-14T00:00:00Z") });
    expect(pick.patternId).toBe("closed-center");
  });
});

function rows(n) {
  return Array.from({ length: n }, (_, i) => ({
    exerciseId: `e${i}`,
    fen: `4k${i + 1}/8/8/8/8/8/P7/4K3 w - - 0 1`,
    loss: 100 + i,
  }));
}

describe("session planning", () => {
  it("avoids duplicate FEN keys in one session", () => {
    const list = [
      { exerciseId: "1", fen: "a w - - 0 1", loss: 100 },
      { exerciseId: "2", fen: "a w - - 0 1", loss: 50 },
      { exerciseId: "3", fen: "b w - - 0 1", loss: 80 },
    ];
    const plan = planSessionPositions(list, []);
    expect(plan).toHaveLength(1);
    expect(plan.map(r => r.exerciseId)).toEqual(["1"]);
    const layout = planSessionLayout(list, []);
    expect(layout.ok).toBe(true);
    expect(layout.guided).toHaveLength(1);
    expect(layout.holdout.exerciseId).toBe("3");
  });

  it.each([
    [1, null, null, false],
    [2, 1, true, true],
    [3, 2, true, true],
    [4, 3, false, true],
    [6, 5, false, true],
  ])("%i unique positions → %s guided, shortfall=%s", (count, guidedCount, shortfall, ok) => {
    const layout = planSessionLayout(rows(count), []);
    if (!ok) {
      expect(layout.ok).toBe(false);
      expect(layout.error).toBe("insufficient_holdout_positions");
      return;
    }
    expect(layout.ok).toBe(true);
    expect(layout.guided).toHaveLength(guidedCount);
    expect(layout.sessionShortfall).toBe(shortfall);
    const guidedKeys = new Set(layout.guided.map((r) => positionKey(r.fen)));
    expect(guidedKeys.has(positionKey(layout.holdout.fen))).toBe(false);
  });
});

describe("independent failure updates domain evidence flag", () => {
  it("counts failed independent holdout as domain evidence", () => {
    const session = createPracticeSession("piece-loss", ["a", "b"], {
      contentVersion: "v1",
      detectorVersion: "eng",
      at,
      reservedHoldoutRecordId: "hold",
      sessionShortfall: true,
    });
    const holdoutAttempt = {
      id: "att-fail",
      at,
      status: "incorrect",
      assisted: false,
      repeated: false,
      verified: true,
      independent: true,
    };
    const completion = completePracticeSession({
      session,
      holdoutExercise: { id: "ex-h", recordId: "hold" },
      holdoutAttempt,
      patternDomains: {},
      at,
      now: Date.parse(at),
    });
    expect(completion.result.outcomeKey).toBe("needs_reinforcement");
    expect(completion.result.countsAsIndependentEvidence).toBe(true);
    expect(completion.domain.independentFailures).toBe(1);
    expect(completion.domain.independentAttempts).toBe(1);
    expect(completion.domain.beta).toBeGreaterThan(1);
    const next = scheduleNextReview(completion.domain, { kind: "independent_failure" }, at, Date.parse(at));
    expect(Date.parse(next) - Date.parse(at)).toBe(86400000);
  });
});

describe("learning state migration", () => {
  it("rebuilds domains from prior holdout attempts", () => {
    const state = migrateLearningState({
      attempts: [{ id: "a1", exerciseId: "e1", patternId: "piece-loss", at, verified: true, status: "verified_best", independent: true, assisted: false }],
      exercises: [{ id: "e1", role: "holdout", repeated: false }],
      patternDomains: {},
      practiceSessions: [],
    }, at);
    expect(state.patternDomains["piece-loss"].independentSuccesses).toBe(1);
  });
});

describe("session outcomes", () => {
  it("maps assisted holdout to learned with help", () => {
    const key = sessionOutcomeKey({
      holdoutEvidence: { kind: "holdout_invalid" },
      sessionAssisted: true,
      holdoutAttempt: { status: "incorrect" },
    });
    expect(key).toBe("learned_with_help");
  });
});
