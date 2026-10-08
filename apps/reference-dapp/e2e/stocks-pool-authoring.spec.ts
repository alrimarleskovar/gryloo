// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { installSupplyWallet, setSupplyWalletChain } from './supply-fixtures';
import { configureCanvasAction } from './composer-authoring-fixtures';
import type { Page } from '@playwright/test';

const cards = (page: Page) => page.locator('.build-flow-surface .composer-card');
async function workflowJson(page: Page) {
  const advanced = page.locator('details.library[aria-label="Advanced action setup"]');
  if (!(await advanced.evaluate(element => element.hasAttribute('open')))) await advanced.locator(':scope > summary').click();
  const json = advanced.locator('[data-workflow-ir]');
  if (!(await json.count())) return null;
  if (!(await json.isVisible())) await advanced.getByText('Workflow IR', { exact: true }).click();
  return JSON.parse(await json.innerText());
}

test('floating Stocks action creates a Supply-style editable card without connecting a wallet', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Undock toolbar', exact: true }).click();
  const toolbox = page.locator('.floating-toolbox');
  const stocks = toolbox.getByRole('button', { name: 'Stocks', exact: true });
  await expect(stocks).toHaveAttribute('title', 'Stocks');
  await expect(stocks).toBeEnabled(); await expect(stocks.locator('svg')).toBeVisible();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const styles = await toolbox.evaluate(element => ({ padding: getComputedStyle(element).paddingLeft, width: element.getBoundingClientRect().width }));
    expect(styles.padding).toBe('5px'); expect(styles.width).toBeGreaterThan(46);
    const stockBox = (await stocks.boundingBox())!, iconBox = (await stocks.locator('svg').boundingBox())!;
    expect(Math.abs(stockBox.x + stockBox.width / 2 - iconBox.x - iconBox.width / 2)).toBeLessThan(1);
  }
  await stocks.click();
  const card = cards(page);
  await expect(card.locator('.composer-action-title')).toHaveText('1. Stocks');
  await expect(card.locator('.composer-metadata')).toHaveText('Robinhood');
  await expect(card.locator('.composer-amount-box')).toHaveCount(1);
  await expect(card.getByRole('textbox', { name: 'Stocks amount', exact: true })).toHaveValue('0');
  await expect(card.locator('.composer-fiat-value')).toHaveText('USD value unavailable');
  await expect(card.getByRole('button', { name: 'Select stock', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(card.getByRole('img', { name: 'Robinhood', exact: true })).toBeVisible();
  await expect(card.getByRole('img', { name: 'Robinhood Chain network', exact: true })).toBeVisible();
  expect(await card.getByRole('img', { name: 'Robinhood', exact: true }).evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(card.locator('.composer-token-chip .composer-amount-token')).toHaveText('AAPL');
  await expect(card.locator('.composer-destination-box, .composer-amount-actions, .composer-warning, .composer-card-state, button:disabled')).toHaveCount(0);
  expect(await card.innerText()).not.toMatch(/unsupported|non-executable|coming soon|placeholder|warning|debug|lab\b|transfer|balance|holding/i);
  await expect(card.getByRole('button', { name: 'Advanced Settings', exact: true })).toBeEnabled();
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
});

test('Stocks amount, equities and settings share UI state while canonical workflow and wallet requests stay untouched', async ({ page }) => {
  await installSupplyWallet(page); await page.goto('/');
  await setSupplyWalletChain(page, '0x2105');
  await page.getByRole('button', { name: 'Add swap', exact: true }).click();
  await configureCanvasAction(page, '2');
  const original = await workflowJson(page);
  expect(original).not.toBeNull();
  await page.getByRole('button', { name: 'Stocks', exact: true }).click();
  const card = cards(page).filter({ hasText: 'Robinhood' }), amount = card.getByRole('textbox', { name: 'Stocks amount', exact: true });
  await amount.click(); await amount.pressSequentially('25'); await expect(amount).toHaveValue('25');
  const equity = card.getByRole('button', { name: 'Select stock', exact: true });
  await equity.click();
  const picker = page.getByRole('region', { name: 'Stocks configuration', exact: true });
  for (const symbol of ['AAPL', 'TSLA', 'NVDA']) {
    await picker.locator('.composer-stock-option').filter({ hasText: symbol }).click();
    await expect(card.locator('.composer-amount-token')).toHaveText(symbol);
  }
  await card.getByRole('button', { name: 'Advanced Settings', exact: true }).click();
  const inspector = page.getByRole('region', { name: 'Action inspector', exact: true });
  await expect(inspector.getByRole('textbox', { name: 'Stocks amount', exact: true })).toHaveValue('25');
  await inspector.getByRole('textbox', { name: 'Stocks amount', exact: true }).fill('12.5');
  await expect(amount).toHaveValue('12.5');
  await inspector.getByRole('combobox', { name: 'Equity', exact: true }).selectOption('TSLA');
  await expect(equity).toContainText('TSLA');
  await expect(picker.getByRole('radio', { name: 'TSLA', exact: true })).toBeChecked();
  expect(await inspector.innerText()).not.toMatch(/unsupported|non-executable|coming soon|placeholder|warning|debug|lab\b|transfer|balance|holding/i);
  await setSupplyWalletChain(page, '0x14a34');
  await expect(card.locator('.composer-metadata')).toHaveText('Robinhood');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const { box, amountBox, pill } = await card.evaluate(element => ({
      box: element.querySelector('.composer-amount-box')!.getBoundingClientRect().toJSON(),
      amountBox: element.querySelector('.composer-amount-box input')!.getBoundingClientRect().toJSON(),
      pill: element.querySelector('.composer-equity-pill')!.getBoundingClientRect().toJSON(),
    }));
    expect(amountBox.x + amountBox.width).toBeLessThan(pill.x);
    expect(pill.x + pill.width).toBeLessThan(box.x + box.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
  expect(await workflowJson(page)).toEqual(original);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
  expect(await page.evaluate(() => (window as unknown as { supplyWalletRequests: { method: string }[] }).supplyWalletRequests.filter(request => /sign|send|switch|addEthereumChain/i.test(request.method)))).toEqual([]);
});

test('Stocks coexists with a Pool card and can be removed without changing the canonical Pool', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Stocks', exact: true }).click();
  const stock = cards(page).filter({ hasText: 'Robinhood' });
  await stock.getByRole('textbox', { name: 'Stocks amount', exact: true }).fill('3');
  await page.getByRole('button', { name: 'Add pool', exact: true }).click();
  await expect(cards(page)).toHaveCount(2);
  await expect(stock.getByRole('textbox', { name: 'Stocks amount', exact: true })).toHaveValue('3');
  const pool = cards(page).filter({ hasText: 'Pool / Liquidity' });
  await expect(pool.getByRole('textbox', { name: 'First liquidity amount (USDC)', exact: true })).toHaveValue('0');
  await stock.locator('.composer-action-title').click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(cards(page)).toHaveCount(1);
  await expect(pool.getByRole('textbox', { name: 'First liquidity amount (USDC)', exact: true })).toHaveValue('0');
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
});

test('both Pool contribution fields share the position form and require fresh Review before Apply', async ({ page }) => {
  await installSupplyWallet(page); await page.goto('/');
  await page.getByRole('button', { name: 'Add pool', exact: true }).click();
  const card = cards(page);
  const first = card.getByRole('textbox', { name: 'First liquidity amount (USDC)', exact: true });
  const second = card.getByRole('textbox', { name: 'Second liquidity amount (WETH)', exact: true });
  await expect(first).toHaveValue('0'); await expect(second).toHaveValue('0');
  await expect(page.getByRole('button', { name: 'Simulate fees', exact: true })).toBeDisabled();
  await card.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await first.fill('2.5'); await second.fill('0.0002');
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
  await card.getByRole('button', { name: 'Advanced Settings', exact: true }).click();
  const inspector = page.getByRole('region', { name: 'Action inspector', exact: true });
  await expect(inspector.getByLabel('Maximum USDC', { exact: true })).toHaveValue('2.5');
  await expect(inspector.getByLabel('Maximum WETH', { exact: true })).toHaveValue('0.0002');
  const review = card.getByRole('button', { name: 'Review', exact: true }), apply = card.getByRole('button', { name: 'Apply', exact: true });
  await review.click(); await expect(apply).toBeEnabled();
  await expect(page.getByRole('region', { name: 'Workflow edit review', exact: true })).toHaveCount(0);
  await second.fill('0.0003'); await expect(apply).toBeDisabled();
  await inspector.getByLabel('Maximum USDC', { exact: true }).fill('3');
  await expect(first).toHaveValue('3');
  await first.press('Enter'); await expect(apply).toBeEnabled(); await apply.click();
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
  await expect(first).toHaveValue('3'); await expect(second).toHaveValue('0.0003');
  await card.getByRole('button', { name: 'Price', exact: true }).click();
  const presets = page.locator('.composer-pool-presets');
  await presets.locator('.composer-pool-preset').filter({ hasText: 'Wide' }).click();
  const positions = await card.getByRole('slider').evaluateAll(elements => elements.map(element => (element as HTMLElement).style.left));
  await first.fill('4'); await second.fill('0.0004');
  expect(await card.getByRole('slider').evaluateAll(elements => elements.map(element => (element as HTMLElement).style.left))).toEqual(positions);
  await expect(presets.locator('.composer-pool-preset').filter({ hasText: 'Wide' }).getByRole('radio')).toBeChecked();
  await expect(apply).toBeDisabled();
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
  await card.getByRole('button', { name: 'Tick', exact: true }).click();
  await first.fill('0'); await second.fill('0'); await review.click(); await expect(apply).toBeDisabled();
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
  expect(await page.evaluate(() => (window as unknown as { supplyWalletRequests: { method: string }[] }).supplyWalletRequests.filter(request => /send|sign/i.test(request.method)))).toEqual([]);
});

test('Orca Pool contribution fields use the existing Solana position review and keep both amounts synchronized', async ({ page }) => {
  await installSupplyWallet(page); await page.goto('/');
  await expect(page.getByRole('combobox', { name: 'Environment', exact: true })).toHaveText('Testnet');
  // Enter authored bounds directly; this check needs no quote or provider calls.
  const prompt = page.locator('#mock-prompt');
  await prompt.fill('Add liquidity 0.01 SOL and 0.30 devUSDC ticks -39104 to -36992 on Solana Devnet');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: 'Apply proposal', exact: true }).click();
  const card = cards(page);
  const first = card.getByRole('textbox', { name: 'First liquidity amount (SOL)', exact: true });
  const second = card.getByRole('textbox', { name: 'Second liquidity amount (devUSDC)', exact: true });
  await first.fill('0.02'); await second.fill('0.4');
  await card.getByRole('button', { name: 'Advanced Settings', exact: true }).click();
  const inspector = page.getByRole('region', { name: 'Action inspector', exact: true });
  await expect(inspector.getByLabel('Maximum SOL', { exact: true })).toHaveValue('0.02');
  await expect(inspector.getByLabel('Maximum devUSDC', { exact: true })).toHaveValue('0.4');
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
  await card.getByRole('button', { name: 'Review', exact: true }).click();
  await card.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '2');
  await expect(first).toHaveValue('0.02'); await expect(second).toHaveValue('0.4');
});

test('Stocks pill opens a compact stock list with shared selection and no extra form fields', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.library .action-list, .library-note')).toHaveCount(0);
  await expect(page.getByText('One semantic plan', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Stocks', exact: true }).click();
  const card = cards(page), equity = card.getByRole('button', { name: 'Select stock', exact: true });
  const amount = card.getByRole('textbox', { name: 'Stocks amount', exact: true });
  const panel = page.getByRole('region', { name: 'Stocks configuration', exact: true });
  await amount.fill('12.5');
  await expect(panel).toHaveCount(0);
  await equity.click();
  await expect(panel).toBeVisible(); await expect(equity).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.locator('form, select, input:not([type="radio"]), .composer-stocks-heading')).toHaveCount(0);
  await expect(panel.getByRole('radio')).toHaveCount(5);
  await expect(panel.getByRole('radio', { name: 'AAPL', exact: true })).toBeChecked();
  await panel.locator('.composer-stock-option').filter({ hasText: 'NVDA' }).click();
  await expect(equity).toContainText('NVDA');
  await expect(amount).toHaveValue('12.5');
  const selected = panel.getByRole('radio', { name: 'NVDA', exact: true });
  await selected.focus(); await selected.press('ArrowDown');
  await expect(panel.getByRole('radio', { name: 'MSFT', exact: true })).toBeChecked();
  await expect(equity).toContainText('MSFT');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(panel).toBeInViewport({ ratio: 0.99 });
    await expect(card).toBeInViewport({ ratio: 0.99 });
    const badge = await card.locator('.composer-robinhood-avatar').evaluate(element => ({
      avatar: element.getBoundingClientRect().toJSON(),
      overlay: element.querySelector('.composer-network-badge')!.getBoundingClientRect().toJSON(),
      pill: element.closest('.composer-equity-pill')!.getBoundingClientRect().toJSON(),
    }));
    expect(badge.overlay.width).toBeLessThan(badge.avatar.width);
    expect(badge.overlay.x).toBeGreaterThan(badge.avatar.x);
    expect(badge.overlay.x).toBeLessThan(badge.avatar.x + badge.avatar.width);
    expect(badge.overlay.y + badge.overlay.height).toBeLessThan(badge.pill.y + badge.pill.height);
    expect(await card.locator('.composer-network-badge').evaluate(element => getComputedStyle(element).borderRadius)).toBe('50%');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
  await panel.getByRole('button', { name: 'Hide Stocks configuration', exact: true }).click();
  await expect(panel).toHaveCount(0); await expect(equity).toHaveAttribute('aria-expanded', 'false');
  await equity.focus(); await equity.press('Enter');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('radio', { name: 'MSFT', exact: true })).toBeChecked();
  await equity.click(); await expect(panel).toHaveCount(0);
  await expect(amount).toHaveValue('12.5');
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
});
