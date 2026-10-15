import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // Foliate initializes nested Blob-backed frames. Serial browser startup keeps
  // Vite's cold module graph deterministic on local and constrained CI hosts.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    // E2E assertions use the Chinese interface; English has its own test.
    locale: 'zh-CN',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /production\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Runs against `vite build` output, which the dev server cannot cover
      // (Rollup options such as dynamic-import handling only apply there).
      name: 'production',
      testMatch: /production\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:4174',
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm dev --host 127.0.0.1 --port 4173',
      env: {
        VITE_AI_FAKE_PROVIDER: 'true',
        VITE_DISCOVERY_FAKE_SOURCE: 'true',
      },
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command:
        'pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 4174 --strictPort',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
    },
  ],
});
