// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from '@playwright/test';
import { basename, dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

const cache = process.env.BUILD002_BROWSER_CACHE;
if (!cache || basename(cache) !== 'chromium_headless_shell-1243') {
  throw new Error('BUILD002_BROWSER_CACHE must name the verified headless-shell revision 1243');
}
const executablePath = join(cache, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
if (!existsSync(executablePath)) throw new Error('Verified headless-shell executable is missing');
if (process.env.NEXT_TELEMETRY_DISABLED !== '1' || process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD !== '1') {
  throw new Error('BUILD-002 telemetry and browser-download controls are required');
}
// BUILD-003C: E2E serves only committed recordings. Live Base reads are never made from tests.
const observation = process.env.GRYLOO_BASE_OBSERVATION;
if (observation !== undefined && observation !== 'replay') {
  throw new Error('E2E runs only with the recorded Base replay; live Base reads are forbidden in tests');
}

// BUILD-003F: local-fork Mode A always runs on loopback chain 31337. CI uses the MOCKED synthetic fork;
// `replay` serves the committed Base transcript and is an owner-only local acceptance mode.
const modeA = process.env.GRYLOO_MODE_A_E2E ?? 'synthetic';
if (modeA !== 'synthetic' && modeA !== 'replay') throw new Error('GRYLOO_MODE_A_E2E must be synthetic or replay');
const anvil = process.env.GRYLOO_ANVIL_BIN;
if (!anvil || basename(anvil) !== 'anvil' || basename(dirname(anvil)) !== 'foundry-v1.8.3') {
  throw new Error('GRYLOO_ANVIL_BIN must name the verified foundry-v1.8.3/anvil binary');
}
const runtime = process.env.GRYLOO_MODE_A_RUNTIME ?? join(tmpdir(), 'gryloo-build003f-mode-a-e2e');
if (!runtime.startsWith('/')) throw new Error('GRYLOO_MODE_A_RUNTIME must be absolute');
// Test workers inherit the runner environment, so fixtures and servers share one runtime directory.
process.env.GRYLOO_MODE_A_RUNTIME = runtime;
process.env.GRYLOO_MODE_A_E2E = modeA;

const supplyHarness = process.env.GRYLOO_SUPPLY_E2E === 'MOCKED_LOOPBACK_ONLY';
if (process.env.GRYLOO_SUPPLY_E2E && !supplyHarness) throw new Error('Supply E2E permits only the MOCKED loopback harness');
const supplyJournal = process.env.GRYLOO_SUPPLY_JOURNAL ?? join(tmpdir(), 'gryloo-build012a-' + Date.now() + '-' + process.pid);
if (supplyHarness) process.env.GRYLOO_SUPPLY_JOURNAL = supplyJournal;

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000, toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixels: 0 } },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    browserName: 'chromium',
    headless: true,
    launchOptions: { executablePath },
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
    locale: 'en-US',
    serviceWorkers: 'block',
    video: 'off', trace: 'off', screenshot: 'off',
  },
  projects: [{ name: 'chromium' }],
  webServer: [...(supplyHarness ? [{ command: 'node e2e/supply-harness.mjs --serve', url: 'http://127.0.0.1:8549', reuseExistingServer: false, timeout: 30_000 }] : []), {
    command: modeA === 'synthetic' ? 'node e2e/fork/offline-rehearsal.mjs --serve-synthetic' : 'node e2e/fork/owner-recording.mjs serve-replay',
    url: 'http://127.0.0.1:8547',
    reuseExistingServer: false,
    timeout: 180_000,
    env: { GRYLOO_MODE_A_RUNTIME: runtime, GRYLOO_ANVIL_BIN: anvil,
      ...(modeA === 'replay' && process.env.GRYLOO_MODE_A_TRANSCRIPT ? { GRYLOO_MODE_A_TRANSCRIPT: process.env.GRYLOO_MODE_A_TRANSCRIPT } : {}),
      ...(modeA === 'replay' && process.env.GRYLOO_MODE_A_SYNTHETIC_PINS ? { GRYLOO_MODE_A_SYNTHETIC_PINS: process.env.GRYLOO_MODE_A_SYNTHETIC_PINS } : {}) },
  }, {
    command: 'pnpm --filter @defi-workflow-engine/reference-dapp start',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: false,
    timeout: 60_000,
    env: { NEXT_TELEMETRY_DISABLED: '1', PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1', GRYLOO_BASE_OBSERVATION: 'replay',
      ...(supplyHarness ? { GRYLOO_SUPPLY_HARNESS: 'MOCKED_LOOPBACK_ONLY', GRYLOO_SUPPLY_JOURNAL: supplyJournal } : {}),
      GRYLOO_MODE_A: 'fork', GRYLOO_MODE_A_PROFILE: join(runtime, 'profile.json'), GRYLOO_MODE_A_JOURNAL: join(runtime, 'journal') },
  }],
});
