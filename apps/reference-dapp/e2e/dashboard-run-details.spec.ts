// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { detailHash, detailOrderId, detailDestinationHash } from '../src/test-utils/run-detail-fixture';

// Isolated browser presentation fixtures reuse the production components and UX-005 projectors.
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
      lib: { entry: fileURLToPath(new URL('../src/test-utils/run-detail-acceptance-harness.tsx', import.meta.url)), name: 'FloFiRunDetailAcceptance', formats: ['iife'] } } });
  const entry = (Array.isArray(result) ? result : [result]).flatMap(output => 'output' in output ? output.output : []).find(output => output.type === 'chunk' && output.isEntry);
  if (!entry || entry.type !== 'chunk') throw new Error('Run Details acceptance bundle missing');
  bundle = entry.code;
});
test.beforeEach(async ({ page }) => {
  const found: string[] = []; errors.set(page, found); page.on('pageerror', error => found.push(error.message));
  await page.goto('/app/dashboard');
  await expect(page.getByRole('heading', { name: 'Your execution workspace' })).toBeVisible();
  const styles = await page.locator('head link[rel="stylesheet"]').evaluateAll(links => links.map(link => link.outerHTML).join(''));
  await page.route('**/__ux006c-acceptance.js', route => route.fulfill({ contentType: 'application/javascript', body: bundle }));
  await page.route('**/__ux006c-acceptance', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html data-theme="light"><head><meta charset="utf-8">${styles}</head><body><div class="app-shell"><main class="main"><div id="acceptance-root"></div></main></div><script src="/__ux006c-acceptance.js"></script></body></html>` }));
  await page.goto('/__ux006c-acceptance');
  await page.evaluate(() => (window as unknown as { FloFiRunDetailAcceptance: { mount(element: HTMLElement): void } }).FloFiRunDetailAcceptance.mount(document.getElementById('acceptance-root')!));
  await expect(page.getByRole('region', { name: 'Run summary', exact: true })).toBeVisible();
});
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });

test('saved run summary, actual values, archive evidence and secondary technical details stay read-only', async ({ page }) => {
  await expect(page.locator('.dashboard-result-summary')).toContainText('Execution completed');
  await expect(page.getByRole('list', { name: 'Workflow step progression' })).toContainText('0.0243 WETH');
  await expect(page.getByRole('group', { name: 'Planned and actual values' })).toContainText('0.025 WETH');
  await expect(page.getByRole('region', { name: 'Evidence', exact: true })).toContainText('Archive integrity verified');
  await expect(page.locator('details')).toHaveCount(1); await expect(page.locator('details')).not.toHaveAttribute('open', '');
  const technical = page.getByText('View technical details', { exact: true });
  await technical.focus(); await technical.press('Enter');
  await expect(page.locator('.execution-evidence-details')).toContainText('Saved execution record');
  await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Back to Build', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to Dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Your execution workspace' })).toBeVisible();
  expect(await page.evaluate(() => window.flofiRunDetailAcceptance.counts())).toEqual({ back: 1, reloaded: 0, executeNavigation: 0, built: 0 });
});

test('partial, failed, declined, unresolved, and recovered records retain their individual meanings', async ({ page }) => {
  for (const [mode, label] of [['partial', 'Execution partially completed'], ['failed', 'Execution failed'], ['declined', 'Transaction not submitted'], ['unresolved', 'Execution status unresolved'], ['recovered', 'Execution completed']] as const) {
    await page.evaluate(value => window.flofiRunDetailAcceptance.show(value), mode);
    await expect(page.locator('.dashboard-final-result')).toHaveText(label);
    await expect(page.getByRole('button', { name: /^(Retry|Execute workflow|Open current execution|Continue execution)$/ })).toHaveCount(0);
  }
  await expect(page.locator('.dashboard-recovery-summary')).toContainText('Recovered');
  await page.evaluate(() => window.flofiRunDetailAcceptance.show('restored'));
  await expect(page.locator('.dashboard-recovery-summary')).toContainText('Saved result restored');
  await expect(page.locator('.dashboard-recovery-tags')).not.toContainText('Recovered');
});

test('bridge settlement and CoW order IDs keep correct labels, amounts, networks and limitations', async ({ page }) => {
  await page.evaluate(() => window.flofiRunDetailAcceptance.show('bridge-pending'));
  await expect(page.locator('.dashboard-result-summary')).toContainText('In progress');
  await expect(page.locator('.execution-plan')).toContainText('Source transaction');
  await expect(page.locator('.execution-plan')).toContainText('Destination transaction');
  await expect(page.locator('.execution-plan')).not.toContainText('4.89 USDC');
  await expect(page.locator('.execution-plan').locator(`a[href="https://sepolia.arbiscan.io/tx/${detailDestinationHash}"]`)).toBeVisible();
  await page.evaluate(() => window.flofiRunDetailAcceptance.show('bridge-completed'));
  await expect(page.locator('.execution-plan')).toContainText('4.89 USDC');
  await expect(page.locator('.execution-plan')).toContainText('4.9 USDC');
  await page.evaluate(() => window.flofiRunDetailAcceptance.show('cow-pending'));
  await expect(page.locator('.execution-plan')).toContainText('Order ID');
  await expect(page.locator('.execution-plan')).toContainText('Orderbook reports bought');
  await expect(page.locator('.execution-plan')).not.toContainText('Action transaction');
  await expect(page.locator('.dashboard-evidence-limitations')).toContainText('CoW orderbook and settlement are scripted');
  await expect(page.getByRole('link', { name: 'View transaction', exact: true })).toHaveCount(0);
  await page.evaluate(() => window.flofiRunDetailAcceptance.show('cow-cancelled'));
  await expect(page.locator('.execution-plan')).toContainText('Cancellation requested');
});

test('copy keeps full transaction and order identifiers and handles unavailable clipboard', async ({ page }) => {
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { Object.assign(window, { runDetailCopied: value }); } } }));
  const transaction = page.getByRole('button', { name: `Copy transaction ${detailHash}`, exact: true }).first();
  await transaction.click(); await expect(transaction).toHaveText('Copied');
  expect(await page.evaluate(() => (window as unknown as { runDetailCopied: string }).runDetailCopied)).toBe(detailHash);
  await page.evaluate(() => window.flofiRunDetailAcceptance.show('cow-pending'));
  const order = page.getByRole('button', { name: `Copy order ${detailOrderId}`, exact: true }).first();
  await order.click(); expect(await page.evaluate(() => (window as unknown as { runDetailCopied: string }).runDetailCopied)).toBe(detailOrderId);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Fixture clipboard denied'); } } }));
  await order.click(); await expect(page.locator('.execution-plan')).toContainText(`Copy unavailable. Order ID: ${detailOrderId}`);
  await page.setViewportSize({ width: 320, height: 1000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('not-found, unavailable history and missing legacy detail remain distinct without mutation actions', async ({ page }) => {
  await page.evaluate(() => window.flofiRunDetailAcceptance.show('not-found'));
  await expect(page.getByRole('heading', { name: 'Run not found', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload details', exact: true })).toHaveCount(0);
  await page.evaluate(() => window.flofiRunDetailAcceptance.show('unavailable'));
  await expect(page.getByRole('heading', { name: 'Execution details temporarily unavailable', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reload details', exact: true }).click();
  expect(await page.evaluate(() => window.flofiRunDetailAcceptance.counts().reloaded)).toBe(1);
  await page.evaluate(() => window.flofiRunDetailAcceptance.show('legacy'));
  await expect(page.getByRole('region', { name: 'Recorded requests', exact: true })).toContainText('Original workflow details are unavailable');
  await expect(page.getByRole('list', { name: 'Workflow step progression' })).toHaveCount(0);
  await expect(page.locator('.dashboard-result-summary')).not.toContainText('Steps confirmed');
  await expect(page.locator('.dashboard-run-detail')).not.toContainText('Actual received');
  await page.evaluate(() => window.flofiRunDetailAcceptance.show('archive-unavailable'));
  await expect(page.locator('.dashboard-run-evidence')).toContainText('Archived evidence could not be loaded');
  await expect(page.locator('.execution-plan')).toContainText('0.0243 WETH');
});

for (const theme of ['light', 'dark'] as const) test(`${theme} Run Details preserves tokens, branding and overflow at desktop and narrow widths`, async ({ page }) => {
  await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
  expect(await page.locator('.dashboard-result-summary').evaluate(element => {
    const sample = document.createElement('div'); sample.style.backgroundColor = 'var(--paper)'; document.body.append(sample);
    const same = getComputedStyle(sample).backgroundColor === getComputedStyle(element).backgroundColor; sample.remove(); return same;
  })).toBe(true);
  expect(await page.locator('img.brand-icon').evaluateAll(images => images.every(image => getComputedStyle(image).filter === 'none'))).toBe(true);
  for (const mode of ['completed', 'partial', 'bridge-completed', 'cow-pending', 'legacy'] as const) {
    await page.evaluate(value => window.flofiRunDetailAcceptance.show(value), mode);
    for (const width of [1440, 1024, 820, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
  await page.evaluate(() => window.flofiRunDetailAcceptance.show('completed'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: `.tmp/ux006c-run-completed-${theme}.png`, fullPage: true });
  await page.evaluate(() => { window.flofiRunDetailAcceptance.show('partial'); window.flofiRunDetailAcceptance.longTitle(); });
  await page.setViewportSize({ width: 320, height: 1000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('.dashboard-detail-heading h1').evaluate(element => element.getAttribute('title') === element.textContent && element.getBoundingClientRect().height <= parseFloat(getComputedStyle(element).lineHeight) * 3 + 1)).toBe(true);
  await page.getByText('View technical details', { exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.tmp/ux006c-run-partial-${theme}-320.png`, fullPage: true });
});
