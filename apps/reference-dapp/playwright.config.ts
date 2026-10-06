// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from '@playwright/test';
import { basename, dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { E2E_APP_ORIGIN, E2E_APP_PORT } from './e2e/app-origin';
import { MCP_E2E_INVITE } from './e2e/mcp-constants';

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
const lendingHarness = process.env.GRYLOO_LENDING_E2E === 'MOCKED_LOOPBACK_ONLY';
if (process.env.GRYLOO_LENDING_E2E && !lendingHarness) throw new Error('Lending E2E permits only the MOCKED loopback harness');
const lendingJournal = process.env.GRYLOO_LENDING_JOURNAL ?? join(tmpdir(), 'gryloo-build013-' + Date.now() + '-' + process.pid);
if (lendingHarness) process.env.GRYLOO_LENDING_JOURNAL = lendingJournal;
// BUILD-014: Jupiter/Solana browser tests use only the MOCKED loopback harness; never a public provider or broadcast.
const jupiterHarness = process.env.GRYLOO_JUPITER_E2E === 'MOCKED_LOOPBACK_ONLY';
if (process.env.GRYLOO_JUPITER_E2E && !jupiterHarness) throw new Error('Jupiter E2E permits only the MOCKED loopback harness');
const jupiterJournal = process.env.GRYLOO_JUPITER_JOURNAL ?? join(tmpdir(), 'gryloo-build014-' + Date.now() + '-' + process.pid);
if (jupiterHarness) process.env.GRYLOO_JUPITER_JOURNAL = jupiterJournal;
// BUILD-DEMO-001: Solana Devnet browser tests use only the MOCKED loopback harness; never public Devnet or a broadcast.
const devnetHarness = process.env.GRYLOO_SOLANA_DEVNET_E2E === 'MOCKED_LOOPBACK_ONLY';
if (process.env.GRYLOO_SOLANA_DEVNET_E2E && !devnetHarness) throw new Error('Solana Devnet E2E permits only the MOCKED loopback harness');
const devnetJournal = process.env.GRYLOO_SOLANA_DEVNET_JOURNAL ?? join(tmpdir(), 'gryloo-demo001-' + Date.now() + '-' + process.pid);
if (devnetHarness) process.env.GRYLOO_SOLANA_DEVNET_JOURNAL = devnetJournal;

// RH-DEMO-001: Robinhood Testnet self-transfer browser tests use only the MOCKED loopback chain; never the public network or a broadcast.
const robinhoodHarness = process.env.GRYLOO_ROBINHOOD_E2E === 'MOCKED_LOOPBACK_ONLY';
if (process.env.GRYLOO_ROBINHOOD_E2E && !robinhoodHarness) throw new Error('Robinhood E2E permits only the MOCKED loopback harness');
const robinhoodJournal = process.env.GRYLOO_ROBINHOOD_JOURNAL ?? join(tmpdir(), 'gryloo-rh-demo-001-' + Date.now() + '-' + process.pid);
if (robinhoodHarness) process.env.GRYLOO_ROBINHOOD_JOURNAL = robinhoodJournal;

// BUILD-UNISWAP-LIQUIDITY-PUBLIC: Base Sepolia Uniswap liquidity browser tests use only the MOCKED loopback chain; never the public network or a broadcast.
const uniswapHarness = process.env.GRYLOO_UNISWAP_LIQUIDITY_E2E === 'MOCKED_LOOPBACK_ONLY';
if (process.env.GRYLOO_UNISWAP_LIQUIDITY_E2E && !uniswapHarness) throw new Error('Uniswap liquidity E2E permits only the MOCKED loopback harness');
const uniswapJournal = process.env.GRYLOO_UNISWAP_LIQUIDITY_JOURNAL ?? join(tmpdir(), 'gryloo-unilp-' + Date.now() + '-' + process.pid);
if (uniswapHarness) process.env.GRYLOO_UNISWAP_LIQUIDITY_JOURNAL = uniswapJournal;
// BUILD-ROUTER-001: Cross-chain Router browser tests use only the MOCKED loopback Base/Arbitrum chains and providers; never a public network or a broadcast.
const routerHarness = process.env.GRYLOO_ROUTER_E2E === 'MOCKED_LOOPBACK_ONLY';
if (process.env.GRYLOO_ROUTER_E2E && !routerHarness) throw new Error('Router E2E permits only the MOCKED loopback harness');
const routerJournal = process.env.GRYLOO_ROUTER_JOURNAL ?? join(tmpdir(), 'gryloo-router-' + Date.now() + '-' + process.pid);
if (routerHarness) process.env.GRYLOO_ROUTER_JOURNAL = routerJournal;
// BUILD-JOURNEY-001: the permissionless testnet journey runs only on the MOCKED loopback Base Sepolia/Arbitrum Sepolia chains and providers.
const routerTestnetHarness = process.env.GRYLOO_ROUTER_TESTNET_E2E === 'MOCKED_LOOPBACK_ONLY';
if (process.env.GRYLOO_ROUTER_TESTNET_E2E && !routerTestnetHarness) throw new Error('Router testnet E2E permits only the MOCKED loopback harness');
const routerTestnetJournal = process.env.GRYLOO_ROUTER_TESTNET_JOURNAL ?? join(tmpdir(), 'gryloo-router-testnet-' + Date.now() + '-' + process.pid);
if (routerTestnetHarness) process.env.GRYLOO_ROUTER_TESTNET_JOURNAL = routerTestnetJournal;

// BUILD-CLOUD-PARITY-001: the app on the embedded PostgreSQL runtime (the path a Vercel deployment runs) with the MOCKED loopback
// Robinhood chain. A disposable LOOPBACK database is created for the run (e2e/cloud-runtime-setup.ts) and dropped afterwards; the
// server gets no journal directory.
const cloudRuntime = process.env.GRYLOO_CLOUD_RUNTIME_E2E === 'EMBEDDED_LOOPBACK_ONLY';
if (process.env.GRYLOO_CLOUD_RUNTIME_E2E && !cloudRuntime) throw new Error('Cloud runtime E2E permits only the embedded loopback runtime');
if (cloudRuntime && !process.env.FLOFI_E2E_DATABASE_URL) {
  const server = new URL(process.env.TEST_DATABASE_URL ?? 'invalid:');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(server.hostname)) throw new Error('Cloud runtime E2E needs a loopback TEST_DATABASE_URL');
  server.pathname = `/flofi_e2e_${Date.now()}_${process.pid}`;
  // Test workers inherit it, so the setup, the server and the spec share one database.
  process.env.FLOFI_E2E_DATABASE_URL = server.href;
}

// BUILD-MCP-002: the in-chat execution journey — consumer OAuth, the MCP App panel in a minimal MCP Apps test host, /approve and the
// owner's unchanged flows — on the embedded PostgreSQL runtime with the MOCKED loopback router and Solana Devnet harnesses. Loopback
// database, loopback chains, a random per-run OAuth secret and a test invite only; never a public network or a real transaction.
const mcpHarness = process.env.GRYLOO_MCP_E2E === 'EMBEDDED_LOOPBACK_ONLY';
if (process.env.GRYLOO_MCP_E2E && !mcpHarness) throw new Error('MCP E2E permits only the embedded loopback runtime');
if (mcpHarness && !process.env.FLOFI_E2E_DATABASE_URL) {
  const server = new URL(process.env.TEST_DATABASE_URL ?? 'invalid:');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(server.hostname)) throw new Error('MCP E2E needs a loopback TEST_DATABASE_URL');
  server.pathname = `/flofi_e2e_${Date.now()}_${process.pid}`;
  process.env.FLOFI_E2E_DATABASE_URL = server.href;
}
const mcpServerEnv = mcpHarness ? { FLOFI_RUNTIME: 'embedded', DATABASE_URL: process.env.FLOFI_E2E_DATABASE_URL!, FLOFI_MCP: 'enabled', FLOFI_MCP_OAUTH: 'enabled',
  FLOFI_PUBLIC_ORIGIN: E2E_APP_ORIGIN, FLOFI_MCP_OAUTH_SECRET: randomBytes(32).toString('hex'), FLOFI_MCP_OAUTH_DCR: 'enabled',
  FLOFI_MCP_OAUTH_INVITES: createHash('sha256').update(MCP_E2E_INVITE).digest('hex'), FLOFI_MCP_INFRAME_WALLET_HOSTS: 'flofi-e2e-host',
  GRYLOO_ROUTER_TESTNET_HARNESS: 'MOCKED_LOOPBACK_ONLY', GRYLOO_SOLANA_DEVNET_HARNESS: 'MOCKED_LOOPBACK_ONLY', GRYLOO_LENDING_HARNESS: 'MOCKED_LOOPBACK_ONLY' } : {};

// BUILD-COPILOT-001: the Copilot runs in browser tests only on committed replay answers; a live model is never called from tests.
const copilot = process.env.FLOFI_COPILOT;
if (copilot !== undefined && copilot !== 'off' && copilot !== 'replay') throw new Error('Copilot E2E permits only FLOFI_COPILOT=replay');

export default defineConfig({
  testDir: './e2e',
  ...(cloudRuntime || mcpHarness ? { globalSetup: './e2e/cloud-runtime-setup.ts' } : {}),
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000, toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixels: 0 } },
  reporter: 'list',
  use: {
    baseURL: E2E_APP_ORIGIN,
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
  webServer: [...(supplyHarness ? [{ command: 'node e2e/supply-harness.mjs --serve', url: 'http://127.0.0.1:8549', reuseExistingServer: false, timeout: 30_000 }] : []),
    ...(lendingHarness || mcpHarness ? [{ command: 'node e2e/lending-harness.mjs --serve', url: 'http://127.0.0.1:8554', reuseExistingServer: false, timeout: 30_000 }] : []),
    ...(jupiterHarness ? [{ command: 'node e2e/jupiter-harness.mjs --serve', url: 'http://127.0.0.1:8551', reuseExistingServer: false, timeout: 30_000 }] : []),
    ...(devnetHarness || mcpHarness ? [{ command: 'node e2e/solana-devnet-harness.mjs --serve', url: 'http://127.0.0.1:8552', reuseExistingServer: false, timeout: 30_000 }] : []),
    ...(robinhoodHarness || cloudRuntime ? [{ command: 'node e2e/robinhood-transfer-harness.mjs --serve', url: 'http://127.0.0.1:8553', reuseExistingServer: false, timeout: 30_000 }] : []),
    ...(uniswapHarness ? [{ command: 'node e2e/uniswap-liquidity-serve.ts', url: 'http://127.0.0.1:8556', reuseExistingServer: false, timeout: 30_000 }] : []),
    ...(routerHarness || routerTestnetHarness || mcpHarness ? [{ command: 'node e2e/router-serve.ts', url: 'http://127.0.0.1:8557', reuseExistingServer: false, timeout: 30_000 }] : []), {
    command: modeA === 'synthetic' ? 'node e2e/fork/offline-rehearsal.mjs --serve-synthetic' : 'node e2e/fork/owner-recording.mjs serve-replay',
    url: 'http://127.0.0.1:8547',
    reuseExistingServer: false,
    timeout: 180_000,
    env: { GRYLOO_MODE_A_RUNTIME: runtime, GRYLOO_ANVIL_BIN: anvil,
      ...(modeA === 'replay' && process.env.GRYLOO_MODE_A_TRANSCRIPT ? { GRYLOO_MODE_A_TRANSCRIPT: process.env.GRYLOO_MODE_A_TRANSCRIPT } : {}),
      ...(modeA === 'replay' && process.env.GRYLOO_MODE_A_SYNTHETIC_PINS ? { GRYLOO_MODE_A_SYNTHETIC_PINS: process.env.GRYLOO_MODE_A_SYNTHETIC_PINS } : {}) },
  }, {
    command: 'pnpm --filter @defi-workflow-engine/reference-dapp start',
    url: E2E_APP_ORIGIN,
    reuseExistingServer: false,
    timeout: 60_000,
    // `next start` listens on PORT; FLOFI_E2E_APP_PORT isolates CI from another server on 3000 (release default 3108).
    env: { PORT: String(E2E_APP_PORT), NEXT_TELEMETRY_DISABLED: '1', PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1', GRYLOO_BASE_OBSERVATION: 'replay',
      ...(supplyHarness ? { GRYLOO_SUPPLY_HARNESS: 'MOCKED_LOOPBACK_ONLY', GRYLOO_SUPPLY_JOURNAL: supplyJournal } : {}),
      ...(lendingHarness ? { GRYLOO_LENDING_HARNESS: 'MOCKED_LOOPBACK_ONLY', GRYLOO_SUPPLY_JOURNAL: lendingJournal } : {}),
      ...(jupiterHarness ? { GRYLOO_JUPITER_HARNESS: 'MOCKED_LOOPBACK_ONLY', GRYLOO_JUPITER_JOURNAL: jupiterJournal } : {}),
      ...(devnetHarness ? { GRYLOO_SOLANA_DEVNET_HARNESS: 'MOCKED_LOOPBACK_ONLY', GRYLOO_SOLANA_DEVNET_JOURNAL: devnetJournal } : {}),
      ...(robinhoodHarness ? { GRYLOO_ROBINHOOD_HARNESS: 'MOCKED_LOOPBACK_ONLY', GRYLOO_ROBINHOOD_JOURNAL: robinhoodJournal } : {}),
      ...(uniswapHarness ? { GRYLOO_UNISWAP_LIQUIDITY_HARNESS: 'MOCKED_LOOPBACK_ONLY', GRYLOO_UNISWAP_LIQUIDITY_JOURNAL: uniswapJournal } : {}),
      ...(routerHarness ? { GRYLOO_ROUTER_HARNESS: 'MOCKED_LOOPBACK_ONLY', GRYLOO_ROUTER_JOURNAL: routerJournal } : {}),
      ...(routerTestnetHarness ? { GRYLOO_ROUTER_TESTNET_HARNESS: 'MOCKED_LOOPBACK_ONLY', GRYLOO_ROUTER_TESTNET_JOURNAL: routerTestnetJournal } : {}),
      ...(copilot === 'replay' ? { FLOFI_COPILOT: 'replay' } : {}),
      ...(cloudRuntime ? { FLOFI_RUNTIME: 'embedded', DATABASE_URL: process.env.FLOFI_E2E_DATABASE_URL!, GRYLOO_ROBINHOOD_HARNESS: 'MOCKED_LOOPBACK_ONLY' } : {}),
      ...mcpServerEnv,
      GRYLOO_MODE_A: 'fork', GRYLOO_MODE_A_PROFILE: join(runtime, 'profile.json'), GRYLOO_MODE_A_JOURNAL: join(runtime, 'journal') },
  }],
});
