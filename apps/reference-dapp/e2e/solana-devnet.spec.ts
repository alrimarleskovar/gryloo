// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, chooseWallet, openSimulationDetails, acceptProductReview } from './fixtures';
import { MOCKED_SOLANA_WALLET, chooseSolanaWallet, decoyWalletCalls, signChains, signRequests } from './jupiter-fixtures';
import { authorDevnetSwap, devnetControl, devnetPanel as panel, installDevnetWallet, resetDevnetHarness, reviewDevnetSwap } from './solana-devnet-fixtures';

// MOCKED Devnet loopback only: these runs prove the UX and fail-closed paths, never DEVNET_EXECUTED.
test.afterEach(async ({ page }, info) => { if (info.status !== info.expectedStatus) console.error('Devnet failure:', await panel(page).locator('pre').textContent().catch(() => 'no panel')); });

test('canvas Swap on Solana Devnet → Simulate → Review → Execute → Result with signature, Devnet explorer link and MOCKED evidence', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const wallet = await resetDevnetHarness({}, { devUsdc: '0' }); await installDevnetWallet(page, wallet);
  await authorDevnetSwap(page, 'canvas');
  const card = page.locator('.react-flow__node[data-id="node-002"]');
  await expect(card).toContainText('Orca Whirlpools · Solana Devnet');
  await expect(card.getByRole('button', { name: 'Select source token', exact: true })).toHaveAttribute('title', 'SOL on Solana Devnet');
  await expect(card.getByRole('button', { name: 'Select destination token', exact: true })).toHaveAttribute('title', 'devUSDC on Solana Devnet');
  await expect(card).not.toContainText('Jupiter');
  await page.getByRole('button', { name: 'Simulate fees' }).click();
  await openSimulationDetails(page);
  await chooseSolanaWallet(panel(page));
  await expect(panel(page)).toContainText('Wallet connected · Solana Devnet');
  await panel(page).getByRole('button', { name: 'Simulate swap' }).click();
  await expect(panel(page).getByRole('definition').filter({ hasText: '→ expected' })).toContainText('0.1 Devnet SOL → expected');
  for (const [term, value] of [['Network', 'Solana Devnet'], ['Provider', 'Orca Whirlpools']] as const)
    await expect(panel(page).getByRole('term').filter({ hasText: new RegExp(`^${term}$`) }).locator('xpath=following-sibling::dd[1]')).toHaveText(value);
  for (const label of ['Expected output', 'Minimum received', 'Slippage', 'Estimated network fee', 'Quote freshness']) await expect(panel(page).getByRole('term').filter({ hasText: new RegExp(`^${label}$`) })).toBeVisible();
  await expect(panel(page)).toContainText('test tokens only');
  expect((await panel(page).locator(':scope > :not(details)').allInnerTexts()).join(' ')).not.toContain('Jupiter');
  await expect(panel(page).locator('details')).not.toHaveAttribute('open', '');
  await acceptProductReview(page);
  await expect(panel(page)).toContainText('Receive at least');
  await expect(panel(page).getByRole('checkbox')).toHaveCount(0); // no real-funds acknowledgement on Devnet
  expect(await devnetControl({ action: 'sent' })).toBe(0);
  await panel(page).getByRole('button', { name: 'Execute swap' }).click();
  const result = panel(page).getByRole('region', { name: 'Swap result' });
  await expect(result.getByRole('heading', { name: 'Success' })).toBeVisible();
  await expect(result).toContainText('Paid 0.1 Devnet SOL; received');
  await expect(result.getByRole('link', { name: 'View on Solana Explorer (Devnet)' })).toHaveAttribute('href', /^https:\/\/explorer\.solana\.com\/tx\/[1-9A-HJ-NP-Za-km-z]{64,88}\?cluster=devnet$/);
  await expect(result).toContainText('Evidence: MOCKED');
  expect(await signRequests(page)).toBe(1); expect(await signChains(page)).toEqual(['solana:devnet']); expect(await devnetControl({ action: 'sent' })).toBe(1);
  const href = await result.getByRole('link', { name: 'Download Evidence Bundle' }).getAttribute('href');
  const evidence = JSON.parse(decodeURIComponent(href!.split(',')[1]!)) as { bundle: { environment: string; outcome: string }; evidenceClass: string; publicExecution: { cluster: string; provider: string } };
  expect(evidence.bundle).toMatchObject({ environment: 'MOCKED', outcome: 'RECONCILED' }); expect(evidence.evidenceClass).toBe('MOCKED');
  expect(evidence.publicExecution).toMatchObject({ cluster: 'devnet', provider: 'Orca Whirlpools swap_v2 (Solana Devnet)' });
  await expect(panel(page).getByRole('button', { name: 'Execute swap' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('chat “Swap 10 test USDC to test SOL on Solana Devnet” authors the same canonical swap and simulates read-only', async ({ page }) => {
  const wallet = await resetDevnetHarness(); await installDevnetWallet(page, wallet);
  await authorDevnetSwap(page, 'chat');
  await expect(page.locator('.react-flow__node[data-id="node-002"]')).toContainText('10 devUSDC · Solana Devnet · 50 bps');
  await page.getByRole('button', { name: 'Simulate fees' }).click();
  await chooseSolanaWallet(panel(page));
  await panel(page).getByRole('button', { name: 'Simulate swap' }).click();
  await expect(panel(page).getByRole('definition').filter({ hasText: '→ expected' })).toContainText('10 devUSDC (test) → expected');
  expect(await signRequests(page)).toBe(0); expect(await devnetControl({ action: 'sent' })).toBe(0);
});
test('Devnet wallet rejection is a concrete pre-submission failure', async ({ page }) => {
  const wallet = await resetDevnetHarness(); await installDevnetWallet(page, wallet, { reject: true });
  await authorDevnetSwap(page); await reviewDevnetSwap(page);
  await panel(page).getByRole('button', { name: 'Execute swap' }).click();
  await expect(panel(page).getByRole('status')).toContainText('You declined the signature request. No transaction was sent.');
  await expect(panel(page)).toContainText('Swap: not submitted');
  expect(await devnetControl({ action: 'sent' })).toBe(0);
});
test('a Devnet transaction changed by the wallet is never broadcast', async ({ page }) => {
  const wallet = await resetDevnetHarness();
  const other = await (async () => { const { createMockedSolanaDevnetOrca, simulateOrcaDevnetSwap } = await import('@defi-workflow-engine/reference-compiler');
    const { createSolanaSwapNode } = await import('../src/domain/jupiter-authoring');
    const env = createMockedSolanaDevnetOrca(); env.fund(wallet.owner, 3_000_000_000n, 0n);
    const wf = { schemaVersion: '1.0.0' as const, workflowId: 'other', revision: 1, resourceEdges: [], nodes: [createSolanaSwapNode('node-002', { network: 'Solana Devnet', from: 'SOL', to: 'devUSDC', amount: '0.09', slippage: '50' })] };
    return (await simulateOrcaDevnetSwap(wf, wallet.owner, env.rpc)).unsignedTransaction; })();
  await installDevnetWallet(page, wallet, { modify: other });
  await authorDevnetSwap(page); await reviewDevnetSwap(page);
  await panel(page).getByRole('button', { name: 'Execute swap' }).click();
  await expect(panel(page).getByRole('status')).toContainText('different transaction than the one you reviewed');
  expect(await devnetControl({ action: 'sent' })).toBe(0);
});
test('a stale Devnet Review cannot be executed, and a semantic edit invalidates it', async ({ page }) => {
  const wallet = await resetDevnetHarness(); await installDevnetWallet(page, wallet);
  await authorDevnetSwap(page); await reviewDevnetSwap(page);
  await expect(panel(page).getByRole('button', { name: 'Execute swap' })).toBeVisible();
  await devnetControl({ action: 'advance', blocks: 140 });
  await panel(page).getByRole('button', { name: 'Execute swap' }).click();
  await expect(panel(page).getByRole('status')).toContainText('This quote has expired');
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await page.locator('.react-flow__node[data-id="node-002"] .flow-card').click();
  const form = page.getByRole('form', { name: 'Edit Solana Devnet swap' });
  await form.getByLabel('Amount').fill('0.2'); await form.getByRole('button', { name: 'Review swap change' }).click();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(panel(page)).toContainText('The workflow changed. Prior authorization is invalid.');
  await expect(panel(page).getByRole('button', { name: 'Execute swap' })).toHaveCount(0);
  expect(await signRequests(page)).toBe(0); expect(await devnetControl({ action: 'sent' })).toBe(0);
});
test('an uncertain Devnet submission is resolved from the persisted signature without resubmission', async ({ page }) => {
  const wallet = await resetDevnetHarness({ send: 'RPC_ERROR_AFTER_LANDING' }); await installDevnetWallet(page, wallet);
  await authorDevnetSwap(page); await reviewDevnetSwap(page);
  await panel(page).getByRole('button', { name: 'Execute swap' }).click();
  await expect(panel(page).getByRole('region', { name: 'Swap result' }).getByRole('heading', { name: 'Success' })).toBeVisible();
  expect(await devnetControl({ action: 'sent' })).toBe(1); expect(await signRequests(page)).toBe(1);
});
test('a dropped Devnet transaction survives reload and resolves as expired, never resubmitted', async ({ page }) => {
  const wallet = await resetDevnetHarness({ send: 'DROPPED' }); await installDevnetWallet(page, wallet);
  await authorDevnetSwap(page); await reviewDevnetSwap(page);
  await panel(page).getByRole('button', { name: 'Execute swap' }).click();
  await expect(panel(page)).toContainText('Swap: pending');
  await page.reload();
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Observe existing transaction' })).toBeVisible();
  await devnetControl({ action: 'advance', blocks: 200 });
  await panel(page).getByRole('button', { name: 'Observe existing transaction' }).click();
  await expect(panel(page).getByRole('status')).toContainText('expired without landing. No swap happened');
  expect(await devnetControl({ action: 'sent' })).toBe(1); expect(await signRequests(page)).toBe(0);
});
test('Connect lists every compatible Wallet Standard provider and uses only the one the owner chooses', async ({ page }) => {
  const wallet = await resetDevnetHarness({}, { devUsdc: '0' });
  const SOLANA = ['solana:mainnet', 'solana:devnet'];
  // MetaMask and Brave Wallet register first, as browser-injected wallets often do; an EVM-only and a mainnet-only provider are not offered on Devnet.
  await installDevnetWallet(page, wallet, { decoys: [{ name: 'MetaMask', chains: SOLANA }, { name: 'Brave Wallet', chains: SOLANA },
    { name: 'EVM Only', chains: ['eip155:1'] }, { name: 'Mainnet Only', chains: ['solana:mainnet'] }] });
  await authorDevnetSwap(page);
  await page.getByRole('button', { name: 'Simulate fees' }).click();
  await panel(page).getByRole('button', { name: 'Simulate swap' }).click();
  await expect(panel(page).getByRole('status')).toContainText('Connect a Solana wallet first and choose which wallet to use.');
  await panel(page).getByRole('button', { name: 'Connect Solana wallet' }).click();
  // The canonical selector offers only wallets that can connect and sign on Solana Devnet; opening it calls none of them.
  const choices = page.locator('dialog.wallet-selector[open]').getByRole('button', { name: / on Solana$/ });
  await expect(choices).toHaveText([/Brave Wallet/, new RegExp(MOCKED_SOLANA_WALLET), /MetaMask/]);
  await expect(panel(page)).not.toContainText('Wallet connected');
  expect(await decoyWalletCalls(page)).toEqual([]);
  await chooseWallet(page, MOCKED_SOLANA_WALLET, 'Solana');
  await expect(panel(page)).toContainText(`Wallet connected · Solana Devnet: ${wallet.owner}`);
  await panel(page).getByRole('button', { name: 'Simulate swap' }).click();
  await panel(page).getByRole('definition').filter({ hasText: '→ expected' }).waitFor();
  await page.getByRole('button', { name: 'Review swap', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Accept swap review' }).click();
  await panel(page).getByRole('button', { name: 'Execute swap' }).click();
  await expect(panel(page).getByRole('region', { name: 'Swap result' }).getByRole('heading', { name: 'Success' })).toBeVisible();
  expect(await signRequests(page)).toBe(1); expect(await signChains(page)).toEqual(['solana:devnet']);
  expect(await decoyWalletCalls(page)).toEqual([]);
});
