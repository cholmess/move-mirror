import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e', testMatch: ['decision-coaching.spec.ts', 'personal-training-path.spec.ts'],
  use: { baseURL: 'http://127.0.0.1:5187', launchOptions: { executablePath: process.env.E2E_BROWSER_PATH, args: process.env.E2E_BROWSER_ARGS ? JSON.parse(process.env.E2E_BROWSER_ARGS) : ['--no-sandbox'] } },
  webServer: { command: 'npm run dev:web -- --host 127.0.0.1 --port 5187', url: 'http://127.0.0.1:5187', reuseExistingServer: false },
});
