// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { reviewNow } from '../src/test-utils/review-fixture';

// Mount real Summary/Review components to test effects, native buttons and prop updates.
// These normalized fixtures do not claim to exercise RPC or wallet signatures.
let bundle: string;
const browserErrors = new WeakMap<Page, string[]>();
test.beforeAll(async () => {
  const result = await build({ root: fileURLToPath(new URL('../../../', import.meta.url)), configFile: false, logLevel: 'error',
    // Use the same SHA implementation that Next provides to these client components.
    resolve: { alias: {
      'node:crypto': fileURLToPath(new URL('../node_modules/next/dist/compiled/crypto-browserify/index.js', import.meta.url)),
      buffer: fileURLToPath(new URL('../node_modules/next/dist/compiled/buffer/index.js', import.meta.url)),
      'node:buffer': fileURLToPath(new URL('../node_modules/next/dist/compiled/buffer/index.js', import.meta.url)),
      stream: fileURLToPath(new URL('../node_modules/next/dist/compiled/stream-browserify/index.js', import.meta.url)),
      events: fileURLToPath(new URL('../node_modules/next/dist/compiled/events/events.js', import.meta.url)),
      string_decoder: fileURLToPath(new URL('../node_modules/next/dist/compiled/string_decoder/string_decoder.js', import.meta.url)),
      util: fileURLToPath(new URL('../node_modules/next/dist/compiled/util/util.js', import.meta.url)),
      vm: fileURLToPath(new URL('../node_modules/next/dist/compiled/vm-browserify/index.js', import.meta.url)),
      process: fileURLToPath(new URL('../node_modules/next/dist/compiled/process/browser.js', import.meta.url)),
    } },
    define: { 'process.env.NODE_ENV': '"production"', __dirname: '"/"', global: 'globalThis' },
    build: { write: false, minify: false,
      rolldownOptions: { transform: { inject: { Buffer: ['buffer', 'Buffer'], process: 'process' } } },
      lib: { entry: fileURLToPath(new URL('../src/test-utils/review-acceptance-harness.tsx', import.meta.url)), name: 'FloFiReviewAcceptance', formats: ['iife'] } } });
  const outputs = Array.isArray(result) ? result : [result];
  const entry = outputs.flatMap(output => 'output' in output ? output.output : []).find(output => output.type === 'chunk' && output.isEntry);
  if (!entry || entry.type !== 'chunk') throw new Error('Acceptance component bundle missing');
  bundle = entry.code;
});
test.beforeEach(async ({ page }) => {
  const errors: string[] = []; browserErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/app');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  const styles = await page.locator('head link[rel="stylesheet"]').evaluateAll(links => links.map(link => link.outerHTML).join(''));
  await page.clock.install({ time: reviewNow });
  await page.route('**/__ux004-acceptance.js', route => route.fulfill({ contentType: 'application/javascript; charset=utf-8', body: bundle }));
  // A fresh document avoids leaving the Next shell's mounted roots and effects alive.
  await page.route('**/__ux004-acceptance', route => route.fulfill({ contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html data-theme="light"><head><meta charset="utf-8">${styles}</head><body><main class="main" aria-label="Simulation workspace"><div id="acceptance-root"></div></main><script src="/__ux004-acceptance.js"></script></body></html>` }));
  await page.goto('/__ux004-acceptance');
  await page.evaluate(() => (window as unknown as { FloFiReviewAcceptance: { mount(element: HTMLElement): void } }).FloFiReviewAcceptance.mount(document.getElementById('acceptance-root')!));
  await expect.poll(async () => errors.length > 0 || await page.locator('#simulation-review').count() > 0).toBe(true);
  expect(errors).toEqual([]);
  await expect(page.getByRole('button', { name: 'Approve & Continue', exact: true })).toBeEnabled();
  await page.waitForFunction(() => Boolean(window.flofiReviewAcceptance));
});
test.afterEach(({ page }) => { expect(browserErrors.get(page)).toEqual([]); });
test('live Review reveals after simulation, stays embedded and confirms only Review', async ({ page }) => {
  const review = page.getByRole('region', { name: 'Review & Authorization', exact: true });
  const url = page.url();
  await page.evaluate(() => window.flofiReviewAcceptance.transition('pending'));
  await expect(review).toContainText('Review unavailable until simulation is ready');
  await expect(review.getByRole('button', { name: 'Approve & Continue', exact: true })).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Simulation Summary' })).toContainText('No simulation yet');
  await page.evaluate(() => window.flofiReviewAcceptance.transition('loading'));
  await expect(page.getByRole('complementary', { name: 'Simulation Summary' })).toContainText('Simulating workflow…');
  await page.evaluate(() => window.flofiReviewAcceptance.transition('valid'));
  const approve = review.getByRole('button', { name: 'Approve & Continue', exact: true });
  await expect(approve).toBeEnabled();
  await approve.focus();
  await approve.press('Enter');
  await expect(review.getByRole('button', { name: 'Review approved', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.flofiReviewAcceptance.counts())).toEqual({ approved: 1, executed: 0, refreshed: 0, edited: 0 });
  expect(page.url()).toBe(url);
});
test('live expiry invalidates an approved Review without a render or navigation', async ({ page }) => {
  const review = page.getByRole('region', { name: 'Review & Authorization', exact: true });
  await review.getByRole('button', { name: 'Approve & Continue', exact: true }).click();
  await expect(review).toContainText('Review approved');
  await page.clock.fastForward(120_001);
  await expect(page.getByRole('complementary', { name: 'Simulation Summary' })).toContainText('Simulation expired');
  await expect(review).toContainText('Review unavailable until simulation is refreshed');
  await expect(review.getByRole('button', { name: 'Approve & Continue', exact: true })).toBeDisabled();
  await review.getByRole('button', { name: 'Simulate again', exact: true }).click();
  expect(await page.evaluate(() => window.flofiReviewAcceptance.counts())).toEqual({ approved: 1, executed: 0, refreshed: 1, edited: 0 });
});
test('expiry is checked at approval even when a background timer has not fired', async ({ page }) => {
  const review = page.getByRole('region', { name: 'Review & Authorization', exact: true });
  await page.clock.setSystemTime(reviewNow + 120_001); // Changes wall time without firing timeout callbacks.
  await review.getByRole('button', { name: 'Approve & Continue', exact: true }).click();
  expect((await page.evaluate(() => window.flofiReviewAcceptance.counts())).approved).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(review).toContainText('Simulation expired');
  await expect(review.getByRole('button', { name: 'Approve & Continue', exact: true })).toBeDisabled();
});
test('accepted Review fails closed on live workflow, policy, wallet and network changes', async ({ page }) => {
  const review = page.getByRole('region', { name: 'Review & Authorization', exact: true });
  const url = page.url();
  for (const change of ['workflow', 'policy', 'wallet', 'network', 'unknown-network', 'failed', 'blocked'] as const) {
    await page.evaluate(() => window.flofiReviewAcceptance.transition('valid'));
    await review.getByRole('button', { name: 'Approve & Continue', exact: true }).click();
    await expect(review).toContainText('Review approved');
    await page.evaluate(value => window.flofiReviewAcceptance.transition(value), change);
    await expect(review.getByRole('button', { name: 'Approve & Continue', exact: true })).toBeDisabled();
    await expect(review).not.toContainText('Review approved');
    if (change === 'wallet') {
      await expect(review).toContainText('0x2222…2222');
      await page.evaluate(() => window.flofiReviewAcceptance.transition('wallet-return'));
      await expect(review.getByRole('button', { name: 'Approve & Continue', exact: true })).toBeDisabled();
    }
    if (change === 'network') { await expect(review).toContainText('Arbitrum'); await expect(review).toContainText('Mainnet'); }
    if (change === 'unknown-network') { await expect(review).toContainText('Unknown network'); await expect(review).not.toContainText('Mainnet'); }
    expect(page.url()).toBe(url);
  }
  expect((await page.evaluate(() => window.flofiReviewAcceptance.counts())).executed).toBe(0);
  const main = await page.getByRole('main').innerText();
  expect(main).not.toMatch(/SIMULATION_FAILED|canonical|artifact|schemaVersion|undefined|null/);
});

for (const width of [320, 375, 390, 430]) {
  test(`mobile Review keeps the manifest and explicit confirmation readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 });
    const review = page.getByRole('region', { name: 'Review & Authorization', exact: true });
    await page.getByText('View technical details', { exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Strategy Manifest', exact: true })).toBeVisible();
    const approve = review.getByRole('button', { name: 'Approve & Continue', exact: true });
    await approve.scrollIntoViewIfNeeded();
    const box = (await approve.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await approve.focus();
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => window.flofiReviewAcceptance.counts())).toEqual({ approved: 1, executed: 0, refreshed: 0, edited: 0 });
    await page.evaluate(() => window.flofiReviewAcceptance.transition('wallet'));
    await expect(review.getByRole('button', { name: 'Approve & Continue', exact: true })).toBeDisabled();
    expect((await page.evaluate(() => window.flofiReviewAcceptance.counts())).executed).toBe(0);
  });
}
