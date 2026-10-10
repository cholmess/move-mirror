import { useTranslation } from "react-i18next";
import { LOCALE_LABELS, SUPPORTED_LOCALES, type SupportedLocale } from "../i18n";
import { writeStoredLocale } from "../i18n/localeStorage";
import { setAppLocale } from "../i18n/i18nInstance";

export function LanguageWelcome({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation("common");

  const choose = (locale: SupportedLocale) => {
    writeStoredLocale(locale);
    setAppLocale(locale);
    document.documentElement.lang = locale;
    onDone();
  };

  return (
    <section className="card language-welcome" role="dialog" aria-labelledby="language-welcome-title">
      <h2 id="language-welcome-title">{t("chooseLanguage")}</h2>
      <p className="muted small">{t("chooseLanguageHint")}</p>
      <div className="actions">
        {SUPPORTED_LOCALES.map((locale) => (
          <button key={locale} type="button" className="btn primary" onClick={() => choose(locale)}>
            {LOCALE_LABELS[locale]}
          </button>
        ))}
      </div>
    </section>
  );
}
