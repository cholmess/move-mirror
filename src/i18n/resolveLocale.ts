import type { SupportedLocale } from "./types";
import { DEFAULT_LOCALE } from "./types";
import { readStoredLocale } from "./localeStorage";

function normalizeBrowserLanguage(tag: string): SupportedLocale | null {
  const base = tag.toLowerCase().split("-")[0];
  if (base === "es") return "es";
  if (base === "en") return "en";
  if (base === "de") return "de";
  return null;
}

export function resolveInitialLocale(): SupportedLocale {
  const stored = readStoredLocale();
  if (stored) return stored;
  if (typeof navigator !== "undefined") {
    for (const lang of navigator.languages ?? [navigator.language]) {
      if (!lang) continue;
      const match = normalizeBrowserLanguage(lang);
      if (match) return match;
    }
  }
  return DEFAULT_LOCALE;
}

export function browserLocaleOrDefault(): SupportedLocale {
  if (typeof navigator === "undefined") return DEFAULT_LOCALE;
  for (const lang of navigator.languages ?? [navigator.language]) {
    if (!lang) continue;
    const match = normalizeBrowserLanguage(lang);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}
