import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { SupportedLocale } from "../i18n";

export function LocaleHtmlSync() {
  const { i18n } = useTranslation();

  useEffect(() => {
    const lang = (["es", "en", "de"].includes(i18n.language) ? i18n.language : "en") as SupportedLocale;
    document.documentElement.lang = lang;
  }, [i18n.language]);

  return (
    <div id="locale-live" className="visually-hidden" aria-live="polite" aria-atomic="true" />
  );
}
