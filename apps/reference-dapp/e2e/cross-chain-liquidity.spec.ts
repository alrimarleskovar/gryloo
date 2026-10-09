// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, applyPendingProposal, openSimulationDetails, readWorkflowIr, installPassiveWallet, assertPassiveWallet } from './fixtures';
const recipient = '0x1111111111111111111111111111111111111111';

test('cross-chain canvas and chat author the same graph while MOCKED simulation cannot authorize Execute', async ({ page }) => {
  await installPassiveWallet(page);
  await page.goto('/app');
  await page.getByText('Advanced action setup', { exact: true }).click();
  await page.getByText('Base → Arbitrum → Uniswap v3 position', { exact: true }).click();
  const inspector = page.getByRole('form', { name: 'Compose cross-chain liquidity' });
  await inspector.getByLabel('Composition source quantity (USDC)').fill('100');
  await inspector.getByRole('button', { name: 'Review cross-chain composition' }).click();
  await applyPendingProposal(page);
  const canvasIR = JSON.parse(await readWorkflowIr(page));
  expect(canvasIR.nodes).toHaveLength(4);
  expect(JSON.stringify(canvasIR)).toContain('"outputId":"swap-input"');
  expect(JSON.stringify(canvasIR)).toContain('"actionType":"asset.liquidity.uniswap-v3"');
  await page.getByRole('button', { name: 'Simulate', exact: true }).click();
  await openSimulationDetails(page);
  const panel = page.getByRole('region', { name: 'Cross-chain liquidity composition' });
  await panel.getByRole('button', { name: 'Generate MOCKED chained simulation' }).click();
  await expect(panel).toContainText('Estimated bridge output:');
  await expect(panel).toContainText('pool swap fee');
  await expect(panel).toContainText('Stage: SOURCE PREPARED');
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Submit MOCKED bridge' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Download Evidence Bundle' })).toHaveCount(0);
  await assertPassiveWallet(page);
  await page.reload();
  await page.getByLabel('Describe your flow').fill(`bridge 100 USDC from Base to Arbitrum via LI.FI and create Uniswap liquidity ticks -200100 to -199900 recipient ${recipient}`);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await applyPendingProposal(page);
  const chatIR = JSON.parse(await readWorkflowIr(page));
  expect(chatIR.nodes).toEqual(canvasIR.nodes);
  expect(chatIR.edges).toEqual(canvasIR.edges);
  await assertPassiveWallet(page);
});
