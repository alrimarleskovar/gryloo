// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { configureCanvasAction } from './composer-authoring-fixtures';
const owner = '0x1111111111111111111111111111111111111111';
const graph = (page: Page) => page.getByRole('region', { name: 'Simulation workflow graph', exact: true });
const stages = (page: Page) => page.getByRole('navigation', { name: 'Workflow stages' });
const summaries = (page: Page, surface: string) => page.locator(`${surface} .composer-card`).evaluateAll(cards => cards.map(card => {
  const title = card.querySelector('strong')?.textContent ?? '';
  const number = title.match(/^(\d+)\. /)?.[1];
  // Compare the token route across Build's value boxes and Simulate's unchanged pair summary.
  const destination = card.querySelector('.composer-destination-box .composer-amount-token')?.textContent;
  const detail = destination && title.includes('Swap')
    ? `${card.querySelector('.composer-amount .composer-amount-token')?.textContent} → ${destination}`
    : (card.querySelector('.composer-detail')?.textContent ?? '').replace(/^Borrowed /, '');
  const amount = (card.querySelector('.composer-amount .composer-token-value') as HTMLInputElement | null)?.value
    ?? card.querySelector('.composer-amount .composer-amount-value')?.textContent;
  const sourceAmount = amount
    ? `${amount} ${card.querySelector('.composer-amount .composer-amount-token')?.textContent}`
    : card.querySelector('.composer-amount')?.textContent ?? '';
  return [number ? `Step ${number}` : card.querySelector('.composer-step')?.textContent ?? '', title.replace(/^\d+\. /, ''),
    ...['.composer-provider', '.composer-chain'].map(selector =>
      (card.querySelector(selector)?.textContent ?? '').replace(/Cross-chain Router/g, 'Router')), sourceAmount, detail];
}));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(account => {
    const requests: string[] = [];
    Object.assign(window, { inspectionWalletRequests: requests, ethereum: {
      isMetaMask: true,
      async request({ method }: { method: string }) {
        requests.push(method);
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [account];
        if (method === 'eth_chainId') return '0x14a34';
        throw new Error(`Unexpected wallet request: ${method}`);
      }, on() {}, removeListener() {},
    } });
  }, owner);
});
test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => (window as unknown as { inspectionWalletRequests: string[] }).inspectionWalletRequests.filter(method => /sign|send/i.test(method)))).toEqual([]);
});
async function open(page: Page) {
  await page.goto('/'); await expect(page.locator('.build009-wallet-info')).toBeVisible({ timeout: 15000 });
}
async function rename(page: Page, name: string) {
  await page.getByRole('button', { name: 'Rename workflow', exact: true }).click();
  await page.getByRole('textbox', { name: 'Workflow name', exact: true }).fill(name);
  await page.getByRole('textbox', { name: 'Workflow name', exact: true }).press('Enter');
}

test('lending projects the same authored strategy, shared title and links above its existing simulation panel', async ({ page }) => {
  await open(page); await rename(page, 'ESPARTACUS');
  await page.getByRole('button', { name: 'Add Supply → Borrow → Swap', exact: true }).click();
  await page.getByRole('button', { name: 'Apply proposal', exact: true }).click();
  const build = await summaries(page, '.build-flow-surface');
  const positions = await page.locator('.build-flow-surface .react-flow__node').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).style.transform));
  await page.getByRole('button', { name: 'Simular Fees', exact: true }).click();
  await expect(graph(page)).toHaveAttribute('data-viewport', 'fitted');
  await expect(page.locator('.simulation-workflow-canvas h2')).toHaveText('ESPARTACUS');
  expect(await summaries(page, '.simulate-flow-surface')).toEqual(build);
  expect(await graph(page).locator('.react-flow__node').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).style.transform))).toEqual(positions);
  await expect(graph(page).locator('.react-flow__edge')).toHaveCount(2);
  await expect(graph(page).locator('.react-flow__edge-path').first()).toHaveAttribute('marker-end', /.+/);
  await expect(graph(page).getByRole('button', { name: 'Review lending composition', exact: true })).toBeDisabled();
  await expect(page.locator('.summary-bar').getByRole('button', { name: /Review/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Simulate lending composition', exact: true })).toBeVisible();
  const surface = await graph(page).innerText();
  expect(surface).not.toMatch(/mock|local|synthetic|read-only graph|Expected|Minimum|Health factor|HF|Confirmed|Authorized|Success|Select to edit/i);
  await expect(graph(page).locator('.composer-card-state, .composer-selected, form, input')).toHaveCount(0);
  const node = graph(page).locator('.react-flow__node').first();
  await node.scrollIntoViewIfNeeded(); const box = (await node.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 30); await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + 50, { steps: 8 }); await page.mouse.up();
  await page.keyboard.press('Delete'); await page.keyboard.press('Escape');
  expect(await graph(page).locator('.react-flow__node').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).style.transform))).toEqual(positions);
  await expect(graph(page).locator('.react-flow__node.selected')).toHaveCount(0);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
  await graph(page).getByRole('button', { name: 'Return to Build', exact: true }).click();
  await expect(stages(page).getByRole('button', { name: 'Build', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.build-flow-surface .composer-card.active')).toHaveCount(1);
});

test('accepted Build edits refresh Simulate while current diagnostic artifacts and Review gates stay intact', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Add swap', exact: true }).click();
  await configureCanvasAction(page, '1');
  await rename(page, 'ETH Carry Strategy');
  await page.getByRole('button', { name: 'Simular Fees', exact: true }).click();
  await expect(graph(page).locator('.composer-amount')).toHaveText('1 USDC');
  const details = page.locator('.simulation-technical');
  await expect(page.getByRole('button', { name: 'Generate mocked artifacts for revision 1', exact: true })).toBeHidden();
  await details.locator(':scope > summary').click();
  await page.getByRole('button', { name: 'Generate mocked artifacts for revision 1', exact: true }).click();
  await expect(details.locator('.simulate-swap')).toContainText('1 USDC');
  await page.getByRole('button', { name: 'Show JSON · Artifact Set', exact: true }).click();
  expect(JSON.parse(await details.locator('[data-artifact-json="artifact-set"]').innerText())).toBeTruthy();
  await expect(graph(page).locator('[data-mocked-value]')).toHaveCount(0);
  await expect(graph(page).getByRole('button', { name: 'Review swap', exact: true })).toBeDisabled();
  await details.locator(':scope > summary').click();
  expect(await page.getByRole('main', { name: 'Simulation workspace', exact: true }).innerText()).not.toMatch(/MOCK|SYNTHETIC|Artifact Set|LOCAL/);
  await graph(page).getByRole('button', { name: 'Return to Build', exact: true }).click();
  await page.getByRole('region', { name: 'Action inspector' }).getByLabel('Input amount (USDC)').fill('2.5');
  await page.getByRole('button', { name: 'Review amount change', exact: true }).click();
  await page.getByRole('button', { name: 'Apply amount', exact: true }).click();
  await rename(page, 'Updated Strategy');
  await page.getByRole('button', { name: 'Simular Fees', exact: true }).click();
  await expect(graph(page).locator('.composer-amount')).toHaveText('2.5 USDC');
  await expect(page.locator('.simulation-workflow-canvas h2')).toHaveText('Updated Strategy');
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '2');
});

test('empty workflows and supported isolated actions keep the same graph and original simulation controls', async ({ page }) => {
  for (const action of [null, 'supply', 'bridge', 'pool', 'borrow', 'repay', 'withdraw'] as const) {
    await open(page);
    if (action) await page.getByRole('button', { name: `Add ${action}`, exact: true }).click();
    if (action === 'bridge') await configureCanvasAction(page, '1');
    const build = await summaries(page, '.build-flow-surface');
    await stages(page).getByRole('button', { name: 'Simulate', exact: true }).click();
    await expect(graph(page)).toBeVisible();
    expect(await summaries(page, '.simulate-flow-surface')).toEqual(build);
    await expect(page.locator('.simulation-workflow-canvas')).toHaveCount(1);
    if (!action) {
      await expect(graph(page).locator('.react-flow__node')).toHaveCount(0);
      await expect(graph(page)).toContainText('Add an action to your workflow');
    } else await expect(graph(page).locator('.react-flow__node')).toHaveCount(1);
    await expect(graph(page).getByRole('button', { name: 'Return to Build', exact: true })).toHaveCount(1);
    await expect(graph(page).locator('.react-flow__controls')).toBeVisible();
  }
});

test('desktop/mobile graph keeps approved action order, zoom/fit controls and card clearance', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Add Supply → Borrow → Swap', exact: true }).click();
  await page.getByRole('button', { name: 'Apply proposal', exact: true }).click();
  await page.getByRole('button', { name: 'Simular Fees', exact: true }).click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(graph(page)).toHaveAttribute('data-viewport', 'fitted');
    await graph(page).scrollIntoViewIfNeeded();
    const actions = graph(page).locator('.simulation-canvas-actions');
    await expect(actions.locator('button')).toHaveText(['Return to Build', 'Review lending composition']);
    const graphBox = (await graph(page).boundingBox())!;
    const actionBox = (await actions.boundingBox())!;
    const controlBox = (await graph(page).locator('.react-flow__controls').boundingBox())!;
    expect(actionBox.x).toBeGreaterThanOrEqual(graphBox.x + 8);
    expect(controlBox.x - actionBox.x - actionBox.width).toBeGreaterThanOrEqual(12);
    for (const card of await graph(page).locator('.composer-card').all()) {
      const box = (await card.boundingBox())!;
      expect(box.x + box.width + 8 <= actionBox.x || actionBox.x + actionBox.width + 8 <= box.x || box.y + box.height + 8 <= actionBox.y).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const viewport = graph(page).locator('.react-flow__viewport');
    const before = await viewport.getAttribute('style');
    await graph(page).locator('.react-flow__controls-zoomout').click();
    await expect(viewport).not.toHaveAttribute('style', before!);
    const smaller = await viewport.getAttribute('style');
    await graph(page).locator('.react-flow__controls-zoomin').click();
    await expect(viewport).not.toHaveAttribute('style', smaller!);
    await graph(page).locator('.react-flow__controls-zoomout').click();
    const beforeFit = await viewport.getAttribute('style');
    await graph(page).locator('.react-flow__controls-fitview').click();
    await expect(viewport).not.toHaveAttribute('style', beforeFit!);
    await expect(graph(page).locator('.composer-card').last()).toBeInViewport();
  }
});
