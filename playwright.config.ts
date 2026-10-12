// End-to-end smoke tests against the fictional test account. Pick the app with E2E_TARGET=local|staging
// (npm run e2e:local / e2e:staging). local needs `npm run sandbox:dev`; staging needs TEST_LOGIN_SECRET.
import { defineConfig } from '@playwright/test';
import { loadEnvFile, resolveTarget } from './scripts/test-env.mjs';

loadEnvFile();
const target = resolveTarget(process.env.E2E_TARGET === 'staging' ? 'staging' : 'local');

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  // One shared test vault, and the last spec writes to it: run everything in order, one worker.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: target.url,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1360, height: 900 },
  },
  metadata: { target: target.name },
});
