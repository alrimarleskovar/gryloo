// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

// Exercise the actual Dashboard components with explicit read-only browser fixtures.
let bundle: string;
const errors = new WeakMap<Page, string[]>();
test.beforeAll(async () => {
  const compiled = '../node_modules/next/dist/compiled/';
  const aliases: Record<string, string> = {};
  for (const [name, path] of Object.entries({ 'node:crypto': 'crypto-browserify/index.js', buffer: 'buffer/index.js', 'node:buffer': 'buffer/index.js', stream: 'stream-browserify/index.js', events: 'events/events.js', string_decoder: 'string_decoder/string_decoder.js', util: 'util/util.js', vm: 'vm-browserify/index.js', process: 'process/browser.js' })) {
    aliases[name] = fileURLToPath(new URL(`${compiled}${path}`, import.meta.url));
  }
  const result = await build({ root: fileURLToPath(new URL('../../../', import.meta.url)), configFile: false, logLevel: 'error', resolve: { alias: aliases },
    define: { 'process.env.NODE_ENV': '"production"', __dirname: '"/"', global: 'globalThis' },
    build: { write: false, minify: false, rolldownOptions: { transform: { inject: { Buffer: ['buffer', 'Buffer'], process: 'process' } } },
      lib: { entry: fileURLToPath(new URL('../src/test-utils/dashboard-acceptance-harness.tsx', import.meta.url)), name: 'FloFiDashboardAcceptance', formats: ['iife'] } } });
  const entry = (Array.isArray(result) ? result : [result]).flatMap(output => 'output' in output ? output.output : []).find(output => output.type === 'chunk' && output.isEntry);
  if (!entry || entry.type !== 'chunk') throw new Error('Dashboard acceptance bundle missing');
  bundle = entry.code;
});
test.beforeEach(async ({ page }) => {
  const found: string[] = []; errors.set(page, found);
  page.on('pageerror', error => found.push(error.message));
  await page.goto('/app/dashboard');
  await expect(page.getByRole('heading', { name: 'Your execution workspace' })).toBeVisible();
  const styles = await page.locator('head link[rel="stylesheet"]').evaluateAll(links => links.map(link => link.outerHTML).join(''));
  await page.route('**/__ux006b-acceptance.js', route => route.fulfill({ contentType: 'application/javascript', body: bundle }));
  await page.route('**/__ux006b-acceptance', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html data-theme="light"><head><meta charset="utf-8">${styles}</head><body><main class="main"><div id="acceptance-root"></div></main><script src="/__ux006b-acceptance.js"></script></body></html>` }));
  await page.goto('/__ux006b-acceptance');
  await page.evaluate(() => (window as unknown as { FloFiDashboardAcceptance: { mount(element: HTMLElement): void } }).FloFiDashboardAcceptance.mount(document.getElementById('acceptance-root')!));
  await expect(page.locator('.dashboard-current')).toBeVisible();
});
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });

test('current execution and saved cards retain status, evidence and distinct review actions', async ({ page }) => {
  const current = page.getByRole('region', { name: 'Current execution', exact: true });
  await expect(current).toContainText('Unresolved'); await expect(current).toContainText('0 of 1 step confirmed');
  await expect(page.locator('.dashboard-run-list>.dashboard-run-card')).toHaveCount(0);
  await expect(page.locator('.dashboard-run-list>li')).toHaveCount(3);
  await expect(page.locator('.dashboard-run-current')).toHaveCount(1);
  const attention = page.getByRole('complementary', { name: 'Needs attention', exact: true });
  await expect(attention.getByRole('listitem')).toHaveCount(2);
  await expect(attention).toContainText('Execution status unresolved');
  await expect(attention).toContainText('Review the incomplete action');
  await current.getByRole('link').focus(); await current.getByRole('link').press('Enter');
  await expect(page.locator('.dashboard-result-summary')).toContainText('Unresolved');
  await expect(page.getByRole('button', { name: 'Open current execution', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.flofiDashboardAcceptance.counts().executed)).toBe(0);
  await page.getByRole('button', { name: 'Back to Dashboard' }).click();
  await page.getByRole('link', { name: 'View Swap run fixture-completed', exact: true }).click();
  await expect(page.locator('.dashboard-result-summary')).toContainText('Completed');
  await expect(page.getByRole('button', { name: 'Open current execution', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toHaveCount(0);
});

test('loading, verification and unavailable history preserve the current execution and its attention', async ({ page }) => {
  for (const mode of ['loading', 'verify', 'unavailable', 'not-configured', 'current-only'] as const) {
    await page.evaluate(value => window.flofiDashboardAcceptance.mode(value), mode);
    await expect(page.locator('.dashboard-current')).toBeVisible();
    await expect(page.locator('.dashboard-current')).toContainText('Unresolved');
    await expect(page.locator('.dashboard-attention')).toContainText('Execution status unresolved');
    await expect(page.getByRole('heading', { name: 'No workflows executed yet', exact: true })).toHaveCount(0);
  }
  await page.evaluate(() => window.flofiDashboardAcceptance.mode('verify'));
  await page.getByRole('button', { name: 'Verify wallet for history', exact: true }).click();
  expect(await page.evaluate(() => window.flofiDashboardAcceptance.counts().verified)).toBe(1);
  await page.evaluate(() => window.flofiDashboardAcceptance.mode('unavailable'));
  await page.getByRole('button', { name: 'Refresh history', exact: true }).click();
  expect(await page.evaluate(() => window.flofiDashboardAcceptance.counts().refreshed)).toBe(1);
  expect(await page.evaluate(() => window.flofiDashboardAcceptance.counts().executed)).toBe(0);
});

test('verified empty and disconnected states have no fabricated history or financial values', async ({ page }) => {
  await page.evaluate(() => window.flofiDashboardAcceptance.mode('empty'));
  await expect(page.getByRole('heading', { name: 'No workflows executed yet', exact: true })).toBeVisible();
  await expect(page.locator('.dashboard-run-card')).toHaveCount(0);
  await expect(page.locator('.dashboard-attention')).toContainText('No available runs need attention');
  await page.locator('.dashboard-history-empty').getByRole('button', { name: 'Build workflow', exact: true }).click();
  expect(await page.evaluate(() => window.flofiDashboardAcceptance.counts().built)).toBe(1);
  await page.evaluate(() => window.flofiDashboardAcceptance.mode('disconnected'));
  await expect(page.getByRole('status')).toContainText('Connect your wallet to view your execution history');
  await expect(page.locator('.dashboard-attention,.dashboard-current')).toHaveCount(0);
  expect(await page.locator('.dashboard-workspace').innerText()).not.toMatch(/\$|APY|PnL|0 ETH|0 USDC/);
});

for (const theme of ['light', 'dark'] as const) test(`${theme} Dashboard cards, attention, details and long titles fit wide and narrow widths`, async ({ page }) => {
  await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
  const colors = await page.locator('.dashboard-status-progress').evaluate(element => {
    const sample = document.createElement('span'); sample.style.color = 'var(--accent-ink)'; document.body.append(sample);
    const status = getComputedStyle(element).color, token = getComputedStyle(sample).color; sample.remove(); return { status, token };
  });
  expect(colors.status).toBe(colors.token);
  for (const width of [1440, 1024, 820, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const activity = await page.locator('.dashboard-activity').boundingBox(), attention = await page.locator('.dashboard-attention').boundingBox();
    expect(activity).not.toBeNull(); expect(attention).not.toBeNull();
    if (width > 900) expect(activity!.x + activity!.width).toBeLessThan(attention!.x);
    else expect(attention!.y + attention!.height).toBeLessThan(activity!.y);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: `.tmp/ux006b-dashboard-${theme}.png`, fullPage: true });
  await page.evaluate(() => window.flofiDashboardAcceptance.longTitle());
  await page.setViewportSize({ width: 320, height: 1000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.dashboard-current').getByRole('link').click();
  await expect(page.locator('.dashboard-result-summary')).toContainText('Unresolved');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByText('View technical details', { exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.tmp/ux006b-run-detail-${theme}-320.png`, fullPage: true });
});
