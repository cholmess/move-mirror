import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useApp } from "../context/AppContext";
import { APP_VERSION, PATTERN_ID } from "../data/constants";
import {
  cancelTransfer,
  fetchExamples,
  fetchTransferState,
  freezeTransfer,
  postTrainingSummary,
  promoteTransfer,
  resumeTransfer,
  startTransferSync,
} from "../api/transferClient";
import { combinedNarrative, decidePedagogy, summarizeTraining } from "@shared/transfer/pedagogy.js";
import type { TransferExample, TransferState } from "../types/transfer";
import {
  formatComparisonStatus,
  formatDateTime,
  formatErrorCode,
  formatExposureStatus,
  formatInterventionRequirement,
  formatNumber,
  formatPedagogyActionExplanation,
  formatPedagogyActionTitle,
  formatPhase,
  formatTransferExclusion,
} from "../i18n/presenters";
import type { SupportedLocale } from "../i18n/types";
import { TechnicalDetails, TechnicalRow } from "./TechnicalDetails";

function trainingFromState(
  attempts: { skillIds: string[]; patternId: string; evaluationStatus: string }[],
  mastery: number | null,
  nextReviewAt: string | null,
) {
  const related = attempts.filter(
    (attempt) => attempt.patternId === PATTERN_ID || attempt.skillIds.includes(PATTERN_ID),
  );
  const count = (status: string) => related.filter((attempt) => attempt.evaluationStatus === status).length;
  return {
    verified_best: count("verified_best"),
    verified_acceptable: count("verified_acceptable"),
    playable_inexact: count("playable_inexact"),
    incorrect: count("incorrect"),
    unverified: count("unverified"),
    attempts: related.length,
    mastery,
    nextReviewAt,
  };
}

function formatRate(value: number | null, locale: SupportedLocale) {
  if (value === null || Number.isNaN(value)) return "—";
  return formatNumber(value, locale, { maximumFractionDigits: 1 });
}

export function TransferView() {
  const { t, i18n } = useTranslation(["transfer", "common", "technical", "errors"]);
  const locale = i18n.language as SupportedLocale;
  const { state } = useApp();
  const [data, setData] = useState<TransferState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [examples, setExamples] = useState<TransferExample[]>([]);
  const [busy, setBusy] = useState(false);

  const explainTransferError = (err: unknown, fallbackKey: string) => {
    const code = err instanceof Error ? err.message : "";
    if (code) return formatErrorCode(code, locale);
    return t(fallbackKey);
  };

  const training = useMemo(
    () => ({
      ...trainingFromState(
        state.attempts,
        state.skills[PATTERN_ID]?.masteryEstimate ?? null,
        state.skills[PATTERN_ID]?.nextReviewAt ?? null,
      ),
      interventionLogVersion: state.interventionLogVersion,
      pedagogyEvents: state.pedagogyEvents,
      interventionQualification: state.interventionQualification,
      lessonVersion:
        state.pedagogyEvents.find((event) => event.eventType === "lesson_completed")?.lessonVersion ?? null,
      evalCriterionVersion: "engine-validated-v2",
    }),
    [state],
  );
  const profile = summarizeTraining(training);
  const pedagogy = useMemo(
    () =>
      data
        ? decidePedagogy({
            training,
            comparison: data.comparison,
            previousAction: data.pedagogy?.action ?? null,
          })
        : null,
    [data, training],
  );
  const narrative =
    pedagogy && data ? combinedNarrative({ training, comparison: data.comparison, pedagogy }) : [];

  async function reload() {
    try {
      const next = await fetchTransferState();
      setData(next);
      setError(null);
      if (next.currentCohortId && !next.examplesLocked) {
        const payload = await fetchExamples(next.currentCohortId);
        setExamples(payload.examples ?? []);
      } else {
        setExamples([]);
      }
    } catch (err) {
      setError(explainTransferError(err, "errors:request_failed"));
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!data?.sync.running) return;
    const id = window.setInterval(() => void reload(), 1200);
    return () => window.clearInterval(id);
  }, [data?.sync.running]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
    } catch (err) {
      setError(explainTransferError(err, "errors:request_failed"));
    } finally {
      setBusy(false);
    }
  }

  const comparison = data?.comparison;
  const comparisonCopy = comparison
    ? formatComparisonStatus(comparison.status, locale)
    : null;
  const pending = data?.openCohort?.pendingDecisions ?? 0;
  const cutoff = data?.baseline?.cutoff?.endUtc
    ? formatDateTime(data.baseline.cutoff.endUtc, locale)
    : null;
  const dose = state.interventionQualification;
  const exposure = data?.v03ExposureAudit;
  const nextMeasurement = data?.openCohort
    ? data.openCohort.frozen
      ? "frozen"
      : data.openCohort.analysisComplete && data.openCohort.games >= 30
        ? "sufficient_descriptive_volume"
        : "collecting"
    : dose.qualified
      ? "eligible_to_collect"
      : "training_incomplete";

  const syncProgressMessage = data?.sync.progress?.message;
  const syncProgressKey = syncProgressMessage ? `transfer:syncProgress.${syncProgressMessage}` : "";
  const syncProgressLabel =
    syncProgressMessage && i18n.exists(syncProgressKey)
      ? t(`syncProgress.${syncProgressMessage}`)
      : syncProgressMessage;

  return (
    <div className="page transfer">
      <header className="page-head">
        <p className="eyebrow">{t("eyebrow", { version: APP_VERSION })}</p>
        <h1>{t("title")}</h1>
        <p className="lead">{t("lead")}</p>
      </header>

      {error && <p className="warn">{error}</p>}

      <section className="card">
        <h2>{t("trainingStateTitle")}</h2>
        <p>
          <strong>{t("lessonLine")}:</strong> {training.lessonVersion ?? t("lessonHistorical")} ·{" "}
          <strong>{dose.protocolId}</strong>
        </p>
        <TechnicalDetails>
          <TechnicalRow label={t("patternInternal")} value={PATTERN_ID} />
          <TechnicalRow label={t("technical:protocolId")} value={dose.protocolId} />
        </TechnicalDetails>
        <ul className="stat-list">
          <li>
            {t("lessonDone")}: {dose.lessonCompletedAt ? t("common:yes") : t("common:no")}
          </li>
          <li>
            {t("exercisesConfirmed")}: {dose.confirmedExercises} / 12
          </li>
          <li>
            {t("verifiedSuccesses")}: {dose.verifiedSuccesses} / 8
          </li>
          <li>
            {t("sessions")}: {dose.distinctSessions} / 2
          </li>
          <li>
            {t("calendarDays")}: {dose.distinctCalendarDays} / 2
          </li>
          <li>
            {t("qualifiedAt")}:{" "}
            {dose.qualifiedAt ? formatDateTime(dose.qualifiedAt, locale) : t("common:dash")}
          </li>
        </ul>
        {!dose.qualified && (
          <p className="warn">
            {t("missingRequirements")}:{" "}
            {dose.missingRequirements.map((req) => formatInterventionRequirement(req, locale)).join(" · ")}
          </p>
        )}
      </section>

      <section className="card">
        <h2>{t("exposureTitle")}</h2>
        <p>{t("postBaseline")}</p>
        <p>
          {t("exposureLabel")}:{" "}
          <strong>{formatExposureStatus(exposure?.exposureValidity ?? "exposure_unknown", locale)}</strong>
        </p>
        {exposure?.gamesBeforeQualification !== null && exposure?.gamesBeforeQualification !== undefined && (
          <p>
            {t("gamesBeforeAfter", {
              before: exposure.gamesBeforeQualification,
              after: exposure.gamesAfterQualification ?? 0,
            })}
          </p>
        )}
        <p className="muted small">
          {t("exposureFootnote")}
          {exposure?.exposureValidity === "exposure_unknown" && t("exposureUnknownNote")}
        </p>
      </section>

      <section className="card">
        <h2>{t("nextMeasurementTitle")}</h2>
        <p className="badge badge-medium">{t(`measurement.${nextMeasurement}`)}</p>
        <p>{t("nextMeasurementHint")}</p>
      </section>

      <section className="card">
        <h2>{t("syncTitle")}</h2>
        <p>
          {t("lastSync")}:{" "}
          {data?.sync.lastSyncedAt
            ? formatDateTime(data.sync.lastSyncedAt, locale)
            : t("common:dash")}
        </p>
        <p className="muted small">
          {t("baselineCutoff")}: {cutoff ?? t("loadingCutoff")}. {t("baselineCutoffHint")}
        </p>
        {data?.sync.progress && (
          <p>
            {syncProgressLabel}
            {data.sync.progress.total > 0
              ? ` (${data.sync.progress.done} / ${data.sync.progress.total})`
              : ""}
          </p>
        )}
        {data?.sync.lastError && <p className="warn">{data.sync.lastError}</p>}
        <div className="actions">
          <button
            type="button"
            className="btn primary"
            disabled={busy || data?.sync.running || !dose.qualified}
            onClick={() => run(() => startTransferSync("live", training))}
          >
            {t("syncNewGames")}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !data?.sync.running}
            onClick={() => run(() => cancelTransfer())}
          >
            {t("cancelSync")}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || data?.sync.running || pending === 0 || !dose.qualified}
            onClick={() => run(() => resumeTransfer(training))}
          >
            {t("resumeAnalysis")}
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={busy || data?.sync.running || !dose.qualified}
            onClick={() => run(() => startTransferSync("fixtures", training))}
          >
            {t("offlineFixtures")}
          </button>
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <h2>{t("includedExcludedTitle")}</h2>
          <ul className="stat-list">
            <li>
              {t("validNewGames")}: {data?.includedCount ?? "—"}
            </li>
            <li>
              {t("excludedGames")}: {data?.excludedCount ?? "—"}
            </li>
            <li>
              {t("analysisStatus")}:{" "}
              {pending > 0
                ? t("analysisPending", { count: pending })
                : data?.openCohort || data?.currentCohortId
                  ? t("analysisComplete")
                  : t("analysisNoCohort")}
            </li>
          </ul>
          <ul className="reason-list">
            {(data?.exclusionCounts ?? []).map((row) => (
              <li key={row.reason}>
                {formatTransferExclusion(row.reason, locale)}: {row.count}
              </li>
            ))}
          </ul>
          <p className="muted small">{t("exclusionFootnote")}</p>
        </section>

        <section className="card">
          <h2>{t("baselineTitle")}</h2>
          {!data?.baseline?.metrics && <p>{t("baselinePending")}</p>}
          {comparison && comparisonCopy ? (
            <>
              <p
                className={`badge ${comparison.status === "observed_improvement" ? "badge-high" : "badge-medium"}`}
              >
                {comparisonCopy.label}
              </p>
              <ul className="stat-list">
                <li>
                  {t("baselineRate", { rate: formatRate(comparison.baseline.eventsPer100, locale) })}
                </li>
                <li>
                  {t("transferRate", { rate: formatRate(comparison.transfer.eventsPer100, locale) })}
                </li>
                <li>
                  {t("differenceLine", {
                    absolute:
                      comparison.absoluteDifference === null
                        ? "—"
                        : formatRate(comparison.absoluteDifference, locale),
                    relative:
                      comparison.relativeDifference !== null
                        ? t("relativeSuffix", {
                            percent: Math.round(comparison.relativeDifference * 100),
                          })
                        : "",
                  })}
                </li>
                <li>
                  {t("intervalLine", {
                    low: formatRate(comparison.interval.low, locale),
                    high: formatRate(comparison.interval.high, locale),
                  })}
                </li>
                <li>
                  {t("sampleLine", {
                    transferGames: comparison.sample.transferGames,
                    transferDecisions: comparison.sample.transferDecisions,
                    baselineGames: comparison.sample.baselineGames,
                    baselineDecisions: comparison.sample.baselineDecisions,
                  })}
                </li>
                <li>
                  {t("gamesWithPattern", {
                    affected: comparison.transfer.gamesAffected,
                    analyzed: comparison.transfer.gamesAnalyzed,
                  })}
                </li>
              </ul>
            </>
          ) : (
            <p className="muted">{t("comparisonPending")}</p>
          )}
          <TechnicalDetails>
            <TechnicalRow label={t("technical:detector")} value={data?.detectorId} />
          </TechnicalDetails>
        </section>
      </div>

      {comparison && comparisonCopy && (
        <section className="card">
          <h2>{t("meaningTitle")}</h2>
          <p>{comparisonCopy.meaning}</p>
          <p>{comparisonCopy.notMeaning}</p>
          <div className="grid-2">
            <div>
              <h3>{t("byPhase")}</h3>
              <ul className="stat-list">
                {Object.entries(comparison.transfer.byPhase ?? {}).map(([phase, slice]) => (
                  <li key={phase}>
                    {t("phaseSlice", {
                      phase: formatPhase(phase, locale),
                      events: slice.events,
                      decisions: slice.decisions,
                    })}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3>{t("severityTitle")}</h3>
              <ul className="stat-list">
                <li>
                  {t("severityNotable")}: {comparison.transfer.severity.notable}
                </li>
                <li>
                  {t("severityMarked")}: {comparison.transfer.severity.marcada}
                </li>
                <li>
                  {t("severityGrave")}: {comparison.transfer.severity.grave}
                </li>
                <li>
                  {t("pieceCaptureEvents")}: {comparison.transfer.pieceCaptureEvents}
                </li>
                <li>
                  {t("per100White", {
                    rate: formatRate(comparison.transfer.byColor.white?.per100 ?? null, locale),
                  })}
                </li>
                <li>
                  {t("per100Black", {
                    rate: formatRate(comparison.transfer.byColor.black?.per100 ?? null, locale),
                  })}
                </li>
              </ul>
            </div>
          </div>
        </section>
      )}

      {data?.context?.warning?.materialDifference && (
        <p className="warn">{data.context.warning.message ?? t("comparabilityWarning")}</p>
      )}

      {data?.context?.baseline && data.context.cohort && (
        <section className="card">
          <h2>{t("comparabilityTitle")}</h2>
          <div className="grid-2">
            {(
              [
                [t("contextBaseline"), data.context.baseline],
                [t("contextCohort"), data.context.cohort],
              ] as const
            ).map(([label, context]) => (
              <div key={label}>
                <h3>{label}</h3>
                <ul className="stat-list">
                  <li>
                    {t("ratingOwnMeanMedian")}: {formatRate(context.ownRatingMean, locale)} /{" "}
                    {formatRate(context.ownRatingMedian, locale)}
                  </li>
                  <li>
                    {t("ratingOppMeanMedian")}: {formatRate(context.opponentRatingMean, locale)} /{" "}
                    {formatRate(context.opponentRatingMedian, locale)}
                  </li>
                  <li>
                    {t("ratingDiffMean")}: {formatRate(context.ratingDifferenceMean, locale)}
                  </li>
                  <li>
                    {t("whiteShare")}:{" "}
                    {context.whiteProportion === null
                      ? "—"
                      : formatNumber(Math.round(context.whiteProportion * 100), locale)}
                    %
                  </li>
                  <li>
                    {t("resultsWLD")}:{" "}
                    {[context.winProportion, context.lossProportion, context.drawProportion]
                      .map((value) =>
                        value === null ? "—" : `${Math.round(value * 100)} %`,
                      )
                      .join(" / ")}
                  </li>
                  <li>
                    {t("decisionsPerGame")}: {formatRate(context.decisionsPerGame, locale)}
                  </li>
                </ul>
              </div>
            ))}
          </div>
          <p className="muted small">{t("comparabilityFootnote")}</p>
        </section>
      )}

      <section className="card">
        <h2>{t("twoChannelsTitle")}</h2>
        <div className="grid-2">
          <div>
            <h3>{t("exercisesChannel")}</h3>
            <ul className="stat-list">
              <li>
                {t("common:evaluationStatus.verified_best")}: {profile.verified_best}
              </li>
              <li>
                {t("common:evaluationStatus.verified_acceptable")}: {profile.verified_acceptable}
              </li>
              <li>
                {t("common:evaluationStatus.playable_inexact")}: {profile.playable_inexact}
              </li>
              <li>
                {t("common:evaluationStatus.incorrect")}: {profile.incorrect}
              </li>
              <li>
                {t("nextReview")}:{" "}
                {profile.nextReviewAt
                  ? formatDateTime(profile.nextReviewAt, locale)
                  : t("common:dash")}
              </li>
            </ul>
          </div>
          <div>
            <h3>{t("realGamesChannel")}</h3>
            <ul className="stat-list">
              <li>
                {comparisonCopy?.label ?? t("comparison.insufficient_data.label")}
              </li>
              <li>
                {t("lastSync")}:{" "}
                {data?.sync.lastSyncedAt
                  ? formatDateTime(data.sync.lastSyncedAt, locale)
                  : t("common:dash")}
              </li>
              <li>{t("realGamesNoAlpha")}</li>
            </ul>
          </div>
        </div>
        {narrative.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </section>

      <section className="card">
        <h2>{t("recommendationTitle")}</h2>
        {pedagogy ? (
          <>
            <p className="badge badge-medium">
              {formatPedagogyActionTitle(pedagogy.action, locale)}
            </p>
            <p>{formatPedagogyActionExplanation(pedagogy.action, locale)}</p>
            <p className="tiny muted">{t("policyNote", { policyId: pedagogy.policyId })}</p>
            {pedagogy.candidate && <p>{pedagogy.candidate.note}</p>}
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => run(() => postTrainingSummary(training, data?.pedagogy?.action ?? null))}
            >
              {t("saveRecommendation")}
            </button>
          </>
        ) : (
          <p className="muted">{t("recommendationPending")}</p>
        )}
        <div className="actions">
          <Link className="btn" to="/train">
            {t("keepTraining")}
          </Link>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !data?.openCohort || pending > 0 || data.openCohort.games === 0}
            onClick={() => data?.openCohort && run(() => freezeTransfer(data.openCohort!.id))}
          >
            {t("freezeGroup")}
          </button>
          <a className="btn ghost" href="/api/transfer/export">
            {t("exportJson")}
          </a>
        </div>
      </section>

      <section className="card">
        <h2>{t("examplesTitle")}</h2>
        {data?.examplesLocked ? (
          <p>{t("examplesLocked")}</p>
        ) : examples.length === 0 ? (
          <p>{t("examplesEmpty")}</p>
        ) : (
          <ul className="reason-list">
            {examples.slice(0, 12).map((example) => (
              <li key={example.key}>
                {t("exampleLine", {
                  moveNumber: example.moveNumber,
                  color: example.color === "white" ? t("common:white") : t("common:black"),
                  capture: example.pieceCaptureSubgroup ? t("exampleCapture") : "",
                })}
                {example.url && (
                  <>
                    {" "}
                    <a href={example.url} target="_blank" rel="noreferrer">
                      {t("exampleGameLink")}
                    </a>
                  </>
                )}
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy || data?.exerciseCandidates.some((item) => item.key === example.key)}
                  onClick={() =>
                    data?.currentCohortId && run(() => promoteTransfer(data.currentCohortId!, example.key))
                  }
                >
                  {t("saveFutureExercise")}
                </button>
              </li>
            ))}
          </ul>
        )}
        {!!data?.exerciseCandidates.length && (
          <p className="small">
            {t("futureExercisesSaved", { count: data.exerciseCandidates.length })}
          </p>
        )}
      </section>
    </div>
  );
}
