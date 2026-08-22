import { defineConfig } from '@playwright/test';

const port = 3102;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 10_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `PORT=${port} HOST=127.0.0.1 npm run start`,
    port,
    reuseExistingServer: !process.env.CI,
  },
});
