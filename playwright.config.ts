import { defineConfig, devices } from '@playwright/test';

const evidenceOutput = process.env.PRD_GENIE_BROWSER_EVIDENCE_RAW;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: evidenceOutput
    ? [['list'], ['json', { outputFile: evidenceOutput }]]
    : process.env.CI
      ? [['html'], ['github']]
      : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'tsx tests/fixtures/mock-openai-server.ts',
      url: 'http://127.0.0.1:4312/v1/models',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'PRD_GENIE_DATA_DIR=/tmp/prd-genie-e2e PRD_GENIE_PORT=3210 npm run dev',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
