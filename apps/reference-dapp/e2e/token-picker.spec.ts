// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { selectSettingsTheme } from './settings-fixtures';
import { installSupplyWallet } from './supply-fixtures';

for (const action of ['swap', 'bridge', 'supply', 'borrow', 'repay', 'withdraw', 'pool']) {
  test(`${action} token pills expand with supported options and preserve amounts and network context`, async ({ page }) => {
    await installSupplyWallet(page); await page.goto('/');
    await page.getByRole('button', { name: `Add ${action}`, exact: true }).click();
    const card = page.locator('.build-flow-surface .composer-card');
    await card.getByRole('textbox').first().fill('2.5');
    const inputs = await card.locator('input').evaluateAll(elements => elements.map(element => (element as HTMLInputElement).value));
    const count = await card.locator('.composer-token-pill').count();
    for (let index = 0; index < count; index++) {
      const side = index ? 'destination' : 'source', pill = card.getByRole('button', { name: action === 'bridge' ? `Configure ${side} asset` : `Select ${side} token`, exact: true });
      const symbol = await pill.locator('.composer-amount-token').innerText();
      const network = await pill.locator('.composer-network-badge').getAttribute('aria-label');
      await pill.click();
      const bridgePanel = page.getByRole('region', { name: `${index ? 'Destination' : 'Source'} bridge picker`, exact: true });
      const picker = page.getByRole('region', { name: `${index ? 'Destination' : 'Source'} token picker`, exact: true });
      await expect(pill).toHaveAttribute('aria-expanded', 'true');
      await expect(picker.getByRole('radio', { name: symbol, exact: true })).toBeChecked();
      await expect(picker.getByRole('radio', { name: symbol, exact: true })).toBeFocused();
      await expect(picker.getByRole('combobox')).toHaveCount(0);
      const options = action === 'swap' ? ['USDC', 'WETH'] : [symbol];
      expect(await picker.getByRole('radio').evaluateAll(elements => elements.map(element => (element as HTMLInputElement).value))).toEqual(options);
      await expect(picker.locator('.composer-network-badge')).toHaveCount(0);
      await expect(pill.locator('.composer-network-badge')).toHaveAttribute('aria-label', network!);
      expect(await picker.evaluate(element => getComputedStyle(element).width)).not.toBe('auto');
      await expect(picker).toBeInViewport({ ratio: .99 });
      const bounds = await picker.boundingBox(), cardBounds = await card.boundingBox();
      expect(bounds!.x).toBeGreaterThan(cardBounds!.x + cardBounds!.width);
      await picker.getByRole('radio', { name: symbol, exact: true }).press('Escape');
      await expect(picker).toHaveCount(0);
      if (action === 'bridge') await expect(bridgePanel).toHaveCount(0);
      await expect(pill).toBeFocused();
    }
    expect(await card.locator('input').evaluateAll(elements => elements.map(element => (element as HTMLInputElement).value))).toEqual(inputs);
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
  });
}

test('Swap token selection synchronizes both pills and settings, invalidates review, and applies the selected supported direction', async ({ page }) => {
  await installSupplyWallet(page, { chain: '0x2105' }); await page.goto('/'); await expect(page.getByRole('combobox', { name: 'Environment', exact: true })).toHaveText('Mainnet'); await page.getByRole('button', { name: 'Add swap', exact: true }).click();
  const card = page.locator('.build-flow-surface .composer-card');
  await card.getByRole('textbox').fill('0.25');
  await card.getByRole('button', { name: 'Review amount', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Apply amount', exact: true })).toBeEnabled();
  await card.getByRole('button', { name: 'Select source token', exact: true }).click();
  const picker = page.getByRole('region', { name: 'Source token picker', exact: true });
  await picker.locator('label').filter({ hasText: 'WETH' }).click();
  await expect(card.getByRole('button', { name: 'Select source token', exact: true })).toContainText('WETH');
  await expect(card.getByRole('button', { name: 'Select destination token', exact: true })).toContainText('USDC');
  await expect(card.getByRole('button', { name: 'Apply amount', exact: true })).toBeDisabled();
  await expect(picker.getByRole('radio', { name: 'WETH', exact: true })).toBeChecked();
  await page.getByRole('region', { name: 'Source asset picker', exact: true }).getByRole('button', { name: 'Hide token picker', exact: true }).click();
  await card.getByRole('button', { name: 'Advanced Settings', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Configure Swap', exact: true }).getByLabel('Source amount (WETH)', { exact: true })).toHaveValue('0.25');
  await card.getByRole('button', { name: 'Select destination token', exact: true }).click();
  const destination = page.getByRole('region', { name: 'Destination token picker', exact: true });
  await destination.locator('label').filter({ hasText: 'WETH' }).click();
  await expect(card.getByRole('textbox', { name: 'Source amount (USDC)', exact: true })).toHaveValue('0.25');
  await destination.locator('label').filter({ hasText: 'USDC' }).click();
  await page.getByRole('region', { name: 'Destination asset picker', exact: true }).getByRole('button', { name: 'Hide token picker', exact: true }).click();
  await card.getByRole('button', { name: 'Review amount', exact: true }).click();
  await card.getByRole('button', { name: 'Apply amount', exact: true }).click();
  await expect(card.getByRole('textbox', { name: 'Source amount (WETH)', exact: true })).toHaveValue('0.25');
  const advanced = page.locator('details.library[aria-label="Advanced action setup"]');
  await advanced.locator(':scope > summary').click(); await advanced.getByText('Workflow IR', { exact: true }).click();
  const workflow = JSON.parse(await advanced.locator('[data-workflow-ir]').innerText());
  const node = workflow.nodes.find((node: { actionType: string }) => node.actionType === 'asset.swap.exact-input');
  expect(node.inputs.find((input: { kind: string }) => input.kind === 'QUANTITY').value.amount).toBe('250000000000000000');
  await card.getByRole('button', { name: 'Advanced Settings', exact: true }).click();
  const settings = page.getByRole('form', { name: 'Edit Swap', exact: true });
  await settings.getByLabel('Slippage (bps)', { exact: true }).fill('75');
  await settings.getByRole('button', { name: 'Review Swap settings', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Apply amount', exact: true })).toBeEnabled();
  await settings.getByLabel('Slippage (bps)', { exact: true }).fill('80');
  await expect(card.getByRole('button', { name: 'Apply amount', exact: true })).toBeDisabled();
  await settings.getByRole('button', { name: 'Review Swap settings', exact: true }).click();
  await card.getByRole('button', { name: 'Apply amount', exact: true }).click();
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '2');
  // Authored assets remain editable within the shared action network.
  await card.getByRole('button', { name: 'Select source token', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Source token picker', exact: true }).getByRole('radio')).toHaveCount(2);
});

for (const theme of ['Light', 'Dark']) test(`${theme} Advanced Settings has clean hover and accessible keyboard emphasis`, async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await selectSettingsTheme(page, theme);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Stocks', exact: true }).click();
  const card = page.locator('.composer-card'), settings = card.getByRole('button', { name: 'Advanced Settings', exact: true });
  await settings.hover();
  await expect(settings).toHaveCSS('outline-style', 'none'); await expect(settings).toHaveCSS('box-shadow', 'none'); await expect(settings).toHaveCSS('background-image', 'none');
  await page.keyboard.press('Tab'); await settings.focus();
  await expect(settings).toBeFocused(); await expect(settings).toHaveCSS('outline-style', 'none'); await expect(settings).toHaveCSS('box-shadow', 'none');
  await expect(settings).toHaveCSS('border-left-width', '0px'); await expect(settings).toHaveCSS('border-right-width', '0px'); await expect(settings).toHaveCSS('border-bottom-width', '0px');
  await expect(settings).toHaveCSS('text-decoration-line', 'underline'); await expect(settings.locator('svg')).toBeVisible();
  await settings.press('Enter'); await expect(page.getByRole('region', { name: 'Action inspector', exact: true }).getByRole('textbox', { name: 'Stocks amount', exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Select stock', exact: true }).click();
  await page.getByRole('region', { name: 'Stocks configuration', exact: true }).locator('label').filter({ hasText: 'NVDA' }).click();
  await expect(card.getByRole('button', { name: 'Select stock', exact: true })).toContainText('NVDA');
});

test('token panels fit compact and mobile canvases and collapse on outside interaction', async ({ page }) => {
  await installSupplyWallet(page); await page.goto('/'); await expect(page.getByRole('combobox', { name: 'Environment', exact: true })).toHaveText('Testnet'); await page.getByRole('button', { name: 'Add swap', exact: true }).click();
  const pill = page.getByRole('button', { name: 'Select source token', exact: true });
  await pill.click();
  const panel = page.getByRole('region', { name: 'Source token picker', exact: true });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 }); await expect(panel).toBeInViewport({ ratio: .99 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
  await page.locator('.canvas-head h2').click();
  await expect(panel).toHaveCount(0); await expect(pill).toHaveAttribute('aria-expanded', 'false');
});
