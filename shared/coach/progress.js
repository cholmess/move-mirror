import { holdoutGeneralizationEvidence } from "./candidate-verify.js";

export function buildCoachProgressFromSession(session) {
  if (!session) return null;
  const events = session.events ?? [];
  const hints = events.filter((e) => e.type === "coach_hint");
  const practice = events.find((e) => e.type === "coach_practice_attempt" && e.firstAttempt);
  const holdout = events.find((e) => e.type === "coach_holdout_attempt" && e.firstAttempt);
  const retention = events.find((e) => e.type === "coach_retention_attempt" && e.firstAttempt);
  const hypotheses = events.filter((e) => e.type === "coach_hypothesis_evidence");
  const generalization = holdoutGeneralizationEvidence({ holdoutAttempt: holdout });

  return {
    assistedPractice: {
      maxHintLevel: hints.reduce((max, e) => Math.max(max, e.hintLevel ?? 0), 0),
      workedExampleCompleted: events.some((e) => e.type === "coach_worked_completed"),
    },
    independentPractice: {
      firstAttemptSuccess:
        practice && practice.countsForPracticeLearning !== false
          ? Boolean(practice.success && (practice.hintLevel ?? 0) === 0)
          : practice
            ? false
            : null,
      hintLevel: practice?.hintLevel ?? null,
      verificationStatus: practice?.verificationStatus ?? null,
    },
    generalization,
    retention: {
      dueAt: session.retentionDueAt ?? null,
      completed: Boolean(session.retentionCompleted),
      firstAttemptSuccess: retention ? Boolean(retention.success && (retention.hintLevel ?? 0) === 0) : null,
    },
    hypotheses: hypotheses.map((e) => ({
      branch: e.branch,
      selfReport: e.selfReport,
      taskSuccess: e.taskSuccess,
      tentativeKey: e.tentativeKey,
    })),
    realGames: {
      noteKey: "coach:realGamesChannelNote",
      qualifiedForTransfer: Boolean(session.coachDoseQualified),
    },
  };
}
