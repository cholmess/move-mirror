import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { fetchCoachHome, startCoachRetention, type CoachHome as CoachHomeDto } from "../api/coachClient";
import { primaryPattern } from "../data/pattern";

export function CoachHome() {
  const { t } = useTranslation(["coach", "navigation", "common"]);
  const navigate = useNavigate();
  const [home, setHome] = useState<CoachHomeDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ev = primaryPattern.evidence;

  useEffect(() => {
    fetchCoachHome()
      .then((res) => setHome(res.home))
      .catch(() => setError("load_failed"));
  }, []);

  const start = async () => {
    if (home?.primaryAction === "start_retention" && home.sessionId) {
      await startCoachRetention(home.sessionId);
      navigate(`/coach/session/${home.sessionId}`);
      return;
    }
    if (home?.primaryAction === "resume_session" && home.sessionId) {
      navigate(`/coach/session/${home.sessionId}`);
      return;
    }
    navigate("/coach/session");
  };

  return (
    <div className="page coach-home">
      <section className="hero-card">
        <p className="eyebrow">{t("coach:todayEyebrow")}</p>
        <h1>{t("coach:focusTitle")}</h1>
        <p className="lead">{t("coach:whyNow", { positions: ev.validationPositions ?? 85, games: ev.validationGames ?? 36, total: 50 })}</p>
      </section>

      <div className="grid-2">
        <section className="card">
          <h2>{t("coach:learnTodayHeading")}</h2>
          <p>{t("coach:learnToday")}</p>
          <p className="muted">{t("coach:applyRulePreview")}</p>
        </section>
        <section className="card">
          <h2>{t("coach:evidenceHeading")}</h2>
          <ul className="stat-list">
            <li>{t("coach:evidencePractice")}</li>
            <li>{t("coach:evidenceGeneralization")}</li>
            <li>{t("coach:evidenceTransfer")}</li>
          </ul>
          <p className="muted small">{t("coach:evidenceNote")}</p>
        </section>
      </div>

      <section className="card coach-action-card">
        {error && <p className="reasoning-error">{t("coach:engineRequired")}</p>}
        <p>{t("coach:sessionDuration", { minutes: home?.estimatedMinutes ?? 8 })}</p>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="coach-primary-action"
          onClick={() => void start()}
          disabled={Boolean(error)}
        >
          {home?.primaryAction === "start_retention"
            ? t("coach:startRetention")
            : home?.primaryAction === "resume_session"
              ? t("coach:continueSession")
              : t("coach:startSession")}
        </button>
      </section>

      <details className="card">
        <summary>{t("coach:moreModules")}</summary>
        <ul className="link-list">
          <li>
            <Link to="/lesson">{t("navigation:lesson")}</Link>
          </li>
          <li>
            <Link to="/train">{t("navigation:train")}</Link>
          </li>
          <li>
            <Link to="/defense">{t("navigation:defense")}</Link>
          </li>
          <li>
            <Link to="/sparring">{t("navigation:play")}</Link>
          </li>
          <li>
            <Link to="/import">{t("navigation:import")}</Link>
          </li>
          <li>
            <Link to="/transfer">{t("navigation:newGames")}</Link>
          </li>
        </ul>
      </details>
    </div>
  );
}
