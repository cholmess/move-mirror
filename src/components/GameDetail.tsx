import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  archiveGame,
  deleteGame,
  deleteRaw,
  deleteSource,
  fetchGame,
  patchGame,
  resolveConflicts,
  resolvePlayer,
} from "../api/gamesClient";
import type { CanonicalGame } from "../types/games";
import {
  formatDateTime,
  formatDuplicateDisposition,
  formatGameIneligibility,
  formatImportSource,
  formatMoveForDisplay,
  formatTimeControl,
} from "../i18n/presenters";
import type { SupportedLocale } from "../i18n/types";
import { TechnicalDetails, TechnicalRow } from "./TechnicalDetails";

export function GameDetail() {
  const { t, i18n } = useTranslation(["games", "common", "technical"]);
  const locale = i18n.language as SupportedLocale;
  const { id } = useParams();
  const [game, setGame] = useState<CanonicalGame | null>(null);
  const [error, setError] = useState("");

  const load = () => {
    if (!id) return;
    fetchGame(id).then(setGame).catch(() => setError(t("openFailed")));
  };
  useEffect(() => {
    load();
  }, [id, t]);

  if (!game) {
    return (
      <div className="page">
        <p className="muted">{error || t("loadingGame")}</p>
      </div>
    );
  }
  const color = game.players.playerResolution.playerColor;
  const reviewConflicts = game.sources.flatMap((source) =>
    source.conflicts.filter((conflict) => conflict.requiresReview),
  );

  return (
    <div className="page game-detail">
      <p className="eyebrow">
        <Link to="/games">{t("breadcrumbLibrary")}</Link> · {t("breadcrumbGame")}
      </p>
      <h1>
        {game.players.white.name ?? "?"} – {game.players.black.name ?? "?"}
      </h1>
      <p className="muted">
        {game.timing.startedAt ? formatDateTime(game.timing.startedAt, locale) : t("unknownDate")} ·{" "}
        {game.chess.result} · {game.timing.timeControl.raw ?? t("unknownTime")} (
        {formatTimeControl(game.timing.timeControl.category, locale)})
      </p>
      {error && <p className="card import-error">{error}</p>}

      <section className="card">
        <h2>{t("identityEligibilityTitle")}</h2>
        <p>
          {game.players.playerResolution.confidence === "verified" ? t("identityConfirmed") : t("confirmColor")}
        </p>
        <p>
          {t("coachingLine", {
            status: game.eligibility.coachingEligible
              ? t("coachingEligibleShort")
              : t("coachingIneligibleShort", {
                  reasons: game.eligibility.reasons.map((r) => formatGameIneligibility(r, locale)).join(", ") || "—",
                }),
          })}
        </p>
        <p>
          {t("transferLine", {
            status: game.eligibility.transferEligible ? t("transferEligibleShort") : t("transferIneligibleShort"),
          })}
        </p>
        {!color && (
          <div className="review-panel">
            <button className="btn" onClick={() => resolvePlayer(game.id, "white").then(setGame)}>
              {t("playedWhite")}
            </button>
            <button className="btn" onClick={() => resolvePlayer(game.id, "black").then(setGame)}>
              {t("playedBlack")}
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <h2>{t("movesTitle")}</h2>
        <p className="mono">
          {game.chess.movesSan.length
            ? game.chess.movesSan.map((move) => formatMoveForDisplay(move, locale)).join(" ")
            : t("noMoves")}
        </p>
      </section>

      {reviewConflicts.length > 0 && (
        <section className="card">
          <h2>{t("metadataConflictsTitle")}</h2>
          {reviewConflicts.map((conflict) => (
            <div key={conflict.field} className="review-panel">
              <span>
                {t("keptValue", { field: conflict.field, value: String(conflict.chosenValue ?? "—") })}
              </span>
              <button
                className="btn"
                onClick={() => resolveConflicts(game.id, { [conflict.field]: conflict.incomingValue }).then(setGame)}
              >
                {t("useNewValue")}
              </button>
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <h2>{t("sourcesTitle")}</h2>
        {game.sources.map((source) => (
          <article key={source.id} className="job-summary">
            <strong>{formatImportSource(source.sourceType, locale)}</strong>
            <p className="small muted">
              {source.rawAvailable ? t("originalAvailable") : t("originalRemoved")} ·{" "}
              {formatDuplicateDisposition(source.duplicateDisposition, locale)}
            </p>
            <TechnicalDetails>
              <TechnicalRow label={t("technical:id")} value={source.id} />
            </TechnicalDetails>
            <div className="actions">
              {source.rawAvailable && (
                <button className="btn" onClick={() => deleteRaw(source.id).then(load)}>
                  {t("deleteOriginal")}
                </button>
              )}
              <button className="btn" onClick={() => deleteSource(source.id).then(load)}>
                {t("deleteSource")}
              </button>
            </div>
          </article>
        ))}
      </section>

      <div className="actions">
        <a className="btn" href={`/api/games/${game.id}/pgn`} download>
          {t("exportPgn")}
        </a>
        <button className="btn" onClick={() => patchGame(game.id, { analysisSelected: !game.analysisSelected }).then(setGame)}>
          {game.analysisSelected ? t("excludeAnalysis") : t("includeAnalysis")}
        </button>
        <button className="btn" onClick={() => archiveGame(game.id, !game.archived).then(setGame)}>
          {game.archived ? t("showAgain") : t("archive")}
        </button>
        <button
          className="btn danger"
          onClick={() =>
            deleteGame(game.id)
              .then(() => {
                window.location.href = "/games";
              })
              .catch((cause) => setError(cause instanceof Error ? cause.message : t("deleteFailed")))
          }
        >
          {t("deleteGame")}
        </button>
      </div>
      {!!game.protection?.length && (
        <p className="small muted">{t("protectedNote", { reasons: game.protection.join(", ") })}</p>
      )}
    </div>
  );
}
