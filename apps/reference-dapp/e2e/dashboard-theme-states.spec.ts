// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

// Mount explicit presentation fixtures below the real shell. The shared Settings control
// changes the real theme; no fixture writes to production history or connects a wallet.
let bundle: string;
const errors = new WeakMap<Page, string[]>();
test.beforeAll(async () => {
  const compiled = '../node_modules/next/dist/compiled/', aliases: Record<string, string> = {};
  for (const [name, path] of Object.entries({ 'node:crypto': 'crypto-browserify/index.js', buffer: 'buffer/index.js', 'node:buffer': 'buffer/index.js', stream: 'stream-browserify/index.js', events: 'events/events.js', string_decoder: 'string_decoder/string_decoder.js', util: 'util/util.js', vm: 'vm-browserify/index.js', process: 'process/browser.js' })) {
    aliases[name] = fileURLToPath(new URL(`${compiled}${path}`, import.meta.url));
  }
  const result = await build({ root: fileURLToPath(new URL('../../../', import.meta.url)), configFile: false, logLevel: 'error', resolve: { alias: aliases },
    define: { 'process.env.NODE_ENV': '"production"', __dirname: '"/"', global: 'globalThis' },
    build: { write: false, minify: false, rolldownOptions: { transform: { inject: { Buffer: ['buffer', 'Buffer'], process: 'process' } } },
      lib: { entry: fileURLToPath(new URL('../src/test-utils/dashboard-theme-acceptance-harness.tsx', import.meta.url)), name: 'FloFiDashboardThemeAcceptance', formats: ['iife'] } } });
  const entry = (Array.isArray(result) ? result : [result]).flatMap(output => 'output' in output ? output.output : []).find(output => output.type === 'chunk' && output.isEntry);
  if (!entry || entry.type !== 'chunk') throw new Error('Dashboard theme acceptance bundle missing');
  bundle = entry.code;
});
async function fixture(page: Page, kind: 'Dashboard' | 'Details') {
  await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>('.main')!;
    for (const child of Array.from(main.children)) (child as HTMLElement).style.display = 'none';
    const root = document.createElement('div'); root.id = `theme-fixture-${main.childElementCount}`; main.append(root);
  });
  await page.evaluate(value => {
    const acceptance = (window as unknown as { FloFiDashboardThemeAcceptance: { mountDashboard(element: HTMLElement): void; mountDetails(element: HTMLElement): void } }).FloFiDashboardThemeAcceptance;
    acceptance[value === 'Dashboard' ? 'mountDashboard' : 'mountDetails'](document.querySelector('.main')!.lastElementChild as HTMLElement);
  }, kind);
  await expect(page.locator('.main > div:visible .dashboard-workspace')).toBeVisible();
}
const workspace = (page: Page) => page.locator('.main > div:visible .dashboard-workspace');
async function theme(page: Page, value: 'light' | 'dark') {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: `${value === 'light' ? 'Light' : 'Dark'} theme`, exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', value);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
test.beforeEach(async ({ page }) => {
  const found: string[] = []; errors.set(page, found); page.on('pageerror', error => found.push(error.message));
  await page.goto('/app/dashboard');
  await expect(page.getByRole('heading', { name: 'Your execution workspace' })).toBeVisible();
  // Wait for shell hydration through its existing interactive control before mounting.
  await theme(page, 'light');
  await page.route('**/__ux006d-acceptance.js', route => route.fulfill({ contentType: 'application/javascript', body: bundle }));
  await page.addScriptTag({ url: '/__ux006d-acceptance.js' });
  await fixture(page, 'Dashboard');
});
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });

test('shared theme switching preserves runs, read state, navigation and the single wallet model', async ({ page }) => {
  const index = workspace(page);
  const before = await index.innerText();
  for (const value of ['dark', 'light', 'dark'] as const) {
    await theme(page, value);
    expect(await index.innerText()).toBe(before);
    await expect(page.locator('.top-bar')).toHaveCount(1);
    await expect(page.getByRole('group', { name: 'Wallet connection' })).toHaveCount(1);
    expect(await page.evaluate(() => window.flofiDashboardAcceptance.counts())).toEqual({ built: 0, refreshed: 0, verified: 0, executed: 0 });
  }
  const run = index.getByRole('link', { name: 'View Swap run fixture-completed', exact: true });
  await run.focus(); await run.press('Enter');
  await expect(index.locator('.dashboard-final-result')).toHaveText('Completed');
  await theme(page, 'light');
  await expect(index.locator('.dashboard-final-result')).toHaveText('Completed');
  await expect(index.getByRole('button', { name: /^(Execute workflow|Retry|Continue execution)$/ })).toHaveCount(0);
  await index.getByRole('button', { name: 'Back to Dashboard' }).click();
  await expect(index.locator('.dashboard-run-card')).toHaveCount(4);
});

for (const value of ['light', 'dark'] as const) {
  test(`${value} product states distinguish empty, disconnected, verification, loading and unavailable history`, async ({ page }) => {
    await theme(page, value);
    const index = workspace(page);
    await page.evaluate(() => window.flofiDashboardAcceptance.mode('empty'));
    await expect(index.getByRole('heading', { name: 'No workflows executed yet', exact: true })).toBeVisible();
    await expect(index.locator('.dashboard-run-card,.dashboard-attention-required')).toHaveCount(0);
    await index.locator('.dashboard-history-empty').getByRole('button', { name: 'Build workflow', exact: true }).click();
    expect(await page.evaluate(() => window.flofiDashboardAcceptance.counts().built)).toBe(1);
    await page.screenshot({ style: 'nextjs-portal{display:none}', path: `.tmp/ux006d-empty-${value}.png`, fullPage: true });
    await page.evaluate(() => window.flofiDashboardAcceptance.mode('disconnected'));
    await expect(index.getByRole('status')).toContainText('Use the wallet control in the FloFi header');
    await expect(index.locator('.dashboard-current,.dashboard-attention')).toHaveCount(0);
    await expect(index.getByRole('button', { name: /Connect wallet/i })).toHaveCount(0);
    await page.evaluate(() => window.flofiDashboardAcceptance.mode('verify'));
    await expect(index.getByRole('status')).toContainText('Verify this wallet');
    await index.getByRole('button', { name: 'Verify wallet for history', exact: true }).click();
    expect(await page.evaluate(() => window.flofiDashboardAcceptance.counts().verified)).toBe(1);
    await page.evaluate(() => window.flofiDashboardAcceptance.mode('verifying'));
    await expect(index.getByRole('button', { name: 'Waiting for wallet…', exact: true })).toBeDisabled();
    await page.evaluate(() => window.flofiDashboardAcceptance.mode('verification-issue'));
    await expect(index.getByRole('alert')).toContainText('Your execution records have not changed');
    await page.evaluate(() => window.flofiDashboardAcceptance.mode('loading'));
    await expect(index.getByRole('status')).toContainText('Loading execution history');
    await expect(index.locator('.dashboard-current')).toContainText('Unresolved');
    await page.evaluate(() => window.flofiDashboardAcceptance.mode('unavailable'));
    await expect(index.getByRole('status')).toContainText('Execution history temporarily unavailable');
    await expect(index.getByRole('heading', { name: 'No workflows executed yet', exact: true })).toHaveCount(0);
    await expect(index.locator('.dashboard-current')).toContainText('Unresolved');
    await index.getByRole('button', { name: 'Refresh history', exact: true }).click();
    expect(await page.evaluate(() => window.flofiDashboardAcceptance.counts().refreshed)).toBe(1);
    await page.screenshot({ style: 'nextjs-portal{display:none}', path: `.tmp/ux006d-unavailable-${value}.png`, fullPage: true });
    await page.evaluate(() => window.flofiDashboardAcceptance.mode('not-configured'));
    await expect(index.getByRole('status')).toContainText('unavailable in this environment');
    expect(await index.innerText()).not.toMatch(/\$|APY|PnL|owner-scope|session mismatch|read-model/i);
  });

  test(`${value} status hierarchy, contrast, hover and keyboard focus remain calm and readable`, async ({ page }) => {
    await theme(page, value);
    const index = workspace(page);
    await expect(index.locator('.dashboard-attention li')).toHaveCount(2);
    await expect(index.locator('.dashboard-attention')).toContainText('Execution status unresolved');
    const checks = await index.locator('.dashboard-status,.dashboard-run-message,.dashboard-run-facts,.dashboard-run-records').evaluateAll(elements => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!;
      function luminance(color: string) {
        context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
        const channels = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map(channel => { const n = channel / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; });
        return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
      }
      return elements.map(element => {
        const style = getComputedStyle(element);
        let parent: Element | null = element, background = 'transparent';
        while (parent && /^(transparent|rgba\(0, 0, 0, 0\))$/.test(background)) { background = getComputedStyle(parent).backgroundColor; parent = parent.parentElement; }
        const fg = luminance(style.color), bg = luminance(background);
        return { text: element.textContent, size: parseFloat(style.fontSize), ratio: (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05) };
      });
    });
    for (const check of checks) { expect(check.size, check.text ?? '').toBeGreaterThanOrEqual(12); expect(check.ratio, check.text ?? '').toBeGreaterThanOrEqual(4.5); }
    const run = index.locator('.dashboard-run-list .dashboard-run-card').first();
    const border = await run.evaluate(element => getComputedStyle(element).borderColor);
    const link = run.getByRole('link'); await link.hover();
    expect(await run.evaluate(element => getComputedStyle(element).borderColor)).not.toBe(border);
    await link.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
    expect(await link.evaluate(element => { const style = getComputedStyle(element); return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2; })).toBe(true);
    const refresh = index.getByRole('button', { name: 'Refresh history', exact: true }); await refresh.hover();
    expect(await refresh.evaluate(element => { const style = getComputedStyle(element); return style.backgroundImage === 'none' && style.boxShadow === 'none'; })).toBe(true);
    await page.mouse.move(0, 0);
    await page.screenshot({ style: 'nextjs-portal{display:none}', path: `.tmp/ux006d-dashboard-${value}.png`, fullPage: true });
    await fixture(page, 'Details');
    for (const [mode, status, tone] of [['completed', 'Completed', 'complete'], ['pending', 'In progress', 'progress'], ['partial', 'Partially completed', 'attention'], ['failed', 'Failed', 'failed'], ['unresolved', 'Unresolved', 'attention'], ['declined', 'Transaction not submitted', 'neutral']] as const) {
      await page.evaluate(mode => window.flofiRunDetailAcceptance.show(mode), mode);
      await expect(workspace(page).locator('.dashboard-result-summary .dashboard-status')).toHaveText(status);
      await expect(workspace(page).locator(`.dashboard-result-summary .dashboard-status-${tone}`)).toHaveCount(1);
      await expect(workspace(page).getByRole('button', { name: /^(Execute workflow|Retry|Continue execution)$/ })).toHaveCount(0);
    }
  });

  test(`${value} Run Details preserves brand colors, evidence and disclosure state during theme changes`, async ({ page }) => {
    await fixture(page, 'Details'); await theme(page, value);
    const detail = workspace(page);
    for (const mode of ['completed', 'bridge-completed'] as const) {
      await page.evaluate(value => window.flofiRunDetailAcceptance.show(value), mode);
      await expect(detail.locator('.dashboard-detail-networks')).toContainText(mode === 'bridge-completed' ? 'Arbitrum Sepolia' : 'Base Sepolia');
      const before = await detail.locator('img.brand-icon').evaluateAll(images => images.map(image => ({ src: (image as HTMLImageElement).src, filter: getComputedStyle(image).filter, opacity: getComputedStyle(image).opacity, blend: getComputedStyle(image).mixBlendMode })));
      expect(before.length).toBeGreaterThan(2);
      expect(before.every(image => image.filter === 'none' && image.opacity === '1' && image.blend === 'normal')).toBe(true);
      await theme(page, value === 'light' ? 'dark' : 'light');
      expect(await detail.locator('img.brand-icon').evaluateAll(images => images.map(image => ({ src: (image as HTMLImageElement).src, filter: getComputedStyle(image).filter, opacity: getComputedStyle(image).opacity, blend: getComputedStyle(image).mixBlendMode })))).toEqual(before);
      await theme(page, value);
    }
    await page.evaluate(() => window.flofiRunDetailAcceptance.show('completed'));
    await expect(detail.locator('.execution-plan')).toContainText('Actual received');
    await expect(detail.locator('.execution-plan')).toContainText('0.0243 WETH');
    await expect(detail.locator('.dashboard-run-evidence')).toContainText('Archive integrity verified');
    const disclosure = detail.getByText('View technical details', { exact: true });
    await disclosure.focus(); await disclosure.press('Enter');
    await expect(detail.locator('details')).toHaveAttribute('open', '');
    await theme(page, value === 'light' ? 'dark' : 'light');
    await expect(detail.locator('details')).toHaveAttribute('open', '');
    await expect(detail.locator('.execution-plan')).toContainText('0.0243 WETH');
    expect(await page.evaluate(() => window.flofiRunDetailAcceptance.counts())).toEqual({ back: 0, reloaded: 0, executeNavigation: 0, built: 0 });
    await theme(page, value); await disclosure.click();
    await page.screenshot({ style: 'nextjs-portal{display:none}', path: `.tmp/ux006d-run-completed-${value}.png`, fullPage: true });
    await page.evaluate(() => window.flofiRunDetailAcceptance.show('partial'));
    await page.screenshot({ style: 'nextjs-portal{display:none}', path: `.tmp/ux006d-run-partial-${value}.png`, fullPage: true });
    await page.evaluate(() => window.flofiRunDetailAcceptance.show('not-found'));
    await expect(detail.getByRole('heading', { name: 'Run not found', exact: true })).toBeVisible();
    await expect(detail).toContainText('This execution is unavailable for the connected wallet');
    await expect(detail.getByRole('button', { name: 'Reload details', exact: true })).toHaveCount(0);
    await page.evaluate(() => window.flofiRunDetailAcceptance.show('unavailable'));
    await expect(detail.getByRole('heading', { name: 'Execution details temporarily unavailable', exact: true })).toBeVisible();
    await expect(detail.getByRole('heading', { name: 'Run not found', exact: true })).toHaveCount(0);
    await page.evaluate(() => window.flofiRunDetailAcceptance.show('legacy'));
    await expect(detail).toContainText('Original workflow details are unavailable');
    await expect(detail.locator('.dashboard-recorded-requests')).toBeVisible();
    await expect(detail.locator('.execution-timeline')).toHaveCount(0);
  });

  test(`${value} common widths preserve cards, attention, long values and evidence without overflow`, async ({ page }) => {
    await theme(page, value);
    for (const mode of ['history', 'verify', 'unavailable', 'empty', 'disconnected'] as const) {
      await page.evaluate(value => window.flofiDashboardAcceptance.mode(value), mode);
      for (const width of [1440, 1024, 768, 375, 320]) { await page.setViewportSize({ width, height: 1000 }); await noOverflow(page); }
    }
    await page.evaluate(() => { window.flofiDashboardAcceptance.mode('history'); window.flofiDashboardAcceptance.longTitle(); });
    await noOverflow(page);
    expect(await workspace(page).locator('.dashboard-run-current h3').evaluate(element => element.getAttribute('title') === element.textContent && element.getBoundingClientRect().height <= parseFloat(getComputedStyle(element).lineHeight) * 3 + 1)).toBe(true);
    await page.screenshot({ style: 'nextjs-portal{display:none}', path: `.tmp/ux006d-dashboard-${value}-320.png`, fullPage: true });
    await fixture(page, 'Details');
    for (const mode of ['completed', 'partial', 'unresolved', 'bridge-completed', 'cow-pending', 'legacy', 'not-found', 'unavailable'] as const) {
      await page.evaluate(value => window.flofiRunDetailAcceptance.show(value), mode);
      for (const width of [1440, 1024, 768, 375, 320]) { await page.setViewportSize({ width, height: 1000 }); await noOverflow(page); }
    }
    await page.evaluate(() => { window.flofiRunDetailAcceptance.show('partial'); window.flofiRunDetailAcceptance.longTitle(); });
    await workspace(page).getByText('View technical details', { exact: true }).click(); await noOverflow(page);
    await page.screenshot({ style: 'nextjs-portal{display:none}', path: `.tmp/ux006d-run-partial-${value}-320.png`, fullPage: true });
  });
}

test('canonical Dashboard and Run Details routes retain the shell and privacy-safe states in both themes', async ({ page }) => {
  for (const value of ['light', 'dark'] as const) {
    await page.goto('/app/dashboard'); await theme(page, value);
    await expect(page.getByRole('status')).toContainText('Connect your wallet');
    await page.screenshot({ style: 'nextjs-portal{display:none}', path: `.tmp/ux006d-shell-disconnected-${value}.png`, fullPage: true });
    await page.setViewportSize({ width: 320, height: 900 });
    const stages = await page.getByRole('navigation', { name: 'Workflow stages' }).locator('button').evaluateAll(buttons => buttons.map(button => {
      const range = document.createRange(); range.selectNodeContents(button);
      const content = range.getBoundingClientRect(), box = button.getBoundingClientRect();
      return { label: button.textContent, left: box.left, right: box.right, contentLeft: content.left, contentRight: content.right };
    }));
    for (const stage of stages) {
      expect(stage.contentLeft, stage.label ?? '').toBeGreaterThanOrEqual(stage.left);
      expect(stage.contentRight, stage.label ?? '').toBeLessThanOrEqual(stage.right);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app/dashboard/runs/inaccessible-theme-check');
    await expect(page.getByRole('heading', { name: 'Connect the wallet used for this execution', exact: true })).toBeVisible();
    await expect(page.locator('.top-bar')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toHaveCount(0);
    await expect(page.locator('.dashboard-run-detail')).not.toContainText('inaccessible-theme-check');
    await page.screenshot({ style: 'nextjs-portal{display:none}', path: `.tmp/ux006d-shell-run-disconnected-${value}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Back to Dashboard' }).click();
    await expect(page).toHaveURL(/\/app\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Your execution workspace' })).toBeVisible();
  }
});
