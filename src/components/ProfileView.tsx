import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { visibleSkills } from "../data/skills";
import { useApp } from "../context/AppContext";
import { aggregateEvidence } from "../domain/profile";
import { exportAttempts } from "../storage/persistence";
import { FUTURE_MODULES } from "../contracts/future";
import { PATTERN_ID } from "../data/constants";
import { fetchTransferState } from "../api/transferClient";
import type { TransferState } from "../types/transfer";
import { summarizeTraining } from "@shared/transfer/pedagogy.js";
import { buildDefenseProfile } from "../domain/defenseProfile";
import { Link } from "react-router-dom";
import { PlayerIdentitySection } from "./PlayerIdentitySection";
import { LanguageSelector } from "./LanguageSelector";
import {
  formatComparisonStatus,
  formatDate,
  formatDateTime,
  formatDefenseProfileText,
  formatDefensiveResource,
  formatEvaluationStatus,
  formatEvidenceLevel,
  formatExposureStatus,
  formatProfileHistoryEvent,
} from "../i18n/presenters";
import type { SupportedLocale } from "../i18n/types";
import { TechnicalDetails, TechnicalRow } from "./TechnicalDetails";
import { CoachProgressPanel } from "./CoachProgressPanel";

const SKILL_I18N: Record<string, { name: string; desc: string }> = {
  "cct-opponent-refutation": { name: "dashboard:skill1Name", desc: "dashboard:skill1Desc" },
  "forced-candidate-generation": { name: "dashboard:skill2Name", desc: "dashboard:skill2Desc" },
  "capture-recapture-check": { name: "dashboard:skill3Name", desc: "dashboard:skill3Desc" },
};

export function ProfileView() {
  const { t, i18n } = useTranslation(["profile", "dashboard", "common", "transfer", "technical"]);
  const locale = i18n.language as SupportedLocale;
  const { state, resetAll } = useApp();

  const [transfer, setTransfer] = useState<TransferState | null>(null);
  useEffect(() => {
    fetchTransferState().then(setTransfer).catch(() => setTransfer(null));
  }, []);

  const training = useMemo(() => {
    const related = state.attempts.filter(
      (attempt) => attempt.patternId === PATTERN_ID || attempt.skillIds.includes(PATTERN_ID),
    );
    const count = (status: string) => related.filter((attempt) => attempt.evaluationStatus === status).length;
    return summarizeTraining({
      verified_best: count("verified_best"),
      verified_acceptable: count("verified_acceptable"),
      playable_inexact: count("playable_inexact"),
      incorrect: count("incorrect"),
      unverified: count("unverified"),
      attempts: related.length,
      mastery: state.skills[PATTERN_ID]?.masteryEstimate ?? null,
      nextReviewAt: state.skills[PATTERN_ID]?.nextReviewAt ?? null,
    });
  }, [state.attempts, state.skills]);

  const defense = useMemo(() => buildDefenseProfile(state.defenseLab.attempts), [state.defenseLab.attempts]);
  const defenseText = formatDefenseProfileText(defense, locale);
  const comparisonLabel = transfer?.comparison
    ? formatComparisonStatus(transfer.comparison.status, locale).label
    : t("transfer:comparison.insufficient_data.label");

  const downloadLog = () => {
    const blob = new Blob([exportAttempts(state)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `move-mirror-attempts-${state.username}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page profile">
      <div className="profile-head">
        <div>
          <h1>{t("title")}</h1>
          <p className="muted">{t("subtitle")}</p>
        </div>
        <LanguageSelector compact />
      </div>

      <PlayerIdentitySection />

      <CoachProgressPanel />

      <details className="card">
        <summary>{t("profile:legacyMasteryTitle")}</summary>
        <p className="muted small">{t("profile:legacyMasteryHint")}</p>
        <div className="skills-grid">
          {visibleSkills.map((sk) => {
            const st = state.skills[sk.id];
            const agg = aggregateEvidence(sk.id, state.attempts);
            const labels = SKILL_I18N[sk.id];
            return (
              <article key={sk.id} className="card skill-detail">
                <h2>{labels ? t(labels.name) : sk.name}</h2>
                {labels && <p className="small muted">{t(labels.desc)}</p>}
                <ul className="stat-list small">
                  <li>
                    {t("reviewEvidence")}: {t("positionsValidation", { count: agg.reviewEvidence.validationPositions })}{" "}
                    · {t("practiceAttempts")}: {t("attemptsCount", { count: agg.practiceAttempts })}
                  </li>
                  <li>
                    {t("lastPractice")}:{" "}
                    {st?.lastPracticeAt ? formatDateTime(st.lastPracticeAt, locale) : t("common:dash")}
                  </li>
                </ul>
                <TechnicalDetails>
                  <TechnicalRow
                    label={t("technical:alphaBeta")}
                    value={st ? `α=${st.alpha.toFixed(1)}, β=${st.beta.toFixed(1)}` : undefined}
                  />
                  <TechnicalRow
                    label={t("profile:legacyMasteryEstimate")}
                    value={st ? `${Math.round(st.masteryEstimate * 100)}%` : t("common:dash")}
                  />
                </TechnicalDetails>
                {st && st.history.length > 1 && (
                  <ul className="mono tiny">
                    {st.history.slice(-3).map((h) => (
                      <li key={h.at + h.event}>
                        {formatDate(h.at, locale)} — {formatProfileHistoryEvent(h.event, locale)}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
        </div>
      </details>

      <section className="card">
        <h2>{t("threeChannelsTitle")}</h2>
        <p className="muted small">{t("threeChannelsHint")}</p>
        <ul className="stat-list">
          <li>
            {t("exercisesLine", {
              best: training.verified_best,
              acceptable: training.verified_acceptable,
              imprecise: training.playable_inexact,
              incorrect: training.incorrect,
            })}
          </li>
          <li>{t("realGamesLine", { label: comparisonLabel })}</li>
          <li>
            {t("profile:legacyDose")}:{" "}
            {state.interventionQualification.qualified
              ? t("transfer:trainingChannel.doseComplete", {
                  date: formatDateTime(state.interventionQualification.qualifiedAt!, locale),
                })
              : t("transfer:trainingChannel.doseInProgress")}
          </li>
          <li>
            {t("cohortValidity")}:{" "}
            {formatExposureStatus(transfer?.currentExposureAudit?.exposureValidity ?? "exposure_unknown", locale)}
          </li>
          <li>
            {t("lastSync")}:{" "}
            {transfer?.sync.lastSyncedAt
              ? formatDateTime(transfer.sync.lastSyncedAt, locale)
              : t("common:dash")}
          </li>
        </ul>
        <div className="actions">
          <Link className="btn" to="/games">
            {t("dashboard:library")}
          </Link>
          <Link className="btn" to="/import">
            {t("dashboard:importGames")}
          </Link>
        </div>
      </section>

      <section className="card">
        <h2>{t("learningLogTitle")}</h2>
        {state.attempts.length === 0 ? (
          <p className="muted">{t("noAttempts")}</p>
        ) : (
          <table className="attempts-table">
            <thead>
              <tr>
                <th>{t("tableDate")}</th>
                <th>{t("tableExercise")}</th>
                <th>{t("tableResult")}</th>
                <th>{t("tableMove")}</th>
                <th>{t("tableRefutationLogged")}</th>
              </tr>
            </thead>
            <tbody>
              {[...state.attempts].reverse().slice(0, 20).map((a) => (
                <tr key={a.id}>
                  <td>{formatDateTime(a.recordedAt, locale)}</td>
                  <td className="mono">{a.exerciseId}</td>
                  <td>{formatEvaluationStatus(a.evaluationStatus, locale)}</td>
                  <td>{a.chosenMoveSan}</td>
                  <td>{a.foundOpponentForcedResponse ? t("common:yes") : t("common:no")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <button type="button" className="btn" onClick={downloadLog}>
          {t("exportAttempts")}
        </button>
      </section>

      <section className="card">
        <h2>{t("defenseTitle")}</h2>
        <ul className="stat-list">
          <li>
            {t("defenseAttempted")}: {defense.positionsAttempted}
          </li>
          <li>
            {t("defenseVerified")}: {defense.verifiedResults}
          </li>
          <li>
            {t("defenseAcceptable")}: {Math.round(defense.acceptableRate * 100)}%
          </li>
          <li>
            {t("defenseResources")}:{" "}
            {defense.resourcesPracticed.map((r) => formatDefensiveResource(r, locale)).join(", ") || t("common:dash")}
          </li>
          <li>
            {t("lastPractice")}:{" "}
            {defense.lastPracticeAt ? formatDateTime(defense.lastPracticeAt, locale) : t("common:dash")}
          </li>
          <li>
            {t("nextReview")}:{" "}
            {defense.nextReviewAt ? formatDate(defense.nextReviewAt, locale) : t("common:dash")}
          </li>
        </ul>
        <p>
          <strong>{t("defenseObservation")}:</strong> {defenseText.observation}
        </p>
        <p>
          <strong>{t("defenseHypothesis")}:</strong> {defenseText.hypothesis}
        </p>
        <p className="muted small">
          {t("defenseEvidenceNote", {
            confidence: formatEvidenceLevel(defense.confidence as "baja" | "media" | "alta", locale),
          })}
        </p>
        {state.defenseLab.attempts.length > 0 && (
          <ul className="mono tiny">
            {state.defenseLab.attempts.slice(-5).reverse().map((attempt) => (
              <li key={attempt.attemptId}>
                {formatDate(attempt.confirmedAt, locale)} · {attempt.motif} ·{" "}
                {formatEvaluationStatus(attempt.evaluationStatus, locale)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card muted-arch">
        <h2>{t("futureArchTitle")}</h2>
        <ul>
          {Object.values(FUTURE_MODULES).map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <p className="small">{t("futureArchHint")}</p>
      </section>

      <button type="button" className="btn danger" onClick={resetAll}>
        {t("resetProgress")}
      </button>
    </div>
  );
}
