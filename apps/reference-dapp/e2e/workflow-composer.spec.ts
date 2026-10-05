// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
const owner = '0x1111111111111111111111111111111111111111';
const cards = (page: Page) => page.locator('.build-flow-surface .composer-card');
const step = (page: Page, id: string) => page.locator(`.build-flow-surface .react-flow__node[data-id="${id}"]`);
const inspector = (page: Page) => page.getByRole('region', { name: 'Action inspector' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(account => {
    const requests: string[] = [];
    Object.assign(window, { composerWalletRequests: requests, ethereum: {
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
  expect(await page.evaluate(() => (window as unknown as { composerWalletRequests: string[] }).composerWalletRequests.filter(method => /sign|send/i.test(method)))).toEqual([]);
});
async function open(page: Page) {
  await page.goto('/');
  await expect(page.locator('.build009-wallet-info')).toBeVisible({ timeout: 15000 });
}
async function lending(page: Page) {
  await open(page);
  await page.getByRole('button', { name: 'Add Supply → Borrow → Swap', exact: true }).click();
  await expect(cards(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Apply proposal', exact: true }).click();
  await expect(cards(page)).toHaveCount(3);
  await expect(step(page, 'lending-supply')).toBeVisible();
}

test('supported toolbar actions create real selected nodes and bind their editors', async ({ page }) => {
  for (const [action, form] of [
    ['swap', null], ['bridge', 'Edit cross-chain bridge'], ['pool', 'Edit Base Sepolia liquidity position'],
    ['supply', 'Edit Supply'], ['borrow', 'Edit Borrow'], ['repay', 'Edit Repay'], ['withdraw', 'Edit Withdraw'],
  ] as const) {
    await open(page);
    await page.getByRole('button', { name: `Add ${action}`, exact: true }).click();
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page)).toHaveClass(/active/);
    await expect(cards(page)).toContainText('Step 1');
    await expect(cards(page)).toContainText('USDC');
    await expect(cards(page)).toContainText(action === 'swap' ? 'Base (8453)' : 'Base Sepolia');
    await expect(cards(page).locator('input, form')).toHaveCount(0);
    await expect(inspector(page)).toContainText('STEP 1');
    if (form) await expect(inspector(page).getByRole('form', { name: form, exact: true })).toBeVisible();
    else await expect(inspector(page).getByLabel('Input amount (USDC)')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Privacy', exact: true })).toBeDisabled();
  }
});

test('connected lending steps select one editor, update linked summaries after acceptance and preserve order when dragged', async ({ page }) => {
  await lending(page);
  await expect(step(page, 'lending-supply').locator('.composer-card')).toHaveClass(/active/);
  await expect(page.locator('.build-flow-surface .react-flow__edge')).toHaveCount(2);
  await expect(page.locator('.build-flow-surface .react-flow__edge-path').first()).toHaveAttribute('marker-end', /.+/);
  for (const [id, number, form] of [
    ['lending-supply', 1, 'Edit Aave Supply'], ['lending-borrow', 2, 'Edit Aave Borrow'], ['lending-swap', 3, 'Edit Uniswap Swap'],
  ] as const) {
    await step(page, id).locator('.composer-card').click();
    await expect(page.locator('.build-flow-surface .composer-card.active')).toHaveCount(1);
    await expect(inspector(page)).toContainText(`STEP ${number}`);
    await expect(inspector(page).getByRole('form', { name: form, exact: true })).toBeVisible();
  }
  await step(page, 'lending-borrow').click();
  await inspector(page).getByLabel('Borrow amount USDC').fill('0.025');
  await inspector(page).getByRole('button', { name: 'Review Aave Borrow change' }).click();
  await expect(step(page, 'lending-borrow')).toContainText('0.01 USDC');
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await expect(step(page, 'lending-borrow')).toContainText('0.025 USDC');
  await expect(step(page, 'lending-swap')).toContainText('0.025 USDC');
  await expect(step(page, 'lending-borrow').locator('.composer-card')).toHaveClass(/active/);
  await step(page, 'lending-borrow').scrollIntoViewIfNeeded();
  const box = await step(page, 'lending-borrow').boundingBox();
  if (!box) throw new Error('Borrow node missing');
  await page.mouse.move(box.x + 30, box.y + 25); await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + 25, { steps: 8 }); await page.mouse.up();
  expect((await step(page, 'lending-borrow').boundingBox())!.x - box.x).toBeGreaterThan(30);
  await expect(step(page, 'lending-borrow')).toContainText('Step 2');
  await expect(page.locator('.build-flow-surface .react-flow__edge')).toHaveCount(2);
  const edge = page.locator('.build-flow-surface .react-flow__edge').first();
  await step(page, 'lending-supply').scrollIntoViewIfNeeded();
  await edge.locator('.react-flow__edge-textbg').click();
  await expect(edge).toHaveClass(/selected/);
  await page.keyboard.press('Delete');
  await expect(page.getByRole('status').filter({ hasText: 'This connection is required by the workflow.' })).toBeVisible();
  await expect(page.locator('.build-flow-surface .react-flow__edge')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.locator('.build-flow-surface .composer-card.active')).toHaveCount(0);
  await expect(inspector(page)).toContainText('Select a step');
  await step(page, 'lending-swap').focus(); await page.keyboard.press('Enter');
  await expect(inspector(page)).toContainText('STEP 3');
  await expect(step(page, 'lending-swap').locator('.composer-card')).toHaveClass(/active/);
});

test('accepted settings update the card and existing warnings link to Selected Action', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Add swap', exact: true }).click();
  await inspector(page).getByLabel('Input amount (USDC)').fill('2.5');
  await inspector(page).getByRole('button', { name: 'Review amount change' }).click();
  await expect(cards(page)).toContainText('1 USDC');
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await expect(cards(page)).toContainText('2.5 USDC');
  await inspector(page).getByLabel('Slippage (bps)').fill('200');
  await inspector(page).getByRole('button', { name: 'Review slippage change' }).click();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await expect(cards(page)).toHaveAttribute('data-state', 'warning');
  await expect(cards(page)).toContainText('Warning');
  await expect(inspector(page).getByLabel('Selected action checks')).toContainText('Review the prototype slippage limit.');
  await expect(page.locator('.build-flow-surface .react-flow__edge')).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove step', exact: true }).click();
  await expect(cards(page)).toHaveCount(0); await expect(inspector(page)).toContainText('Select a step');
});

test('desktop and mobile composer keep compact cards, editor placement and approved canvas controls', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 }); await lending(page);
    await expect(cards(page)).toHaveCount(3);
    const canvas = await page.getByRole('region', { name: 'Workflow canvas', exact: true }).boundingBox();
    const editor = await inspector(page).boundingBox();
    expect(editor!.y).toBeGreaterThanOrEqual(canvas!.y + canvas!.height);
    await expect(page.getByRole('button', { name: 'Simular Fees', exact: true })).toBeVisible();
    await expect(page.locator('.build-flow-surface .react-flow__controls')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const cta = await page.getByRole('button', { name: 'Simular Fees', exact: true }).boundingBox();
    for (const card of await cards(page).all()) {
      const box = await card.boundingBox();
      if (!box || !cta) throw new Error('Card or canvas CTA missing');
      expect(box.x + box.width + 8 <= cta.x || cta.x + cta.width + 8 <= box.x || box.y + box.height + 8 <= cta.y || cta.y + cta.height + 8 <= box.y).toBe(true);
    }
    const dimensions = await cards(page).first().evaluate(element => ({ width: (element as HTMLElement).offsetWidth, height: (element as HTMLElement).offsetHeight }));
    expect(dimensions.width).toBeLessThanOrEqual(224); expect(dimensions.height).toBeLessThan(230);
  }
});
