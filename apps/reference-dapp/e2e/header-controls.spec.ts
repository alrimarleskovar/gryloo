// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { installSupplyWallet } from './supply-fixtures';

test('boxed wallet preserves connect/disconnect and aligns with an inert Settings control', async ({ page }) => {
  await installSupplyWallet(page, { connected: false });
  await page.goto('/');
  const header = page.getByRole('banner');
  const wallet = header.getByRole('group', { name: 'Wallet connection', exact: true });
  const settings = header.getByRole('button', { name: 'Settings', exact: true });
  await expect(wallet).toContainText('Wallet not connected');
  await expect(settings).toBeDisabled();
  expect(await settings.innerText()).toBe('');
  await expect(settings.locator('svg')).toHaveCount(1);
  await settings.dispatchEvent('click');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(wallet).toContainText('Wallet not connected');
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
    await expect(wallet.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
  await wallet.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(wallet).toContainText('Wallet not connected');
  await expect(wallet.getByRole('button', { name: 'Connect Wallet', exact: true })).toBeVisible();
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
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
