// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { installSupplyWallet, setSupplyWalletChain } from './supply-fixtures';
import { configureCanvasAction, configureCanvasPool, openCanvasSettings } from './composer-authoring-fixtures';
import type { Locator } from '@playwright/test';

async function checkTokenPills(card: Locator) {
  for (const pill of await card.locator('.composer-amount-box > .composer-token-chip').all()) {
    const sizes = await pill.evaluate(element => ({ height: parseFloat(getComputedStyle(element).height),
      avatar: parseFloat(getComputedStyle(element.querySelector('.composer-token-avatar')!).width),
      ticker: parseFloat(getComputedStyle(element.querySelector('.composer-amount-token')!).fontSize),
      left: parseFloat(getComputedStyle(element).paddingLeft), right: parseFloat(getComputedStyle(element).paddingRight) }));
    expect(sizes.height).toBeGreaterThanOrEqual(34); expect(sizes.avatar).toBeGreaterThanOrEqual(22);
    expect(sizes.ticker).toBeGreaterThanOrEqual(12); expect(sizes.left).toBeGreaterThan(4); expect(sizes.right).toBeGreaterThan(8);
    await expect(pill.getByRole('img')).toBeVisible();
    const box = (await pill.boundingBox())!, valueBox = (await pill.locator('..').boundingBox())!;
    expect(box.x).toBeGreaterThan(valueBox.x); expect(box.x + box.width).toBeLessThan(valueBox.x + valueBox.width);
    expect(box.y).toBeGreaterThan(valueBox.y); expect(box.y + box.height).toBeLessThan(valueBox.y + valueBox.height);
    const badge = pill.locator('.composer-network-badge'), avatar = pill.locator('.composer-token-avatar');
    const badgeStyle = await badge.evaluate(element => ({ width: parseFloat(getComputedStyle(element).width), height: parseFloat(getComputedStyle(element).height), font: parseFloat(getComputedStyle(element).fontSize), radius: getComputedStyle(element).borderRadius }));
    expect(badgeStyle.width).toBeGreaterThanOrEqual(14); expect(badgeStyle.height).toBe(badgeStyle.width);
    expect(badgeStyle.font).toBeGreaterThanOrEqual(9); expect(badgeStyle.radius).toBe('50%');
    expect(badgeStyle.width).toBeLessThan(await avatar.locator(':scope > .brand-icon').evaluate(element => parseFloat(getComputedStyle(element).width)));
    const badgeBox = (await badge.boundingBox())!, avatarBox = (await avatar.boundingBox())!, tickerBox = (await pill.locator('.composer-amount-token').boundingBox())!;
    expect(badgeBox.width).toBeLessThan(avatarBox.width);
    expect(badgeBox.x + badgeBox.width).toBeLessThan(tickerBox.x);
    expect(badgeBox.y + badgeBox.height).toBeLessThan(box.y + box.height);
  }
  for (const column of await card.locator('.composer-value-column').all()) {
    const line = column.locator('.composer-value-line');
    const subline = column.locator(':scope > .composer-fiat-value, :scope > .composer-token-subline');
    const mainBox = (await line.boundingBox())!, subBox = (await subline.boundingBox())!;
    const scale = mainBox.height / await line.evaluate(element => parseFloat(getComputedStyle(element).height));
    expect((subBox.y - mainBox.y - mainBox.height) / scale).toBeCloseTo(1, 2);
    const mainValue = line.locator('.composer-amount-value, .composer-primary-fiat');
    const valueSize = await mainValue.evaluate(element => parseFloat(getComputedStyle(element).fontSize));
    expect(valueSize).toBeGreaterThanOrEqual(20); expect(valueSize).toBeLessThanOrEqual(22);
    const valueBox = (await column.locator('..').boundingBox())!, pillBox = (await column.locator('..').locator(':scope > .composer-token-chip').boundingBox())!;
    expect(subBox.y + subBox.height).toBeLessThan(valueBox.y + valueBox.height);
    expect(mainBox.x + mainBox.width).toBeLessThan(pillBox.x);
    expect(subBox.x + subBox.width).toBeLessThan(pillBox.x);
    const primaryFiat = column.locator('.composer-primary-fiat');
    if (await primaryFiat.count()) {
      const fiatBox = (await primaryFiat.boundingBox())!;
      expect(fiatBox.x + fiatBox.width).toBeLessThan(pillBox.x);
    }
  }
}

for (const action of ['swap', 'bridge'] as const) test(`${action} has quiet editable values and opens settings only explicitly`, async ({ page }) => {
  await installSupplyWallet(page); await page.goto('/app');
  await page.getByRole('button', { name: `Add ${action}`, exact: true }).click();
  const card = page.locator('.build-flow-surface .composer-card');
  const panel = page.getByRole('region', { name: 'Action inspector' });
  const source = card.getByRole('textbox', { name: 'Source amount (USDC)', exact: true });
  const toggle = panel.getByRole('button', { name: 'Advanced Settings', exact: true });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(source).toHaveValue('0');
    await expect(card.locator('.composer-card-state, .composer-warning, .composer-amount-error, .composer-value-edit')).toHaveCount(0);
    await expect(card).not.toHaveAttribute('data-state');
    await checkTokenPills(card);
    const typography = await source.evaluate(element => ({
      font: getComputedStyle(element).fontFamily, size: parseFloat(getComputedStyle(element).fontSize),
      weight: Number(getComputedStyle(element).fontWeight), border: getComputedStyle(element).borderBottomStyle,
      tracking: parseFloat(getComputedStyle(element).letterSpacing),
      bodyFont: getComputedStyle(document.body).fontFamily,
    }));
    expect(typography.font).toBe(typography.bodyFont);
    expect(typography.size).toBe(22); expect(typography.weight).toBeGreaterThanOrEqual(700);
    expect(typography.tracking / typography.size).toBeCloseTo(-.05);
    expect(typography.border).toBe('none');
    const fiat = card.locator('.composer-amount .composer-fiat-value');
    expect(await fiat.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeLessThan(typography.size);
    expect(await fiat.evaluate(element => getComputedStyle(element).textDecorationLine)).toBe('none');
    const topBox = (await card.locator('.composer-amount-box').first().boundingBox())!;
    const bottomBox = (await card.locator('.composer-destination-box').boundingBox())!;
    const arrow = card.locator('.composer-value-arrow');
    await expect(arrow).toHaveAttribute('aria-hidden', 'true');
    const arrowBox = (await arrow.boundingBox())!;
    const gap = bottomBox.y - topBox.y - topBox.height;
    const scale = arrowBox.width / await arrow.evaluate(element => parseFloat(getComputedStyle(element).width));
    expect(gap).toBeGreaterThan(0); expect(gap / scale).toBeCloseTo(6, 2);
    expect(arrowBox.y).toBeLessThan(topBox.y + topBox.height);
    expect(arrowBox.y + arrowBox.height).toBeGreaterThan(bottomBox.y);
    expect(Math.abs(arrowBox.y + arrowBox.height / 2 - (topBox.y + topBox.height + gap / 2))).toBeLessThan(1);
    expect(Math.abs(arrowBox.x + arrowBox.width / 2 - topBox.x - topBox.width / 2)).toBeLessThan(1);
    expect(arrowBox.width).toBeCloseTo(arrowBox.height);
    expect(await arrow.evaluate(element => getComputedStyle(element).borderRadius)).toBe('50%');
    expect(await arrow.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none');
    const cardBox = (await card.boundingBox())!, footerBox = (await card.locator('.composer-selected').boundingBox())!;
    expect(footerBox.y).toBeGreaterThan(bottomBox.y + bottomBox.height);
    expect(footerBox.y + footerBox.height).toBeLessThan(cardBox.y + cardBox.height);
    await fiat.click();
    await checkTokenPills(card);
    const primaryFiat = card.locator('.composer-amount .composer-primary-fiat');
    expect(await primaryFiat.evaluate(element => parseFloat(getComputedStyle(element).letterSpacing) / parseFloat(getComputedStyle(element).fontSize))).toBeCloseTo(-.05);
    await primaryFiat.click();
    await card.locator('.composer-action-title').click();
    await expect(card).toHaveClass(/active/); await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await source.click();
    const inputFocus = await source.evaluate(element => ({ outline: getComputedStyle(element).outlineStyle, shadow: getComputedStyle(element).boxShadow, border: getComputedStyle(element).borderStyle }));
    expect(inputFocus).toEqual({ outline: 'none', shadow: 'none', border: 'none' });
    await expect(card).toHaveClass(/active/);
    await source.press('Shift+Tab'); await page.keyboard.press('Tab');
    await expect(source).toBeFocused();
    expect(await source.evaluate(element => element.matches(':focus-visible'))).toBe(true);
    expect(await source.evaluate(element => getComputedStyle(element).color)).toBe(await card.locator('.composer-amount-box').first().evaluate(element => getComputedStyle(element).borderTopColor));
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
  await card.getByRole('button', { name: 'Review amount', exact: true }).click();
  await expect(card.getByRole('alert')).toContainText('greater than 0');
  expect(await card.getByRole('alert').evaluate(element => getComputedStyle(element).clipPath)).toBe('inset(50%)');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: 'Simulate workflow', exact: true })).toBeDisabled();
  await openCanvasSettings(page);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const form = panel.getByRole('form', { name: `Configure ${action === 'swap' ? 'Swap' : 'Bridge'}`, exact: true });
  await form.getByLabel('Source amount (USDC)', { exact: true }).press('Enter');
  await expect(form.getByRole('alert')).toContainText('greater than 0');
  await toggle.click();
  await source.fill('2.5');
  await configureCanvasAction(page, '2.5');
  await expect(source).toHaveValue('2.5'); await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await card.locator('.composer-action-title').click(); await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const gear = card.getByRole('button', { name: 'Advanced Settings', exact: true });
  await gear.focus(); await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByLabel(action === 'swap' ? 'Input amount (USDC)' : 'Cross-chain amount (USDC)', { exact: true })).toHaveValue('2.5');
});

for (const action of ['swap', 'bridge'] as const) test(`${action} shares one fiat/token display mode across both value boxes without changing amounts`, async ({ page }) => {
  await installSupplyWallet(page); await page.goto('/app');
  await page.getByRole('button', { name: `Add ${action}`, exact: true }).click();
  await configureCanvasAction(page, '2.5');
  const card = page.locator('.build-flow-surface .composer-card');
  const source = card.locator('.composer-amount'), destination = card.locator('.composer-destination-box');
  const sourceInput = source.getByRole('textbox', { name: 'Source amount (USDC)', exact: true });
  const revision = page.locator('.summary-bar');
  const destinationToken = action === 'swap' ? 'WETH' : 'USDC';
  async function expectTokenPrimary() {
    await expect(sourceInput).toHaveValue('2.5'); await expect(sourceInput).toHaveClass(/composer-amount-value/);
    await expect(destination.locator('.composer-amount-value')).toHaveText('0');
    await expect(card.locator('.composer-primary-fiat, .composer-token-subline')).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Show fiat amount first (estimate unavailable)', exact: true })).toHaveCount(2);
    await expect(revision).toHaveAttribute('data-workflow-revision', '1');
  }
  async function expectFiatPrimary() {
    await expect(card.locator('.composer-primary-fiat')).toHaveText(['USD value unavailable', 'USD value unavailable']);
    await expect(source.locator('.composer-token-subline input')).toHaveValue('2.5');
    await expect(source.locator('.composer-token-subline > span')).toHaveText('USDC');
    await expect(destination.locator('.composer-token-subline')).toHaveText(`0 ${destinationToken}`);
    await expect(card.getByRole('button', { name: 'Show fiat amount first (estimate unavailable)', exact: true })).toHaveCount(0);
    await expect(revision).toHaveAttribute('data-workflow-revision', '1');
  }
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expectTokenPrimary(); await checkTokenPills(card);
    // Either box controls both; mouse and keyboard return paths remain accessible.
    for (const box of [source, destination]) {
      await box.getByRole('button', { name: 'Show fiat amount first (estimate unavailable)', exact: true }).click();
      await expectFiatPrimary(); await checkTokenPills(card);
      const subInput = source.locator('.composer-token-subline input');
      const inputBox = (await subInput.boundingBox())!, symbolBox = (await source.locator('.composer-token-subline > span').boundingBox())!;
      const scale = inputBox.height / await subInput.evaluate(element => parseFloat(getComputedStyle(element).height));
      expect(inputBox.width / scale).toBeLessThan(20);
      expect((symbolBox.x - inputBox.x - inputBox.width) / scale).toBeCloseTo(3, 1);
      await box.getByRole('button', { name: 'Show token amount first', exact: true }).press('Enter');
      await expectTokenPrimary();
      await box.getByRole('button', { name: 'Show fiat amount first (estimate unavailable)', exact: true }).press('Space');
      await expectFiatPrimary();
      await box.locator('.composer-primary-fiat').click(); await expectTokenPrimary();
    }
    await expect(card.locator('.composer-quote-note')).toHaveText('Estimate unavailable');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
  await openCanvasSettings(page);
  await expect(page.getByRole('region', { name: 'Action inspector' }).getByLabel(action === 'swap' ? 'Input amount (USDC)' : 'Cross-chain amount (USDC)', { exact: true })).toHaveValue('2.5');
  await expect(card.getByRole('button', { name: 'Review amount', exact: true })).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Simulate', exact: true }).click();
  await expect(page.locator('.simulate-flow-surface .composer-amount')).toHaveText('2.5 USDC');
  expect(await page.evaluate(() => (window as unknown as { supplyWalletRequests: { method: string }[] }).supplyWalletRequests.filter(request => /send|sign/i.test(request.method)))).toEqual([]);
});

for (const action of ['borrow', 'repay', 'withdraw'] as const) test(`${action} uses Supply's editable zero-based value block and validated Review/Apply`, async ({ page }) => {
  await installSupplyWallet(page); await page.goto('/app');
  await page.getByRole('button', { name: `Add ${action}`, exact: true }).click();
  const card = page.locator('.build-flow-surface .composer-card');
  const block = card.locator('.composer-amount-box');
  const name = action[0]!.toUpperCase() + action.slice(1);
  const panel = page.getByRole('region', { name: 'Action inspector' });
  await expect(card.locator('.composer-action-title')).toHaveText(`1. ${name}`);
  await expect(card.locator('.composer-metadata')).toContainText('Aave V3 · Base Sepolia');
  await expect(block).toHaveCount(1);
  const inline = block.getByRole('textbox', { name: 'Source amount (USDC)', exact: true });
  const review = card.getByRole('button', { name: `Review ${name} change`, exact: true });
  const apply = card.getByRole('button', { name: 'Apply proposal', exact: true });
  await expect(inline).toHaveValue('0');
  await expect(review).toBeVisible(); await expect(apply).toHaveCount(0);
  await expect(block.locator('.composer-fiat-value')).toHaveText('USD value unavailable');
  await expect(block.locator('.composer-amount-token')).toHaveText('USDC');
  await expect(card.locator('form, .composer-destination-box, .composer-value-arrow')).toHaveCount(0);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await waitForPoolLayout(card);
    await checkTokenPills(card);
    await card.locator('.composer-action-title').click();
    await expect(card).toHaveClass(/active/);
    await expect(panel.locator('.inspector-toggle')).toHaveAttribute('aria-expanded', 'false');
    const blockBox = (await block.boundingBox())!, footerBox = (await card.locator('.composer-selected').boundingBox())!, cardBox = (await card.boundingBox())!;
    expect(footerBox.y).toBeGreaterThan(blockBox.y + blockBox.height);
    expect(footerBox.y + footerBox.height).toBeLessThan(cardBox.y + cardBox.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
  const revision = page.locator('.summary-bar');
  const simulate = page.getByRole('button', { name: 'Simulate workflow', exact: true });
  const execute = page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Execute', exact: true });
  await expect(simulate).toBeDisabled(); await expect(execute).toBeDisabled();
  await expect(revision).toHaveAttribute('data-workflow-revision', '0');
  await openCanvasSettings(page);
  await expect(panel.getByRole('form', { name: `Configure ${name}`, exact: true })).toBeVisible();
  for (const value of ['0', '', '0.0000001', '-1']) {
    await inline.fill(value); await review.click();
    await expect(panel.getByRole('alert')).toContainText('greater than 0');
    await expect(apply).toHaveCount(0); await expect(simulate).toBeDisabled(); await expect(execute).toBeDisabled();
    await expect(revision).toHaveAttribute('data-workflow-revision', '0');
  }
  await inline.fill('2.5');
  await expect(panel.getByLabel('Source amount (USDC)', { exact: true })).toHaveValue('2.5');
  await review.click(); await expect(apply).toBeEnabled();
  await expect(revision).toHaveAttribute('data-workflow-revision', '0');
  await inline.fill('3'); await expect(apply).toHaveCount(0);
  await review.click(); await expect(apply).toBeEnabled();
  await apply.click(); await expect(revision).toHaveAttribute('data-workflow-revision', '1');
  await expect(inline).toHaveValue('3');
  await expect(panel.getByRole('form', { name: `Edit ${name}`, exact: true })).toBeVisible();
  const settingsAmount = panel.getByLabel(`${name} amount (USDC)`, { exact: true });
  await expect(settingsAmount).toHaveValue('3');
  await expect(panel.getByRole('button', { name: `Review ${name} change`, exact: true })).toHaveCount(0);
  await inline.fill('0'); await expect(settingsAmount).toHaveValue('0');
  await review.click(); await expect(apply).toHaveCount(0);
  await expect(simulate).toBeDisabled(); await expect(execute).toBeDisabled();
  await expect(revision).toHaveAttribute('data-workflow-revision', '1');
  await settingsAmount.fill('3.05'); await expect(inline).toHaveValue('3.05');
  await review.click(); await expect(apply).toBeEnabled(); await apply.click();
  await expect(revision).toHaveAttribute('data-workflow-revision', '2');
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Simulate', exact: true }).click();
  await expect(page.locator('.simulate-flow-surface .composer-amount')).toHaveText('3.05 USDC');
  expect(await page.evaluate(() => (window as unknown as { supplyWalletRequests: { method: string }[] }).supplyWalletRequests.filter(request => /send|sign/i.test(request.method)))).toEqual([]);
});

test('Supply edits inline with one shared editor value and validates through its existing review/apply path', async ({ page }) => {
  await installSupplyWallet(page); await page.goto('/app');
  await expect(page.locator('.build009-wallet-info')).toBeVisible();
  await page.getByRole('button', { name: 'Add supply', exact: true }).click();
  const card = page.locator('.build-flow-surface .composer-card');
  const block = card.locator('.composer-amount-box');
  const panel = page.getByRole('region', { name: 'Action inspector' });
  const inline = card.getByRole('textbox', { name: 'Source amount (USDC)', exact: true });
  const reviewSupply = card.getByRole('button', { name: 'Review Supply change', exact: true });
  const applySupply = card.getByRole('button', { name: 'Apply proposal', exact: true });
  await expect(block).toHaveCount(1);
  await expect(reviewSupply).toBeVisible(); await expect(applySupply).toHaveCount(0);
  await expect(card.locator('.composer-destination-box, .composer-value-arrow, form')).toHaveCount(0);
  await expect(inline).toHaveValue('0');
  await inline.click(); await inline.fill('0');
  await expect(panel.locator('.inspector-toggle')).toHaveAttribute('aria-expanded', 'false');
  expect(await inline.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('none');
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
  await expect(card.locator('.composer-action-title')).toHaveText('1. Supply');
  await expect(card.locator('.composer-metadata')).toContainText('Aave V3 · Base Sepolia');
  await expect(block.locator('.composer-token-chip .composer-amount-token')).toHaveText('USDC');
  await expect(block.getByRole('img', { name: 'Base Sepolia network', exact: true })).toBeVisible();
  await openCanvasSettings(page);
  const amount = panel.getByLabel('Source amount (USDC)', { exact: true });
  await expect(panel.getByRole('button', { name: 'Review Supply change', exact: true })).toHaveCount(0);
  await expect(amount).toHaveValue('0'); await reviewSupply.click();
  await expect(panel.getByRole('alert')).toContainText('greater than 0');
  await expect(applySupply).toHaveCount(0);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
  await amount.fill('2.5');
  await expect(inline).toHaveValue('2.5');
  await panel.getByRole('button', { name: 'Advanced Settings', exact: true }).click();
  await inline.press('Enter');
  await expect(applySupply).toBeEnabled();
  const lowerReview = page.getByRole('region', { name: 'Workflow edit review', exact: true });
  await expect(lowerReview).toBeVisible();
  await expect(lowerReview.getByRole('button', { name: 'Apply proposal', exact: true })).toHaveCount(0);
  await expect(lowerReview.getByRole('button', { name: 'Dismiss', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply proposal', exact: true })).toHaveCount(1);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const reviewBox = (await reviewSupply.boundingBox())!, applyBox = (await applySupply.boundingBox())!, blockBox = (await block.boundingBox())!;
    expect(Math.abs(reviewBox.y - applyBox.y)).toBeLessThan(1);
    expect(applyBox.x).toBeGreaterThanOrEqual(reviewBox.x + reviewBox.width);
    expect(applyBox.x + applyBox.width).toBeLessThanOrEqual(blockBox.x + blockBox.width);
    await checkTokenPills(card);
  }
  await inline.fill('3');
  await expect(applySupply).toHaveCount(0); await expect(lowerReview).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Simulate workflow', exact: true })).toBeDisabled();
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
  await reviewSupply.click(); await expect(applySupply).toBeEnabled();
  await lowerReview.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(applySupply).toHaveCount(0);
  await reviewSupply.click(); await expect(applySupply).toBeEnabled();
  await expect(inline).toHaveValue('3');
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
  await applySupply.focus(); await applySupply.press('Enter');
  await expect(inline).toHaveValue('3');
  await expect(applySupply).toHaveCount(0); await expect(lowerReview).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Advanced Settings', exact: true })).toHaveAttribute('aria-expanded', 'false');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const value = block.locator('.composer-amount-value'), token = block.locator(':scope > .composer-token-chip');
    const valueBox = (await value.boundingBox())!, tokenBox = (await token.boundingBox())!, blockBox = (await block.boundingBox())!;
    expect(valueBox.x + valueBox.width).toBeLessThan(tokenBox.x);
    expect(tokenBox.x + tokenBox.width).toBeLessThan(blockBox.x + blockBox.width);
    await expect(block.locator('.composer-fiat-value')).toHaveText('USD value unavailable');
    const footerBox = (await card.locator('.composer-selected').boundingBox())!;
    expect(footerBox.y).toBeGreaterThan(blockBox.y + blockBox.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await expect(card).toHaveClass(/active/);
  }
  await openCanvasSettings(page); await expect(panel.getByLabel('Supply amount (USDC)', { exact: true })).toHaveValue('3');
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Simulate', exact: true }).click();
  await expect(page.locator('.simulate-flow-surface .composer-amount')).toHaveText('3 USDC');
  expect(await page.evaluate(() => (window as unknown as { supplyWalletRequests: { method: string }[] }).supplyWalletRequests.filter(request => /sign|send/i.test(request.method)))).toEqual([]);
});

test('floating toolbox exposes the existing guarded Delete action alongside every tool', async ({ page }) => {
  await page.goto('/app');
  await page.getByRole('button', { name: 'Undock toolbar', exact: true }).click();
  const toolbox = page.locator('.floating-toolbox');
  const remove = toolbox.getByRole('button', { name: 'Delete', exact: true });
  await expect(remove).toBeDisabled();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of ['Add swap', 'Add bridge', 'Add pool', 'Add supply', 'Add Supply → Borrow → Swap', 'Add borrow', 'Add repay', 'Add withdraw', 'Stocks', 'Privacy', 'Duplicate selection', 'Undo', 'Redo', 'Delete']) {
      await expect(toolbox.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await remove.scrollIntoViewIfNeeded();
    await expect(remove).toBeInViewport();
    await expect(remove.locator('svg')).toBeVisible();
    const style = await remove.evaluate(element => ({ width: getComputedStyle(element).width, height: getComputedStyle(element).height }));
    expect(style).toEqual(await toolbox.getByRole('button', { name: 'Redo', exact: true }).evaluate(element => ({ width: getComputedStyle(element).width, height: getComputedStyle(element).height })));
  }
  await toolbox.getByRole('button', { name: 'Add swap', exact: true }).click();
  await expect(page.locator('.build-flow-surface .composer-card')).toHaveCount(1);
  await expect(remove).toBeEnabled();
  await remove.click();
  await expect(page.locator('.build-flow-surface .composer-card')).toHaveCount(0);
  await expect(remove).toBeDisabled();
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
  await toolbox.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.build-flow-surface .composer-card')).toHaveCount(1);
  await toolbox.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('.build-flow-surface .composer-card')).toHaveCount(0);
});

test('header environment follows wallet changes without rewriting action amounts', async ({ page }) => {
  await installSupplyWallet(page); await page.goto('/app');
  const header = page.getByRole('banner');
  const environment = header.getByRole('combobox', { name: 'Environment', exact: true });
  await environment.click();
  expect(await page.getByRole('listbox', { name: 'Environment options' }).getByRole('option').allTextContents()).toEqual(['Testnet', 'Mainnet']);
  await environment.press('Escape');
  const wallet = header.getByRole('group', { name: 'Wallet connection', exact: true });
  await expect(wallet).toContainText('0x1111…1111');
  await page.getByRole('button', { name: 'Add swap', exact: true }).click();
  const source = page.locator('.composer-card').getByRole('textbox', { name: 'Source amount (USDC)', exact: true });
  for (const value of ['PUBLIC_TESTNET', 'MAINNET']) {
    await setSupplyWalletChain(page, value === 'MAINNET' ? '0x2105' : '0x14a34');
    await expect(environment).toHaveText(value === 'MAINNET' ? 'Mainnet' : 'Testnet'); await expect(source).toHaveValue('0');
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
    await expect(wallet).toContainText(value === 'MAINNET' ? 'Base (8453)' : 'Base Sepolia');
    await expect(page.getByRole('button', { name: 'Simulate workflow', exact: true })).toBeDisabled();
    await expect(page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Execute', exact: true })).toBeDisabled();
  }
  expect(await page.evaluate(() => (window as unknown as { supplyWalletRequests: { method: string }[] }).supplyWalletRequests.filter(request => /sign|send|switch|addEthereumChain/i.test(request.method)))).toEqual([]);
  await configureCanvasAction(page, '2');
  const advanced = page.locator('details.library[aria-label="Advanced action setup"]');
  await advanced.locator(':scope > summary').click(); await advanced.getByText('Workflow IR', { exact: true }).click();
  const workflow = await advanced.locator('[data-workflow-ir]').innerText();
  await setSupplyWalletChain(page, '0x14a34');
  expect(await advanced.locator('[data-workflow-ir]').innerText()).toBe(workflow);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
  for (const width of [1440, 900, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await header.scrollIntoViewIfNeeded();
    await expect(environment).toBeInViewport();
    await expect(header.getByRole('button', { name: 'Settings', exact: true })).toBeInViewport();
    const selectorBox = (await environment.boundingBox())!, walletBox = (await wallet.boundingBox())!;
    expect(selectorBox.x + selectorBox.width).toBeLessThanOrEqual(walletBox.x);
    expect(Math.abs(selectorBox.y + selectorBox.height / 2 - walletBox.y - walletBox.height / 2)).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
});


async function waitForPoolLayout(card: ReturnType<import('@playwright/test').Page['locator']>) {
  await card.evaluate(async element => {
    let previous = '', stable = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const bounds = JSON.stringify(element.getBoundingClientRect().toJSON());
      stable = bounds === previous ? stable + 1 : 0; previous = bounds;
      if (stable >= 8) return;
    }
    throw new Error('Pool layout did not settle');
  });
}

test('Pool uses two real liquidity asset blocks with the shared display mode and existing position editor', async ({ page }) => {
  await installSupplyWallet(page); await page.goto('/app');
  await page.getByRole('button', { name: 'Add pool', exact: true }).click();
  await configureCanvasPool(page);
  const card = page.locator('.build-flow-surface .composer-card');
  const boxes = card.locator('.composer-amount-box');
  const first = card.getByRole('group', { name: 'First liquidity asset amount', exact: true });
  const second = card.getByRole('group', { name: 'Second liquidity asset amount', exact: true });
  await expect(boxes).toHaveCount(2);
  await expect(boxes.locator('.composer-amount-value').first()).toHaveValue('1');
  await expect(boxes.locator('.composer-amount-value').last()).toHaveValue('0.0001');
  await expect(boxes.locator('.composer-amount-token')).toHaveText(['USDC', 'WETH']);
  await expect(card.locator('form, .composer-quote-note')).toHaveCount(0);
  await expect(card.getByRole('textbox')).toHaveCount(2);
  const provider = card.getByRole('group', { name: 'Liquidity provider', exact: true });
  const uniswap = provider.getByRole('button', { name: 'Uniswap', exact: true }), solana = provider.getByRole('button', { name: 'Solana', exact: true });
  const custom = card.getByRole('spinbutton', { name: 'Custom range percentage', exact: true });
  await expect(uniswap).toHaveAttribute('aria-pressed', 'true');
  await expect(solana).toHaveAttribute('aria-pressed', 'false');
  await expect(provider.getByRole('button')).toHaveText(['Uniswap', 'Solana']);
  await expect(card.locator('select')).toHaveCount(0);
  await expect(card.locator('.composer-metadata, .composer-detail')).toHaveCount(0);
  await expect(card.getByText('USDC / WETH', { exact: true })).toHaveCount(0);
  await card.getByRole('button', { name: 'Price', exact: true }).click();
  await expect(custom).toHaveValue('10');
  await expect(card.locator('.composer-pool-custom-box')).toContainText('Custom');
  await expect(card.getByText(/Price range:/)).toHaveCount(0);
  await expect(card.locator('.composer-price-range')).toBeVisible();
  await expect(card.getByRole('slider')).toHaveCount(2);
  await expect(card.locator('.composer-pool-thin-control')).toHaveCount(0);
  await expect(card.getByText('Range', { exact: true })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Review', exact: true })).toBeDisabled();
  await expect(card.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await solana.click();
  await custom.fill('15');
  await expect(solana).toHaveAttribute('aria-pressed', 'true');
  await expect(uniswap).toHaveAttribute('aria-pressed', 'false');
  await expect(custom).toHaveValue('15');
  // Previewing controls neither replaces the existing pool nor changes its real assets.
  await expect(boxes.locator('.composer-amount-token')).toHaveText(['USDC', 'WETH']);
  await expect(page.getByRole('region', { name: 'Workflow edit review', exact: true })).toHaveCount(0);
  await uniswap.focus(); await uniswap.press('Enter'); await custom.fill('10');
  const revision = page.locator('.summary-bar');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await waitForPoolLayout(card);
    await checkTokenPills(card);
    const cardBox = (await card.boundingBox())!, titleBox = (await card.locator('.composer-action-title').boundingBox())!, providerBox = (await provider.boundingBox())!;
    expect(providerBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
    const blue = await card.locator('.composer-action-title').evaluate(element => getComputedStyle(element).color);
    expect(await uniswap.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(blue);
    expect(await solana.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(blue);
    expect(await provider.evaluate(element => getComputedStyle(element).borderRadius)).toBe(await card.locator('.composer-pool-range .composer-pool-mode').evaluate(element => getComputedStyle(element).borderRadius));
    for (const control of [provider, card.locator('.composer-pool-custom-box'), card.locator('.composer-price-range')]) {
      const bounds = (await control.boundingBox())!;
      expect(bounds.x).toBeGreaterThan(cardBox.x); expect(bounds.x + bounds.width).toBeLessThan(cardBox.x + cardBox.width);
    }
    const customBox = (await card.locator('.composer-pool-custom-box').boundingBox())!, thin = (await card.locator('.composer-price-range').boundingBox())!;
    expect(thin.y + thin.height).toBeLessThan(customBox.y);
    expect(thin.width).toBeGreaterThan(customBox.width);
    const modeBox = (await card.locator('.composer-pool-range').boundingBox())!;
    expect(modeBox.x).toBeGreaterThan(customBox.x + customBox.width);
    expect(Math.abs(modeBox.y + modeBox.height / 2 - customBox.y - customBox.height / 2)).toBeLessThan(1);
    await custom.focus();
    const customStyle = await custom.evaluate(element => { const style = getComputedStyle(element); return [style.borderTopWidth, style.outlineStyle, style.boxShadow]; });
    expect(customStyle).toEqual(['0px', 'none', 'none']);
    const actions = (await card.locator('.composer-amount-actions').boundingBox())!;
    expect(actions.y).toBeGreaterThan(customBox.y + customBox.height);
    expect(actions.y + actions.height).toBeLessThan((await card.locator('.composer-selected').boundingBox())!.y);
    expect(thin.height).toBeLessThan(customBox.height * 3);
    expect(customBox.y + customBox.height).toBeLessThan((await card.locator('.composer-selected').boundingBox())!.y);
    await expect(card.locator('.composer-value-arrow')).toHaveCount(0);
    await expect(card.locator('.composer-value-pair')).toHaveAttribute('data-relationship', 'contribution');
    const top = (await first.boundingBox())!, bottom = (await second.boundingBox())!;
    const scale = top.height / await first.evaluate(element => parseFloat(getComputedStyle(element).height));
    expect((bottom.y - top.y - top.height) / scale).toBeCloseTo(8, 1);
    for (const box of [first, second]) {
      await box.getByRole('button', { name: 'Show fiat amount first (estimate unavailable)', exact: true }).click();
      await expect(boxes.locator('.composer-primary-fiat')).toHaveText(['USD value unavailable', 'USD value unavailable']);
      await expect(boxes.locator('.composer-token-subline input').first()).toHaveValue('1');
      await expect(boxes.locator('.composer-token-subline input').last()).toHaveValue('0.0001');
      await expect(boxes.locator('.composer-token-subline > span')).toHaveText(['USDC', 'WETH']);
      await checkTokenPills(card);
      await box.getByRole('button', { name: 'Show token amount first', exact: true }).press('Enter');
      await expect(boxes.locator('.composer-amount-value').first()).toHaveValue('1');
      await expect(boxes.locator('.composer-amount-value').last()).toHaveValue('0.0001');
    }
    await expect(revision).toHaveAttribute('data-workflow-revision', '1');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
  await card.getByRole('button', { name: 'Tick', exact: true }).click();
  await openCanvasSettings(page);
  const panel = page.getByRole('region', { name: 'Action inspector' });
  await expect(panel.getByLabel('Maximum USDC', { exact: true })).toHaveValue('1');
  await expect(panel.getByLabel('Maximum WETH', { exact: true })).toHaveValue('0.0001');
  await panel.getByLabel('Maximum USDC', { exact: true }).fill('2');
  await expect(panel.getByRole('button', { name: 'Review position change', exact: true })).toHaveCount(0);
  // The card submits the existing position form, even while Advanced Settings is collapsed.
  await panel.getByRole('button', { name: 'Advanced Settings', exact: true }).click();
  await card.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  await expect(boxes.locator('.composer-amount-value').first()).toHaveValue('2');
  await expect(boxes.locator('.composer-amount-value').last()).toHaveValue('0.0001');
  await expect(revision).toHaveAttribute('data-workflow-revision', '1');
  await expect(page.getByRole('region', { name: 'Workflow edit review' })).toHaveCount(0);
  await card.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(boxes.locator('.composer-amount-value').first()).toHaveValue('2');
  await expect(boxes.locator('.composer-amount-value').last()).toHaveValue('0.0001');
  await expect(revision).toHaveAttribute('data-workflow-revision', '2');
  await expect(card.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await openCanvasSettings(page);
  await panel.getByLabel('Maximum USDC', { exact: true }).fill('-1');
  await card.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(panel.getByRole('alert')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await expect(revision).toHaveAttribute('data-workflow-revision', '2');
  expect(await page.evaluate(() => (window as unknown as { supplyWalletRequests: { method: string }[] }).supplyWalletRequests.filter(request => /send|sign/i.test(request.method)))).toEqual([]);
});


test('linked Borrow edits use the existing composition command and keep Supply and Swap linkage intact', async ({ page }) => {
  await installSupplyWallet(page); await page.goto('/app');
  await page.getByRole('button', { name: 'Add Supply → Borrow → Swap', exact: true }).click();
  await page.getByRole('button', { name: 'Apply proposal', exact: true }).click();
  const supply = page.locator('.react-flow__node[data-id="lending-supply"] .composer-card');
  const borrow = page.locator('.react-flow__node[data-id="lending-borrow"] .composer-card');
  const swap = page.locator('.react-flow__node[data-id="lending-swap"] .composer-card');
  const amount = borrow.getByRole('textbox', { name: 'Source amount (USDC)', exact: true });
  await borrow.locator('.composer-action-title').click();
  await borrow.getByRole('button', { name: 'Advanced Settings', exact: true }).click();
  const review = borrow.getByRole('button', { name: 'Review Borrow change', exact: true });
  const apply = borrow.getByRole('button', { name: 'Apply proposal', exact: true });
  await amount.fill('0'); await review.click(); await expect(apply).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Simulate workflow', exact: true })).toBeDisabled();
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
  await amount.fill('0.02'); await review.click(); await expect(apply).toBeEnabled(); await apply.click();
  await expect(supply.getByRole('textbox', { name: 'Source amount (USDC)', exact: true })).toHaveValue('0.1');
  await expect(swap.locator('.composer-amount .composer-amount-value')).toHaveText('0.02');
  await expect(page.locator('.build-flow-surface .react-flow__edge')).toHaveCount(2);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '2');
  const settings = page.getByRole('region', { name: 'Action inspector' }).getByLabel('Borrow amount USDC', { exact: true });
  await expect(settings).toHaveValue('0.02');
  await settings.fill('0.03'); await expect(amount).toHaveValue('0.03');
  await settings.fill('0.02'); await review.click(); await expect(apply).toBeEnabled(); await apply.click();
  await expect(swap.locator('.composer-amount .composer-amount-value')).toHaveText('0.02');
  await expect(page.getByRole('button', { name: 'Simulate workflow', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as { supplyWalletRequests: { method: string }[] }).supplyWalletRequests.filter(request => /send|sign/i.test(request.method)))).toEqual([]);
});


test('Pool Tick/Price selector reveals attached right-side price tiles without changing the authored position', async ({ page }) => {
  await installSupplyWallet(page); await page.goto('/app');
  await page.getByRole('button', { name: 'Add pool', exact: true }).click();
  await configureCanvasPool(page);
  const card = page.locator('.build-flow-surface .composer-card');
  const view = card.getByRole('group', { name: 'Liquidity range view', exact: true });
  const poolNode = page.locator('.build-flow-surface .composer-pool-node');
  const presets = poolNode.getByRole('group', { name: 'Price strategies', exact: true });
  const panel = page.getByRole('region', { name: 'Action inspector' });
  const tick = view.getByRole('button', { name: 'Tick', exact: true }), price = view.getByRole('button', { name: 'Price', exact: true });
  await expect(tick).toHaveAttribute('aria-pressed', 'true');
  await expect(price).toHaveAttribute('aria-pressed', 'false');
  await expect(presets).toHaveCount(0);
  await openCanvasSettings(page);
  const original = await Promise.all(['Maximum USDC', 'Maximum WETH', 'Lower bound', 'Upper bound', 'Liquidity slippage (bps)'].map(name => panel.getByLabel(name, { exact: true }).inputValue()));
  const strategies = [
    ['Stable', '± 0.03%', 'Good for stablecoins or pairs with low volatility'],
    ['Wide', '–50% — +100%', 'Good for volatile pairs'],
    ['Lower single-sided', '–50%', 'Provide liquidity if the price falls'],
    ['Upper single-sided', '+100%', 'Provide liquidity if the price rises'],
  ];
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const compactHeight = await card.evaluate(element => (element as HTMLElement).offsetHeight), compactWidth = await card.evaluate(element => (element as HTMLElement).offsetWidth);
    await price.click(); await expect(presets).toBeVisible();
    await waitForPoolLayout(card);
    expect(await card.evaluate(element => (element as HTMLElement).offsetHeight)).toBeLessThan(compactHeight + 85);
    expect(await card.evaluate(element => (element as HTMLElement).offsetWidth)).toBe(compactWidth);
    await expect(card.getByRole('group', { name: 'Price strategies', exact: true })).toHaveCount(0);
    await expect(price).toHaveAttribute('aria-pressed', 'true');
    await expect(tick).toHaveAttribute('aria-pressed', 'false');
    const blue = await card.locator('.composer-action-title').evaluate(element => getComputedStyle(element).color);
    expect(await price.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(blue);
    expect(await tick.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(blue);
    const amplo = presets.locator('.composer-pool-preset').filter({ hasText: 'Wide' });
    if (width === 1440) await expect(presets.locator('input:checked')).toHaveCount(0);
    await amplo.click();
    await expect(amplo.getByRole('radio')).toBeChecked();
    await expect(amplo.locator('.composer-pool-preset-check')).toBeVisible();
    expect(await amplo.evaluate(element => getComputedStyle(element).borderTopColor)).toBe(blue);
    const stable = presets.locator('.composer-pool-preset').filter({ hasText: 'Stable' });
    await expect(stable.locator('.composer-pool-preset-check')).toBeHidden();
    expect(await amplo.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(await stable.evaluate(element => getComputedStyle(element).backgroundColor));
    await page.mouse.move(0, 0);
    await waitForPoolLayout(poolNode);
    const beforeHover = await stable.evaluate(element => getComputedStyle(element).backgroundColor), beforeBox = (await stable.boundingBox())!;
    await stable.hover();
    expect(await stable.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(beforeHover);
    expect(await stable.boundingBox()).toEqual(beforeBox);
    const titleStyle = await stable.locator('.composer-pool-preset-title').evaluate(element => ({ size: parseFloat(getComputedStyle(element).fontSize), weight: Number(getComputedStyle(element).fontWeight) }));
    const rangeStyle = await stable.locator('.composer-pool-preset-range').evaluate(element => ({ size: parseFloat(getComputedStyle(element).fontSize), weight: Number(getComputedStyle(element).fontWeight) }));
    expect(titleStyle.size).toBeGreaterThan(rangeStyle.size); expect(titleStyle.weight).toBeGreaterThan(rangeStyle.weight);
    expect(rangeStyle.size).toBeGreaterThan(await stable.locator('.composer-pool-preset-description').evaluate(element => parseFloat(getComputedStyle(element).fontSize)));

    await expect(presets.getByRole('radio')).toHaveCount(4);
    await expect(card.locator('.composer-amount-box')).toHaveCount(2);
    for (const [title, range, description] of strategies) {
      const tile = presets.locator('.composer-pool-preset').filter({ hasText: title! });
      await expect(tile.locator('.composer-pool-preset-range')).toHaveText(range!);
      await expect(tile.locator('.composer-pool-preset-description')).toHaveText(description!);
      await tile.click(); await expect(tile.getByRole('radio')).toBeChecked();
      await expect(tile.locator('.composer-pool-preset-check')).toBeVisible();
      await expect(presets.locator('.composer-pool-preset-check:visible')).toHaveCount(1);
      expect(await tile.evaluate(element => getComputedStyle(element).borderTopColor)).toBe(blue);
      await expect(presets.locator('input:checked')).toHaveCount(1);
      const boundaries: Record<string, [number, number, string, string]> = {
        'Stable': [40, 60, '-0.03%', '+0.03%'], 'Wide': [30, 90, '-50%', '+100%'],
        'Lower single-sided': [25, 50, '-50%', '0%'], 'Upper single-sided': [50, 90, '0%', '+100%'],
      };
      const [left, right, lowerLabel, upperLabel] = boundaries[title!]!;
      const lower = card.getByRole('slider', { name: 'Lower price boundary', exact: true });
      const upper = card.getByRole('slider', { name: 'Upper price boundary', exact: true });
      await expect(lower).toHaveAttribute('aria-valuetext', lowerLabel);
      await expect(upper).toHaveAttribute('aria-valuetext', upperLabel);
      expect(await lower.evaluate(element => (element as HTMLElement).style.left)).toBe(`${left}%`);
      expect(await upper.evaluate(element => (element as HTMLElement).style.left)).toBe(`${right}%`);
      await expect(lower.locator('.composer-price-bound-label')).toHaveText(lowerLabel);
      await expect(upper.locator('.composer-price-bound-label')).toHaveText(upperLabel);
      await expect(card.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
      await expect(card.locator('.composer-range-reference')).toHaveText('--');

      const tileBox = (await tile.boundingBox())!, panelBox = (await presets.boundingBox())!, cardBox = (await card.boundingBox())!;
      expect(panelBox.x).toBeGreaterThan(cardBox.x + cardBox.width);
      expect(panelBox.x - cardBox.x - cardBox.width).toBeLessThan(14);
      expect(Math.abs(panelBox.y + panelBox.height / 2 - cardBox.y - cardBox.height / 2)).toBeLessThan(1);
      expect(tileBox.x).toBeGreaterThan(panelBox.x); expect(tileBox.x + tileBox.width).toBeLessThan(panelBox.x + panelBox.width);
      expect(tileBox.y + tileBox.height).toBeLessThan(panelBox.y + panelBox.height);
      await expect(tile).toBeInViewport();
    }
    const first = presets.getByRole('radio').first();
    await first.focus(); await first.press('ArrowRight');
    await expect(presets.getByRole('radio').nth(1)).toBeChecked();
    expect(await presets.locator('.composer-pool-preset').nth(1).evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
    await expect(card).toHaveClass(/active/);
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
    await waitForPoolLayout(card);
    const expanded = (await poolNode.boundingBox())!, canvas = (await page.locator('.build-flow-surface').boundingBox())!, cta = (await page.getByRole('button', { name: 'Simulate workflow', exact: true }).boundingBox())!;
    expect(expanded.y).toBeGreaterThanOrEqual(canvas.y);
    expect(expanded.y + expanded.height).toBeLessThan(cta.y);
    expect(expanded.x).toBeGreaterThanOrEqual(canvas.x);
    expect(expanded.x + expanded.width).toBeLessThanOrEqual(canvas.x + canvas.width);
    const zoom = (await page.locator('.build-flow-surface .canvas-navigator').boundingBox())!, strategyBounds = (await presets.boundingBox())!;
    expect(strategyBounds.x + strategyBounds.width <= zoom.x || strategyBounds.y + strategyBounds.height <= zoom.y, JSON.stringify({ width, strategyBounds, zoom })).toBe(true);
    const collapseBox = (await presets.getByRole('button', { name: 'Hide price strategies', exact: true }).boundingBox())!;
    expect(Math.abs(collapseBox.y + collapseBox.height / 2 - strategyBounds.y - strategyBounds.height / 2)).toBeLessThan(1);
    expect(Math.abs(collapseBox.x + collapseBox.width / 2 - strategyBounds.x)).toBeLessThan(2);
    expect(await card.locator('.composer-price-handle').first().evaluate(element => getComputedStyle(element).width)).toBe('16px');
    expect(await card.locator('.composer-price-handle').first().evaluate(element => getComputedStyle(element).borderTopWidth)).toBe('3px');
    expect(await card.locator('.composer-price-track').evaluate(element => getComputedStyle(element, '::before').height)).toBe('5px');
    expect(await card.locator('.composer-price-coverage').evaluate(element => getComputedStyle(element).height)).toBe('6px');
    expect(await card.locator('.composer-price-center').evaluate(element => getComputedStyle(element).width)).toBe('10px');
    expect(await card.locator('.composer-range-reference').evaluate(element => getComputedStyle(element).fontSize)).toBe('12px');
    expect(await card.locator('.composer-price-bound-label').first().evaluate(element => getComputedStyle(element).fontSize)).toBe('10px');
    const tiles = await presets.locator('.composer-pool-preset').all();
    const tileBounds = await Promise.all(tiles.map(tile => tile.boundingBox()));
    expect(tileBounds[0]!.y).toBe(tileBounds[1]!.y);
    expect(tileBounds[2]!.y).toBe(tileBounds[3]!.y);
    expect(tileBounds[2]!.y).toBeGreaterThan(tileBounds[0]!.y);
    await expect(page.getByRole('region', { name: 'Workflow edit review', exact: true })).toHaveCount(0);
    // Pressing the active Price segment does not overwrite a deliberate preset choice.
    await presets.locator('.composer-pool-preset').filter({ hasText: 'Upper single-sided' }).click();
    await price.click();
    await expect(presets.locator('.composer-pool-preset').filter({ hasText: 'Upper single-sided' }).getByRole('radio')).toBeChecked();
    await presets.getByRole('button', { name: 'Hide price strategies', exact: true }).click();
    await expect(presets).toHaveCount(0);
    await expect(price).toHaveAttribute('aria-pressed', 'true');
    await price.focus(); await price.press('Enter');
    await expect(presets.locator('.composer-pool-preset').filter({ hasText: 'Upper single-sided' }).getByRole('radio')).toBeChecked();
    await tick.focus(); await tick.press('Enter'); await expect(presets).toHaveCount(0);
    await price.click();
    await expect(presets.locator('.composer-pool-preset').filter({ hasText: 'Upper single-sided' }).getByRole('radio')).toBeChecked();
    await tick.click();
    await expect(tick).toHaveAttribute('aria-pressed', 'true');
    await expect(price).toHaveAttribute('aria-pressed', 'false');

    await expect(card.locator('.composer-amount-box .composer-amount-value').first()).toHaveValue('1');
    await expect(card.locator('.composer-amount-box .composer-amount-value').last()).toHaveValue('0.0001');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
  expect(await Promise.all(['Maximum USDC', 'Maximum WETH', 'Lower bound', 'Upper bound', 'Liquidity slippage (bps)'].map(name => panel.getByLabel(name, { exact: true }).inputValue()))).toEqual(original);
  expect(await page.evaluate(() => (window as unknown as { supplyWalletRequests: { method: string }[] }).supplyWalletRequests.filter(request => /send|sign/i.test(request.method)))).toEqual([]);
});


test('Pool custom price handles mirror live, share the percentage, and keep unavailable prices unapplied', async ({ page }) => {
  await installSupplyWallet(page); await page.goto('/app');
  await page.getByRole('button', { name: 'Add pool', exact: true }).click();
  await configureCanvasPool(page);
  const card = page.locator('.build-flow-surface .composer-card');
  const price = card.getByRole('button', { name: 'Price', exact: true });
  const tick = card.getByRole('button', { name: 'Tick', exact: true });
  const custom = card.getByRole('spinbutton', { name: 'Custom range percentage', exact: true });
  const lower = card.getByRole('slider', { name: 'Lower price boundary', exact: true });
  const upper = card.getByRole('slider', { name: 'Upper price boundary', exact: true });
  await expect(card.locator('.composer-price-range')).toHaveCount(0);
  await price.click();
  await expect(card.locator('.composer-pool-custom-value')).toContainText('±');
  await expect(custom).toHaveValue('10');
  await expect(card.locator('.composer-range-reference')).toHaveText('--');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const track = card.locator('.composer-price-track');
    await waitForPoolLayout(card);
    await expect(upper).toBeInViewport({ ratio: 0.99 });
    await custom.fill('10');
    const originalCenter = await card.locator('.composer-price-center').evaluate(element => (element as HTMLElement).offsetLeft);
    const positions = async () => Promise.all([lower, upper].map(handle => handle.evaluate(element => parseFloat((element as HTMLElement).style.left))));
    expect(await positions()).toEqual([45, 55]);
    const drag = async (handle: typeof lower, target: number) => {
      const bounds = (await track.boundingBox())!, handleBounds = (await handle.boundingBox())!;
      await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width * target, handleBounds.y + handleBounds.height / 2, { steps: 5 });
      await page.mouse.up();
    };
    await drag(upper, 0.575);
    expect(Number(await custom.inputValue())).toBeCloseTo(15, 0);
    const [left, right] = await positions();
    expect(left! + right!).toBeCloseTo(100, 4);
    await expect(lower).toHaveAttribute('aria-valuenow', await custom.inputValue());
    await expect(upper).toHaveAttribute('aria-valuenow', await custom.inputValue());
    await expect(card.locator('.composer-price-bound-label.lower')).toHaveText('-' + await custom.inputValue() + '%');
    await expect(card.locator('.composer-price-bound-label.upper')).toHaveText('+' + await custom.inputValue() + '%');
    await drag(lower, 0.4);
    expect(Number(await custom.inputValue())).toBeCloseTo(20, 0);
    const mirrored = await positions(); expect(mirrored[0]! + mirrored[1]!).toBeCloseTo(100, 4);
    await custom.fill('12'); expect(await positions()).toEqual([44, 56]);
    await lower.focus(); await lower.press('ArrowLeft'); await expect(custom).toHaveValue('13');
    await upper.focus(); await upper.press('ArrowRight'); await expect(custom).toHaveValue('14');
    expect(await card.locator('.composer-price-center').evaluate(element => (element as HTMLElement).offsetLeft)).toBe(originalCenter);
    await expect(card.getByRole('button', { name: 'Review', exact: true })).toBeDisabled();
    await expect(card.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
    await expect(page.getByRole('region', { name: 'Workflow edit review' })).toHaveCount(0);
  }
  await tick.click(); await expect(card.locator('.composer-price-range')).toHaveCount(0);
  await price.click(); await expect(custom).toHaveValue('14');
  await expect(card.getByRole('button', { name: 'Review', exact: true })).toBeDisabled();
  await expect(card.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await expect(card.locator('.composer-range-reference')).toHaveText('--');
  expect(await page.evaluate(() => (window as unknown as { supplyWalletRequests: { method: string }[] }).supplyWalletRequests.filter(request => /send|sign/i.test(request.method)))).toEqual([]);
});
