// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { installSupplyWallet } from './supply-fixtures';

for (const action of ['swap', 'bridge', 'pool', 'Stocks', 'supply', 'borrow', 'repay', 'withdraw']) {
  test(`${action} switches both value lines without changing token amounts`, async ({ page }) => {
    await installSupplyWallet(page);
    await page.goto('/');
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
  await page.goto('/');
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
  await settings.getByRole('button', { name: 'Dark theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(settings.getByRole('button', { name: 'Dark theme', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(settings.getByRole('button', { name: 'Light theme', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
  await expect(card.getByRole('textbox', { name: 'Stocks amount', exact: true })).toHaveValue('12.5');
  await expect(card.getByRole('button', { name: 'Select stock', exact: true })).toContainText('NVDA');
  const surfaces = page.locator('.top-bar, .composer-card, .copilot, .inspector, details.library, .header-settings-menu, .composer-token-chip, .floating-toolbox');
  await expect(surfaces).toHaveCount(8);
  // The expanded pill uses a raised tint; wait for the existing button color transitions.
  await expect.poll(async () => surfaces.evaluateAll(elements => elements.every(element => ['rgb(11, 20, 32)', 'rgb(14, 34, 45)'].includes(getComputedStyle(element).backgroundColor)))).toBe(true);
  const canvas = await page.locator('.flow-surface').evaluate(element => getComputedStyle(element).backgroundImage);
  expect(canvas).toContain('rgb(5, 11, 20)');
  expect(await page.locator('.react-flow__attribution').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(11, 20, 32)');
  expect(await page.locator('.react-flow__controls-zoomout').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(18, 38, 51)');
  const contrast = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const luminance = (name: string) => {
      const hex = style.getPropertyValue(name).trim().slice(1);
      const rgb = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722;
    };
    return [['--ink', '--paper'], ['--muted', '--paper'], ['--muted', '--blue-soft'], ['--blue', '--paper'], ['--on-accent', '--blue']].map(([foreground, background]) => {
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
  await settings.getByRole('button', { name: 'Light theme', exact: true }).click();
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
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Dark theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Light theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});


test('short-value menus fit labels, grow for longer symbols and retain row targets', async ({ page }) => {
  await page.goto('/');
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

test('dark hover illumination is subtle, temporary and respects reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Stocks', exact: true }).click();
  const card = page.locator('.composer-card');
  await card.getByRole('button', { name: 'Select stock', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Dark theme', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const header = page.locator('.canvas-head h2');
  await header.hover();
  const level = () => card.evaluate(element => getComputedStyle(element).getPropertyValue('--flofi-hover-light').trim());
  await expect.poll(level).toBe('0');
  await card.locator('.composer-action-title').hover();
  await expect.poll(level).toBe('1');
  const appearance = await card.evaluate(element => ({ image: getComputedStyle(element).backgroundImage, duration: getComputedStyle(element).transitionDuration }));
  expect(appearance.image).toContain('0.06'); expect(appearance.image).toContain('0.035');
  expect(appearance.duration).toContain('0.18s');
  await page.screenshot({ path: '.tmp/flofi-premium-hover-1440.png', fullPage: true });
  await header.hover(); await expect.poll(level).toBe('0');
  const picker = page.getByRole('region', { name: 'Stocks configuration', exact: true });
  const option = picker.locator('.composer-stock-option').filter({ hasText: 'NVDA' });
  await option.hover();
  await expect.poll(() => option.evaluate(element => getComputedStyle(element).getPropertyValue('--flofi-hover-light').trim())).toBe('1');
  await option.click(); await expect(card.getByRole('button', { name: 'Select stock', exact: true })).toContainText('NVDA');
  const cta = page.getByRole('button', { name: 'Simular Fees', exact: true });
  await cta.hover();
  await expect.poll(() => cta.evaluate(element => getComputedStyle(element).getPropertyValue('--flofi-hover-light').trim())).toBe('1');
  expect(await cta.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await header.hover();
  await expect.poll(() => cta.evaluate(element => getComputedStyle(element).getPropertyValue('--flofi-hover-light').trim())).toBe('0');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await card.locator('.composer-action-title').hover();
  expect(await card.evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
});


test('spotlight follows mouse input without intercepting controls or animating while idle', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const aura = page.locator('.dark-spotlight');
  await expect(aura).toHaveCount(1); await expect(aura).toHaveAttribute('aria-hidden', 'true');
  await expect(aura).toHaveCSS('display', 'none');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Dark theme', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.mouse.move(580, 320);
  await expect(aura).toHaveAttribute('data-visible', 'true');
  await expect(aura).toHaveCSS('opacity', '1'); await expect(aura).toHaveCSS('pointer-events', 'none');
  await expect.poll(async () => aura.evaluate(element => Math.abs(element.getBoundingClientRect().x + 240 - 580))).toBeLessThan(1);
  await expect.poll(async () => aura.evaluate(element => Math.abs(element.getBoundingClientRect().y + 240 - 320))).toBeLessThan(1);
  const glow = await aura.evaluate(element => getComputedStyle(element).backgroundImage);
  expect(glow).toContain('radial-gradient');
  const alphas = Array.from(glow.matchAll(/rgba\([^)]*,\s*([\d.]+)\)/g), match => Number(match[1]));
  expect(Math.max(...alphas)).toBeGreaterThan(.02);
  expect(Math.max(...alphas)).toBeLessThanOrEqual(.035);
  const writes = await aura.evaluate(async element => {
    let count = 0;
    const observer = new MutationObserver(records => { count += records.length; });
    observer.observe(element, { attributes: true, attributeFilter: ['style'] });
    for (let index = 0; index < 100; index++) document.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: 600 + index, clientY: 360 }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    observer.disconnect(); return count;
  });
  expect(writes).toBe(1);
  const idleWrites = await aura.evaluate(async element => {
    let count = 0;
    const observer = new MutationObserver(records => { count += records.length; });
    observer.observe(element, { attributes: true, attributeFilter: ['style'] });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    observer.disconnect(); return count;
  });
  expect(idleWrites).toBe(0);
  await page.getByRole('button', { name: 'Stocks', exact: true }).click();
  const card = page.locator('.composer-card');
  await card.getByRole('textbox', { name: 'Stocks amount', exact: true }).fill('12.5');
  await card.getByRole('button', { name: 'Select stock', exact: true }).click();
  await page.getByRole('region', { name: 'Stocks configuration', exact: true }).locator('label').filter({ hasText: 'NVDA' }).click();
  await expect(card.getByRole('button', { name: 'Select stock', exact: true })).toContainText('NVDA');
  await expect(card.getByRole('textbox', { name: 'Stocks amount', exact: true })).toHaveValue('12.5');
  await page.mouse.move(450, 390);
  await expect(aura).toHaveCSS('opacity', '1');
  await page.screenshot({ path: '.tmp/flofi-spotlight-1440.png', fullPage: true });
  await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointerleave')));
  await expect(aura).not.toHaveAttribute('data-visible'); await expect(aura).toHaveCSS('opacity', '0');
  await page.mouse.move(460, 400); await expect(aura).toHaveAttribute('data-visible', 'true');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(aura).not.toHaveAttribute('data-visible');
  await page.mouse.move(470, 410); await expect(aura).toHaveAttribute('data-visible', 'true');
  await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', clientX: 470, clientY: 410 })));
  await expect(aura).not.toHaveAttribute('data-visible');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.mouse.move(480, 420); await expect(aura).toHaveCSS('display', 'none');
  await expect(aura).not.toHaveAttribute('data-visible');
  await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'active' });
  await page.mouse.move(490, 430); await expect(aura).toHaveCSS('display', 'none');
  await expect(aura).not.toHaveAttribute('data-visible');
  await expect(card.locator('.composer-action-title svg')).toHaveCSS('filter', 'none');
  await expect(card).toHaveCSS('box-shadow', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'none' });
  await expect(aura).toHaveCSS('display', 'block');
  // Media-query change notifications arrive on a rendering frame.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.mouse.move(500, 440, { steps: 6 }); await expect(aura).toHaveAttribute('data-visible', 'true');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Light theme', exact: true }).click();
  await page.mouse.move(510, 450); await expect(aura).toHaveCSS('display', 'none');
  await expect(aura).not.toHaveAttribute('data-visible');
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
});

test('dark edges and icons lift on hover and keyboard focus with no light-theme halo', async ({ page }) => {
  await page.goto('/');
  const stocks = page.getByRole('button', { name: 'Stocks', exact: true });
  await stocks.click();
  const card = page.locator('.composer-card');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Dark theme', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.canvas-head h2').hover();
  await expect(stocks.locator('svg')).toHaveCSS('stroke-width', '1.95px');
  await expect(stocks.locator('svg')).toHaveCSS('filter', 'none');
  await expect(card).toHaveCSS('border-top-color', 'rgb(79, 150, 144)');
  await stocks.hover();
  await expect(stocks.locator('svg')).toHaveCSS('color', 'rgb(177, 238, 226)');
  expect(await stocks.locator('svg').evaluate(element => getComputedStyle(element).filter)).toContain('drop-shadow');
  await card.locator('.composer-action-title').hover();
  await expect(card).toHaveCSS('border-top-color', 'rgb(117, 190, 178)');
  await page.keyboard.press('Tab'); await stocks.focus();
  await expect(stocks).toHaveCSS('outline-style', 'solid');
  await expect(stocks).toHaveCSS('border-top-color', 'rgb(117, 190, 178)');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Light theme', exact: true }).click();
  await stocks.hover(); await expect(stocks.locator('svg')).toHaveCSS('filter', 'none');
  await expect(stocks.locator('svg')).toHaveCSS('stroke-width', '1.8px');
});
