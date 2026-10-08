// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, openSimulationDetails, applyPendingProposal } from './fixtures';
import { installSupplyWallet, resetSupplyHarness, authorSupply, supplySendCount, SUPPLY_OWNER, REPAY_OWNER, repayOptions } from './supply-fixtures';
import { withdrawOptions } from './withdraw-fixtures';

test('a valid MOCKED Supply simulation cannot grant production Review or submit a transaction', async ({ page, networkGuard }) => {
  await resetSupplyHarness();
  await installSupplyWallet(page);
  await authorSupply(page);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
  await page.getByRole('button', { name: 'Simulate fees', exact: true }).click();
  await openSimulationDetails(page);
  await page.getByRole('button', { name: 'Simulate Supply', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Aave Supply', exact: true });
  await expect(panel).toContainText('Approval required: Yes');
  await expect(page.getByRole('button', { name: 'Approve & Continue', exact: true })).toBeDisabled();
  await expect(page.locator('.review-validity')).toContainText('A simulation that can authorize this workflow is required before approval.');
  expect(await supplySendCount(page)).toBe(0);
  await expect(page.getByRole('link', { name: 'Download Evidence Bundle' })).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toBeDisabled();
  expect(await supplySendCount(page)).toBe(0);
  await page.reload();
  expect(await supplySendCount(page)).toBe(0);
  await expect(page.getByRole('link', { name: 'Download Evidence Bundle' })).toHaveCount(0);
  networkGuard.assertClean();
});

for (const row of [
  { action: 'Borrow', amount: '0.01', raw: '10000', owner: SUPPLY_OWNER, options: { balance: '0' }, fields: ['Estimated health factor after: 860'] },
  { action: 'Repay', amount: '0.005', raw: '5000', owner: REPAY_OWNER, options: repayOptions, fields: ['Repay amount: 0.005', 'Approval required: Yes', 'Variable debt before: 0.010001'] },
  { action: 'Withdraw', amount: '0.1', raw: '100000', owner: REPAY_OWNER, options: withdrawOptions, fields: ['Withdraw amount: 0.1'] },
] as const) {
  test(`a valid MOCKED ${row.action} simulation preserves its economic review but cannot authorize execution`, async ({ page, networkGuard }) => {
    await resetSupplyHarness(row.options);
    await installSupplyWallet(page, { account: row.owner });
    await page.goto('/');
    const verb = row.action.toLowerCase();
    await page.getByLabel('Describe your flow').fill(`${verb} ${row.amount} USDC ${row.action === 'Repay' ? 'to' : 'from'} Aave on Base Sepolia`);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await applyPendingProposal(page);
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
    await page.getByRole('button', { name: 'Simulate fees', exact: true }).click();
    await openSimulationDetails(page);
    await page.getByRole('button', { name: `Simulate ${row.action}`, exact: true }).click();
    const panel = page.getByRole('region', { name: `Aave ${row.action}`, exact: true });
    for (const text of row.fields) await expect(panel).toContainText(text);
    await panel.locator('details > summary').click();
    const details = JSON.parse((await panel.locator('pre').innerText()));
    expect(details.review).toMatchObject({ amount: row.raw, chain: 'eip155:84532' });
    expect(details.attempts).toEqual([]);
    await expect(page.getByRole('button', { name: 'Approve & Continue', exact: true })).toBeDisabled();
    await expect(page.locator('.review-validity')).toContainText('A simulation that can authorize this workflow is required before approval.');
    expect(await supplySendCount(page)).toBe(0);
    await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Execute', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toBeDisabled();
    await expect(page.getByRole('link', { name: 'Download Evidence Bundle' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Observe existing transaction' })).toHaveCount(0);
    expect(await supplySendCount(page)).toBe(0);
    await page.reload();
    await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Execute', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toBeDisabled();
    await expect(page.getByRole('link', { name: 'Download Evidence Bundle' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Observe existing transaction' })).toHaveCount(0);
    expect(await supplySendCount(page)).toBe(0);
    networkGuard.assertClean();
  });
}

test('Ethereum Sepolia WBTC retains the correct chain, asset and amount while MOCKED Review refuses authority', async ({ page, networkGuard }) => {
  await resetSupplyHarness({}, '/ethereum-sepolia');
  await installSupplyWallet(page, { chain: '0xaa36a7', route: '/ethereum-sepolia' });
  await page.goto('/');
  await page.getByLabel('Describe your flow').fill(`supply 0.001 WBTC to Aave on Ethereum Sepolia beneficiary ${SUPPLY_OWNER}`);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await applyPendingProposal(page);
  const card = page.locator('.build-flow-surface .composer-card').first();
  await expect(card.getByRole('textbox', { name: 'Source amount (WBTC)', exact: true })).toHaveValue('0.001');
  await expect(card).toContainText('Ethereum Sepolia');
  await page.getByRole('button', { name: 'Simulate fees', exact: true }).click();
  await openSimulationDetails(page);
  await page.getByRole('button', { name: 'Simulate Supply', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Aave Supply', exact: true });
  await expect(panel).toContainText('Approval required: Yes');
  await panel.locator('details > summary').click();
  const details = JSON.parse(await panel.locator('pre').innerText());
  expect(details.review).toMatchObject({ chain: 'eip155:11155111', asset: '0x29f2d40b0605204364af54ec677bd022da425d03', amount: '100000', beneficiary: SUPPLY_OWNER });
  expect(details.attempts).toEqual([]);
  await expect(page.getByRole('button', { name: 'Approve & Continue', exact: true })).toBeDisabled();
  await expect(page.locator('.review-validity')).toContainText('A simulation that can authorize this workflow is required before approval.');
  expect(await supplySendCount(page)).toBe(0);
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Download Evidence Bundle' })).toHaveCount(0);
  expect(await supplySendCount(page)).toBe(0);
  networkGuard.assertClean();
});
