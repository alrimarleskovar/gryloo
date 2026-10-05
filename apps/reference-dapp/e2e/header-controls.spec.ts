// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { installSupplyWallet } from './supply-fixtures';
import { configureCanvasAction } from './composer-authoring-fixtures';

test('boxed wallet preserves connect/disconnect and aligns with the Settings toggle', async ({ page }) => {
  await installSupplyWallet(page, { connected: false });
  await page.goto('/');
  const header = page.getByRole('banner');
  const wallet = header.getByRole('group', { name: 'Wallet connection', exact: true });
  const settings = header.getByRole('button', { name: 'Settings', exact: true });
  await expect(wallet).toContainText('Wallet not connected');
  await expect(settings).toBeEnabled();
  await expect(settings).toHaveAttribute('aria-expanded', 'false');
  expect(await settings.innerText()).toBe('');
  await expect(settings.locator('svg')).toHaveCount(1);
  await settings.click();
  const options = header.getByRole('group', { name: 'Settings options', exact: true });
  await expect(options).toBeVisible();
  expect(await options.getByRole('group', { name: 'Language', exact: true }).getByRole('button').allTextContents()).toEqual(['PT', 'EN']);
  await expect(options.getByRole('group', { name: 'Theme', exact: true }).getByRole('button')).toHaveCount(2);
  await expect(options.getByRole('button', { name: 'Disconnect', exact: true })).toBeDisabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(wallet).toContainText('Wallet not connected');
  await settings.click();
  await expect(options).toHaveCount(0);
  await wallet.getByRole('button', { name: 'Connect Wallet', exact: true }).click();
  await expect(wallet).toContainText('Wallet: 0x1111…1111 · Base Sepolia');
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const walletBox = (await wallet.boundingBox())!;
    const settingsBox = (await settings.boundingBox())!;
    expect(Math.abs(walletBox.y + walletBox.height / 2 - settingsBox.y - settingsBox.height / 2)).toBeLessThan(1);
    expect(settingsBox.x).toBeGreaterThanOrEqual(walletBox.x + walletBox.width);
    expect(settingsBox.width).toBe(40);
    expect(settingsBox.height).toBe(40);
    expect(await wallet.evaluate(element => getComputedStyle(element).borderTopStyle)).toBe('solid');
    expect(await wallet.evaluate(element => parseFloat(getComputedStyle(element).borderRadius))).toBeGreaterThan(0);
    await expect(wallet.getByRole('button', { name: 'Disconnect', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
  await settings.click();
  await expect(options.getByRole('group', { name: 'Language', exact: true })).toBeVisible();
  await expect(options.getByRole('group', { name: 'Theme', exact: true })).toBeVisible();
  await expect(options.getByRole('button', { name: 'Disconnect', exact: true })).toBeEnabled();
  await options.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(options).toHaveCount(0);
  await expect(settings).toBeFocused();
  await expect(wallet).toContainText('Wallet not connected');
  await expect(wallet.getByRole('button', { name: 'Connect Wallet', exact: true })).toBeVisible();
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
});

test('Settings toggles without layout changes, closes outside/Escape/Tab and leaves wallet and node selection untouched', async ({ page }) => {
  await installSupplyWallet(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Add supply', exact: true }).click();
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  const options = page.getByRole('group', { name: 'Settings options', exact: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const headerBefore = await page.getByRole('banner').boundingBox();
    const canvasBefore = await page.getByRole('region', { name: 'Workflow canvas', exact: true }).boundingBox();
    await settings.click();
    await expect(settings).toHaveAttribute('aria-expanded', 'true');
    await expect(options).toBeVisible();
    const gearBox = (await settings.boundingBox())!;
    const menuBox = (await options.boundingBox())!;
    expect(Math.abs(menuBox.x + menuBox.width - gearBox.x - gearBox.width)).toBeLessThan(1);
    expect(menuBox.y - gearBox.y - gearBox.height).toBe(8);
    expect(await page.getByRole('banner').boundingBox()).toEqual(headerBefore);
    expect(await page.getByRole('region', { name: 'Workflow canvas', exact: true }).boundingBox()).toEqual(canvasBefore);
    const disconnect = options.getByRole('button', { name: 'Disconnect', exact: true });
    await expect(disconnect).toBeEnabled();
    await expect(page.getByRole('group', { name: 'Wallet connection' })).toContainText('0x1111…1111');
    await settings.press('Escape');
    await expect(options).toHaveCount(0);
    await expect(settings).toBeFocused();
    await expect(page.locator('.flow-card.active')).toHaveCount(1);
    await settings.press('Enter');
    await expect(options).toBeVisible();
    await page.getByRole('heading', { name: 'Copilot', exact: true }).click();
    await expect(options).toHaveCount(0);
    await settings.click();
    await settings.press('Tab');
    await expect(options.getByRole('button', { name: 'PT', exact: true })).toBeFocused();
    for (const name of ['EN', 'Light theme', 'Dark theme', 'Disconnect']) {
      await page.keyboard.press('Tab');
      await expect(options.getByRole('button', { name, exact: true })).toBeFocused();
    }
    await expect(disconnect).toBeFocused();
    await expect(options).toBeVisible();
    await disconnect.press('Tab');
    await expect(options).toHaveCount(0);
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
});

test('language and theme choices update menu selection only and fit narrow headers', async ({ page }) => {
  await installSupplyWallet(page); await page.goto('/');
  await expect(page.locator('.build009-wallet-info')).toBeVisible();
  const header = page.getByRole('banner');
  const settings = header.getByRole('button', { name: 'Settings', exact: true });
  const options = header.getByRole('group', { name: 'Settings options', exact: true });
  const wallet = header.getByRole('group', { name: 'Wallet connection', exact: true });
  const environment = header.getByRole('combobox', { name: 'Environment', exact: true });
  const walletBefore = await wallet.innerText(), environmentBefore = await environment.inputValue();
  const pageStyle = await page.locator('body').evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color, language: document.documentElement.lang }));
  await settings.click();
  const pt = options.getByRole('button', { name: 'PT', exact: true }), en = options.getByRole('button', { name: 'EN', exact: true });
  const sun = options.getByRole('button', { name: 'Light theme', exact: true }), moon = options.getByRole('button', { name: 'Dark theme', exact: true });
  await expect(en).toHaveAttribute('aria-pressed', 'true'); await expect(pt).toHaveAttribute('aria-pressed', 'false');
  await expect(sun).toHaveAttribute('aria-pressed', 'true'); await expect(moon).toHaveAttribute('aria-pressed', 'false');
  await expect(sun.locator('svg')).toBeVisible(); await expect(moon.locator('svg')).toBeVisible();
  await pt.click(); await expect(pt).toHaveAttribute('aria-pressed', 'true'); await expect(en).toHaveAttribute('aria-pressed', 'false');
  await moon.focus(); await moon.press('Space');
  await expect(moon).toHaveAttribute('aria-pressed', 'true'); await expect(sun).toHaveAttribute('aria-pressed', 'false');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await options.scrollIntoViewIfNeeded();
    for (const button of [pt, en, sun, moon]) await expect(button).toBeInViewport();
    const menuBox = (await options.boundingBox())!;
    expect(menuBox.x).toBeGreaterThanOrEqual(0); expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
  await settings.press('Escape'); await settings.click();
  await expect(pt).toHaveAttribute('aria-pressed', 'true'); await expect(moon).toHaveAttribute('aria-pressed', 'true');
  await en.click(); await sun.click();
  await expect(en).toHaveAttribute('aria-pressed', 'true'); await expect(sun).toHaveAttribute('aria-pressed', 'true');
  expect(await wallet.innerText()).toBe(walletBefore); expect(await environment.inputValue()).toBe(environmentBefore);
  expect(await page.locator('body').evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color, language: document.documentElement.lang }))).toEqual(pageStyle);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
  expect(await page.evaluate(() => (window as unknown as { supplyWalletRequests: { method: string }[] }).supplyWalletRequests.filter(request => /sign|send|switch|addEthereumChain/i.test(request.method)))).toEqual([]);
});

test('advanced setup has a single outer expansion and retains existing forms and workflow checks', async ({ page }) => {
  await installSupplyWallet(page);
  await page.goto('/');
  await expect(page.getByText('Technical authoring tools', { exact: true })).toHaveCount(0);
  const advanced = page.locator('details.library[aria-label="Advanced action setup"]');
  await expect(advanced).toHaveCount(1);
  expect(await advanced.evaluate(element => element.parentElement?.closest('details') !== null)).toBe(false);
  await expect(advanced).not.toHaveAttribute('open');
  await page.getByRole('button', { name: 'Add swap', exact: true }).click();
  await configureCanvasAction(page, '1');
  await expect(page.locator('.flow-card')).toHaveCount(1);
  const findings = advanced.getByRole('region', { name: 'Deterministic review findings' });
  await expect(findings).toBeHidden();
  await advanced.locator(':scope > summary').click();
  await expect(advanced).toHaveAttribute('open', '');
  await expect(findings).toBeVisible();
  await expect(advanced.getByRole('form', { name: 'Create swap proposal', exact: true })).toBeVisible();
  await expect(advanced.getByRole('form', { name: 'Create direct Across bridge proposal', exact: true })).toBeVisible();
  await advanced.getByText('Workflow IR', { exact: true }).click();
  const before = await findings.locator('[data-workflow-ir]').innerText();
  const revision = await page.locator('.summary-bar').getAttribute('data-workflow-revision');
  await advanced.locator(':scope > summary').click();
  await expect(findings).toBeHidden();
  await advanced.locator(':scope > summary').click();
  await expect(findings).toBeVisible();
  expect(await findings.locator('[data-workflow-ir]').innerText()).toBe(before);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', revision!);
  expect(JSON.parse(before).nodes.some((node: { actionType: string }) => node.actionType === 'asset.swap.exact-input')).toBe(true);
});
