import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { createValidationStore } from "../server/validation/store.mjs";
import { createValidationService } from "../server/validation/service.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const validationRoot = process.env.VALIDATION_DATA_DIR
  ? path.resolve(ROOT, process.env.VALIDATION_DATA_DIR)
  : path.join(ROOT, "data/validation");

const store = createValidationStore(validationRoot);
const service = createValidationService(store);
const bundle = service.exportBundle();
const outDir = path.join(validationRoot, "exports");
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = path.join(outDir, `validation-export-${stamp}.json`);
fs.writeFileSync(out, `${JSON.stringify(bundle, null, 2)}\n`);
console.log(out);
