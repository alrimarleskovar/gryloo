// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { selectSettingsTheme } from './settings-fixtures';
import { installSupplyWallet } from './supply-fixtures';
import { configureCanvasAction, configureCanvasPool } from './composer-authoring-fixtures';
import type { Locator } from '@playwright/test';

async function tokenIconsStayInside(surface: Locator) {
  const icons = surface.locator('.composer-token-avatar > img.brand-icon');
  expect(await icons.count()).toBeGreaterThan(0);
  for (const icon of await icons.all()) {
    await expect(icon).toHaveCSS('object-fit', 'contain');
    await expect(icon).toHaveCSS('filter', 'none');
    const avatar = icon.locator('..');
    await expect(avatar).toHaveCSS('overflow', 'visible'); // The existing network badge stays visible.
    const frame = (await avatar.boundingBox())!, image = (await icon.boundingBox())!;
    expect(image.width).toBeGreaterThan(0); expect(image.height).toBeGreaterThan(0);
    expect(image.x).toBeGreaterThanOrEqual(frame.x - .25);
    expect(image.y).toBeGreaterThanOrEqual(frame.y - .25);
    expect(image.x + image.width).toBeLessThanOrEqual(frame.x + frame.width + .25);
    expect(image.y + image.height).toBeLessThanOrEqual(frame.y + frame.height + .25);
    const pill = (await icon.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " composer-token-chip ")][1]').boundingBox())!;
    expect(image.x).toBeGreaterThanOrEqual(pill.x);
    expect(image.y).toBeGreaterThanOrEqual(pill.y);
    expect(image.x + image.width).toBeLessThanOrEqual(pill.x + pill.width + .25);
    expect(image.y + image.height).toBeLessThanOrEqual(pill.y + pill.height + .25);
  }
}
for (const theme of ['Light', 'Dark']) test(`${theme} keeps token icons contained in Pool, Swap, picker and Simulate pills`, async ({ page }) => {
  await installSupplyWallet(page);
  for (const action of ['pool', 'swap'] as const) {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await selectSettingsTheme(page, theme);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: `Add ${action}`, exact: true }).click();
    if (action === 'pool') await configureCanvasPool(page); else await configureCanvasAction(page, '1');
    const buildCard = page.locator('.build-flow-surface .composer-card');
    await expect(buildCard.locator('.composer-token-avatar[data-token="WETH"] > img')).toHaveAttribute('src', '/brand/crypto/ethereum.svg');
    await tokenIconsStayInside(buildCard);
    await expect(buildCard.locator('.composer-network-badge').first()).toBeVisible();
    if (action === 'swap') {
      await buildCard.getByRole('button', { name: 'Select source token', exact: true }).click();
      const picker = page.getByRole('region', { name: 'Source asset picker', exact: true });
      await tokenIconsStayInside(picker);
      await picker.getByRole('button', { name: 'Hide token picker', exact: true }).click();
    }
    await page.screenshot({ path: `.tmp/token-layout-${theme.toLowerCase()}-${action}-build.png`, fullPage: true });
    await page.getByRole('button', { name: 'Simular Fees', exact: true }).click();
    const graph = page.getByRole('region', { name: 'Simulation workflow graph', exact: true });
    await expect(graph).toHaveAttribute('data-viewport', 'fitted');
    await tokenIconsStayInside(graph);
    await expect(graph.locator('.composer-network-badge').first()).toBeVisible();
    await page.screenshot({ path: `.tmp/token-layout-${theme.toLowerCase()}-${action}-simulate.png`, fullPage: true });
  }
  expect(await page.evaluate(() => (window as unknown as { supplyWalletRequests: { method: string }[] }).supplyWalletRequests.filter(request => /sign|send/i.test(request.method)))).toEqual([]);
});
