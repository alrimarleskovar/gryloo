// SPDX-License-Identifier: AGPL-3.0-only
import {
  authorSwap, executionPanel, expect, forkRpc, preparedRecord, requestStep, reviewAndConnect, simulateOnFork, stepState, test, visual,
} from './mode-a-fixtures';

const stage = (page: import('@playwright/test').Page, name: 'Execute') =>
  page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name, exact: true }).click();

test('an unknown wallet result survives a browser restart and is recovered from the fork without a duplicate', async ({ page, fork, testWallet }) => {
  await page.goto('/');
  await authorSwap(page, 'WETH_TO_USDC', '1', '100');
  await simulateOnFork(page);
  await reviewAndConnect(page);
  await requestStep(page, 'Step 1 · approve exact input');
  await expect(stepState(page, 'Step 1 · approve exact input')).toHaveText('CONFIRMED_NOT_RECONCILED');
  testWallet.fault = { dropResponse: true };
  await requestStep(page, 'Step 2 · exact swap');
  await expect(stepState(page, 'Step 2 · exact swap')).toHaveText('SUBMISSION_RESULT_UNKNOWN');
  await expect(executionPanel(page)).toContainText('Gryloo will not request this step again');
  await expect(executionPanel(page).getByRole('button', { name: /^Request wallet signature · swap/ })).toHaveCount(0);
  await visual(page, 'execute-result-unknown.png');

  // Browser restart: the page reloads the durable journal; no new swap request is offered.
  testWallet.fault = {};
  await page.reload();
  await stage(page, 'Execute');
  await expect(stepState(page, 'Step 2 · exact swap')).toHaveText('SUBMISSION_RESULT_UNKNOWN');
  await expect(page.getByRole('region', { name: 'Mode A Manifest review' })).toContainText('Recovered from the journal after a restart');
  await executionPanel(page).getByRole('article', { name: 'Step 2 · exact swap' }).getByRole('button', { name: 'Scan the fork for this attempt' }).click();
  await expect(stepState(page, 'Step 2 · exact swap')).toHaveText('CONFIRMED_NOT_RECONCILED');
  await expect(executionPanel(page)).toContainText('RECOVERED_RECEIPT_SUCCESS');
  await executionPanel(page).getByRole('button', { name: 'Reconcile from independent fork reads' }).click();
  await expect(executionPanel(page).locator('[data-outcome]')).toHaveText('RECONCILED');
  await visual(page, 'execute-recovered-after-restart.png');
  // Exactly one owner transaction consumed each nonce: the unknown result never produced a duplicate.
  const prepared = preparedRecord(fork);
  expect(testWallet.calls.filter(call => call.method === 'eth_sendTransaction')).toHaveLength(2);
  expect(BigInt(await forkRpc('eth_getTransactionCount', [prepared.owner, 'latest']) as string))
    .toBe(BigInt(prepared.payloads[0]!.request.nonce!) + 2n);
});

test('delayed mining keeps each step PENDING until its block exists, then reconciles', async ({ page, fork, testWallet }) => {
  await page.goto('/');
  await authorSwap(page, 'WETH_TO_USDC', '1', '100');
  await simulateOnFork(page);
  await reviewAndConnect(page);
  await fork.automine(false);
  for (const title of ['Step 1 · approve exact input', 'Step 2 · exact swap'] as const) {
    await requestStep(page, title);
    await expect(stepState(page, title)).toHaveText('PENDING');
    expect(await fork.pendingCount()).toBe(1);
    await fork.mine(1);
    await expect(stepState(page, title)).toHaveText('CONFIRMED_NOT_RECONCILED');
  }
  await fork.automine(true);
  expect(testWallet.sent).toHaveLength(2);
  await executionPanel(page).getByRole('button', { name: 'Reconcile from independent fork reads' }).click();
  await expect(executionPanel(page).locator('[data-outcome]')).toHaveText('RECONCILED');
});

test('a reverted swap leaves a residual allowance that only a separate revocation clears', async ({ page, fork, testWallet }) => {
  await page.goto('/');
  await authorSwap(page, 'WETH_TO_USDC', '1', '0');
  await simulateOnFork(page);
  await reviewAndConnect(page);
  await requestStep(page, 'Step 1 · approve exact input');
  await expect(stepState(page, 'Step 1 · approve exact input')).toHaveText('CONFIRMED_NOT_RECONCILED');
  // Another account trades in the quoted pool after the zero-slippage quote.
  await fork.movePrice(preparedRecord(fork).fee);
  await requestStep(page, 'Step 2 · exact swap');
  await expect(stepState(page, 'Step 2 · exact swap')).toHaveText('REVERTED');
  await executionPanel(page).getByRole('button', { name: 'Reconcile from independent fork reads' }).click();
  await expect(executionPanel(page).locator('[data-outcome]')).toHaveText('DIVERGENT');
  await expect(executionPanel(page)).toContainText('TRANSACTION_REVERTED');
  await expect(executionPanel(page).getByRole('article', { name: 'Mode A outcome' })).toContainText('Residual router allowance');
  await visual(page, 'execute-swap-reverted-residual-allowance.png');
  const revocation = executionPanel(page).getByRole('article', { name: 'Separate revocation' });
  await revocation.getByRole('button', { name: 'Prepare separate revocation' }).click();
  await expect(revocation.getByRole('table', { name: 'Decoded fields · step-revoke' })).toContainText('0 WETH');
  await revocation.getByRole('button', { name: 'Request wallet signature · revoke allowance to 0' }).click();
  await revocation.getByRole('button', { name: 'Confirm revocation from the fork' }).click();
  await expect(executionPanel(page).locator('[data-outcome]')).toHaveText('REVOCATION_CONFIRMED');
  await visual(page, 'execute-revocation-confirmed.png');
  expect(testWallet.sent).toHaveLength(3);
  const allowance = await forkRpc('eth_call', [{ to: '0x4200000000000000000000000000000000000006',
    data: `0xdd62ed3e${fork.fixture.owner.slice(2).padStart(64, '0')}${'2626664c2603336e57b271c5c0b26f421741e481'.padStart(64, '0')}` }, 'latest']);
  expect(BigInt(allowance as string)).toBe(0n);
});
