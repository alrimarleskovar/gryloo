// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
const origin = process.env.FLOFI_DOCS_TEST_ORIGIN ?? 'http://127.0.0.1:3004';
if (!/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(origin)) throw new Error('DOCS_TEST_REQUIRES_LOOPBACK');
const cache = process.env.BUILD002_BROWSER_CACHE;
export default defineConfig({
  testDir: './e2e', testMatch: ['native-docs.spec.ts', 'docs-mascot.spec.ts'], workers: 1, retries: 0,
  timeout: 40_000, reporter: 'list', outputDir: 'test-results/docs',
  use: { baseURL: origin, browserName: 'chromium', viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference',
    serviceWorkers: 'block', launchOptions: cache ? { executablePath: join(cache, 'chrome-headless-shell-linux64/chrome-headless-shell') } : {},
    screenshot: 'only-on-failure', trace: 'off', video: 'off' },
});
