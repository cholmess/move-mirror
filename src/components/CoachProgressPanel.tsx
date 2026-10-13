import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { fetchCoachProgress, fetchValidationStatus, type CoachProgressDto } from "../api/coachClient";

export function CoachProgressPanel() {
  const { t } = useTranslation(["coach", "profile"]);
  const [progress, setProgress] = useState<CoachProgressDto | null>(null);
  const [coachDose, setCoachDose] = useState<{ qualified: boolean; qualifiedAt: string | null } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [p, v] = await Promise.all([fetchCoachProgress(), fetchValidationStatus()]);
        setProgress(p.progress);
        setCoachDose(v.coachDose ?? null);
      } catch {
        setProgress(null);
      }
    })();
  }, []);

  return (
    <section className="card" data-testid="coach-progress-panel">
      <h2>{t("coach:progressTitle")}</h2>
      <p className="muted small">{t("coach:progressSubtitle")}</p>
      <ul className="stat-list">
        <li>
          {t("coach:channelAssisted")}:{" "}
          {progress?.assistedPractice?.workedExampleCompleted
            ? t("coach:statusRecorded")
            : t("coach:statusPending")}
          {progress?.assistedPractice?.maxHintLevel != null
            ? ` · ${t("coach:channelHints", { level: progress.assistedPractice.maxHintLevel })}`
            : ""}
        </li>
        <li>
          {t("coach:channelIndependentPractice")}:{" "}
          {progress?.independentPractice?.firstAttemptSuccess == null
            ? t("coach:statusPending")
            : progress.independentPractice.firstAttemptSuccess
              ? t("coach:statusPass")
              : t("coach:statusNeedsWork")}
        </li>
        <li data-testid="coach-generalization-status">
          {t("coach:channelGeneralization")}:{" "}
          {progress?.generalization?.holdoutFirstAttemptSuccess == null
            ? t("coach:statusPending")
            : progress.generalization.exposureUncertainty
              ? `${t("coach:statusRecorded")} · ${t("coach:noveltyNotConfirmed")}`
              : progress.generalization.protectedGeneralizationEligible
                ? t("coach:statusPass")
                : t("coach:statusNeedsWork")}
        </li>
        <li>
          {t("coach:channelRetentionProgress")}:{" "}
          {progress?.retention?.completed
            ? progress.retention.firstAttemptSuccess
              ? t("coach:statusPass")
              : t("coach:statusNeedsWork")
            : progress?.retention?.dueAt
              ? t("coach:retentionScheduled", { date: progress.retention.dueAt })
              : t("coach:statusPending")}
        </li>
        <li>
          {t("coach:channelRealGames")}:{" "}
          {coachDose?.qualified
            ? t("coach:coachDoseReady", { date: coachDose.qualifiedAt ?? "—" })
            : t("coach:coachDosePending")}
        </li>
      </ul>
      {progress?.hypotheses?.length ? (
        <details>
          <summary>{t("coach:hypothesesTitle")}</summary>
          <ul className="stat-list small">
            {progress.hypotheses.map((h, idx) => (
              <li key={`${h.branch}-${idx}`}>
                {t("coach:hypothesisLine", { branch: h.branch ?? "—" })} · {t(h.tentativeKey ?? "coach:hypothesis.tentative")}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <Link className="btn btn-primary" to="/">
        {t("coach:backToday")}
      </Link>
    </section>
  );
}
