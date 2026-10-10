// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, readWorkflowIr, applyPendingProposal } from './fixtures';
import { installSupplyWallet } from './supply-fixtures';
import { configureCanvasAction, configureCanvasPool } from './composer-authoring-fixtures';

for (const action of ['swap', 'bridge', 'supply', 'borrow', 'repay', 'withdraw', 'pool', 'lending', 'transfer']) test(`Canvas parity without Advanced action setup: ${action}`, async ({ page }) => {
  await installSupplyWallet(page); await page.goto('/app');
  await expect(page.getByText('Advanced action setup', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: action === 'lending' ? 'Add Supply → Borrow → Swap' : `Add ${action}`, exact: true }).click();
  const card = page.locator('.build-flow-surface .composer-card').last();
  if (action === 'transfer') {
    await card.getByRole('textbox', { name: 'Source amount (ETH)', exact: true }).fill('0.000001');
    await card.getByRole('button', { name: 'Review Transfer change', exact: true }).click();
    await card.getByRole('button', { name: 'Apply proposal', exact: true }).click();
  } else if (action === 'pool') await configureCanvasPool(page);
  else if (action === 'lending') await applyPendingProposal(page);
  else await configureCanvasAction(page, '1');
  const workflow = JSON.parse(await readWorkflowIr(page));
  const types = workflow.nodes.map((node: { actionType: string }) => node.actionType);
  const expected = ({ swap: 'asset.swap.exact-input', bridge: 'asset.bridge', pool: 'asset.liquidity.position', transfer: 'asset.transfer' } as Record<string, string>)[action] ?? action;
  if (action === 'pool') expect(types.some((type: string) => type.startsWith('asset.liquidity.'))).toBe(true);
  else if (action === 'lending') expect(types).toEqual(['supply', 'borrow', 'asset.swap.exact-input']);
  else expect(types).toContain(expected);
  const primary = page.locator('.canvas-primary-action');
  await expect(primary.getByRole('button', { name: 'Simulate workflow', exact: true })).toBeVisible();
  // Adding an action grants no Review or execution authority.
  await expect(page.getByRole('button', { name: 'Approve & Continue', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toHaveCount(0);
});

test('normal Simulate has concise safety details and no engineering or duplicate lifecycle workspace, desktop and mobile', async ({ page }) => {
  await installSupplyWallet(page); await page.goto('/app');
  await page.getByRole('button', { name: 'Add swap', exact: true }).click(); await configureCanvasAction(page, '1');
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Simulate', exact: true }).click();
  const details = page.locator('.review-authorization-details');
  await details.locator('summary').click();
  for (const text of ['Wallet', 'Network', 'Permissions']) await expect(details).toContainText(text);
  for (const selector of ['.review-workspace', '.simulation-technical', '.review-technical', '[data-workflow-ir]', '.observation-panel']) await expect(page.locator(selector)).toHaveCount(0);
  for (const text of ['Advanced action setup', 'Generate mocked artifacts', 'ARTIFACTS: EMPTY', 'ARTIFACTS: CURRENT', 'Base read-only observation', 'NOT EVIDENCE · NOT AN AUTHORIZATION INPUT']) await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  await expect(page.locator('main pre')).toHaveCount(0);
  await expect(details.locator('button.primary')).toHaveCount(0);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const graph = page.locator('.simulate-flow-surface'), action = graph.locator('.canvas-primary-action');
    await expect(action.getByRole('button', { name: 'Simulate workflow', exact: true })).toBeVisible();
    const surface = (await graph.boundingBox())!, button = (await action.boundingBox())!;
    expect(button.x).toBeGreaterThanOrEqual(surface.x); expect(button.x + button.width).toBeLessThanOrEqual(surface.x + surface.width);
    expect(button.y + button.height).toBeLessThanOrEqual(surface.y + surface.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `.tmp/canvas-automation-simulate-${width}.png`, fullPage: true });
  }
});

test('engineering harness is explicitly invoked separately from the normal workspace', async ({ page }) => {
  await page.goto('/__engineering');
  await expect(page.getByText('Advanced action setup', { exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Simulate', exact: true }).click();
  const details = page.locator('.simulation-technical'); await details.locator('> summary').click();
  await expect(page.getByRole('region', { name: 'Authorization technical details', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Generate mocked artifacts for revision/ })).toBeVisible();
  await expect(page.getByText('Base read-only observation', { exact: true })).toBeVisible();
});

for (const network of ['Robinhood Chain Testnet', 'Ethereum Sepolia']) test(`Canvas native transfer authors and edits the supported self-transfer on ${network}`, async ({ page }) => {
  await installSupplyWallet(page); await page.goto('/app');
  await page.getByRole('button', { name: 'Add transfer', exact: true }).click();
  const card = page.locator('.build-flow-surface .composer-card');
  await card.getByRole('button', { name: 'Select source token', exact: true }).click();
  const picker = page.getByRole('region', { name: 'Source asset picker', exact: true });
  await picker.getByRole('button', { name: network, exact: true }).click();
  await picker.getByRole('button', { name: 'Hide token picker', exact: true }).click();
  const amount = card.getByRole('textbox', { name: 'Source amount (ETH)', exact: true });
  for (const [index, value] of ['0.000001', '0.000002'].entries()) {
    await amount.fill(value);
    await card.getByRole('button', { name: 'Review Transfer change', exact: true }).click();
    await card.getByRole('button', { name: 'Apply proposal', exact: true }).click();
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', String(index + 1));
    await expect(card.getByRole('button', { name: 'Select source token', exact: true })).toHaveAttribute('title', `ETH on ${network} (${network === 'Ethereum Sepolia' ? '11155111' : '46630'})`);
  }
  const workflow = JSON.parse(await readWorkflowIr(page));
  const transfer = workflow.nodes.find((node: { actionType: string }) => node.actionType === 'asset.transfer');
  expect(transfer).toMatchObject({ actionType: 'asset.transfer', chainId: network === 'Ethereum Sepolia' ? 'eip155:11155111' : 'eip155:46630' });
  await card.getByRole('button', { name: 'Advanced Settings', exact: true }).click();
  const inspector = page.getByRole('region', { name: 'Action inspector', exact: true });
  await expect(inspector.getByRole('heading', { name: 'Transfer settings', exact: true })).toBeVisible();
  await expect(inspector).toContainText('Recipient: your connected owner wallet');
  await expect(page.getByText('Advanced action setup', { exact: true })).toHaveCount(0);
});

for (const action of ['swap', 'pool']) test(`Solana Devnet ${action} remains authored in the normal Canvas`, async ({ page }) => {
  await installSupplyWallet(page); await page.goto('/app');
  await page.getByRole('button', { name: `Add ${action}`, exact: true }).click();
  const card = page.locator('.build-flow-surface .composer-card');
  await card.getByRole('button', { name: 'Select source token', exact: true }).click();
  const picker = page.getByRole('region', { name: 'Source asset picker', exact: true });
  await picker.getByRole('button', { name: 'Solana Devnet', exact: true }).click();
  await picker.getByRole('button', { name: 'Hide token picker', exact: true }).click();
  await card.getByRole('textbox').first().fill('0.1');
  if (action === 'pool') await card.getByRole('textbox').nth(1).fill('2');
  await card.getByRole('button', { name: action === 'pool' ? 'Review' : 'Review amount', exact: true }).click();
  await card.getByRole('button', { name: action === 'pool' ? 'Apply' : 'Apply amount', exact: true }).click();
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
  const workflow = JSON.parse(await readWorkflowIr(page));
  const node = workflow.nodes.find((node: { actionType: string }) => node.actionType === (action === 'swap' ? 'asset.swap.exact-input' : 'asset.liquidity.concentrated'));
  expect(node.chainId).toMatch(/^solana:/);
  expect(node.actionType).toBe(action === 'swap' ? 'asset.swap.exact-input' : 'asset.liquidity.concentrated');
  await expect(page.locator('.canvas-primary-action').getByRole('button', { name: 'Simulate workflow', exact: true })).toBeVisible();
});

test('new Transfer authoring controls and lifecycle copy use Portuguese', async ({ page }) => {
  await installSupplyWallet(page);
  await page.addInitScript(() => localStorage.setItem('flofi.language', 'PT'));
  await page.goto('/app');
  await page.getByRole('button', { name: 'Adicionar transferência', exact: true }).click();
  const card = page.locator('.build-flow-surface .composer-card');
  await card.getByRole('textbox', { name: 'Valor de origem (ETH)', exact: true }).fill('0.000001');
  await card.getByRole('button', { name: 'Rever alteração da transferência', exact: true }).click();
  await card.getByRole('button', { name: 'Aplicar proposta', exact: true }).click();
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
  await expect(page.locator('.canvas-primary-action button')).toHaveText('Simular fluxo');
  await expect(page.getByText('Review Transfer change', { exact: true })).toHaveCount(0);
});
