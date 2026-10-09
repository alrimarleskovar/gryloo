// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { installSupplyWallet } from './supply-fixtures';
import { configureCanvasAction } from './composer-authoring-fixtures';
import type { Page } from '@playwright/test';

async function geometry(page: Page) {
  return page.evaluate(() => {
    const selectors = ['.top-bar', 'main', '.canvas', '.canvas-head', '.flow-surface', '.canvas-foot', '.canvas-primary-action', '.canvas-navigator', '.copilot', '.simulation-summary', '.execution-plan', '.summary-bar', '.dashboard-workspace'];
    return Object.fromEntries(selectors.map(selector => {
      const element = document.querySelector(`main ${selector}`) ?? document.querySelector(selector);
      if (!element) return [selector, null];
      const { x, y, width, height } = element.getBoundingClientRect();
      return [selector, { x, y, width, height }];
    }));
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} navigation routes share the drawer and preserve dismissal controls`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(value => localStorage.setItem('flofi.theme', value), theme);
    await installSupplyWallet(page); await page.goto('/app');
    await expect(page.locator('.build009-wallet-info')).toBeVisible();
    const trigger = page.locator('.navigation-trigger'), drawer = page.locator('.navigation-drawer'), layer = page.locator('.navigation-layer');
    await expect(trigger).toHaveAccessibleName('Open navigation');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(drawer).toBeHidden(); await expect(layer).toHaveAttribute('inert', '');
    expect(await trigger.getAttribute('aria-controls')).toBe(await drawer.getAttribute('id'));
    for (const label of ['Credentials', 'Agents', 'Passkeys']) {
      await trigger.click(); await expect(drawer).toBeVisible();
      expect(await drawer.getByRole('link').allTextContents()).toEqual(['Dashboard', 'Build Workflow', 'Credentials', 'Agents', 'Passkeys']);
      await drawer.getByRole('link', { name: label, exact: true }).click();
      await expect(page).toHaveURL(`/app/${label.toLowerCase()}`);
      await expect(page.getByRole('heading', { name: label, level: 1 })).toBeVisible();
      await expect(drawer).toBeHidden();
      await trigger.click();
      const row = drawer.getByRole('link', { name: label, exact: true });
      await expect(row).toHaveAttribute('aria-current', 'page');
      await expect(drawer.locator('[aria-current=page]')).toHaveCount(1);
      await expect(row).toHaveCSS('font-weight', '600');
      await expect(row).toHaveCSS('background-color', theme === 'dark' ? 'rgb(26, 35, 80)' : 'rgb(234, 242, 255)');
      await row.press('Escape'); await expect(drawer).toBeHidden(); await expect(trigger).toBeFocused();
      await expect(trigger).toHaveCSS('outline-style', 'solid');
    }
    await trigger.press('Enter');
    await expect(drawer.getByRole('link', { name: 'Dashboard', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(drawer.getByRole('link', { name: 'Build Workflow', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(drawer.getByRole('link', { name: 'Credentials', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(drawer.getByRole('link', { name: 'Agents', exact: true })).toBeFocused();
    await page.keyboard.press('Enter'); await expect(page).toHaveURL('/app/agents'); await expect(drawer).toBeHidden();
    await trigger.click(); await trigger.click(); await expect(drawer).toBeHidden();
    await trigger.click(); await page.mouse.click(1400, 500); await expect(drawer).toBeHidden(); await expect(trigger).toBeFocused();
    await trigger.click(); await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(drawer).toBeHidden();
    await expect(page.getByRole('switch', { name: 'Language', exact: true })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Theme', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).press('Escape');
    expect(errors).toEqual([]);
  });

  test(`${theme} responsive drawer preserves Build, Simulate, Execute and Dashboard geometry`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(value => localStorage.setItem('flofi.theme', value), theme);
    await installSupplyWallet(page); await page.goto('/app');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('.build009-wallet-info')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.getByRole('button', { name: 'Add supply', exact: true }).click();
    await configureCanvasAction(page, '1');
    const stages = page.getByRole('navigation', { name: 'Workflow stages' });
    const trigger = page.locator('.navigation-trigger');
    const drawer = page.locator('.navigation-drawer');
    const measurements: Record<string, Awaited<ReturnType<typeof geometry>>> = {};
    for (const width of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const stage of ['Build', 'Simulate', 'Execute', 'Dashboard'] as const) {
        await stages.getByRole('button', { name: stage, exact: true }).click();
        await expect(stages.getByRole('button', { name: stage, exact: true })).toHaveAttribute('aria-current', 'page');
        if (stage === 'Dashboard') await expect(page.locator('.dashboard-loading')).toHaveCount(0);
        await page.evaluate(() => window.scrollTo(0, 0));
        const before = await geometry(page);
        measurements[`${theme}-${width}-${stage}`] = before;
        await trigger.click(); await expect(drawer).toBeVisible();
        expect(await geometry(page)).toEqual(before);
        const headerBox = (await page.getByRole('banner').boundingBox())!;
        const drawerBox = (await drawer.boundingBox())!;
        expect(drawerBox.x).toBe(0);
        expect(drawerBox.y).toBe(headerBox.y + headerBox.height);
        expect(drawerBox.y + drawerBox.height).toBe(900);
        expect(drawerBox.width).toBeCloseTo(width <= 480 ? Math.min(width * .88, 320) : 260, 1);
        expect(900 - drawerBox.y).toBeGreaterThan(400);
        expect(width - drawerBox.width).toBeGreaterThan(30);
        expect(await drawer.evaluate(element => element.scrollHeight <= element.clientHeight)).toBe(true);
        for (const label of ['Dashboard', 'Build Workflow', 'Credentials', 'Agents', 'Passkeys']) await expect(drawer.getByRole('link', { name: label, exact: true })).toBeInViewport();
        await expect(drawer.getByRole('button', { name: 'Logout', exact: true })).toBeInViewport();
        await expect(drawer.locator('[aria-current=page]')).toHaveCount(stage === 'Build' || stage === 'Dashboard' ? 1 : 0);
        await expect(trigger).toBeInViewport();
        await expect(page.getByRole('combobox', { name: 'Environment', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
        await expect(page.getByRole('group', { name: 'Wallet connection' })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (stage === 'Build' && (width === 320 || width === 1440)) await page.screenshot({ path: `.tmp/flofi-navigation-${theme}-${width}.png` });
        await drawer.getByRole('link', { name: 'Credentials', exact: true }).press('Escape');
        await expect(drawer).toBeHidden();
        expect(await geometry(page)).toEqual(before);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
    await testInfo.attach('navigation-workspace-geometry', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
    expect(errors).toEqual([]);
  });
}

test('drawer opens and closes with a restrained reversible slide and respects reduced motion', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.goto('/app');
  const trigger = page.locator('.navigation-trigger');
  const drawer = page.locator('.navigation-drawer');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await trigger.click();
  await expect(drawer).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  for (const open of [false, true]) {
    const motion = await page.evaluate(async open => {
      const layer = document.querySelector('.navigation-layer')!;
      const drawer = document.querySelector('.navigation-drawer')!;
      const trigger = document.querySelector<HTMLButtonElement>('.navigation-trigger')!;
      const changed = new Promise<void>(resolve => {
        const observer = new MutationObserver(() => {
          if (layer.getAttribute('data-open') === String(open)) { observer.disconnect(); resolve(); }
        });
        observer.observe(layer, { attributes: true, attributeFilter: ['data-open'] });
      });
      void getComputedStyle(drawer).transform;
      trigger.click(); await changed;
      const style = getComputedStyle(drawer);
      const samples: { x: number; visibility: string }[] = [];
      for (let frame = 0; frame < 20; frame++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        samples.push({ x: new DOMMatrix(getComputedStyle(drawer).transform).m41, visibility: getComputedStyle(layer).visibility });
      }
      return { duration: style.transitionDuration, easing: style.transitionTimingFunction, samples };
    }, open);
    expect(motion.duration).toBe('0.22s'); expect(motion.easing).toBe('ease-out');
    expect(motion.samples.some(sample => sample.x > -260 && sample.x < 0 && sample.visibility === 'visible')).toBe(true);
    expect(motion.samples.every(sample => sample.x >= -260 && sample.x <= 0)).toBe(true);
    for (let index = 1; index < motion.samples.length; index++) {
      const delta = motion.samples[index]!.x - motion.samples[index - 1]!.x;
      expect(open ? delta >= 0 : delta <= 0).toBe(true);
    }
    expect(motion.samples.at(-1)!.x).toBe(open ? 0 : -260);
  }
  await trigger.click(); await expect(drawer).toBeHidden();
  // A quick reversal settles open, with no extra layer or stuck backdrop.
  await trigger.click(); await trigger.click(); await trigger.click();
  await expect(drawer).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  await expect(page.locator('.navigation-layer')).toHaveCount(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(drawer).toHaveCSS('transition-duration', '0s');
  await trigger.click(); await expect(drawer).toBeHidden();
  await trigger.press('Space'); await expect(drawer).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  await page.keyboard.press('Escape'); await expect(drawer).toBeHidden();
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  await settings.click(); await page.getByRole('switch', { name: 'Theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await settings.press('Escape'); await trigger.click();
  await expect(drawer).toHaveCSS('transition-duration', '0s');
  await expect(drawer).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  await page.keyboard.press('Escape'); await expect(drawer).toBeHidden();
  expect(errors).toEqual([]);
});
