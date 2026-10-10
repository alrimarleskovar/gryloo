// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { selectSettingsTheme } from './settings-fixtures';
import { installSupplyWallet } from './supply-fixtures';

for (const action of ['swap', 'bridge', 'pool', 'Stocks', 'supply', 'borrow', 'repay', 'withdraw']) {
  test(`${action} switches both value lines without changing token amounts`, async ({ page }) => {
    await installSupplyWallet(page);
    await page.goto('/app');
    await page.getByRole('button', { name: action === 'Stocks' ? action : `Add ${action}`, exact: true }).click();
    const card = page.locator('.build-flow-surface .composer-card');
    const boxes = card.locator('.composer-amount-box');
    const input = boxes.first().getByRole('textbox');
    await input.fill('12.5');
    const revision = await page.locator('.summary-bar').getAttribute('data-workflow-revision');
    const inputs = await boxes.locator('input').evaluateAll(elements => elements.map(element => (element as HTMLInputElement).value));
    // Toggling either box changes the pair together, including read-only destination values.
    await boxes.last().getByRole('button', { name: 'Show fiat amount first (estimate unavailable)', exact: true }).click();
    await expect(boxes.locator('.composer-value-line .composer-primary-fiat')).toHaveCount(await boxes.count());
    await expect(boxes.locator('.composer-value-line input')).toHaveCount(0);
    await expect(boxes.locator('.composer-token-subline input').first()).toHaveValue('12.5');
    expect(await boxes.locator('input').evaluateAll(elements => elements.map(element => (element as HTMLInputElement).value))).toEqual(inputs);
    const hierarchy = await boxes.first().evaluate(element => ({
      primary: parseFloat(getComputedStyle(element.querySelector('.composer-primary-fiat')!).fontSize),
      secondary: parseFloat(getComputedStyle(element.querySelector('.composer-token-subline input')!).fontSize),
    }));
    expect(hierarchy.primary).toBeGreaterThan(hierarchy.secondary * 1.5);
    await input.fill('7.25');
    await boxes.first().getByRole('button', { name: 'Show token amount first', exact: true }).click();
    await expect(boxes.locator('.composer-primary-fiat, .composer-token-subline')).toHaveCount(0);
    await expect(boxes.first().locator('.composer-value-line input')).toHaveValue('7.25');
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', revision!);
  });
}

test('theme defaults to light, covers product surfaces, persists and returns to light', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/app');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Undock toolbar', exact: true }).click();
  await page.getByRole('button', { name: 'Stocks', exact: true }).click();
  const card = page.locator('.composer-card');
  await card.getByRole('textbox', { name: 'Stocks amount', exact: true }).fill('12.5');
  await card.getByRole('button', { name: 'Select stock', exact: true }).click();
  const picker = page.getByRole('region', { name: 'Stocks configuration', exact: true });
  const size = await picker.evaluate(element => ({ width: parseFloat(getComputedStyle(element).width), height: parseFloat(getComputedStyle(element).height) }));
  expect(size.width).toBeLessThanOrEqual(110); expect(size.height).toBeLessThanOrEqual(164);
  await picker.locator('label').filter({ hasText: 'NVDA' }).click();
  await card.getByRole('button', { name: 'Advanced Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('group', { name: 'Settings options', exact: true });
  await selectSettingsTheme(page, 'Dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(settings.getByRole('switch', { name: 'Theme', exact: true })).toBeChecked();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
  await expect(card.getByRole('textbox', { name: 'Stocks amount', exact: true })).toHaveValue('12.5');
  await expect(card.getByRole('button', { name: 'Select stock', exact: true })).toContainText('NVDA');
  const surfaces = page.locator('.top-bar, .composer-card, .copilot, .inspector, details.library, .header-settings-menu, .composer-token-chip, .floating-toolbox');
  await expect(surfaces).toHaveCount(8);
  // Pills and fields use raised graphite; wait for the existing color transitions.
  await expect.poll(async () => surfaces.evaluateAll(elements => elements.every(element => ['rgb(21, 24, 31)', 'rgb(28, 32, 41)'].includes(getComputedStyle(element).backgroundColor)))).toBe(true);
  const canvas = await page.locator('.flow-surface').evaluate(element => getComputedStyle(element).backgroundImage);
  expect(canvas).toContain('rgb(28, 32, 41)');
  expect(await page.locator('.react-flow__attribution').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(21, 24, 31)');
  expect(await page.locator('.canvas-navigator').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(28, 32, 41)');
  const contrast = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d')!;
    const luminance = (name: string) => {
      context.clearRect(0, 0, 1, 1); context.fillStyle = style.getPropertyValue(name).trim(); context.fillRect(0, 0, 1, 1);
      const rgb = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map(channel => channel / 255)
        .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722;
    };
    return [['--ink', '--paper'], ['--muted', '--paper'], ['--muted', '--blue-soft'], ['--blue', '--paper'], ['--on-accent', '--primary']].map(([foreground, background]) => {
      const a = luminance(foreground!), b = luminance(background!);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    });
  });
  expect(contrast.every(ratio => ratio >= 4.5)).toBe(true);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(picker).toBeInViewport({ ratio: .99 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `.tmp/flofi-dark-${width}.png`, fullPage: true });
  }
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await selectSettingsTheme(page, 'Light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.locator('.top-bar').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(255, 255, 255)');
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('theme remains functional when preference storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    Storage.prototype.getItem = function(key: string) {
      if (key === 'flofi.theme') throw new DOMException('Storage unavailable', 'SecurityError');
      return get.call(this, key);
    };
    Storage.prototype.setItem = function(key: string, value: string) {
      if (key === 'flofi.theme') throw new DOMException('Storage unavailable', 'SecurityError');
      set.call(this, key, value);
    };
  });
  await page.goto('/app');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await selectSettingsTheme(page, 'Dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await selectSettingsTheme(page, 'Light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});


test('short-value menus fit labels, grow for longer symbols and retain row targets', async ({ page }) => {
  await page.goto('/app');
  await page.getByRole('button', { name: 'Stocks', exact: true }).click();
  await page.getByRole('button', { name: 'Select stock', exact: true }).click();
  const picker = page.getByRole('region', { name: 'Stocks configuration', exact: true });
  const geometry = () => picker.evaluate(element => ({
    width: parseFloat(getComputedStyle(element).width),
    options: Array.from(element.querySelectorAll('.composer-stock-option')).map(option => ({
      padding: getComputedStyle(option).paddingInline,
      height: parseFloat(getComputedStyle(option).height),
      nowrap: getComputedStyle(option).whiteSpace,
      fits: option.scrollWidth <= option.clientWidth,
    })),
  }));
  const initial = await geometry();
  expect(initial.width).toBeLessThan(110);
  expect(initial.options.every(option => option.padding === '8px' && option.height >= 28 && option.nowrap === 'nowrap' && option.fits)).toBe(true);
  // Exercise intrinsic layout with future label lengths without changing the available equities.
  await picker.locator('.composer-stock-option > span').first().evaluate(element => { element.textContent = 'EXTENDED.EQUITY'; });
  const longer = await geometry();
  expect(longer.width).toBeGreaterThan(initial.width + 50);
  expect(longer.options.every(option => option.fits)).toBe(true);
  await picker.locator('.composer-stock-option > span').first().evaluate(element => { element.textContent = 'AAPL'; });
  expect((await geometry()).width).toBe(initial.width);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('group', { name: 'Settings options', exact: true });
  expect(await settings.evaluate(element => parseFloat(getComputedStyle(element).width))).toBeLessThan(176);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(picker).toBeInViewport({ ratio: .99 });
    await expect(settings).toBeInViewport({ ratio: .99 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
});

test('dark hover uses restrained borders and respects reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/app');
  await page.getByRole('button', { name: 'Stocks', exact: true }).click();
  const card = page.locator('.composer-card');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await selectSettingsTheme(page, 'Dark');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await card.locator('.composer-action-title').hover();
  await expect(card).toHaveCSS('background-image', 'none');
  await expect(card).toHaveCSS('border-top-color', 'rgb(147, 166, 255)');
  expect(await card.evaluate(element => getComputedStyle(element).transitionDuration)).toContain('0.18s');
  const cta = page.getByRole('button', { name: 'Simulate workflow', exact: true });
  await cta.hover(); await expect(cta).toHaveCSS('background-color', 'rgb(35, 67, 217)');
  await expect(cta).toHaveCSS('animation-name', 'none');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(card).toHaveCSS('transition-duration', '0s');
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
});

test('graphite ambient spotlight stays below usable controls and respects forced colors', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/app');
  const aura = page.locator('.dark-spotlight');
  await expect(aura).toHaveAttribute('aria-hidden', 'true');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await selectSettingsTheme(page, 'Dark');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.mouse.move(580, 320);
  await expect(aura).toHaveAttribute('data-visible', 'true');
  await expect(aura).toHaveCSS('opacity', '1');
  await expect(aura).toHaveCSS('pointer-events', 'none');
  await page.getByRole('button', { name: 'Stocks', exact: true }).click();
  const card = page.locator('.composer-card');
  await card.getByRole('textbox', { name: 'Stocks amount', exact: true }).fill('12.5');
  await card.getByRole('button', { name: 'Select stock', exact: true }).click();
  await page.getByRole('region', { name: 'Stocks configuration', exact: true }).locator('label').filter({ hasText: 'NVDA' }).click();
  await expect(card.getByRole('button', { name: 'Select stock', exact: true })).toContainText('NVDA');
  await expect(card.getByRole('textbox', { name: 'Stocks amount', exact: true })).toHaveValue('12.5');
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(card).toHaveCSS('box-shadow', 'none');
  await expect(aura).toHaveCSS('display', 'none');
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
});

test('dark edges and icons lift on hover and keyboard focus with no light-theme halo', async ({ page }) => {
  await page.goto('/app');
  const stocks = page.getByRole('button', { name: 'Stocks', exact: true });
  await stocks.click();
  const card = page.locator('.composer-card');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await selectSettingsTheme(page, 'Dark');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.canvas-head h2').hover();
  await expect(stocks.locator('svg')).toHaveCSS('stroke-width', '1.95px');
  await expect(stocks.locator('svg')).toHaveCSS('filter', 'none');
  await expect(card).toHaveCSS('border-top-color', 'rgb(147, 166, 255)');
  await stocks.hover();
  await expect(stocks.locator('svg')).toHaveCSS('color', 'rgb(147, 166, 255)');
  await expect(stocks.locator('svg')).toHaveCSS('filter', 'none');
  await card.locator('.composer-action-title').hover();
  await expect(card).toHaveCSS('border-top-color', 'rgb(147, 166, 255)');
  await page.keyboard.press('Tab'); await stocks.focus();
  await expect(stocks).toHaveCSS('outline-style', 'solid');
  await expect(stocks).toHaveCSS('outline-color', 'rgb(147, 166, 255)');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await selectSettingsTheme(page, 'Light');
  await stocks.hover(); await expect(stocks.locator('svg')).toHaveCSS('filter', 'none');
  await expect(stocks.locator('svg')).toHaveCSS('stroke-width', '1.8px');
});
