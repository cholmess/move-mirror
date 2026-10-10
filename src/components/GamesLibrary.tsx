import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { archiveGame, fetchGames, patchGame, resolvePlayer } from "../api/gamesClient";
import type { CanonicalGame } from "../types/games";
import {
  formatDateTime,
  formatGameIneligibility,
  formatImportSource,
  formatTimeControl,
} from "../i18n/presenters";
import type { SupportedLocale } from "../i18n/types";

export function GamesLibrary() {
  const { t, i18n } = useTranslation(["games", "common"]);
  const locale = i18n.language as SupportedLocale;
  const [games, setGames] = useState<CanonicalGame[]>([]);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({
    source: "",
    category: "",
    color: "",
    result: "",
    eligibility: "",
    analyzed: "",
    from: "",
    to: "",
    review: false,
  });

  const load = () =>
    fetchGames()
      .then((result) => setGames(result.games))
      .catch(() => setError(t("loadError")));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(
    () =>
      games.filter((game) => {
        if (filters.source && !game.sources.some((source) => source.sourceType === filters.source)) return false;
        if (filters.category && game.timing.timeControl.category !== filters.category) return false;
        if (filters.color && game.players.playerResolution.playerColor !== filters.color) return false;
        if (filters.result && game.chess.result !== filters.result) return false;
        if (filters.eligibility === "eligible" && !game.eligibility.coachingEligible) return false;
        if (filters.eligibility === "ineligible" && game.eligibility.coachingEligible) return false;
        if (filters.eligibility === "transfer" && !game.eligibility.transferEligible) return false;
        if (filters.analyzed === "yes" && !game.analysisSelected) return false;
        if (filters.analyzed === "no" && game.analysisSelected) return false;
        if (filters.from && (game.timing.startedAt ?? "") < filters.from) return false;
        if (filters.to && (game.timing.startedAt ?? "9999") > `${filters.to}T23:59:59`) return false;
        if (
          filters.review &&
          game.players.playerResolution.confidence === "verified" &&
          !game.sources.some((source) => source.conflicts.some((conflict) => conflict.requiresReview))
        ) {
          return false;
        }
        return true;
      }),
    [games, filters],
  );

  const resolve = async (id: string, color: "white" | "black") => {
    await resolvePlayer(id, color);
    load();
  };

  const toggleScope = async (game: CanonicalGame) => {
    await patchGame(game.id, { analysisSelected: !game.analysisSelected });
    load();
  };

  return (
    <div className="page games-library">
      <div className="library-head">
        <div>
          <p className="eyebrow">{t("libraryEyebrow")}</p>
          <h1>{t("title")}</h1>
          <p className="muted">
            {t("subtitle", {
              unique: games.length,
              sources: games.reduce((sum, game) => sum + game.sources.length, 0),
            })}
          </p>
        </div>
        <Link className="btn primary" to="/import">
          {t("importGames")}
        </Link>
      </div>
      {error && <p className="card import-error">{error}</p>}
      <section className="card filter-bar">
        <select
          aria-label={t("filterSource")}
          value={filters.source}
          onChange={(event) => setFilters({ ...filters, source: event.target.value })}
        >
          <option value="">{t("allSources")}</option>
          {(["chess_com", "lichess", "pgn_file", "pgn_text", "manual"] as const).map((source) => (
            <option key={source} value={source}>
              {formatImportSource(source, locale)}
            </option>
          ))}
        </select>
        <select
          data-testid="games-pace-filter"
          aria-label={t("filterPace")}
          value={filters.category}
          onChange={(event) => setFilters({ ...filters, category: event.target.value })}
        >
          <option value="">{t("allPaces")}</option>
          {(["bullet", "blitz", "rapid", "classical", "correspondence", "unknown"] as const).map((category) => (
            <option key={category} value={category}>
              {formatTimeControl(category, locale)}
            </option>
          ))}
        </select>
        <select
          aria-label={t("filterColor")}
          value={filters.color}
          onChange={(event) => setFilters({ ...filters, color: event.target.value })}
        >
          <option value="">{t("bothColors")}</option>
          <option value="white">{t("common:white")}</option>
          <option value="black">{t("common:black")}</option>
        </select>
        <select
          aria-label={t("filterResult")}
          value={filters.result}
          onChange={(event) => setFilters({ ...filters, result: event.target.value })}
        >
          <option value="">{t("allResults")}</option>
          <option value="1-0">1-0</option>
          <option value="0-1">0-1</option>
          <option value="1/2-1/2">½-½</option>
          <option value="*">{t("unfinished")}</option>
        </select>
        <select
          aria-label={t("filterEligibility")}
          value={filters.eligibility}
          onChange={(event) => setFilters({ ...filters, eligibility: event.target.value })}
        >
          <option value="">{t("allEligibility")}</option>
          <option value="eligible">{t("coachingEligible")}</option>
          <option value="ineligible">{t("outOfPolicy")}</option>
          <option value="transfer">{t("transferEligible")}</option>
        </select>
        <select
          aria-label={t("filterAnalysis")}
          value={filters.analyzed}
          onChange={(event) => setFilters({ ...filters, analyzed: event.target.value })}
        >
          <option value="">{t("analysisAll")}</option>
          <option value="yes">{t("analysisSelected")}</option>
          <option value="no">{t("analysisNotSelected")}</option>
        </select>
        <label className="field">
          <span>{t("fromDate")}</span>
          <input
            className="input"
            type="date"
            value={filters.from}
            onChange={(event) => setFilters({ ...filters, from: event.target.value })}
          />
        </label>
        <label className="field">
          <span>{t("toDate")}</span>
          <input
            className="input"
            type="date"
            value={filters.to}
            onChange={(event) => setFilters({ ...filters, to: event.target.value })}
          />
        </label>
        <label className="check-field">
          <input
            type="checkbox"
            checked={filters.review}
            onChange={(event) => setFilters({ ...filters, review: event.target.checked })}
          />{" "}
          {t("needsReviewFilter")}
        </label>
      </section>

      <div className="game-list">
        {visible.map((game) => (
          <GameCard key={game.id} game={game} locale={locale} resolve={resolve} toggleScope={toggleScope} />
        ))}
        {visible.length === 0 && (
          <section className="card">
            <p className="muted">{t("noMatches")}</p>
          </section>
        )}
      </div>
    </div>
  );
}

function GameCard({
  game,
  locale,
  resolve,
  toggleScope,
}: {
  game: CanonicalGame;
  locale: SupportedLocale;
  resolve: (id: string, color: "white" | "black") => Promise<void>;
  toggleScope: (game: CanonicalGame) => Promise<void>;
}) {
  const { t } = useTranslation(["games", "common"]);
  const color = game.players.playerResolution.playerColor;
  const opponent = color === "white" ? game.players.black : color === "black" ? game.players.white : null;
  const review = game.sources.some((source) => source.conflicts.some((conflict) => conflict.requiresReview));
  return (
    <article className="card game-card" data-testid="canonical-game">
      <div className="game-main">
        <div>
          <p className="eyebrow">
            {game.sources
              .map((source) => t(`sourceShort.${source.sourceType}`))
              .filter((value, index, all) => all.indexOf(value) === index)
              .join(" + ")}
          </p>
          <h2>
            {opponent?.name ?? opponent?.username ?? `${game.players.white.name ?? "?"} – ${game.players.black.name ?? "?"}`}
          </h2>
          <p className="muted small">
            {game.timing.startedAt
              ? formatDateTime(game.timing.startedAt, locale)
              : t("unknownDate")}{" "}
            ·{" "}
            {color
              ? color === "white"
                ? t("common:white")
                : t("common:black")
              : t("confirmColor")}{" "}
            · {game.chess.result} · {game.timing.timeControl.raw ?? t("unknownTime")} (
            {formatTimeControl(game.timing.timeControl.category, locale)})
          </p>
        </div>
        <div className="game-badges">
          <span className={`badge ${game.players.playerResolution.confidence === "verified" ? "badge-high" : "badge-medium"}`}>
            {game.players.playerResolution.confidence === "verified" ? t("identityConfirmed") : t("confirmColor")}
          </span>
          <span className={`badge ${game.eligibility.coachingEligible ? "badge-high" : "badge-medium"}`}>
            {game.eligibility.coachingEligible ? t("eligibleCoaching") : t("outOfPolicy")}
          </span>
          <span className="badge">
            {game.eligibility.transferEligible ? t("canMeasureTransfer") : t("outOfPolicy")}
          </span>
          {review && <span className="badge badge-medium">{t("metadataConflicts")}</span>}
          {game.analysisSelected && <span className="badge">{t("inNextAnalysis")}</span>}
        </div>
      </div>
      {!color && (
        <div className="review-panel">
          <span>{t("whichColor")}</span>
          <button className="btn" onClick={() => void resolve(game.id, "white")}>
            {t("playedWhite")}
          </button>
          <button className="btn" onClick={() => void resolve(game.id, "black")}>
            {t("playedBlack")}
          </button>
        </div>
      )}
      {!game.eligibility.coachingEligible && (
        <p className="small muted">
          {t("reasonsLabel")}:{" "}
          {game.eligibility.reasons.map((reason) => formatGameIneligibility(reason, locale)).join(", ")}.
        </p>
      )}
      <div className="actions">
        <Link className="btn" to={`/games/${game.id}`}>
          {t("openGame")}
        </Link>
        <a className="btn" href={`/api/games/${game.id}/pgn`} download>
          {t("exportPgn")}
        </a>
        <button className="btn" onClick={() => void toggleScope(game)}>
          {game.analysisSelected ? t("excludeAnalysis") : t("includeAnalysis")}
        </button>
        <button className="btn" onClick={() => void archiveGame(game.id, true).then(() => window.location.reload())}>
          {t("archive")}
        </button>
      </div>
    </article>
  );
}
