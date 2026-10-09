// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { selectSettingsTheme } from './settings-fixtures';
import { installSupplyWallet } from './supply-fixtures';
import type { Locator } from '@playwright/test';

async function nativeImage(image: Locator, src: string) {
  await expect(image).toHaveAttribute('src', src);
  await expect(image).toHaveCSS('filter', 'none');
  await expect(image).toHaveCSS('mix-blend-mode', 'normal');
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
  return image.evaluate(element => {
    const icon = element as HTMLImageElement;
    for (let ancestor: HTMLElement | null = icon; ancestor; ancestor = ancestor.parentElement) {
      if (getComputedStyle(ancestor).filter !== 'none' || Number(getComputedStyle(ancestor).opacity) !== 1) throw new Error('Brand image is filtered or faded');
    }
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d')!; context.drawImage(icon, 0, 0, 128, 128);
    const data = context.getImageData(0, 0, 128, 128).data, colors = new Set<string>();
    for (let offset = 0; offset < data.length; offset += 4) if (data[offset + 3] === 255) colors.add(`${data[offset]},${data[offset + 1]},${data[offset + 2]}`);
    return [...colors];
  });
}
for (const theme of ['Light', 'Dark']) test(`${theme} preserves native token, badge and network picker brand colors`, async ({ page }) => {
  await installSupplyWallet(page, { chain: '0x2105' }); await page.goto('/app');
  await expect(page.getByRole('combobox', { name: 'Environment', exact: true })).toHaveText('Mainnet');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await selectSettingsTheme(page, theme); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase());
  await page.getByRole('button', { name: 'Add bridge', exact: true }).click();
  const card = page.locator('.build-flow-surface .composer-card');
  const source = card.getByRole('button', { name: 'Configure source asset', exact: true }), destination = card.getByRole('button', { name: 'Configure destination asset', exact: true });
  expect(await nativeImage(source.locator('.composer-token-avatar > img'), '/brand/crypto/usdc.png')).toContain('39,117,202');
  expect(await nativeImage(source.locator('.composer-network-badge img'), '/brand/crypto/base.svg')).toContain('0,82,255');
  const arb = await nativeImage(destination.locator('.composer-network-badge img'), '/brand/crypto/arbitrum.png');
  expect(arb.some(color => { const [r, g, b] = color.split(',').map(Number); return r! < 80 && g! > 100 && b! > 170; })).toBe(true);
  await source.click();
  const bridge = page.getByRole('region', { name: 'Source bridge picker', exact: true });
  await expect(bridge.locator('.composer-token-options .composer-network-badge')).toHaveCount(0);
  const disabled = bridge.getByRole('button', { name: 'Solana', exact: true }); await expect(disabled).toBeDisabled();
  const solNetwork = await nativeImage(disabled.locator('img'), '/brand/crypto/solana.svg');
  expect(solNetwork.some(color => { const [r, g, b] = color.split(',').map(Number); return r! < 70 && g! > 170 && b! > 100; })).toBe(true);
  await page.screenshot({ path: `.tmp/native-brand-${theme.toLowerCase()}-bridge.png`, fullPage: true });

  await page.goto('/app');
  await page.getByRole('button', { name: 'Add swap', exact: true }).click();
  const from = card.getByRole('button', { name: 'Select source token', exact: true }), to = card.getByRole('button', { name: 'Select destination token', exact: true });
  const eth = await nativeImage(to.locator('.composer-token-avatar > img'), '/brand/crypto/ethereum.svg');
  expect(eth).toContain('184,251,246'); expect(eth).toContain('202,179,245');
  await card.getByRole('textbox').fill('2.5');
  await from.click();
  const panel = page.getByRole('region', { name: 'Source asset picker', exact: true });
  await expect(panel.locator('.composer-token-options .composer-network-badge')).toHaveCount(0);
  expect(await nativeImage(panel.locator('.composer-token-avatar[data-token="USDC"] > img'), '/brand/crypto/usdc.png')).toContain('39,117,202');
  expect(await nativeImage(panel.locator('.composer-token-avatar[data-token="WETH"] > img'), '/brand/crypto/ethereum.svg')).toEqual(eth);
  expect(await nativeImage(panel.getByRole('button', { name: 'Base', exact: true }).locator('img'), '/brand/crypto/base.svg')).toContain('0,82,255');
  await panel.getByRole('button', { name: 'Solana', exact: true }).click();
  const sol = panel.locator('.composer-token-avatar[data-token="SOL"] > img');
  const solColors = await nativeImage(sol, '/brand/crypto/solana.svg');
  expect(solColors.some(color => { const [r, g, b] = color.split(',').map(Number); return r! > 80 && g! < 120 && b! > 180; })).toBe(true);
  expect(await nativeImage(panel.locator('.composer-token-avatar[data-token="USDT"] > img'), '/brand/crypto/usdt.svg')).toContain('38,161,123');
  await page.screenshot({ path: `.tmp/native-brand-${theme.toLowerCase()}-tokens.png`, fullPage: true });
  await panel.getByRole('region', { name: 'Source token picker', exact: true }).locator('label').filter({ hasText: 'USDT' }).click();
  await expect(from).toHaveAttribute('title', 'USDT on Solana'); await expect(to).toHaveAttribute('title', 'SOL on Solana');
  await expect(card.getByRole('textbox')).toHaveValue('2.5');
  const badgeColors = await nativeImage(from.locator('.composer-network-badge img'), '/brand/crypto/solana.svg'); expect(badgeColors).toEqual(solNetwork);
  await panel.getByRole('button', { name: 'Hide token picker', exact: true }).click();
  await page.getByRole('button', { name: 'Stocks', exact: true }).click();
  const stock = page.locator('.composer-card').filter({ hasText: 'Robinhood' });
  await nativeImage(stock.getByRole('img', { name: 'Robinhood', exact: true }), '/brand/robinhood-avatar.jpg');
  await nativeImage(stock.locator('.composer-network-badge img'), '/brand/robinhood-avatar.jpg');
  await page.screenshot({ path: `.tmp/native-brand-${theme.toLowerCase()}-stocks.png`, fullPage: true });
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
  await expect(card.first()).toHaveCSS('background-color', theme === 'Dark' ? 'rgb(21, 24, 31)' : 'rgb(255, 255, 255)');
});
