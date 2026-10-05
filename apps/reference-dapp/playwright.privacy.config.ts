// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.BUILD_PRIVACY_TEST_PORT ?? '3017');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local privacy test port');

/** Isolated read-only privacy UI checks; no fork, wallet, relay or mainnet service is launched. */
export default defineConfig({
  testDir: './e2e', testMatch: 'privacy.spec.ts', workers: 1, retries: 0, timeout: 30_000,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: 'chromium', headless: true, serviceWorkers: 'block',
    viewport: { width: 1440, height: 900 }, screenshot: 'off', video: 'off', trace: 'off' },
  webServer: { command: `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port ${port}`, url: `http://127.0.0.1:${port}`,
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    reuseExistingServer: false, timeout: 60_000, env: { NEXT_TELEMETRY_DISABLED: '1', PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1', GRYLOO_BASE_OBSERVATION: 'replay',
      API_BASE_URL: '', API_AUTH_TOKEN: '' } },
});
