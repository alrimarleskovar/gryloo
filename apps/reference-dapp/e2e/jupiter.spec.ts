// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { authorSolanaSwap, chooseSolanaWallet, installSolanaWallet, jupiterControl, resetJupiterHarness, reviewSolanaSwap, signRequests } from './jupiter-fixtures';

const panel = (page: import('@playwright/test').Page) => page.getByRole('region', { name: 'Jupiter swap' });
test.afterEach(async ({ page }, info) => { if (info.status !== info.expectedStatus) console.error('Jupiter failure:', await panel(page).locator('pre').textContent().catch(() => 'no panel')); });

test('canonical canvas Swap on Solana → Simulate → Review → Execute → reconciled MOCKED evidence', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const wallet = await resetJupiterHarness(); await installSolanaWallet(page, wallet);
  await authorSolanaSwap(page, 'canvas');
  await expect(page.locator('.react-flow__node[data-id="node-002"]')).toContainText('USDC → SOL');
  await expect(page.locator('.react-flow__node[data-id="node-002"]')).toContainText('SOLANA · JUPITER');
  await reviewSolanaSwap(page);
  await expect(panel(page)).toContainText('Receive at least');
  expect(await jupiterControl({ action: 'sent' })).toBe(0);
  await panel(page).getByRole('button', { name: 'Execute swap' }).click();
  await expect(page.getByRole('link', { name: 'Download Evidence Bundle' })).toBeVisible();
  await expect(panel(page)).toContainText('Swap independently reconciled. Paid 10 USDC');
  await expect(panel(page)).toContainText('Evidence: MOCKED');
  expect(await signRequests(page)).toBe(1); expect(await jupiterControl({ action: 'sent' })).toBe(1);
  const href = await page.getByRole('link', { name: 'Download Evidence Bundle' }).getAttribute('href');
  const evidence = JSON.parse(decodeURIComponent(href!.split(',')[1]!)) as { bundle: { environment: string; outcome: string }; evidenceClass: string };
  expect(evidence.bundle).toMatchObject({ environment: 'MOCKED', outcome: 'RECONCILED' }); expect(evidence.evidenceClass).toBe('MOCKED');
  await expect(panel(page).getByRole('button', { name: 'Execute swap' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('chat “Swap 10 USDC to SOL on Solana” authors the same swap and simulates read-only', async ({ page }) => {
  const wallet = await resetJupiterHarness(); await installSolanaWallet(page, wallet);
  await authorSolanaSwap(page, 'chat');
  await expect(page.locator('.react-flow__node[data-id="node-002"]')).toContainText('10 USDC · Solana · 50 bps');
  await page.getByRole('button', { name: 'Continue to Simulate' }).click();
  await chooseSolanaWallet(panel(page));
  await panel(page).getByRole('button', { name: 'Simulate swap' }).click();
  const summary = page.getByRole('definition').filter({ hasText: '→ expected' });
  await expect(summary).toContainText('10 USDC → expected');
  for (const label of ['Network', 'Provider', 'Quoted output', 'Minimum received', 'Slippage', 'Estimated network fee', 'Quote freshness']) await expect(panel(page).getByRole('term').filter({ hasText: new RegExp(`^${label}$`) })).toBeVisible();
  await expect(panel(page).locator('details')).not.toHaveAttribute('open', '');
  expect(await signRequests(page)).toBe(0); expect(await jupiterControl({ action: 'sent' })).toBe(0);
});
test('wallet rejection is a concrete pre-submission failure', async ({ page }) => {
  const wallet = await resetJupiterHarness(); await installSolanaWallet(page, wallet, { reject: true });
  await authorSolanaSwap(page); await reviewSolanaSwap(page);
  await panel(page).getByRole('button', { name: 'Execute swap' }).click();
  await expect(panel(page).getByRole('status')).toContainText('You declined the signature request. No transaction was sent.');
  await expect(panel(page)).toContainText('Swap: not submitted');
  expect(await jupiterControl({ action: 'sent' })).toBe(0);
});
test('a transaction changed by the wallet after Review is never broadcast', async ({ page }) => {
  const wallet = await resetJupiterHarness();
  // A different, validly signed transaction stands in for a wallet that rewrote the reviewed message.
  const other = await (async () => { const { createMockedSolanaJupiter, simulateJupiterSwap } = await import('@defi-workflow-engine/reference-compiler');
    const { createSolanaSwapNode } = await import('../src/domain/jupiter-authoring');
    const env = createMockedSolanaJupiter(); env.fund(wallet.owner, 3_000_000_000n, { USDC: 100_000_000n });
    const wf = { schemaVersion: '1.0.0' as const, workflowId: 'other', revision: 1, resourceEdges: [], nodes: [createSolanaSwapNode('node-002', { network: 'Solana', from: 'USDC', to: 'SOL', amount: '9', slippage: '50' })] };
    return (await simulateJupiterSwap(wf, wallet.owner, env.http, env.rpc)).unsignedTransaction; })();
  await installSolanaWallet(page, wallet, { modify: other });
  await authorSolanaSwap(page); await reviewSolanaSwap(page);
  await panel(page).getByRole('button', { name: 'Execute swap' }).click();
  await expect(panel(page).getByRole('status')).toContainText('different transaction than the one you reviewed');
  expect(await jupiterControl({ action: 'sent' })).toBe(0);
});
test('stale quote cannot be executed', async ({ page }) => {
  const wallet = await resetJupiterHarness(); await installSolanaWallet(page, wallet);
  await authorSolanaSwap(page); await reviewSolanaSwap(page);
  await expect(panel(page).getByRole('button', { name: 'Execute swap' })).toBeVisible();
  await jupiterControl({ action: 'advance', blocks: 140 });
  await panel(page).getByRole('button', { name: 'Execute swap' }).click();
  await expect(panel(page).getByRole('status')).toContainText('This quote has expired');
  expect(await signRequests(page)).toBe(0); expect(await jupiterControl({ action: 'sent' })).toBe(0);
});
test('semantic edit after Review invalidates authorization', async ({ page }) => {
  const wallet = await resetJupiterHarness(); await installSolanaWallet(page, wallet);
  await authorSolanaSwap(page); await reviewSolanaSwap(page);
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await page.locator('.react-flow__node[data-id="node-002"] .flow-card').click();
  const form = page.getByRole('form', { name: 'Edit Solana swap' });
  await form.getByLabel('Amount').fill('11'); await form.getByRole('button', { name: 'Review swap change' }).click();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(panel(page)).toContainText('The workflow changed. Prior authorization is invalid.');
  await expect(panel(page).getByRole('button', { name: 'Execute swap' })).toHaveCount(0);
  expect(await signRequests(page)).toBe(0);
});
test('uncertain submission is resolved by observing the persisted signature without resubmission', async ({ page }) => {
  const wallet = await resetJupiterHarness({ send: 'RPC_ERROR_AFTER_LANDING' }); await installSolanaWallet(page, wallet);
  await authorSolanaSwap(page); await reviewSolanaSwap(page);
  await panel(page).getByRole('button', { name: 'Execute swap' }).click();
  await expect(page.getByRole('link', { name: 'Download Evidence Bundle' })).toBeVisible();
  expect(await jupiterControl({ action: 'sent' })).toBe(1); expect(await signRequests(page)).toBe(1);
});
test('a dropped transaction survives reload and resolves as expired, never resubmitted', async ({ page }) => {
  const wallet = await resetJupiterHarness({ send: 'DROPPED' }); await installSolanaWallet(page, wallet);
  await authorSolanaSwap(page); await reviewSolanaSwap(page);
  await panel(page).getByRole('button', { name: 'Execute swap' }).click();
  await expect(panel(page)).toContainText('Swap: pending');
  expect(await signRequests(page)).toBe(1);
  await page.reload();
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Observe existing transaction' })).toBeVisible();
  await jupiterControl({ action: 'advance', blocks: 200 });
  await panel(page).getByRole('button', { name: 'Observe existing transaction' }).click();
  await expect(panel(page).getByRole('status')).toContainText('expired without landing. No swap happened');
  expect(await jupiterControl({ action: 'sent' })).toBe(1); expect(await signRequests(page)).toBe(0);
});
test('pending wallet signature freezes semantic authoring until the owner responds', async ({ page }) => {
  const wallet = await resetJupiterHarness(); await installSolanaWallet(page, wallet, { pause: true });
  await authorSolanaSwap(page); await reviewSolanaSwap(page);
  await panel(page).getByRole('button', { name: 'Execute swap' }).click();
  await expect(page.locator('[data-jupiter-wallet-pending="true"]')).toHaveAttribute('inert', '');
  await page.keyboard.press('Control+z');
  await page.evaluate(() => (window as unknown as { releaseSolanaSignature: () => void }).releaseSolanaSignature());
  await expect(page.getByRole('link', { name: 'Download Evidence Bundle' })).toBeVisible();
  expect(await jupiterControl({ action: 'sent' })).toBe(1);
});
