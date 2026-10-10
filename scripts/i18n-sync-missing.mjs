#!/usr/bin/env node
/**
 * Adds keys present in en but missing in es/de. Never overwrites existing values.
 * New keys get a ⟪pending⟫ marker plus the English source for translators.
 */
import fs from "node:fs";
import path from "node:path";
import {
  LOCALES_DIR,
  TARGET_LANGS,
  PENDING_PREFIX,
  flattenLeaves,
  getByPath,
  listNamespaces,
  loadLocale,
  saveLocale,
  setByPath,
} from "./i18n-lib.mjs";

const pendingReport = { es: [], de: [] };

for (const lang of TARGET_LANGS) {
  for (const file of listNamespaces()) {
    const en = loadLocale("en", file);
    let target = loadLocale(lang, file);
    let changed = false;

    for (const [keyPath, enValue] of flattenLeaves(en)) {
      const existing = getByPath(target, keyPath);
      if (existing !== undefined) continue;
      const pending =
        typeof enValue === "string"
          ? `${PENDING_PREFIX}${enValue}`
          : `${PENDING_PREFIX}${JSON.stringify(enValue)}`;
      setByPath(target, keyPath, pending);
      pendingReport[lang].push(`${file.replace(/\.json$/, "")}:${keyPath}`);
      changed = true;
    }

    if (changed) saveLocale(lang, file, target);
  }
}

const metaPath = path.join(LOCALES_DIR, "_meta", "pending-keys.json");
fs.mkdirSync(path.dirname(metaPath), { recursive: true });
fs.writeFileSync(
  metaPath,
  `${JSON.stringify({ updatedAt: new Date().toISOString(), pending: pendingReport }, null, 2)}\n`,
);

const added = pendingReport.es.length + pendingReport.de.length;
console.log(
  `[i18n:sync] Added ${added} missing key(s) across es/de. Pending manifest: ${path.relative(process.cwd(), metaPath)}`,
);
if (added === 0) console.log("[i18n:sync] es and de are structurally complete vs en.");
