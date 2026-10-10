import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { fetchTransferState } from "../api/transferClient";
import type { TransferState } from "../types/transfer";
import { primaryPattern } from "../data/pattern";
import { microLesson } from "../data/microlesson";
import { coreExercises, exercises, dataManifest } from "../data/exercises";
import { useApp } from "../context/AppContext";
import { getExercise } from "../data/exercises";
import { buildDefenseProfile } from "../domain/defenseProfile";
import {
  formatDateTime,
  formatComparisonStatus,
  formatDefenseProfileText,
  formatDefenseSelectionReason,
  formatEvidenceLevel,
  formatExposureStatus,
  formatNumber,
  formatPedagogyActionExplanation,
  formatPedagogyActionTitle,
  formatSelectionReasons,
  formatSideToMove,
} from "../i18n/presenters";
import { selectNextExercise } from "../domain/adaptive";
import { TechnicalDetails, TechnicalRow } from "./TechnicalDetails";

export function Dashboard() {
  const { t, i18n } = useTranslation(["dashboard", "common", "lesson", "technical", "defense"]);
  const { state } = useApp();
  const ev = primaryPattern.evidence;
  const locale = i18n.language as "es" | "en" | "de";
  const currentId = state.progress.currentExerciseId;
  const currentEx = currentId ? getExercise(currentId) : exercises[0];

  const lessonDone = !!state.progress.lessonCompletedAt;
  const solvedCount = state.progress.exercisesCompleted.length;
  const [transfer, setTransfer] = useState<TransferState | null>(null);
  const defense = buildDefenseProfile(state.defenseLab.attempts);
  const defenseText = formatDefenseProfileText(defense, locale);
  const nextSel = useMemo(() => selectNextExercise(state), [state]);

  useEffect(() => {
    fetchTransferState().then(setTransfer).catch(() => setTransfer(null));
  }, []);

  const pedagogyAction = transfer?.pedagogy?.action ?? "continue_cct";

  return (
    <div className="page dashboard">
      <section className="hero-card">
        <p className="eyebrow">{t("dashboard:practiceNowEyebrow")}</p>
        <h1>{t("dashboard:patternTitle")}</h1>
        <p className="lead">{t("dashboard:patternLead")}</p>
        <div className="confidence-row">
          <span className="badge badge-high">
            {formatEvidenceLevel(primaryPattern.patternConfidence === "alta" ? "high" : "medium", locale)}
          </span>
          <span className="badge badge-medium">
            {t("common:pedagogyLabels.possibleExplanation")}:{" "}
            {formatEvidenceLevel(primaryPattern.hypothesisConfidence === "media" ? "medium" : "high", locale)}
          </span>
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <h2>{t("common:pedagogyLabels.whatWeSee")}</h2>
          <ul className="stat-list">
            <li>
              {t("dashboard:evidenceDiscovery", {
                positions: ev.discoveryPositions,
                games: ev.discoveryGames,
                pct: ev.pctDiscovery,
              })}
            </li>
            <li>
              {t("dashboard:evidenceValidation", {
                positions: ev.validationPositions,
                games: ev.validationGames,
                pct: ev.pctValidation,
              })}
            </li>
            <li>
              {t("dashboard:evidenceSample", {
                games: ev.sampleGames,
                decisions: formatNumber(ev.sampleDecisions, locale),
              })}
            </li>
          </ul>
          <p className="muted small">
            {t("dashboard:evidenceFootnote", { hypothesis: t("dashboard:patternHypothesis") })}
          </p>
          <p className="muted tiny">{t("common:evidence.hint")}</p>
        </section>

        <section className="card">
          <h2>{t("dashboard:progressTitle")}</h2>
          <div className="progress-blocks">
            <div>
              <span className="progress-label">{t("dashboard:lessonStatus")}</span>
              <span>{lessonDone ? t("dashboard:lessonDone") : t("dashboard:lessonPending")}</span>
            </div>
            <div>
              <span className="progress-label">{t("dashboard:exercisesSolved")}</span>
              <span>
                {t("dashboard:exercisesCore", {
                  solved: solvedCount,
                  core: coreExercises.length,
                  total: exercises.length,
                })}
              </span>
            </div>
            <div>
              <span className="progress-label">{t("dashboard:attemptsLogged")}</span>
              <span>{state.attempts.length}</span>
            </div>
          </div>
          {currentEx && (
            <div className="next-box">
              <p className="small muted">{t("dashboard:nextExercise")}</p>
              <p>
                {t("dashboard:moveLabel", {
                  number: currentEx.moveNumber,
                  side: formatSideToMove(currentEx.sideToMove, locale),
                })}
              </p>
              {state.progress.lastSelectionReason && (
                <p className="reason">{formatSelectionReasons(nextSel.reasons, locale)}</p>
              )}
            </div>
          )}
          <div className="actions">
            {!lessonDone && (
              <Link className="btn primary" to="/lesson">
                {t("dashboard:startLesson")}
              </Link>
            )}
            <Link className="btn" to="/train">
              {t("dashboard:trainNow")}
            </Link>
            <Link className="btn" to="/import">
              {t("dashboard:importGames")}
            </Link>
            <Link className="btn" to="/games">
              {t("dashboard:library")}
            </Link>
          </div>
        </section>
      </div>

      <section className="card">
        <h2>{t("dashboard:newGamesTitle")}</h2>
        <ul className="stat-list">
          <li>
            {t("dashboard:trainingStatus")}:{" "}
            {state.interventionQualification.qualified
              ? t("dashboard:trainingComplete")
              : t("dashboard:trainingInProgress")}
          </li>
          <li>
            {t("dashboard:nextGroup")}:{" "}
            {state.interventionQualification.qualified
              ? t("dashboard:nextGroupEnabled")
              : t("dashboard:nextGroupDisabled")}
          </li>
          <li>
            {t("dashboard:exposureValidity")}:{" "}
            {formatExposureStatus(transfer?.currentExposureAudit?.exposureValidity ?? "exposure_unknown", locale)}
          </li>
          <li>
            {t("dashboard:recommendation")}: {formatPedagogyActionTitle(pedagogyAction, locale)}
          </li>
        </ul>
        {transfer?.comparison ? (
          <p>
            {t("dashboard:comparisonLine", {
              label: formatComparisonStatus(transfer.comparison.status, locale).label,
              transferRate: formatNumber(transfer.comparison.transfer.eventsPer100 ?? 0, locale, {
                maximumFractionDigits: 1,
              }),
              baselineRate: formatNumber(transfer.comparison.baseline.eventsPer100 ?? 0, locale, {
                maximumFractionDigits: 1,
              }),
            })}
          </p>
        ) : (
          <p>
            {transfer?.sync.lastSyncedAt
              ? t("dashboard:comparisonPendingSync")
              : t("dashboard:comparisonNone")}
          </p>
        )}
        <p className="muted small">
          {t("dashboard:lastSync")}:{" "}
          {transfer?.sync.lastSyncedAt
            ? formatDateTime(transfer.sync.lastSyncedAt, locale)
            : t("dashboard:neverSynced")}
          . {t("dashboard:validNewGames")}: {transfer?.includedCount ?? 0}. {t("dashboard:excludedGames")}:{" "}
          {transfer?.excludedCount ?? 0}.
        </p>
        {transfer?.pedagogy && (
          <p>{formatPedagogyActionExplanation(transfer.pedagogy.action, locale)}</p>
        )}
        <Link className="btn" to="/transfer">
          {t("dashboard:viewNewGames")}
        </Link>
        <TechnicalDetails>
          <TechnicalRow label={t("technical:detector")} value={transfer?.detectorId} />
          <TechnicalRow label={t("technical:patternId")} value={primaryPattern.id} />
        </TechnicalDetails>
      </section>

      <section className="card">
        <p className="eyebrow">{t("dashboard:defenseChannelEyebrow")}</p>
        <h2>{t("dashboard:defenseTitle")}</h2>
        <p className="muted">{t("dashboard:defenseSubtitle")}</p>
        <p>
          {t("dashboard:defenseNext", { session: state.defenseLab.sessionExerciseIds.length + 1 })}
        </p>
        <p className="reason">
          {state.defenseLab.lastSelectionReason
            ? formatDefenseSelectionReason(state.defenseLab.lastSelectionReason, locale)
            : t("dashboard:defenseDefaultReason")}
        </p>
        <p>
          <strong>{t("common:pedagogyLabels.possibleExplanation")}:</strong> {defenseText.hypothesis}
        </p>
        <p className="muted small">
          {t("common:pedagogyLabels.howMuchEvidence")}:{" "}
          {formatEvidenceLevel(defense.confidence as "baja" | "media" | "alta", locale)}.
        </p>
        <Link className="btn" to="/defense">
          {t("dashboard:defensePractice")}
        </Link>
      </section>

      <section className="card">
        <h2>{t("dashboard:skillsEyebrow")}</h2>
        <div className="skills-grid">
          {[
            { id: 1, name: t("dashboard:skill1Name"), desc: t("dashboard:skill1Desc") },
            { id: 2, name: t("dashboard:skill2Name"), desc: t("dashboard:skill2Desc") },
            { id: 3, name: t("dashboard:skill3Name"), desc: t("dashboard:skill3Desc") },
          ].map((sk, index) => {
            const skillId = ["cct-opponent-refutation", "forced-candidate-generation", "capture-recapture-check"][index]!;
            const st = state.skills[skillId as keyof typeof state.skills];
            const pct = Math.round((st?.masteryEstimate ?? 0) * 100);
            const initial = [0.85, 0.72, 0.7][index]!;
            return (
              <article key={sk.id} className="skill-card">
                <h3>{sk.name}</h3>
                <p className="small">{sk.desc}</p>
                <div className="meter">
                  <div className="meter-fill" style={{ width: `${pct}%` }} />
                </div>
                <p className="mono small">
                  {t("profile:estimatedLevel", { ns: "profile" })} {pct}% · {t("profile:evidenceAmount", { ns: "profile" })}{" "}
                  {Math.round((st?.confidence ?? initial) * 100)}%
                </p>
              </article>
            );
          })}
        </div>
      </section>

      <p className="muted small center">
        {t("dashboard:footerMeta", {
          lessonTitle: t("lesson:title", { ns: "lesson" }),
          core: dataManifest.counts.core,
          pool: dataManifest.counts.pool,
          motif: dataManifest.poolFilter.motif,
        })}
      </p>
      <TechnicalDetails>
        <TechnicalRow label={t("technical:id")} value={microLesson.id} />
      </TechnicalDetails>
    </div>
  );
}
