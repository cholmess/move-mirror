import { test, expect } from "@playwright/test";
import type { UiLocale } from "./helpers/i18n";

const locales: UiLocale[] = ["es", "en", "de"];

const navHome: Record<UiLocale, RegExp> = {
  es: /Inicio/i,
  en: /Home/i,
  de: /Start/i,
};

const forbiddenEnum = /verified_best|verified_acceptable|exposure_unknown|cohort_frozen/;

/** English UI phrases that must not appear in localized main content (es/de). */
const englishLeakEs =
  /\b(Home|Train now|Your move|Upload chess|Choose files|Paste PGN|Something went wrong|Loading\.\.\.|Show technical|Hide technical|Feedback|Recommended alternative|What we noticed)\b/;
const englishLeakDe =
  /\b(Home|Your move|Upload chess|Choose files|Paste PGN|Something went wrong|Loading\.\.\.|Show technical|Hide technical|Feedback|Recommended alternative|What we noticed|Import games)\b/;

for (const locale of locales) {
  test.describe(`i18n smoke (${locale})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((lang) => {
        localStorage.setItem("move-mirror-locale-v1", lang);
      }, locale);
      await page.goto("/");
      await page.waitForFunction(
        (lang) => document.documentElement.lang === lang,
        locale,
        { timeout: 10_000 },
      );
    });

    test("persists locale and sets html lang", async ({ page }) => {
      expect(await readHtmlLang(page)).toBe(locale);
      await page.reload();
      expect(await readHtmlLang(page)).toBe(locale);
    });

    test("main routes render without i18n keys or internal enums", async ({ page }) => {
      const routes = ["/", "/lesson", "/train", "/defense", "/transfer", "/import", "/games", "/profile"];
      const paceLabel: Record<UiLocale, RegExp> = {
        es: /Rápidas/,
        en: /Rapid/,
        de: /Schnellschach/,
      };

      for (const route of routes) {
        await page.goto(route);
        await expect(page.locator("main")).toBeVisible();
        const text = await page.locator("main").innerText();
        expect(text).not.toMatch(/\b(common|navigation|dashboard|training|defense|import):[\w.]+/);
        expect(text).not.toMatch(forbiddenEnum);
        if (route === "/games") {
          await expect(page.getByTestId("games-pace-filter")).toContainText(paceLabel[locale]);
        }
      }
    });

    test("navigation label matches locale", async ({ page }) => {
      await page.goto("/");
      await expect(page.locator("nav.nav").getByRole("link", { name: navHome[locale], exact: true })).toBeVisible();
    });

    if (locale === "es") {
      test("no unexpected English copy on main routes", async ({ page }) => {
        for (const route of ["/", "/import", "/train", "/profile"]) {
          await page.goto(route);
          const text = await page.locator("main").innerText();
          expect(text).not.toMatch(englishLeakEs);
        }
      });
    }

    if (locale === "de") {
      test("no unexpected English copy on main routes", async ({ page }) => {
        for (const route of ["/", "/import", "/train", "/profile"]) {
          await page.goto(route);
          const text = await page.locator("main").innerText();
          expect(text).not.toMatch(englishLeakDe);
        }
      });

      test("navigation fits without horizontal overflow", async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.goto("/");
        const nav = page.locator("nav.nav");
        await expect(nav).toBeVisible();
        const overflow = await nav.evaluate((el) => {
          const root = el as HTMLElement;
          return root.scrollWidth > root.clientWidth + 2;
        });
        expect(overflow).toBe(false);
      });
    }

    test("switching locale does not change adaptive exercise id", async ({ page }) => {
      const other: UiLocale = locale === "en" ? "de" : locale === "de" ? "es" : "en";
      await page.goto("/train");
      await expect(page.getByTestId("train-exercise-select")).toBeVisible();
      const before = await page.getByTestId("train-exercise-select").inputValue();
      await page.getByTestId("language-select").selectOption(other);
      await page.waitForFunction((lang) => document.documentElement.lang === lang, other, {
        timeout: 10_000,
      });
      const after = await page.getByTestId("train-exercise-select").inputValue();
      expect(after).toBe(before);
    });
  });
}

async function readHtmlLang(page: import("@playwright/test").Page) {
  return page.evaluate(() => document.documentElement.lang);
}
