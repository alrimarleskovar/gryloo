// SPDX-License-Identifier: AGPL-3.0-only
import {
  authorSwap, executionPanel, expect, forkPanel, openTechnicalDetails, requestStep, reviewAndConnect, simulateOnFork, stepState, test, visual,
} from './mode-a-fixtures';
import { E2E_APP_ORIGIN } from './app-origin';

const sends = (calls: readonly { method: string }[]) => calls.filter(call => call.method === 'eth_sendTransaction').length;

for (const [label, fault] of [['gas', { mutate: 'gas' }], ['recipient', { mutate: 'recipient' }]] as const) {
  test(`a wallet that changes the signed ${label} is DIVERGENT and can never reconcile`, async ({ page, testWallet }) => {
    await page.goto('/__engineering');
    await authorSwap(page, 'WETH_TO_USDC', '1', '100');
    await simulateOnFork(page);
    await reviewAndConnect(page);
    await requestStep(page, 'Step 1 · approve exact input');
    await expect(stepState(page, 'Step 1 · approve exact input')).toHaveText('CONFIRMED_NOT_RECONCILED');
    testWallet.fault = { ...fault };
    await requestStep(page, 'Step 2 · exact swap');
    await expect(stepState(page, 'Step 2 · exact swap')).toHaveText('DIVERGENT');
    await expect(executionPanel(page)).toContainText('PAYLOAD_FIDELITY_FAILED');
    await expect(executionPanel(page).locator('[data-outcome]')).toHaveText('DIVERGENT');
    await expect(executionPanel(page).getByRole('button', { name: 'Reconcile from independent fork reads' })).toHaveCount(0);
    if (label === 'gas') await visual(page, 'execute-divergent-wallet-payload.png');
  });
}

test('a wallet on the wrong chain or account is refused before any transaction request', async ({ page, testWallet }) => {
  await page.goto('/__engineering');
  await authorSwap(page, 'WETH_TO_USDC', '1', '100');
  await simulateOnFork(page);
  await page.getByRole('button', { name: 'Review swap' }).click();
  await page.getByRole('button', { name: 'I reviewed both exact payloads' }).click();
  testWallet.fault = { chainId: '0x2105' };
  await executionPanel(page).getByRole('button', { name: 'Connect injected wallet' }).click();
  await expect(executionPanel(page)).toContainText('WALLET_WRONG_CHAIN');
  testWallet.fault = { account: '0x000000000000000000000000000000000000dead' };
  await executionPanel(page).getByRole('button', { name: 'Connect injected wallet' }).click();
  await expect(executionPanel(page)).toContainText('WALLET_WRONG_ACCOUNT');
  await expect(executionPanel(page).getByRole('button', { name: /^Request wallet signature/ }).first()).toBeDisabled();
  expect(testWallet.calls.some(call => call.method === 'wallet_switchEthereumChain')).toBe(false);
  expect(sends(testWallet.calls)).toBe(0);
});

test('an expired fork quote blocks the first wallet request', async ({ page, fork, testWallet }) => {
  await page.goto('/__engineering');
  await authorSwap(page, 'WETH_TO_USDC', '1', '100');
  await simulateOnFork(page);
  await reviewAndConnect(page);
  await fork.mine(31); // 62 seconds of fork time at the 2-second block interval
  await requestStep(page, 'Step 1 · approve exact input');
  await expect(executionPanel(page)).toContainText('QUOTE_EXPIRED');
  await expect(stepState(page, 'Step 1 · approve exact input')).toHaveText('NOT_REQUESTED');
  expect(sends(testWallet.calls)).toBe(0);
});

test('slippage above the reviewed ceiling cannot be simulated or authorized', async ({ page, fork, testWallet }) => {
  await page.goto('/__engineering');
  await authorSwap(page, 'WETH_TO_USDC', '1', '301');
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Simulate', exact: true }).click();
  await openTechnicalDetails(page);
  await forkPanel(page).getByRole('button', { name: /^Simulate on local fork for revision \d+$/ }).click();
  await expect(forkPanel(page)).toContainText('SLIPPAGE_NOT_ELIGIBLE');
  expect(fork.preparedFiles()).toHaveLength(0);
  expect(sends(testWallet.calls)).toBe(0);
});

test('manipulated calldata or an unknown spender in a server response is blocked in the browser', async ({ page, testWallet }) => {
  await page.goto('/__engineering');
  await authorSwap(page, 'WETH_TO_USDC', '1', '100');
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Simulate', exact: true }).click();
  await openTechnicalDetails(page);
  // Intercept only the fork simulation action: earlier authoring actions are unrelated to this tamper case.
  await page.route(E2E_APP_ORIGIN + '/**', async route => {
    if (route.request().method() !== 'POST' || !route.request().headers()['next-action']) { await route.fallback(); return; }
    const response = await route.fetch();
    const body = (await response.text()).replaceAll('2626664c2603336e57b271c5c0b26f421741e481', '000000000000000000000000000000000000dead');
    await route.fulfill({ response, body });
  });
  await forkPanel(page).getByRole('button', { name: /^Simulate on local fork for revision \d+$/ }).click();
  await expect(forkPanel(page).getByText(/Browser verification blocked the wallet: BROWSER_/)).toBeVisible();
  await expect(forkPanel(page).locator('[data-browser-verification="BLOCKED"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review swap' })).toBeDisabled();
  expect(sends(testWallet.calls)).toBe(0);
});
