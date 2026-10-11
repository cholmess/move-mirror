import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testIgnore: ["**/helpers/**/*.test.ts"],
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "node scripts/prepare-e2e-games.mjs && GAMES_DATA_DIR=data/test-games SPARRING_DATA_DIR=data/test-sparring VALIDATION_DATA_DIR=data/test-validation SCORESHEET_OCR_PROVIDER=fixture node server/index.mjs",
      url: "http://127.0.0.1:8787/health",
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: "npm run dev:web -- --host 127.0.0.1 --port 5173",
      url: "http://127.0.0.1:5173",
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
