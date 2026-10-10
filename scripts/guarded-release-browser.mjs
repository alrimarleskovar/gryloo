// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

// The same explicit profiles run locally and in CI. Financial diagnostic specs
// remain available independently; none of their results are counted as passes.
const phase = process.argv[2];
if (!['product', 'composition'].includes(phase) || process.argv.length !== 3) {
  throw new Error('Usage: node scripts/guarded-release-browser.mjs product|composition');
}
const boundary = 'release-financial-provenance.spec.ts';
const profiles = phase === 'composition' ? [
  ['composition-provenance', ['release-composition-provenance.spec.ts'], {}],
] : [
  ['default-product', ['brand-ux-001.spec.ts', 'base-observation.spec.ts', 'build-roundtrip.spec.ts', 'build009.spec.ts', 'across.spec.ts',
    'canvas-keyboard.spec.ts', 'canvas-ux.spec.ts', 'contextual-proposals.spec.ts', 'cross-chain-liquidity-recovery.spec.ts',
    'cross-chain-liquidity.spec.ts', 'execution-capabilities.spec.ts', 'interface-honesty.spec.ts', 'mock-artifact-chain.spec.ts',
    'network-isolation.spec.ts', 'public-testnet.spec.ts', 'robinhood-network.spec.ts', 'swap-authoring.spec.ts', 'visual-shell.spec.ts', 'credentials.spec.ts'], {}],
  ['review-execute-recovery-components', ['simulate-review-acceptance.spec.ts', 'execute-product-workspace.spec.ts', 'execute-workflow.spec.ts'], {}],
  ['workflow-acceptance', ['acceptance-workflows.spec.ts'], { GRYLOO_CLOUD_RUNTIME_E2E: 'EMBEDDED_LOOPBACK_ONLY', GRYLOO_ROUTER_TESTNET_E2E: 'MOCKED_LOOPBACK_ONLY', TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://flofi@127.0.0.1:5432/postgres' }],
  ['swap-read-acceptance', ['acceptance-swap-read.spec.ts'], { GRYLOO_CLOUD_RUNTIME_E2E: 'EMBEDDED_LOOPBACK_ONLY', FLOFI_SWAP_READ_E2E: 'MOCKED_LOOPBACK_ONLY', TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://flofi@127.0.0.1:5432/postgres' }],
  // BUILD-EXECUTION-CONTINUITY-001: production UI/API/durable lifecycle, isolated synthetic RPC and scripted owner wallet confirmations.
  ['execution-continuity', ['execution-continuity.spec.ts'], { GRYLOO_CLOUD_RUNTIME_E2E: 'EMBEDDED_LOOPBACK_ONLY', FLOFI_SWAP_READ_E2E: 'MOCKED_LOOPBACK_ONLY', FLOFI_SWAP_EXECUTION_E2E: 'MOCKED_LOOPBACK_ONLY', TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://flofi@127.0.0.1:5432/postgres' }],
  // BUILD-AUTOMATION-001: Automations (fixture price source, test clock) into the owner's /approve → Simulate → Review; never a transaction.
  ['automations', ['automations.spec.ts'], { GRYLOO_CLOUD_RUNTIME_E2E: 'EMBEDDED_LOOPBACK_ONLY', FLOFI_SWAP_READ_E2E: 'MOCKED_LOOPBACK_ONLY', GRYLOO_AUTOMATION_E2E: 'FIXTURE_LOOPBACK_ONLY', TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://flofi@127.0.0.1:5432/postgres' }],
  ['supply-provenance', ['release-provenance.spec.ts'], { GRYLOO_SUPPLY_E2E: 'MOCKED_LOOPBACK_ONLY' }],
  ['unsafe-lending-simulations', ['borrow.spec.ts', 'repay.spec.ts', '--grep', 'read-only simulation blocks unsafe Borrow before Review|insufficient debt blocks read-only simulation'], { GRYLOO_SUPPLY_E2E: 'MOCKED_LOOPBACK_ONLY' }],
  ['copilot', ['copilot.spec.ts', 'copilot-conversation.spec.ts'], { FLOFI_COPILOT: 'replay', GRYLOO_SUPPLY_E2E: 'MOCKED_LOOPBACK_ONLY' }],
  ['lending-provenance', [boundary], { FLOFI_RELEASE_PROVENANCE_PROFILE: 'lending', GRYLOO_LENDING_E2E: 'MOCKED_LOOPBACK_ONLY' }],
  ['jupiter-provenance', [boundary], { FLOFI_RELEASE_PROVENANCE_PROFILE: 'jupiter', GRYLOO_JUPITER_E2E: 'MOCKED_LOOPBACK_ONLY' }],
  ['devnet-provenance', [boundary], { FLOFI_RELEASE_PROVENANCE_PROFILE: 'solana-devnet', GRYLOO_SOLANA_DEVNET_E2E: 'MOCKED_LOOPBACK_ONLY' }],
  ['orca-liquidity-provenance', [boundary], { FLOFI_RELEASE_PROVENANCE_PROFILE: 'solana-liquidity', GRYLOO_SOLANA_DEVNET_E2E: 'MOCKED_LOOPBACK_ONLY' }],
  ['transfer-provenance', [boundary], { FLOFI_RELEASE_PROVENANCE_PROFILE: 'transfer', GRYLOO_ROBINHOOD_E2E: 'MOCKED_LOOPBACK_ONLY' }],
  ['uniswap-provenance', [boundary], { FLOFI_RELEASE_PROVENANCE_PROFILE: 'uniswap', GRYLOO_UNISWAP_LIQUIDITY_E2E: 'MOCKED_LOOPBACK_ONLY' }],
  ['router-provenance', [boundary], { FLOFI_RELEASE_PROVENANCE_PROFILE: 'router', GRYLOO_ROUTER_E2E: 'MOCKED_LOOPBACK_ONLY' }],
  ['journey-provenance', [boundary], { FLOFI_RELEASE_PROVENANCE_PROFILE: 'journey', GRYLOO_ROUTER_TESTNET_E2E: 'MOCKED_LOOPBACK_ONLY' }],
  ['cloud-provenance', [boundary], { FLOFI_RELEASE_PROVENANCE_PROFILE: 'cloud', GRYLOO_CLOUD_RUNTIME_E2E: 'EMBEDDED_LOOPBACK_ONLY', TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://flofi@127.0.0.1:5432/postgres' }],
  ['synthetic-fork-provenance', ['release-fork-provenance.spec.ts'], { GRYLOO_MODE_A_E2E: 'synthetic' }],
  ['cow-loopback', ['cow-intent.spec.ts', 'cow-recovery.spec.ts'], { GRYLOO_COW: 'loopback' }],
  ['card-provider-loopback', ['card-provider.spec.ts'], { GRYLOO_CARD_E2E: 'MOCKED_LOOPBACK_ONLY' }],
];

for (const [name, specs, settings] of profiles) {
  const env = { ...process.env, GRYLOO_MODE_A_E2E: 'synthetic' };
  for (const key of ['FLOFI_COPILOT', 'FLOFI_RELEASE_PROVENANCE_PROFILE', 'GRYLOO_SUPPLY_E2E', 'GRYLOO_LENDING_E2E',
    'GRYLOO_JUPITER_E2E', 'GRYLOO_SOLANA_DEVNET_E2E', 'GRYLOO_ROBINHOOD_E2E', 'GRYLOO_UNISWAP_LIQUIDITY_E2E',
    'GRYLOO_ROUTER_E2E', 'GRYLOO_ROUTER_TESTNET_E2E', 'GRYLOO_CLOUD_RUNTIME_E2E', 'FLOFI_SWAP_READ_E2E', 'FLOFI_SWAP_EXECUTION_E2E', 'GRYLOO_COW', 'GRYLOO_CARD_E2E', 'GRYLOO_AUTOMATION_E2E']) delete env[key];
  Object.assign(env, settings);
  console.log(`Guarded release profile: ${name}`);
  const started = performance.now();
  const result = spawnSync('pnpm', ['--filter', '@defi-workflow-engine/reference-dapp', 'exec', 'playwright', 'test', ...specs], { env, stdio: 'inherit' });
  console.log(`Guarded release profile duration: ${name}: ${((performance.now() - started) / 1000).toFixed(2)}s; ${result.error || result.status !== 0 ? 'FAIL' : 'PASS'}`);
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`Guarded release ${phase}: PASS (${profiles.length} profiles)`);
