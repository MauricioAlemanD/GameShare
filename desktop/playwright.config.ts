import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: { trace: 'retain-on-failure' },
});
