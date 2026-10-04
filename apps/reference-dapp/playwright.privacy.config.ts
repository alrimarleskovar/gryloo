// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from '@playwright/test';

/** Isolated read-only privacy UI checks; no fork, wallet, relay or mainnet service is launched. */
export default defineConfig({
  testDir: './e2e', testMatch: 'privacy.spec.ts', workers: 1, retries: 0, timeout: 30_000,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3017', browserName: 'chromium', headless: true, serviceWorkers: 'block',
    viewport: { width: 1440, height: 900 }, screenshot: 'off', video: 'off', trace: 'off' },
  webServer: { command: 'pnpm --filter @defi-workflow-engine/reference-dapp start --port 3017', url: 'http://127.0.0.1:3017',
    reuseExistingServer: false, timeout: 60_000, env: { NEXT_TELEMETRY_DISABLED: '1', PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1', GRYLOO_BASE_OBSERVATION: 'replay',
      API_BASE_URL: '', API_AUTH_TOKEN: '' } },
});
