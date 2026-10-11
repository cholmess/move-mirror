import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { createValidationStore } from "../server/validation/store.mjs";
import { createValidationService } from "../server/validation/service.mjs";
import { verifyValidationLedger } from "../server/validation/verify.mjs";
import { sha256Canonical } from "../shared/transfer/intervention.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const validationRoot = process.env.VALIDATION_DATA_DIR
  ? path.resolve(ROOT, process.env.VALIDATION_DATA_DIR)
  : path.join(ROOT, "data/validation");

const store = createValidationStore(validationRoot);
const service = createValidationService(store);

const frozenPath = path.join(ROOT, "data/transfer/cohorts/transfer-20261010-2/frozen.json");
const frozenHash = fs.existsSync(frozenPath)
  ? sha256Canonical(JSON.parse(fs.readFileSync(frozenPath, "utf8")))
  : null;

const report = verifyValidationLedger(service, {
  sparringRoot: process.env.SPARRING_DATA_DIR ? path.resolve(ROOT, process.env.SPARRING_DATA_DIR) : path.join(ROOT, "data/sparring"),
  gamesRoot: process.env.GAMES_DATA_DIR ? path.resolve(ROOT, process.env.GAMES_DATA_DIR) : path.join(ROOT, "data/games"),
  frozenHash,
});

if (!report.ok) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, eventCount: report.eventCount }, null, 2));
