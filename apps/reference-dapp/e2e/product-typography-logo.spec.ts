// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { selectSettingsTheme } from './settings-fixtures';
import { installSupplyWallet } from './supply-fixtures';
import { configureCanvasAction } from './composer-authoring-fixtures';

for (const theme of ['Light', 'Dark'] as const) test(`${theme} approved fonts and identity preserve the shell at product widths`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installSupplyWallet(page); await page.goto('/app');
  await expect(page.locator('.wallet-address')).toBeVisible();
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  await settings.click(); await selectSettingsTheme(page, theme);
  await settings.press('Escape');
  await page.evaluate(async () => {
    await Promise.all(['400 14px Outfit', '500 14px Outfit', '600 16px Outfit', '400 12px "IBM Plex Mono"', '500 12px "IBM Plex Mono"'].map(font => document.fonts.load(font)));
    await document.fonts.ready;
  });
  const fonts = await page.evaluate(() => [...document.fonts].filter(font => font.status === 'loaded').map(font => ({ family: font.family, weight: font.weight })));
  for (const weight of ['400', '500', '600']) expect(fonts).toContainEqual({ family: 'Outfit', weight });
  for (const weight of ['400', '500']) expect(fonts).toContainEqual({ family: 'IBM Plex Mono', weight });
  expect(await page.locator('body').evaluate(element => getComputedStyle(element).fontFamily)).toMatch(/^Outfit/);
  expect(await page.locator('.wallet-address').evaluate(element => getComputedStyle(element).fontFamily)).toContain('IBM Plex Mono');
  const variant = page.locator(`.flofi-logo-${theme.toLowerCase()}`);
  const other = page.locator(`.flofi-logo-${theme === 'Light' ? 'dark' : 'light'}`);
  await expect(page.getByRole('img', { name: 'FloFi', exact: true })).toHaveCount(1);
  await expect(variant).toBeVisible(); await expect(other).toBeHidden();
  await expect(page.locator('.top-bar img[src="/brand/flofi-logo.png"]')).toHaveCount(0);
  const symbol = variant.locator('.flofi-logo-symbol'), wordmark = variant.locator('.flofi-logo-wordmark');
  await expect(symbol).toHaveAttribute('src', `/brand/flofi-symbol-${theme.toLowerCase()}.svg`);
  await expect(wordmark).toHaveAttribute('src', `/brand/flofi-wordmark-${theme.toLowerCase()}.png`);
  for (const image of [symbol, wordmark]) {
    await expect(image).toHaveCSS('filter', 'none');
    await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
  }
  const artwork = await (await page.request.get(await symbol.getAttribute('src') as string)).text();
  expect(artwork).toContain(theme === 'Light' ? 'fill="#2343D9"' : 'fill="#FFFFFF"');
  expect(artwork).toContain('fill="#C9D2F8"'); expect(artwork).not.toContain('gradient');
  const colors = await wordmark.evaluate(element => {
    const img = element as HTMLImageElement, canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const context = canvas.getContext('2d')!; context.drawImage(img, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data, colors = new Set<string>();
    for (let index = 0; index < data.length; index += 4) if (data[index + 3] === 255) colors.add(`${data[index]},${data[index + 1]},${data[index + 2]}`);
    return [...colors];
  });
  expect(colors).toEqual([theme === 'Light' ? '4,27,61' : '255,255,255']);
  const icon = page.locator('link[rel="icon"][type="image/svg+xml"]');
  await expect(icon).toHaveAttribute('sizes', 'any');
  const iconResponse = await page.request.get(await icon.getAttribute('href') as string);
  expect(iconResponse.ok()).toBe(true);
  const iconSvg = await iconResponse.text(); expect(iconSvg).toContain('fill="#2343D9"'); expect(iconSvg).toContain('fill="#FFFFFF"');
  await page.getByRole('button', { name: 'Add supply', exact: true }).click(); await configureCanvasAction(page, '1');
  expect(await page.locator('.composer-amount-value').first().evaluate(element => getComputedStyle(element).fontFamily)).toContain('IBM Plex Mono');
  const nav = page.getByRole('navigation', { name: 'Workflow stages' });
  const walletText = await page.getByRole('group', { name: 'Wallet connection' }).innerText();
  for (const width of [1440, 1024, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const stage of ['Build', 'Simulate', 'Execute', 'Dashboard'] as const) {
      await nav.getByRole('button', { name: stage, exact: true }).click();
      await expect(nav.getByRole('button', { name: stage, exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('.top-bar')).toHaveCount(1);
      await expect(page.getByRole('group', { name: 'Wallet connection' })).toHaveText(walletText);
      await expect(page.getByRole('combobox', { name: 'Environment' })).toHaveText('Testnet');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const dimensions = await variant.evaluate(element => {
        const symbol = element.querySelector('.flofi-logo-symbol')!.getBoundingClientRect();
        const wordmark = element.querySelector('.flofi-logo-wordmark')!.getBoundingClientRect();
        const header = element.closest('header')!.getBoundingClientRect();
        return { symbol: { width: symbol.width, height: symbol.height }, wordmark: { width: wordmark.width, height: wordmark.height },
          within: symbol.left >= header.left && wordmark.right <= header.right && symbol.top >= header.top && symbol.bottom <= header.bottom };
      });
      expect(dimensions.symbol.height).toBe(29); expect(dimensions.wordmark.height).toBe(22);
      expect(dimensions.symbol.width / dimensions.symbol.height).toBeCloseTo(370 / 345, 2);
      expect(dimensions.wordmark.width / dimensions.wordmark.height).toBeCloseTo(738 / 280, 2);
      expect(dimensions.within).toBe(true);
      for (const control of [nav, page.getByRole('group', { name: 'Wallet connection' }), settings]) {
        const box = (await control.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      const unexpectedFonts = await page.locator('main button:visible').evaluateAll(buttons => buttons.map(button => ({ label: button.textContent, family: getComputedStyle(button).fontFamily }))
        .filter(button => !button.family.startsWith('Outfit')));
      expect(unexpectedFonts).toEqual([]);
      if (stage === 'Execute') await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toBeDisabled();
      if (stage === 'Dashboard') {
        await expect(page.getByRole('heading', { name: 'Your execution workspace', exact: true })).toHaveCSS('font-size', '28px');
        expect(await page.locator('.eyebrow').first().evaluate(element => getComputedStyle(element).fontFamily)).toContain('IBM Plex Mono');
      }
      if (width === 1440 || width === 320) await page.screenshot({ style: 'nextjs-portal{display:none}', path: `.tmp/ux007-team2-${stage.toLowerCase()}-${theme.toLowerCase()}-${width}.png`, fullPage: true });
    }
    await settings.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
    await expect(settings).toBeFocused(); await expect(settings).toHaveCSS('outline-style', 'solid');
    await settings.press('Enter'); await expect(page.getByRole('group', { name: 'Settings options' })).toBeVisible();
    expect(await page.getByRole('group', { name: 'Settings options' }).evaluate(element => getComputedStyle(element).fontFamily)).toMatch(/^Outfit/);
    await settings.press('Escape'); await expect(settings).toBeFocused();
  }
  await nav.getByRole('button', { name: 'Build', exact: true }).click();
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
  await expect(page.getByRole('textbox', { name: 'Source amount (USDC)', exact: true }).first()).toHaveValue('1');
  expect(await page.locator('html').evaluate(element => getComputedStyle(element).getPropertyValue('--blue').trim().toLowerCase())).toBe(theme === 'Light' ? '#1d5fca' : '#93a6ff');
  expect(await page.evaluate(() => performance.getEntriesByType('resource').filter(entry => /fonts\.(googleapis|gstatic)\.com/.test(entry.name)))).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { supplyWalletRequests: { method: string }[] }).supplyWalletRequests.filter(request => /send|sign/i.test(request.method)))).toEqual([]);
  expect(errors).toEqual([]);
});
