import { describe, expect, it } from "vitest";
import { calculateCoachDoseQualification } from "./dose.js";
import { COACH_DOSE_PROTOCOL_ID } from "./constants.js";

describe("coach dose v2", () => {
  it("does not inherit legacy exercise thresholds", () => {
    const q = calculateCoachDoseQualification([]);
    expect(q.protocolId).toBe(COACH_DOSE_PROTOCOL_ID);
    expect(q.missingRequirements).toContain("coach_session_completed");
    expect(q.missingRequirements).not.toContain("confirmed_exercises:0/12");
  });

  it("qualifies only after retention without hints", () => {
    const events = [
      {
        eventId: "1",
        occurredAt: "2026-10-01T10:00:00.000Z",
        type: "coach_session_completed",
        payload: { sessionId: "s1", protocolId: "x", contrastCompleted: true, exitRuleRecorded: true },
      },
      {
        eventId: "2",
        occurredAt: "2026-10-01T10:05:00.000Z",
        type: "coach_holdout_recorded",
        payload: { sessionId: "s1", contentId: "h1", firstAttempt: true, success: true, hintLevel: 0 },
      },
      {
        eventId: "3",
        occurredAt: "2026-10-08T10:00:00.000Z",
        type: "coach_retention_recorded",
        payload: { sessionId: "s1", contentId: "r1", firstAttempt: true, success: true, hintLevel: 0 },
      },
    ];
    const q = calculateCoachDoseQualification(events);
    expect(q.qualified).toBe(true);
    expect(q.qualifiedAt).toBe("2026-10-08T10:00:00.000Z");
  });
});
