import type { SupportedLocale } from "./types";

export function localeToIntl(locale: SupportedLocale): string {
  return locale === "es" ? "es-ES" : locale === "de" ? "de-DE" : "en-US";
}

export function formatDateTime(iso: string, locale: SupportedLocale): string {
  return new Date(iso).toLocaleString(localeToIntl(locale));
}

export function formatDate(iso: string, locale: SupportedLocale): string {
  return new Date(iso).toLocaleDateString(localeToIntl(locale));
}

export function formatNumber(value: number, locale: SupportedLocale, options?: Intl.NumberFormatOptions): string {
  return value.toLocaleString(localeToIntl(locale), options);
}

export function formatPercent(fraction: number, locale: SupportedLocale): string {
  return new Intl.NumberFormat(localeToIntl(locale), {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(fraction);
}

export function formatPercentFrom100(value: number, locale: SupportedLocale): string {
  return new Intl.NumberFormat(localeToIntl(locale), {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value / 100);
}
