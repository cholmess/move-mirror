export type SupportedLocale = "es" | "en" | "de";

export const SUPPORTED_LOCALES: SupportedLocale[] = ["es", "en", "de"];

export const LOCALE_STORAGE_KEY = "move-mirror-locale-v1";

export const DEFAULT_LOCALE: SupportedLocale = "en";

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  es: "Español",
  en: "English",
  de: "Deutsch",
};
