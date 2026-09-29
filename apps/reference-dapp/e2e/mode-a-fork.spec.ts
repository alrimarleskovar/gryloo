// SPDX-License-Identifier: AGPL-3.0-only
import { payloadIdentity, fromHex, encodeUnsignedPayload } from '@defi-workflow-engine/reference-compiler';
import { verifySignedPayload } from '@defi-workflow-engine/reference-reconciler';
import {
  authorSwap, executionPanel, expect, forkPanel, forkRpc, preparedRecord, requestStep, reviewAndConnect, simulateOnFork, stepState, test, visual,
} from './mode-a-fixtures';

const unsignedFromRequest = (request: Record<string, string>) => encodeUnsignedPayload({ chainId: 31337, nonce: BigInt(request.nonce!),
  maxPriorityFeePerGas: BigInt(request.maxPriorityFeePerGas!), maxFeePerGas: BigInt(request.maxFeePerGas!), gasLimit: BigInt(request.gas!),
  to: request.to!, value: 0n, data: fromHex(request.data!), accessList: [] });

test('WETH to USDC: the wallet request equals the reviewed bytes and the outcome reconciles on the fork', async ({ page, fork, testWallet }) => {
  await page.goto('/');
  await authorSwap(page, 'WETH_TO_USDC', '1', '100');
  await simulateOnFork(page);
  await expect(forkPanel(page)).toContainText(fork.fixture.environment);
  await expect(forkPanel(page)).toContainText('USD values: not modeled.');
  await visual(page, 'fork-simulated.png');
  await reviewAndConnect(page);
  const review = page.getByRole('region', { name: 'Mode A Manifest review' });
  await expect(review.locator('.status-badge', { hasText: 'EXACT_SIGNED_PAYLOAD' })).toBeVisible();
  await expect(review).toContainText('NOT_ENFORCED');
  await expect(review).toContainText('Residual allowance risk');
  await visual(page, 'manifest-review.png');
  await requestStep(page, 'Step 1 · approve exact input');
  await expect(stepState(page, 'Step 1 · approve exact input')).toHaveText('CONFIRMED_NOT_RECONCILED');
  await requestStep(page, 'Step 2 · exact swap');
  await expect(stepState(page, 'Step 2 · exact swap')).toHaveText('CONFIRMED_NOT_RECONCILED');
  await executionPanel(page).getByRole('button', { name: 'Reconcile from independent fork reads' }).click();
  await expect(executionPanel(page).locator('[data-outcome]')).toHaveText('RECONCILED');
  await expect(executionPanel(page).locator('[data-evidence-hash]')).toHaveText(/^0x[0-9a-f]{64}$/);
  await visual(page, 'execute-reconciled.png');

  // Exact payload proof: every wallet-requested field set re-encodes to the reviewed bytes, and the
  // independently read signed transaction carries exactly those unsigned bytes.
  const prepared = preparedRecord(fork);
  expect(testWallet.sent).toHaveLength(2);
  for (const [index, sent] of testWallet.sent.entries()) {
    const reviewed = prepared.payloads[index]!;
    expect(sent).toEqual(reviewed.request);
    expect(payloadIdentity(unsignedFromRequest(sent)).payloadHash).toBe(reviewed.payloadHash);
  }
  const attempts = testWallet.calls.filter(call => call.method === 'eth_sendTransaction');
  expect(attempts).toHaveLength(2);
  for (const reviewed of prepared.payloads) {
    const nonce = BigInt(reviewed.request.nonce!);
    const block = await forkRpc('eth_getBlockByNumber', ['latest', true]) as { number: string };
    let found = false;
    for (let number = BigInt(block.number); number > 0n && !found; number--) {
      const item = await forkRpc('eth_getBlockByNumber', [`0x${number.toString(16)}`, true]) as { transactions: { hash: string; from: string; nonce: string }[] };
      const tx = item.transactions.find(entry => entry.from.toLowerCase() === prepared.owner && BigInt(entry.nonce) === nonce);
      if (tx) {
        const raw = await forkRpc('eth_getRawTransactionByHash', [tx.hash]) as string;
        verifySignedPayload(fromHex(raw), tx.hash, prepared.owner, fromHex(reviewed.bytes));
        found = true;
      }
    }
    expect(found).toBe(true);
  }
  await expect(page.locator('body')).not.toContainText(/MAINNET_EXECUTED|TESTNET_EXECUTED|mainnet executed|(?<!not )production certified/i);
  await expect(executionPanel(page)).toContainText('Not mainnet, not a public testnet, not production certified.');
});

test('USDC to WETH reconciles through two separate exact authorizations', async ({ page, testWallet }) => {
  await page.goto('/');
  await authorSwap(page, 'USDC_TO_WETH', '2500', '100');
  await simulateOnFork(page);
  await reviewAndConnect(page);
  await requestStep(page, 'Step 1 · approve exact input');
  await expect(stepState(page, 'Step 1 · approve exact input')).toHaveText('CONFIRMED_NOT_RECONCILED');
  await requestStep(page, 'Step 2 · exact swap');
  await expect(stepState(page, 'Step 2 · exact swap')).toHaveText('CONFIRMED_NOT_RECONCILED');
  await executionPanel(page).getByRole('button', { name: 'Reconcile from independent fork reads' }).click();
  await expect(executionPanel(page).locator('[data-outcome]')).toHaveText('RECONCILED');
  expect(testWallet.sent.map(item => item.to)).toEqual(['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', '0x2626664c2603336e57b271c5c0b26f421741e481']);
});

test('a semantic edit retires the reviewed fork action and no wallet request is possible', async ({ page, testWallet }) => {
  await page.goto('/');
  await authorSwap(page, 'WETH_TO_USDC', '1', '100');
  await simulateOnFork(page);
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Build', exact: true }).click();
  await page.locator('.flow-card').nth(1).click();
  await page.locator('.inspector').getByLabel('Slippage (bps)', { exact: true }).fill('50');
  await page.getByRole('button', { name: 'Review slippage change' }).click();
  await expect(page.getByText('Review proposed edit')).toBeVisible();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await expect(page.locator('.summary-bar[data-workflow-revision="2"]')).toBeVisible();
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Simulate', exact: true }).click();
  await expect(forkPanel(page).getByText('FORK: INVALIDATED', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review swap' })).toBeDisabled();
  expect(testWallet.calls.filter(call => call.method === 'eth_sendTransaction')).toHaveLength(0);
});

test('mocked and observed artifacts can never open Mode A review or execution', async ({ page, testWallet, fork }) => {
  await page.goto('/');
  await authorSwap(page, 'WETH_TO_USDC', '1', '100');
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Simulate', exact: true }).click();
  const mocked = page.getByRole('region', { name: 'Mocked artifact chain' });
  await mocked.getByRole('button', { name: 'Generate mocked artifacts for revision 1' }).click();
  await expect(mocked).toContainText('ARTIFACTS: CURRENT');
  await expect(page.getByRole('button', { name: 'Review swap' })).toBeDisabled();
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Execute unavailable' })).toContainText('Mocked quote and simulation artifacts cannot authorize execution.');
  expect(fork.preparedFiles()).toHaveLength(0);
  expect(testWallet.calls.filter(call => call.method === 'eth_sendTransaction')).toHaveLength(0);
});
