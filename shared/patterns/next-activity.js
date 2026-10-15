import { isReviewDue } from "./scheduler.js";
import { SESSION_FATIGUE_POSITIONS } from "./learning-config.js";

/**
 * Transparent next-activity selection (testable, no opaque ML).
 * @param {{ patterns: Array<{ id: string, priority: number, status: string, practice: object }>, domains: Record<string, { nextReviewAt: string | null, lifecycle: string, confidence: number }>, activeSession: { patternId: string, positionRecordIds: string[] } | null, planPriorities: string[], sessionPositionsThisPattern: number, now: number }}
 */
export function selectNextActivity({
  patterns,
  domains,
  activeSession,
  planPriorities,
  sessionPositionsThisPattern = 0,
  now = Date.now(),
}) {
  const reasons = [];
  const recurrent = patterns.filter((p) => p.status === "recurrent");
  const due = recurrent
    .filter((p) => isReviewDue(domains[p.id]?.nextReviewAt ?? p.practice?.nextReviewAt, now))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  if (due[0]) {
    reasons.push({ key: "nextActivity.dueReview", params: { patternId: due[0].id } });
    return { kind: "pattern", patternId: due[0].id, href: null, reasons };
  }
  if (activeSession && sessionPositionsThisPattern < SESSION_FATIGUE_POSITIONS) {
    reasons.push({ key: "nextActivity.continueSession", params: { patternId: activeSession.patternId } });
    return { kind: "continue_session", patternId: activeSession.patternId, href: null, reasons };
  }
  const planPick = planPriorities.find((id) => recurrent.some((p) => p.id === id));
  if (planPick) {
    reasons.push({ key: "nextActivity.planPriority", params: { patternId: planPick } });
    return { kind: "pattern", patternId: planPick, href: null, reasons };
  }
  const lowConfidence = recurrent
    .filter((p) => (domains[p.id]?.confidence ?? 0.5) < 0.55)
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  if (lowConfidence) {
    reasons.push({ key: "nextActivity.lowConfidence", params: { patternId: lowConfidence.id } });
    return { kind: "pattern", patternId: lowConfidence.id, href: null, reasons };
  }
  reasons.push({ key: "nextActivity.none" });
  return { kind: "finish", patternId: null, href: "/coach", reasons };
}
