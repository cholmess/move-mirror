import { defineConfig } from "@playwright/test";

const E2E_ENGINE_PORT = process.env.E2E_ENGINE_PORT ?? "8791";
const E2E_WEB_PORT = process.env.E2E_WEB_PORT ?? "5174";

export default defineConfig({
  testDir: "e2e",
  testIgnore: ["**/helpers/**/*.test.ts"],
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${E2E_WEB_PORT}`,
    trace: "on-first-retry",
    launchOptions: process.env.E2E_BROWSER_PATH ? { executablePath: process.env.E2E_BROWSER_PATH, args: ["--no-sandbox", "--disable-dev-shm-usage"] } : undefined,
  },
  webServer: [
    {
      command:
        `node scripts/prepare-e2e-games.mjs && rm -rf data/test-coach/coach && mkdir -p data/test-coach/coach && ENGINE_PORT=${E2E_ENGINE_PORT} GAMES_DATA_DIR=data/test-games SPARRING_DATA_DIR=data/test-sparring VALIDATION_DATA_DIR=data/test-validation COACH_DATA_DIR=data/test-coach COACH_RETENTION_DELAY_MS=0 COACH_ALLOW_EARLY_RETENTION=1 SCORESHEET_OCR_PROVIDER=fixture node server/index.mjs`,
      url: `http://127.0.0.1:${E2E_ENGINE_PORT}/health`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `VITE_ENGINE_API=http://127.0.0.1:${E2E_ENGINE_PORT} npm run dev:web -- --host 127.0.0.1 --port ${E2E_WEB_PORT}`,
      url: `http://127.0.0.1:${E2E_WEB_PORT}`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
