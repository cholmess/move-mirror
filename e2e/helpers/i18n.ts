import type { Page } from "@playwright/test";

export type UiLocale = "es" | "en" | "de";

export async function setUiLocale(page: Page, locale: UiLocale) {
  await page.evaluate((lang) => {
    localStorage.setItem("move-mirror-locale-v1", lang);
  }, locale);
  await page.reload();
  await page.waitForFunction(
    (lang) => document.documentElement.lang === lang,
    locale,
    { timeout: 10_000 },
  );
}

export async function readHtmlLang(page: Page) {
  return page.evaluate(() => document.documentElement.lang);
}
