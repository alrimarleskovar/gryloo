// SPDX-License-Identifier: AGPL-3.0-only
import type { Page } from '@playwright/test';
import { createDatabase } from '@defi-workflow-engine/cloud-runtime';
import { test, expect, applyPendingProposal, openSimulationDetails } from './fixtures';
import { assertSimulationReviewBlocked } from './release-safety-fixtures';
import { resetLending, installLendingWallet, lendingSends, LENDING_OWNER } from './lending-fixtures';
import { resetJupiterHarness, installSolanaWallet, authorSolanaSwap, chooseSolanaWallet, signRequests, jupiterControl } from './jupiter-fixtures';
import { resetDevnetHarness, installDevnetWallet, authorDevnetSwap, devnetControl } from './solana-devnet-fixtures';
import { resetTransferHarness, installTransferWallet, sendRequests, chainBroadcasts, transferHarnessRpc } from './robinhood-transfer-fixtures';
import { resetUniswapHarness, installUniswapWallet, walletSends } from './uniswap-liquidity-fixtures';
import { resetRouterHarness, installRouterWallet, routerWalletSends } from './router-fixtures';
import { resetJourneyHarness, installJourneyWallet, journeySends } from './journey-fixtures';
import { createTestWallet } from '../../../packages/reference-reconciler/test/test-wallet';

// Every profile uses its existing deterministic engineering harness. Positive
// financial lifecycle assertions remain in the original diagnostic specs and in
// the mandatory service/executor/reconciler suites; MOCKED cannot authorize UI.
const profile = process.env.FLOFI_RELEASE_PROVENANCE_PROFILE;
const profiles = ['lending', 'jupiter', 'solana-devnet', 'solana-liquidity', 'transfer', 'uniswap', 'router', 'journey', 'cloud'] as const;
if (!profiles.some(value => value === profile)) throw new Error('An exact FLOFI_RELEASE_PROVENANCE_PROFILE is required');

async function chat(page: Page, text: string) {
  await page.goto('/');
  await page.getByLabel('Describe your flow').fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await applyPendingProposal(page);
}
async function simulate(page: Page) {
  await page.getByRole('button', { name: 'Simulate fees', exact: true }).click();
  await openSimulationDetails(page);
}

if (profile === 'lending') test('MOCKED Supply → Borrow → Swap retains its economic limits and cannot authorize any composed wallet request', async ({ page }) => {
  await resetLending(); await installLendingWallet(page);
  await chat(page, `compose supply 0.1 USDC to Aave then borrow 0.01 USDC then swap borrowed USDC to WETH on Base Sepolia slippage 50 bps owner ${LENDING_OWNER}`);
  await expect(page.locator('.build-flow-surface .composer-card')).toHaveCount(3);
  await simulate(page);
  const panel = page.getByRole('region', { name: 'Lending composition', exact: true });
  await page.getByRole('button', { name: 'Simulate lending composition', exact: true }).click();
  await expect(panel).toContainText('Borrow / exact Swap input: 0.01 USDC');
  await expect(panel).toContainText('Maximum total network fee:');
  await assertSimulationReviewBlocked(page, () => lendingSends(page));
});

if (profile === 'jupiter' || profile === 'solana-devnet') test(`${profile} MOCKED quote preserves chain and minimum output without a signature or broadcast`, async ({ page }) => {
  const devnet = profile === 'solana-devnet';
  const wallet = devnet ? await resetDevnetHarness() : await resetJupiterHarness();
  if (devnet) { await installDevnetWallet(page, wallet); await authorDevnetSwap(page, 'chat'); }
  else { await installSolanaWallet(page, wallet); await authorSolanaSwap(page, 'chat'); }
  await simulate(page);
  const panel = page.getByRole('region', { name: devnet ? 'Solana Devnet swap' : 'Jupiter swap', exact: true });
  await chooseSolanaWallet(panel);
  await panel.getByRole('button', { name: 'Simulate swap', exact: true }).click();
  await expect(panel.getByRole('term').filter({ hasText: /^Minimum received$/ })).toBeVisible();
  await expect(panel).toContainText(devnet ? 'Solana Devnet' : 'Solana');
  await assertSimulationReviewBlocked(page, () => signRequests(page));
  expect(await (devnet ? devnetControl({ action: 'sent' }) : jupiterControl({ action: 'sent' }))).toBe(0);
});

if (profile === 'solana-liquidity') test('MOCKED Orca liquidity retains exact ticks and contribution without creating financial authority', async ({ page }) => {
  const wallet = await resetDevnetHarness(); await installDevnetWallet(page, wallet);
  await chat(page, 'Add liquidity 0.01 SOL and 0.30 devUSDC ticks -39104 to -36992 on Solana Devnet');
  await simulate(page);
  const panel = page.getByRole('region', { name: 'Solana Devnet liquidity', exact: true });
  await chooseSolanaWallet(panel);
  await panel.getByRole('button', { name: 'Simulate position', exact: true }).click();
  await expect(panel).toContainText('aligned ticks -39104 to -36992');
  await expect(panel.getByRole('term').filter({ hasText: /^Expected contribution$/ })).toBeVisible();
  await assertSimulationReviewBlocked(page, () => signRequests(page));
  expect(await devnetControl({ action: 'sent' })).toBe(0);
});

if (profile === 'transfer' || profile === 'cloud') for (const route of profile === 'cloud' ? [''] as const : ['', '/ethereum-sepolia'] as const) {
  test(`MOCKED ${route ? 'Ethereum Sepolia' : 'Robinhood'} transfer keeps its chain and amount but never sends or claims reconciliation`, async ({ page }) => {
    if (profile === 'cloud') await transferHarnessRpc('MOCK_reset', [{ nonce: 40 }]);
    else await resetTransferHarness({}, route);
    const broadcastsBefore = await chainBroadcasts(route);
    await installTransferWallet(page, { ...(route ? { chain: '0xaa36a7', route } : {}) });
    await page.goto('/');
    await page.getByText('Advanced action setup', { exact: true }).click();
    const form = page.getByRole('form', { name: 'Create Robinhood transfer' });
    if (route) await form.getByLabel('Transfer network').selectOption('Ethereum Sepolia');
    await form.getByLabel('Transfer amount (test ETH)').fill('0.000001');
    await form.getByRole('button', { name: 'Review transfer proposal' }).click();
    await applyPendingProposal(page); await simulate(page);
    const panel = page.getByRole('region', { name: route ? 'Ethereum Sepolia transfer' : 'Robinhood Testnet transfer', exact: true });
    await panel.getByRole('button', { name: 'Simulate transfer', exact: true }).click();
    await expect(panel).toContainText(route ? '11155111' : '46630');
    await expect(panel).toContainText('0.000001');
    await assertSimulationReviewBlocked(page, async () => (await sendRequests(page)).length);
    expect(await chainBroadcasts(route)).toBe(broadcastsBefore);
    if (profile === 'cloud') {
      const db = createDatabase({ connectionString: process.env.FLOFI_E2E_DATABASE_URL!, maxConnections: 1 });
      try {
        const rows = (await db.query<{ provenance: string; status: string; attempts: number }>(`SELECT r.provenance, r.status,
          (SELECT count(*)::int FROM execution_attempts a WHERE a.run_id = r.run_id) AS attempts
          FROM execution_runs r WHERE r.flow = 'robinhood-transfer'`)).rows;
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ provenance: 'MOCKED', attempts: 0 });
        expect(rows[0]!.status).not.toBe('RECONCILED');
      } finally { await db.close(); }
    }
  });
}

if (profile === 'uniswap') test('MOCKED Uniswap liquidity retains exact approval amounts, ticks and recipient while Review rejects execution', async ({ page }) => {
  await resetUniswapHarness(); await installUniswapWallet(page); await page.goto('/');
  await page.getByText('Advanced action setup', { exact: true }).click();
  await page.locator('#liquidity-network').selectOption('BASE_SEPOLIA');
  const form = page.getByRole('form', { name: 'Create Base Sepolia liquidity position' });
  await form.getByLabel('Maximum USDC').fill('10'); await form.getByLabel('Maximum WETH').fill('0.005');
  await form.getByRole('button', { name: 'Use ±10% around the current Base Sepolia price' }).click();
  await form.getByRole('button', { name: 'Review position proposal' }).click();
  await applyPendingProposal(page); await simulate(page);
  const panel = page.getByRole('region', { name: 'Base Sepolia liquidity' });
  await panel.getByRole('button', { name: 'Simulate position', exact: true }).click();
  for (const text of ['exactly 10 USDC', 'exactly 0.005 WETH', 'exact ticks', 'your wallet']) await expect(panel).toContainText(text);
  await assertSimulationReviewBlocked(page, walletSends);
});

if (profile === 'uniswap') test('liquidity proposal waits for price-derived bounds, including keyboard submission', async ({ page }) => {
  await resetUniswapHarness(); await installUniswapWallet(page); await page.goto('/');
  await page.getByText('Advanced action setup', { exact: true }).click();
  await page.locator('#liquidity-network').selectOption('BASE_SEPOLIA');
  const form = page.getByRole('form', { name: 'Create Base Sepolia liquidity position' });
  await form.getByLabel('Maximum USDC').fill('10'); await form.getByLabel('Maximum WETH').fill('0.005');
  let release!: () => void, requested!: () => void;
  const priceGate = new Promise<void>(resolve => { release = resolve; });
  const priceRequested = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/*', async route => {
    if (route.request().method() === 'POST' && route.request().headers()['next-action'] && route.request().postData() === '["eip155:84532"]') {
      requested(); await priceGate;
    }
    await route.fallback(); // Retain the existing same-origin network guard.
  });
  try {
    await form.getByRole('button', { name: 'Use ±10% around the current Base Sepolia price' }).click();
    await priceRequested;
    await expect(form.getByRole('button', { name: 'Review position proposal' })).toBeDisabled();
    await form.evaluate(element => (element as HTMLFormElement).requestSubmit());
    await expect(form.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Review proposed change:/ })).toHaveCount(0);
  } finally { release(); }
  await expect(form.getByLabel('Lower bound')).toHaveValue('224640');
  await expect(form.getByLabel('Upper bound')).toHaveValue('226660');
  await form.getByRole('button', { name: 'Review position proposal' }).click();
  await applyPendingProposal(page);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
  expect(await walletSends()).toBe(0);
});

if (profile === 'router' || profile === 'journey') test(`${profile} preserves read-only route truth and never promotes a MOCKED bridge into financial authority`, async ({ page }) => {
  if (profile === 'journey') {
    const wallet = createTestWallet(); await resetJourneyHarness([wallet]); await installJourneyWallet(page, [wallet]);
  } else { await resetRouterHarness(); await installRouterWallet(page); }
  await chat(page, profile === 'journey' ? 'Bridge 1 USDC from Base Sepolia to Arbitrum Sepolia' : 'Bridge 10 USDC from Base to Arbitrum');
  await simulate(page);
  const panel = page.getByRole('region', { name: 'Cross-chain bridge', exact: true });
  await panel.getByRole('button', { name: 'Get route and simulate', exact: true }).click();
  await expect(panel.getByRole('list', { name: 'Route steps' })).toBeVisible();
  await expect(panel).toContainText('Minimum received');
  await assertSimulationReviewBlocked(page, profile === 'journey' ? journeySends : routerWalletSends);
});
