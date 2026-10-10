import { useTranslation } from "react-i18next";
import { LOCALE_LABELS, SUPPORTED_LOCALES, type SupportedLocale } from "../i18n";
import { writeStoredLocale } from "../i18n/localeStorage";
import { setAppLocale } from "../i18n/i18nInstance";

export function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const { i18n, t } = useTranslation("common");
  const current = (SUPPORTED_LOCALES.includes(i18n.language as SupportedLocale)
    ? i18n.language
    : "en") as SupportedLocale;

  const onChange = (locale: SupportedLocale) => {
    writeStoredLocale(locale);
    setAppLocale(locale);
    document.documentElement.lang = locale;
    const live = document.getElementById("locale-live");
    if (live) {
      live.textContent = t("languageChanged", { language: LOCALE_LABELS[locale] });
    }
  };

  return (
    <label className={compact ? "language-select compact" : "language-select"}>
      {!compact && <span className="small muted">{t("language")}</span>}
      <select
        data-testid="language-select"
        aria-label={t("language")}
        value={current}
        onChange={(event) => onChange(event.target.value as SupportedLocale)}
      >
        {SUPPORTED_LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {LOCALE_LABELS[locale]}
          </option>
        ))}
      </select>
    </label>
  );
}
