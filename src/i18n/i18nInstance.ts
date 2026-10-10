import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import type { SupportedLocale } from "./types";
import { resolveInitialLocale } from "./resolveLocale";

import enCommon from "./locales/en/common.json";
import enNavigation from "./locales/en/navigation.json";
import enDashboard from "./locales/en/dashboard.json";
import enLesson from "./locales/en/lesson.json";
import enTraining from "./locales/en/training.json";
import enDefense from "./locales/en/defense.json";
import enTransfer from "./locales/en/transfer.json";
import enImport from "./locales/en/import.json";
import enGames from "./locales/en/games.json";
import enProfile from "./locales/en/profile.json";
import enErrors from "./locales/en/errors.json";
import enTechnical from "./locales/en/technical.json";
import enAccessibility from "./locales/en/accessibility.json";
import enAdaptive from "./locales/en/adaptive.json";
import enDomain from "./locales/en/domain.json";
import enScoresheet from "./locales/en/scoresheet.json";

import esCommon from "./locales/es/common.json";
import esNavigation from "./locales/es/navigation.json";
import esDashboard from "./locales/es/dashboard.json";
import esLesson from "./locales/es/lesson.json";
import esTraining from "./locales/es/training.json";
import esDefense from "./locales/es/defense.json";
import esTransfer from "./locales/es/transfer.json";
import esImport from "./locales/es/import.json";
import esGames from "./locales/es/games.json";
import esProfile from "./locales/es/profile.json";
import esErrors from "./locales/es/errors.json";
import esTechnical from "./locales/es/technical.json";
import esAccessibility from "./locales/es/accessibility.json";
import esAdaptive from "./locales/es/adaptive.json";
import esDomain from "./locales/es/domain.json";
import esScoresheet from "./locales/es/scoresheet.json";

import deCommon from "./locales/de/common.json";
import deNavigation from "./locales/de/navigation.json";
import deDashboard from "./locales/de/dashboard.json";
import deLesson from "./locales/de/lesson.json";
import deTraining from "./locales/de/training.json";
import deDefense from "./locales/de/defense.json";
import deTransfer from "./locales/de/transfer.json";
import deImport from "./locales/de/import.json";
import deGames from "./locales/de/games.json";
import deProfile from "./locales/de/profile.json";
import deErrors from "./locales/de/errors.json";
import deTechnical from "./locales/de/technical.json";
import deAccessibility from "./locales/de/accessibility.json";
import deAdaptive from "./locales/de/adaptive.json";
import deDomain from "./locales/de/domain.json";
import deScoresheet from "./locales/de/scoresheet.json";

const resources = {
  en: {
    common: enCommon,
    navigation: enNavigation,
    dashboard: enDashboard,
    lesson: enLesson,
    training: enTraining,
    defense: enDefense,
    transfer: enTransfer,
    import: enImport,
    games: enGames,
    profile: enProfile,
    errors: enErrors,
    technical: enTechnical,
    accessibility: enAccessibility,
    adaptive: enAdaptive,
    domain: enDomain,
    scoresheet: enScoresheet,
  },
  es: {
    common: esCommon,
    navigation: esNavigation,
    dashboard: esDashboard,
    lesson: esLesson,
    training: esTraining,
    defense: esDefense,
    transfer: esTransfer,
    import: esImport,
    games: esGames,
    profile: esProfile,
    errors: esErrors,
    technical: esTechnical,
    accessibility: esAccessibility,
    adaptive: esAdaptive,
    domain: esDomain,
    scoresheet: esScoresheet,
  },
  de: {
    common: deCommon,
    navigation: deNavigation,
    dashboard: deDashboard,
    lesson: deLesson,
    training: deTraining,
    defense: deDefense,
    transfer: deTransfer,
    import: deImport,
    games: deGames,
    profile: deProfile,
    errors: deErrors,
    technical: deTechnical,
    accessibility: deAccessibility,
    adaptive: deAdaptive,
    domain: deDomain,
    scoresheet: deScoresheet,
  },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: resolveInitialLocale(),
  fallbackLng: "en",
  defaultNS: "common",
  ns: [
    "common",
    "navigation",
    "dashboard",
    "lesson",
    "training",
    "defense",
    "transfer",
    "import",
    "games",
    "profile",
    "errors",
    "technical",
    "accessibility",
    "adaptive",
    "domain",
    "scoresheet",
  ],
  interpolation: { escapeValue: false },
  returnNull: false,
  saveMissing: import.meta.env.DEV,
  missingKeyHandler: import.meta.env.DEV
    ? (lng, ns, key) => {
        console.warn(`[i18n] missing key ${ns}:${key} (${lng})`);
      }
    : undefined,
});

export function setAppLocale(locale: SupportedLocale): void {
  void i18n.changeLanguage(locale);
}

export { i18n };
