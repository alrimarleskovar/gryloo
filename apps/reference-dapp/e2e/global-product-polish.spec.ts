// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, openProposalReview } from './fixtures';
import { selectSettingsTheme } from './settings-fixtures';
import type { Locator, Page } from '@playwright/test';
import { installSupplyWallet } from './supply-fixtures';
import { configureCanvasAction, configureCanvasPool } from './composer-authoring-fixtures';

const widths = [1440, 1024, 768, 375, 320];
async function theme(page: Page, value: 'Light' | 'Dark') {
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  await settings.click();
  await selectSettingsTheme(page, value);
  await settings.press('Escape');
  await expect(page.locator('html')).toHaveAttribute('data-theme', value.toLowerCase());
}
async function contained(inner: Locator, outer: Locator) {
  await expect.poll(async () => {
    const child = await inner.boundingBox(), parent = await outer.boundingBox();
    return Boolean(child && parent && child.x >= parent.x - 1 && child.y >= parent.y - 1 &&
      child.x + child.width <= parent.x + parent.width + 1 && child.y + child.height <= parent.y + parent.height + 1);
  }).toBe(true);
}
async function noPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const value of ['Light', 'Dark'] as const) for (const action of ['pool', 'swap', 'bridge'] as const) {
  test(`${value} ${action} keeps semantic asset grouping, contained pickers and unchanged authoring`, async ({ page }) => {
    await installSupplyWallet(page); await page.goto('/');
    await expect(page.locator('.build009-wallet-info')).toBeVisible();
    await theme(page, value);
    await page.getByRole('button', { name: `Add ${action}`, exact: true }).click();
    if (action === 'pool') await configureCanvasPool(page);
    else await configureCanvasAction(page, '2.5');
    const card = page.locator('.build-flow-surface .composer-card');
    const pair = card.locator('.composer-value-pair');
    const canvas = page.locator('.build-flow-surface');
    const source = card.getByRole('button', { name: action === 'bridge' ? 'Configure source asset' : 'Select source token', exact: true });
    const picker = page.getByRole('region', { name: action === 'bridge' ? 'Source bridge picker' : 'Source asset picker', exact: true });
    const original = await card.getByRole('textbox').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value));
    await expect(pair).toHaveAttribute('data-relationship', action === 'pool' ? 'contribution' : 'directional');
    await expect(card.locator('.composer-value-arrow')).toHaveCount(action === 'pool' ? 0 : 1);
    if (action !== 'pool') await expect(card.locator('.composer-quote-note')).toHaveCSS('font-size', '11px');
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      const geometry = await pair.evaluate(element => {
        const boxes = [...element.querySelectorAll('.composer-amount-box')];
        const first = boxes[0]!.getBoundingClientRect(), second = boxes[1]!.getBoundingClientRect();
        const scale = first.height / parseFloat(getComputedStyle(boxes[0]!).height);
        return { gap: (second.y - first.y - first.height) / scale, rows: getComputedStyle(element).gridTemplateRows.split(' ').length };
      });
      expect(geometry.gap).toBeCloseTo(action === 'pool' ? 8 : 6, 1);
      expect(geometry.rows).toBe(action === 'pool' ? 2 : 3);
      await expect(source.locator('.composer-network-badge')).toHaveCount(1);
      await source.press('Enter');
      await expect(picker).toBeVisible();
      await expect(picker.locator('.composer-token-options .composer-network-badge')).toHaveCount(0);
      expect(await picker.locator('.brand-icon').evaluateAll(icons => icons.every(icon => getComputedStyle(icon).filter === 'none'))).toBe(true);
      await contained(picker, canvas);
      const selected = picker.getByRole('radio', { checked: true });
      await expect(selected).toBeFocused();
      expect(await selected.locator('..').evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
      await picker.press('Escape'); await expect(picker).toHaveCount(0); await expect(source).toBeFocused();
      await expect.poll(async () => (await card.boundingBox())!.width).toBeGreaterThanOrEqual(160);
      await noPageOverflow(page);
      await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
      expect(await card.getByRole('textbox').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value))).toEqual(original);
      if (width === 1440 || width === 320) await page.screenshot({ style: 'nextjs-portal{display:none}', path: `.tmp/ux007-${action}-${value.toLowerCase()}-${width}.png`, fullPage: true });
    }
    if (action === 'pool') {
      await card.getByRole('button', { name: 'Price', exact: true }).click();
      const strategies = page.getByRole('group', { name: 'Price strategies', exact: true });
      await expect(strategies).toBeVisible(); await contained(strategies, canvas);
      await expect(card.getByRole('button', { name: 'Review', exact: true })).toBeDisabled();
      await expect(card.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
      await strategies.getByRole('button', { name: 'Hide price strategies', exact: true }).press('Enter');
      await card.getByRole('button', { name: 'Tick', exact: true }).click();
      await expect(card.locator('.composer-value-arrow')).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Simulate fees', exact: true }).click();
    const inspection = page.locator('.simulate-flow-surface .composer-card');
    await expect(inspection.locator('.composer-value-arrow')).toHaveCount(action === 'pool' ? 0 : 1);
    await expect(inspection.locator('input, select, button')).toHaveCount(0);
    await noPageOverflow(page);
    expect(await page.evaluate(() => (window as unknown as { supplyWalletRequests: { method: string }[] }).supplyWalletRequests.filter(request => /send|sign/i.test(request.method)))).toEqual([]);
  });
}

for (const value of ['Light', 'Dark'] as const) test(`${value} global stage flow preserves wallet, environment, focus and workspace entry at common widths`, async ({ page }) => {
  await installSupplyWallet(page); await page.goto('/');
  await expect(page.locator('.build009-wallet-info')).toBeVisible();
  await theme(page, value);
  await page.getByRole('button', { name: 'Add supply', exact: true }).click();
  await configureCanvasAction(page, '1');
  const nav = page.getByRole('navigation', { name: 'Workflow stages' });
  const wallet = page.getByRole('group', { name: 'Wallet connection', exact: true });
  const environment = page.getByRole('combobox', { name: 'Environment', exact: true });
  const walletText = await wallet.innerText();
  await environment.focus();
  await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  await expect(environment).toBeFocused();
  await expect(environment).toHaveCSS('outline-style', 'solid');
  await expect(environment).toHaveCSS('outline-color', await nav.getByRole('button', { name: 'Build', exact: true }).evaluate(element => getComputedStyle(element).color));
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    for (const stage of ['Simulate', 'Execute', 'Dashboard', 'Build']) {
      await nav.getByRole('button', { name: stage, exact: true }).click();
      await expect(nav.getByRole('button', { name: stage, exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(wallet).toHaveText(walletText); await expect(environment).toHaveText('Testnet');
      await noPageOverflow(page);
      if (stage === 'Execute') {
        await expect(page.locator('.execute-heading')).toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'Execution Summary', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toBeDisabled();
        const grid = page.locator('.execute-workspace-grid');
        const inset = await page.getByRole('main').evaluate(element => element.getBoundingClientRect().top + parseFloat(getComputedStyle(element).paddingTop));
        expect((await grid.boundingBox())!.y).toBeCloseTo(inset, 1);
      }
      if (stage === 'Simulate') await expect(page.getByRole('heading', { name: 'Simulation Summary', exact: true })).toBeVisible();
      if (width === 1440 || width === 320) await page.screenshot({ style: 'nextjs-portal{display:none}', path: `.tmp/ux007-flow-${stage.toLowerCase()}-${value.toLowerCase()}-${width}.png`, fullPage: true });
    }
  }
  await page.getByRole('link', { name: 'Skip to workspace', exact: true }).focus();
  await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('link', { name: 'Skip to workspace', exact: true })).toHaveCSS('outline-style', 'solid');
  await page.getByRole('link', { name: 'Skip to workspace', exact: true }).press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  expect(await page.evaluate(() => (window as unknown as { supplyWalletRequests: { method: string }[] }).supplyWalletRequests.filter(request => /send|sign/i.test(request.method)))).toEqual([]);
});

for (const value of ['Light', 'Dark'] as const) test(`${value} keyboard selection keeps linked Borrow and Advanced Settings synchronized`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installSupplyWallet(page); await page.goto('/');
  await expect(page.locator('.build009-wallet-info')).toBeVisible();
  await theme(page, value);
  await page.getByRole('button', { name: 'Add Supply → Borrow → Swap', exact: true }).click();
  await openProposalReview(page);
  await page.getByRole('button', { name: 'Apply proposal', exact: true }).click();
  const node = page.locator('.build-flow-surface .react-flow__node[data-id="lending-borrow"]');
  const borrow = node.locator('.composer-card');
  const supply = page.locator('.react-flow__node[data-id="lending-supply"] .composer-card');
  const swap = page.locator('.react-flow__node[data-id="lending-swap"] .composer-card');
  const inspector = page.getByRole('region', { name: 'Action inspector', exact: true });
  const revision = page.locator('.summary-bar');
  await node.focus(); await node.press('Enter');
  await expect(borrow).toHaveCSS('outline-style', 'solid');
  await expect(borrow).toHaveClass(/active/);
  await expect(supply).not.toHaveClass(/active/);
  await expect(inspector.getByRole('button', { name: 'Advanced Settings', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(revision).toHaveAttribute('data-workflow-revision', '1');
  await node.press('Escape'); await expect(borrow).not.toHaveClass(/active/);
  await node.press('Space'); await expect(borrow).toHaveClass(/active/);
  await borrow.getByRole('button', { name: 'Advanced Settings', exact: true }).press('Enter');
  await expect(inspector.getByRole('button', { name: 'Advanced Settings', exact: true })).toHaveAttribute('aria-expanded', 'true');
  const amount = borrow.getByRole('textbox', { name: 'Source amount (USDC)', exact: true });
  const settings = inspector.getByRole('textbox', { name: 'Borrow amount USDC', exact: true });
  await amount.fill('0.02'); await expect(settings).toHaveValue('0.02');
  await borrow.getByRole('button', { name: 'Review Borrow change', exact: true }).press('Enter');
  await expect(revision).toHaveAttribute('data-workflow-revision', '1');
  await borrow.getByRole('button', { name: 'Apply proposal', exact: true }).press('Enter');
  await expect(revision).toHaveAttribute('data-workflow-revision', '2');
  await expect(swap.locator('.composer-amount .composer-amount-value')).toHaveText('0.02');
  await expect(supply.getByRole('textbox', { name: 'Source amount (USDC)', exact: true })).toHaveValue('0.1');
  await settings.fill('0.03'); await expect(amount).toHaveValue('0.03');
  await expect(page.locator('.build-flow-surface .react-flow__edge')).toHaveCount(2);
  await expect(borrow).toHaveClass(/active/);
  await expect(revision).toHaveAttribute('data-workflow-revision', '2');
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { supplyWalletRequests: { method: string }[] }).supplyWalletRequests.filter(request => /send|sign/i.test(request.method)))).toEqual([]);
});
