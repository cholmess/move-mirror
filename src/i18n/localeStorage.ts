import type { SupportedLocale } from "./types";
import { LOCALE_STORAGE_KEY, SUPPORTED_LOCALES } from "./types";

export function readStoredLocale(): SupportedLocale | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
  if (!raw) return null;
    return SUPPORTED_LOCALES.includes(raw as SupportedLocale) ? (raw as SupportedLocale) : null;
  } catch {
    return null;
  }
}

export function writeStoredLocale(locale: SupportedLocale): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* noop in non-browser runtimes */
  }
}

export function hasStoredLocalePreference(): boolean {
  return readStoredLocale() !== null;
}
