import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useApp } from "../context/AppContext";
import { fetchIdentity } from "../api/gamesClient";
import { LanguageSelector } from "./LanguageSelector";
import { LanguageWelcome } from "./LanguageWelcome";
import { hasStoredLocalePreference } from "../i18n/localeStorage";

const navRoutes = [
  { to: "/", key: "today" as const, end: true },
  { to: "/train", key: "train" as const },
  { to: "/sparring", key: "play" as const },
  { to: "/games", key: "myGames" as const },
  { to: "/profile", key: "progress" as const },
];

const moreRoutes = [
  { to: "/dashboard", key: "legacyHome" as const },
  { to: "/lesson", key: "lesson" as const },
  { to: "/coach", key: "guidedCoach" as const },
  { to: "/train/guided", key: "guidedTrain" as const },
  { to: "/defense", key: "defense" as const },
  { to: "/import", key: "import" as const },
  { to: "/transfer", key: "newGames" as const },
];

export function Layout() {
  const { t } = useTranslation(["navigation", "common"]);
  const { state } = useApp();
  const [displayName, setDisplayName] = useState(state.username);
  const [showWelcome, setShowWelcome] = useState(() => !hasStoredLocalePreference());

  useEffect(() => {
    fetchIdentity()
      .then((identity) => setDisplayName(identity.displayName || identity.chessComUsernames[0] || state.username))
      .catch(() => setDisplayName(state.username));
  }, [state.username]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-name">MoveMirror</span>
          <span className="brand-tag">{t("common:productTagline")}</span>
        </div>
        <nav className="nav" aria-label={t("navigation:ariaMainNav")}>
          {navRoutes.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
              end={link.end}
            >
              {t(`navigation:${link.key}`)}
            </NavLink>
          ))}
          <details className="nav-more">
            <summary>{t("navigation:more")}</summary>
            <div className="nav-more-links">
              {moreRoutes.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
                >
                  {t(`navigation:${link.key}`)}
                </NavLink>
              ))}
            </div>
          </details>
        </nav>
        <div className="header-meta">
          <LanguageSelector compact />
          <span className="mono">{displayName}</span>
        </div>
      </header>
      <main className="app-main" id="main-content">
        {showWelcome && (
          <LanguageWelcome onDone={() => setShowWelcome(false)} />
        )}
        <Outlet />
      </main>
    </div>
  );
}
