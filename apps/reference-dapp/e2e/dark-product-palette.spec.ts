// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { selectSettingsTheme } from './settings-fixtures';
import type { Page, Locator } from '@playwright/test';
import { installSupplyWallet } from './supply-fixtures';
import { configureCanvasAction } from './composer-authoring-fixtures';

const widths = [1440, 1024, 768, 375, 320];
async function dark(page: Page) {
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  await settings.click(); await selectSettingsTheme(page, 'Dark');
  await settings.press('Escape');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
}

// Measure the actual rendered foreground and nearest opaque surface, including color-mix.
async function readable(values: Locator) {
  const checks = await values.evaluateAll(elements => {
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d')!;
    function luminance(color: string) {
      context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      const channels = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map(channel => {
        const value = channel / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
      });
      return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
    }
    return elements.filter(element => element.getClientRects().length).map(element => {
      let parent: Element | null = element, background = 'transparent';
      while (parent && /^(transparent|rgba\(0, 0, 0, 0\))$/.test(background)) {
        background = getComputedStyle(parent).backgroundColor; parent = parent.parentElement;
      }
      const foreground = luminance(getComputedStyle(element).color), surface = luminance(background);
      return { label: element.textContent, ratio: (Math.max(foreground, surface) + .05) / (Math.min(foreground, surface) + .05) };
    });
  });
  expect(checks.length).toBeGreaterThan(0);
  for (const check of checks) expect(check.ratio, check.label ?? '').toBeGreaterThanOrEqual(4.5);
}

test('graphite palette follows the real lifecycle shell, settings and workspace at every product width', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await installSupplyWallet(page); await page.goto('/'); await dark(page);
  const tokens = await page.locator('html').evaluate(element => {
    const style = getComputedStyle(element);
    return Object.fromEntries(['app-bg', 'surface', 'surface-raised', 'border', 'text-primary', 'text-secondary', 'accent', 'accent-soft', 'primary', 'success', 'warning-surface', 'warning-text']
      .map(name => [name, style.getPropertyValue(`--${name}`).trim().toUpperCase()]));
  });
  expect(tokens).toEqual({ 'app-bg': '#0B0D12', surface: '#15181F', 'surface-raised': '#1C2029', border: '#2A2F3A',
    'text-primary': '#F4F5F7', 'text-secondary': '#A4ABB8', accent: '#93A6FF', 'accent-soft': '#1A2350',
    primary: '#2343D9', success: '#4ADE80', 'warning-surface': '#33270F', 'warning-text': '#F5B94A' });
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(11, 13, 18)');
  await expect(page.locator('body')).toHaveCSS('color', 'rgb(244, 245, 247)');
  await expect(page.locator('.top-bar')).toHaveCSS('background-color', 'rgb(21, 24, 31)');
  await expect(page.locator('.flofi-logo-dark')).toBeVisible(); await expect(page.locator('.flofi-logo-light')).toBeHidden();
  await expect(page.locator('.flofi-logo-dark .flofi-logo-symbol')).toHaveAttribute('src', '/brand/flofi-symbol-dark.svg');
  await page.screenshot({ style: 'nextjs-portal{display:none}', path: '.tmp/ux007-team3-empty-build-dark.png', fullPage: true });
  await page.getByRole('button', { name: 'Add supply', exact: true }).click(); await configureCanvasAction(page, '1');
  const navigation = page.getByRole('navigation', { name: 'Workflow stages' });
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    for (const stage of ['Build', 'Simulate', 'Execute', 'Dashboard'] as const) {
      await navigation.getByRole('button', { name: stage, exact: true }).click();
      const selected = navigation.getByRole('button', { name: stage, exact: true });
      await expect(selected).toHaveCSS('background-color', 'rgb(26, 35, 80)');
      await expect(selected).toHaveCSS('color', 'rgb(147, 166, 255)');
      if (stage !== 'Dashboard') {
        await expect(selected.locator('.stage-number')).toHaveCSS('background-color', 'rgb(35, 67, 217)');
        await expect(selected.locator('.stage-number')).toHaveCSS('color', 'rgb(255, 255, 255)');
        await expect(page.locator('.flow-surface')).toHaveCSS('background-image', 'linear-gradient(135deg, rgb(28, 32, 41), rgb(28, 32, 41))');
        await expect(page.locator('.canvas-navigator')).toHaveCSS('background-color', 'rgb(28, 32, 41)');
        await expect(page.locator('.canvas-foot')).toHaveCSS('color', 'rgb(164, 171, 184)');
        const action = page.locator('.canvas-primary-action button').last();
        if (await action.isEnabled()) {
          await expect(action).toHaveCSS('background-color', 'rgb(35, 67, 217)');
          await expect(action).toHaveCSS('color', 'rgb(255, 255, 255)');
        } else {
          await expect(action).toHaveCSS('color', 'rgb(164, 171, 184)'); await expect(action).toHaveCSS('opacity', '1');
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await readable(page.locator('.canvas-foot, .simulation-summary-heading p, .execution-summary h2, .dashboard-empty p, .tabs button.selected'));
      if (width === 1440 || width === 320) await page.screenshot({ style: 'nextjs-portal{display:none}', path: `.tmp/ux007-team3-${stage.toLowerCase()}-dark-${width}.png`, fullPage: true });
    }
    const settings = page.getByRole('button', { name: 'Settings', exact: true });
    await settings.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
    await expect(settings).toHaveCSS('outline-color', 'rgb(147, 166, 255)');
    await settings.press('Enter');
    await expect(page.locator('.header-settings-menu')).toHaveCSS('background-color', 'rgb(21, 24, 31)');
    await expect(page.locator('.header-settings-choices').first()).toHaveCSS('background-color', 'rgb(28, 32, 41)');
    await readable(page.locator('.header-settings-row'));
    if (width === 1440 || width === 320) await page.screenshot({ style: 'nextjs-portal{display:none}', path: `.tmp/ux007-team3-settings-dark-${width}.png`, fullPage: true });
    await settings.press('Escape'); await expect(settings).toBeFocused();
  }
  await navigation.getByRole('button', { name: 'Build', exact: true }).click();
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
  await expect(page.getByRole('textbox', { name: 'Source amount (USDC)', exact: true }).first()).toHaveValue('1');
  expect(await page.evaluate(() => (window as unknown as { supplyWalletRequests: { method: string }[] }).supplyWalletRequests.filter(request => /send|sign/i.test(request.method)))).toEqual([]);
  expect(errors).toEqual([]);
});

test('all Dark authoring cards and pickers share graphite surfaces with intact asset branding', async ({ page }) => {
  await installSupplyWallet(page, { chain: '0x2105' }); await page.goto('/'); await dark(page);
  await expect(page.locator('.header-mainnet-dot')).toHaveCSS('background-color', 'rgb(74, 222, 128)');
  for (const action of ['swap', 'bridge', 'pool', 'supply', 'borrow', 'repay', 'withdraw', 'Stocks']) {
    await page.goto('/');
    await page.getByRole('button', { name: action === 'Stocks' ? action : `Add ${action}`, exact: true }).click();
    const card = page.locator('.build-flow-surface .composer-card');
    await expect(card).toHaveCSS('background-color', 'rgb(21, 24, 31)');
    await expect(card.locator('.composer-amount-box').first()).toHaveCSS('background-color', 'rgb(28, 32, 41)');
    await expect(card.locator('.composer-value-arrow')).toHaveCount(['swap', 'bridge'].includes(action) ? 1 : 0);
    const trigger = card.getByRole('button', { name: action === 'Stocks' ? 'Select stock' : action === 'bridge' ? 'Configure source asset' : 'Select source token', exact: true });
    await trigger.press('Enter');
    const picker = page.locator('.composer-stocks-panel'); await expect(picker).toBeVisible();
    await expect(picker).toHaveCSS('background-color', 'rgb(21, 24, 31)');
    await expect(picker).toHaveCSS('border-top-color', 'rgb(42, 47, 58)');
    expect(await picker.locator('img.brand-icon').evaluateAll(icons => icons.every(icon => getComputedStyle(icon).filter === 'none'))).toBe(true);
    await expect(picker.locator('.composer-token-options .composer-network-badge')).toHaveCount(0);
    await readable(picker.locator('.composer-stock-option > span:not(.composer-stock-check), .composer-bridge-picker-heading'));
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      // React Flow refits measured nodes after a resize; inspect the settled viewport.
      await expect.poll(async () => {
        const box = (await picker.boundingBox())!, canvas = (await page.locator('.flow-surface').boundingBox())!;
        return box.x >= canvas.x - 1 && box.x + box.width <= canvas.x + canvas.width + 1;
      }).toBe(true);
    }
    if (['swap', 'pool', 'Stocks'].includes(action)) await page.screenshot({ style: 'nextjs-portal{display:none}', path: `.tmp/ux007-team3-${action.toLowerCase()}-picker-dark-320.png`, fullPage: true });
    await picker.press('Escape');
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
    await page.setViewportSize({ width: 1440, height: 900 });
  }
});
