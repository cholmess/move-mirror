#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  LANGS,
  TARGET_LANGS,
  assertNoBroadWhitelistPatterns,
  flattenLeaves,
  getByPath,
  isPendingValue,
  listNamespaces,
  loadLocale,
  whitelistAllowanceReason,
} from "./i18n-lib.mjs";

assertNoBroadWhitelistPatterns(fs.readFileSync(new URL("./i18n-lib.mjs", import.meta.url), "utf8"));

const srcDir = path.resolve("src/components");
let errors = 0;
let broadExceptions = 0;

const stats = {
  en: { total: 0 },
  es: { total: 0, translated: 0, englishMatches: 0, whitelisted: 0, pending: 0 },
  de: { total: 0, translated: 0, englishMatches: 0, whitelisted: 0, pending: 0 },
};

const whitelistedDetailed = { es: [], de: [] };
const pendingSamples = { es: [], de: [] };
const untranslatedSamples = { es: [], de: [] };

const nsFiles = listNamespaces();
const enKeys = {};

for (const file of nsFiles) {
  const ns = file.replace(/\.json$/, "");
  enKeys[ns] = new Set(flattenLeaves(loadLocale("en", file)).map(([k]) => k));
}

for (const lang of LANGS) {
  for (const file of nsFiles) {
    const ns = file.replace(/\.json$/, "");
    const leaves = flattenLeaves(loadLocale(lang, file));
    if (lang === "en") stats.en.total += leaves.length;

    for (const key of enKeys[ns]) {
      if (!leaves.some(([k]) => k === key)) {
        console.error(`[i18n] missing ${lang}/${file}: ${key}`);
        errors += 1;
      }
    }
    for (const [key] of leaves) {
      if (!enKeys[ns].has(key)) {
        console.error(`[i18n] extra ${lang}/${file}: ${key}`);
        errors += 1;
      }
    }
  }
}

for (const lang of TARGET_LANGS) {
  for (const file of nsFiles) {
    const ns = file.replace(/\.json$/, "");
    const enLeaves = flattenLeaves(loadLocale("en", file));
    const target = loadLocale(lang, file);

    for (const [keyPath, enValue] of enLeaves) {
      stats[lang].total += 1;
      const value = getByPath(target, keyPath);
      const fullKey = `${ns}:${keyPath}`;

      if (isPendingValue(value)) {
        stats[lang].pending += 1;
        if (pendingSamples[lang].length < 30) pendingSamples[lang].push(fullKey);
        console.error(`[i18n] pending ${lang}/${file}: ${keyPath}`);
        errors += 1;
        continue;
      }

      if (typeof enValue !== "string" || typeof value !== "string") {
        stats[lang].translated += 1;
        continue;
      }

      if (value === enValue) {
        stats[lang].englishMatches += 1;
        const reason = whitelistAllowanceReason({
          fullKey,
          enValue,
          localeValue: value,
          lang,
        });
        if (reason) {
          stats[lang].whitelisted += 1;
          whitelistedDetailed[lang].push({ key: fullKey, reason });
        } else {
          if (untranslatedSamples[lang].length < 50) untranslatedSamples[lang].push(fullKey);
          console.error(`[i18n] untranslated (${lang} = en): ${fullKey}`);
          errors += 1;
        }
      } else {
        stats[lang].translated += 1;
      }
    }
  }
}

const whitelistPattern =
  /MoveMirror|Chess\.com|Lichess|Stockfish|PGN|data-testid|aria-|className|http|\/api\/|import\.meta|#[0-9a-fA-F]{3,8}|♔|♕|♖|♗|♘|O-O|ex-|def-|cct-opponent|engine-validated|transfer-|nodes-|defense-/;

const hardcodedPattern = />([^<{]*[áéíóúñÁÉÍÓÚÑ][^<{]*)</g;

for (const file of fs.readdirSync(srcDir).filter((f) => f.endsWith(".tsx"))) {
  const content = fs.readFileSync(path.join(srcDir, file), "utf8");
  if (content.includes("useTranslation")) continue;
  const matches = content.match(hardcodedPattern);
  if (matches) {
    for (const m of matches) {
      const text = m.slice(1, -1).trim();
      if (text.length < 4 || whitelistPattern.test(text)) continue;
      console.warn(`[i18n] possible hardcoded UI in ${file}: "${text.slice(0, 60)}"`);
    }
  }
}

const enumLeak =
  /(verified_best|verified_acceptable|playable_inexact|exposure_unknown|cohort_frozen)(?!["'])/;
for (const file of fs.readdirSync(srcDir).filter((f) => f.endsWith(".tsx"))) {
  const content = fs.readFileSync(path.join(srcDir, file), "utf8");
  const lines = content.split("\n");
  lines.forEach((line, index) => {
    if (line.includes("TechnicalDetails") || line.includes("//")) return;
    if (
      enumLeak.test(line) &&
      !line.includes("EvaluationStatus") &&
      !line.includes("type ") &&
      !line.includes('count("') &&
      !line.includes("evaluationStatus.") &&
      !line.includes("training.")
    ) {
      console.warn(`[i18n] possible enum in UI ${file}:${index + 1}: ${line.trim().slice(0, 80)}`);
    }
  });
}

console.log("\n[i18n] Summary");
console.log(`  Keys (en): ${stats.en.total}`);
for (const lang of TARGET_LANGS) {
  const s = stats[lang];
  console.log(
    `  ${lang}: total=${s.total} translated=${s.translated} englishMatches=${s.englishMatches} whitelisted=${s.whitelisted} pending=${s.pending}`,
  );
}

console.log(`  Broad whitelist exceptions: ${broadExceptions}`);
console.log(`  Unexpected English (untranslated): ${errors > 0 ? untranslatedSamples.es.length + untranslatedSamples.de.length : 0}`);

if (whitelistedDetailed.es.length || whitelistedDetailed.de.length) {
  console.log("\n[i18n] Whitelisted English matches (with reason):");
  for (const lang of TARGET_LANGS) {
    for (const entry of whitelistedDetailed[lang]) {
      console.log(`  ${lang} ${entry.key} → ${entry.reason}`);
    }
  }
}

if (untranslatedSamples.es.length || untranslatedSamples.de.length) {
  console.log("\n[i18n] Untranslated UI keys:");
  for (const lang of TARGET_LANGS) {
    for (const key of untranslatedSamples[lang]) {
      console.log(`  ${lang}: ${key}`);
    }
  }
}

if (errors > 0) {
  console.error(`\n[i18n] FAILED — ${errors} issue(s)`);
  process.exit(1);
}

console.log("\n[i18n] OK — all keys translated, no pending, no stray English in es/de");
process.exit(0);
