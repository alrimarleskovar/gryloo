// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { installSupplyWallet } from './supply-fixtures';
import { configureCanvasAction } from './composer-authoring-fixtures';
import type { Page } from '@playwright/test';

function captureErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

async function publicSessionSnapshot(page: Page) {
  return page.evaluate(() => ({
    storage: Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)])),
    requests: (window as unknown as { supplyWalletRequests: { method: string; params?: unknown[] }[] }).supplyWalletRequests,
  }));
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} drawer reuses real Dashboard and Build, selects one route, and Logout uses Disconnect semantics`, async ({ page }) => {
    const errors = captureErrors(page);
    await page.addInitScript(value => localStorage.setItem('flofi.theme', value), theme);
    await installSupplyWallet(page); await page.goto('/');
    await expect(page.locator('.build009-wallet-info')).toBeVisible();
    await page.getByRole('button', { name: 'Add supply', exact: true }).click();
    await configureCanvasAction(page, '1');
    const revision = await page.locator('.summary-bar').getAttribute('data-workflow-revision');
    const trigger = page.locator('.navigation-trigger'), drawer = page.locator('.navigation-drawer');
    const stages = page.getByRole('navigation', { name: 'Workflow stages' });
    for (const stage of ['Simulate', 'Execute'] as const) {
      await stages.getByRole('button', { name: stage, exact: true }).click();
      await trigger.click();
      await expect(drawer.locator('[aria-current=page]')).toHaveCount(0);
      await drawer.getByRole('link', { name: 'Build Workflow', exact: true }).press('Enter');
      await expect(page).toHaveURL('/');
      await expect(stages.getByRole('button', { name: 'Build', exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(drawer).toBeHidden();
      await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', revision!);
    }
    for (const [label, path] of [
      ['Dashboard', '/app/dashboard'], ['Credentials', '/app/credentials'], ['Agents', '/app/agents'],
      ['Passkeys', '/app/passkeys'], ['Build Workflow', '/'],
    ] as const) {
      await trigger.click();
      expect(await drawer.getByRole('link').allTextContents()).toEqual(['Dashboard', 'Build Workflow', 'Credentials', 'Agents', 'Passkeys']);
      await drawer.getByRole('link', { name: label, exact: true }).press('Enter');
      await expect(page).toHaveURL(path); await expect(drawer).toBeHidden();
      if (label === 'Build Workflow') await expect(page.getByRole('region', { name: 'Workflow canvas', exact: true })).toBeVisible();
      else if (label === 'Dashboard') await expect(page.getByRole('main', { name: 'Dashboard', exact: true })).toBeVisible();
      else await expect(page.getByRole('heading', { name: label, level: 1, exact: true })).toBeVisible();
      await trigger.press('Enter');
      await expect(drawer.getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(drawer.locator('[aria-current=page]')).toHaveCount(1);
      await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
    }
    const before = await publicSessionSnapshot(page);
    const nodes = await page.locator('.react-flow__node').count();
    await trigger.click();
    const logout = drawer.getByRole('button', { name: 'Logout', exact: true });
    for (let index = 0; index < 5; index++) await page.keyboard.press('Tab');
    await expect(logout).toBeFocused(); await expect(logout).toHaveCSS('outline-style', 'solid');
    await logout.press('Enter');
    await expect(drawer).toBeHidden(); await expect(trigger).toBeFocused();
    await expect(page.getByRole('button', { name: 'Connect Wallet', exact: true })).toBeVisible();
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', revision!);
    expect(await page.locator('.react-flow__node').count()).toBe(nodes);
    expect(await publicSessionSnapshot(page)).toEqual(before);
    await trigger.click(); await expect(logout).toBeDisabled(); await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Connect Wallet', exact: true }).click();
    await expect(page.locator('.build009-wallet-info')).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const reconnected = await publicSessionSnapshot(page);
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Connect Wallet', exact: true })).toBeVisible();
    expect(await publicSessionSnapshot(page)).toEqual(reconnected);
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', revision!);
    expect(errors).toEqual([]);
  });

  test(`${theme} official provider marks stay aligned, decorative, inert, and responsive without Grok`, async ({ page }, testInfo) => {
    const errors = captureErrors(page);
    await page.addInitScript(value => localStorage.setItem('flofi.theme', value), theme);
    await installSupplyWallet(page); await page.goto('/app/agents');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('.build009-wallet-info')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const claude = page.getByRole('button', { name: 'Connect with Claude', exact: true });
    const chatgpt = page.getByRole('button', { name: 'Connect with ChatGPT', exact: true });
    await expect(page.locator('.workspace-provider')).toHaveCount(2);
    await expect(page.getByText('Connect with Grok', { exact: true })).toHaveCount(0);
    await expect(page.locator('.workspace-provider-mark')).not.toHaveText(['C', 'GPT']);
    await expect(claude).toBeDisabled(); await expect(chatgpt).toBeDisabled();
    await expect(claude.locator('img')).toHaveAttribute('src', '/brand/providers/claude-spark.svg');
    await expect(chatgpt.locator('img:visible')).toHaveAttribute('src', `/brand/providers/openai-blossom-${theme === 'dark' ? 'white' : 'black'}.svg`);
    for (const row of [claude, chatgpt]) {
      await expect(row.locator('.workspace-provider-mark')).toHaveAttribute('aria-hidden', 'true');
      await expect(row.locator('img:visible')).toHaveAttribute('alt', '');
      const rendered = await row.locator('img:visible').evaluate(async image => {
        const asset = image as HTMLImageElement; await asset.decode();
        const canvas = document.createElement('canvas'); canvas.width = asset.naturalWidth; canvas.height = asset.naturalHeight;
        const context = canvas.getContext('2d')!; context.drawImage(asset, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let left = canvas.width, right = 0;
        for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
          if (pixels[(y * canvas.width + x) * 4 + 3]! > 0) { left = Math.min(left, x); right = Math.max(right, x); }
        }
        return { loaded: asset.naturalWidth > 0, filter: getComputedStyle(asset).filter,
          visualWidth: (right - left + 1) / canvas.width * asset.getBoundingClientRect().width };
      });
      expect(rendered.loaded).toBe(true); expect(rendered.filter).toBe('none');
      expect(rendered.visualWidth).toBeGreaterThanOrEqual(27); expect(rendered.visualWidth).toBeLessThanOrEqual(29);
    }
    const before = await publicSessionSnapshot(page);
    for (const row of [claude, chatgpt]) await row.evaluate(element => (element as HTMLButtonElement).click());
    expect(await publicSessionSnapshot(page)).toEqual(before);
    await expect(page.locator('.workspace-count')).toHaveText('0 active');
    await expect(page.getByRole('heading', { name: 'No agent clients yet.' })).toBeVisible();
    for (const width of [320,375,768,1024,1440]) {
      await page.setViewportSize({ width, height: 900 });
      const a = (await claude.boundingBox())!, b = (await chatgpt.boundingBox())!;
      expect(a.height).toBe(b.height); expect(a.width).toBe(b.width); expect(a.x).toBe(b.x);
      const icons = await Promise.all([claude, chatgpt].map(row => row.locator('.workspace-provider-mark').boundingBox()));
      expect(icons[0]!.x).toBe(icons[1]!.x); expect(icons[0]!.width).toBe(34); expect(icons[1]!.width).toBe(34);
      const arrows = await Promise.all([claude, chatgpt].map(row => row.locator('.workspace-provider-arrow').boundingBox()));
      expect(arrows[0]!.x).toBe(arrows[1]!.x);
      for (const row of [claude, chatgpt]) await expect(row).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.locator('.navigation-trigger').click();
      const drawer = page.locator('.navigation-drawer');
      await expect(drawer.getByRole('button', { name: 'Logout', exact: true })).toBeInViewport();
      const box = (await drawer.boundingBox())!, footer = (await drawer.locator('.navigation-footer').boundingBox())!;
      expect(box.width).toBeCloseTo(width <= 480 ? Math.min(width * .88, 320) : 260, 1);
      expect(box.y + box.height - footer.y - footer.height).toBeCloseTo(26, 1);
      await page.keyboard.press('Escape');
      if (width === 320 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`agents-${theme}-${width}.png`), fullPage: true });
    }
    // Short viewports keep Logout accessible while only the navigation content scrolls.
    await page.setViewportSize({ width: 320, height: 520 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('.navigation-trigger').click();
    await expect(page.getByRole('button', { name: 'Logout', exact: true })).toBeInViewport();
    const content = page.locator('.navigation-content');
    expect(await content.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await content.hover(); await page.mouse.wheel(0, 450);
    await expect.poll(() => content.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await expect(page.getByRole('link', { name: 'Passkeys', exact: true })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Logout', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => scrollY)).toBe(0);
    expect(errors).toEqual([]);
  });

  test(`${theme} Settings Support is safely inert and preserves switches, keyboard, Disconnect, and responsive placement`, async ({ page }, testInfo) => {
    const errors = captureErrors(page);
    await page.addInitScript(value => localStorage.setItem('flofi.theme', value), theme);
    await installSupplyWallet(page); await page.goto('/');
    await expect(page.locator('.build009-wallet-info')).toBeVisible();
    const settings = page.getByRole('button', { name: 'Settings', exact: true });
    const menu = page.getByRole('group', { name: 'Settings options', exact: true });
    const support = page.getByRole('button', { name: 'Support', exact: true });
    for (const width of [320,375,768,1024,1440]) {
      await page.setViewportSize({ width, height: 900 });
      await settings.click(); await expect(support).toBeVisible();
      expect(await menu.locator('button').allTextContents()).toEqual(['PTEN', '', 'Support', 'Disconnect']);
      const a = (await support.boundingBox())!, b = (await menu.getByRole('button', { name: 'Disconnect', exact: true }).boundingBox())!;
      expect(a.height).toBe(b.height); expect(a.x).toBe(b.x); expect(a.width).toBe(b.width); expect(a.y + a.height).toBeLessThanOrEqual(b.y);
      const bounds = (await menu.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(900);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width === 320 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`settings-${theme}-${width}.png`) });
      const before = await publicSessionSnapshot(page);
      await settings.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
      await expect(support).toBeFocused(); await expect(support).toHaveCSS('outline-style', 'solid');
      await support.press('Space'); await expect(menu).toHaveCount(0); await expect(settings).toBeFocused();
      expect(await publicSessionSnapshot(page)).toEqual(before);
      await expect(page.locator('.build009-wallet-info')).toBeVisible(); await expect(page).toHaveURL('/');
    }
    await settings.press('Enter'); await settings.press('Tab');
    const language = page.getByRole('switch', { name: 'Language', exact: true });
    const themeControl = page.getByRole('switch', { name: 'Theme', exact: true });
    await expect(language).toBeFocused(); await language.press('Enter'); await expect(language).not.toBeChecked();
    await language.press('Tab'); await expect(themeControl).toBeFocused(); await themeControl.press('Space');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme === 'light' ? 'dark' : 'light');
    await themeControl.press('Space'); await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await themeControl.press('Tab'); await expect(support).toBeFocused();
    await support.press('Tab'); const disconnect = page.getByRole('button', { name: 'Disconnect', exact: true });
    await expect(disconnect).toBeFocused();
    const before = await publicSessionSnapshot(page); await disconnect.press('Enter');
    await expect(menu).toHaveCount(0); await expect(settings).toBeFocused();
    await expect(page.getByRole('button', { name: 'Connect Wallet', exact: true })).toBeVisible();
    expect(await publicSessionSnapshot(page)).toEqual(before);
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
    expect(errors).toEqual([]);
  });
}
