// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './e2e', testMatch: 'privacy-owner-proof.spec.ts', workers: 1, fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:3018', browserName: 'chromium', headless: true },
  webServer: { command: 'node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3018',
    url: 'http://127.0.0.1:3018/privacy/mainnet-proof', reuseExistingServer: false, timeout: 120000,
    env: { FLOFI_CLOAK_OWNER_PROOF: '0', NEXT_TELEMETRY_DISABLED: '1' } } });
