// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { configureCanvasAction } from './composer-authoring-fixtures';
import type { Page } from '@playwright/test';
import { reviewNow } from '../src/test-utils/review-fixture';

// Mount Execute with a real read-only canvas to verify native clicks, expiry and wallet updates.
// These normalized fixtures do not claim to exercise RPC or wallet signatures.
let bundle: string;
const browserErrors = new WeakMap<Page, string[]>();
async function expectStageNavigationFits(page: Page) {
  const stages = await page.getByRole('navigation', { name: 'Workflow stages' }).locator('button').evaluateAll(buttons => buttons.map(button => {
    const range = document.createRange(); range.selectNodeContents(button);
    const content = range.getBoundingClientRect(), box = button.getBoundingClientRect();
    return { label: button.textContent, left: box.left, right: box.right, contentLeft: content.left, contentRight: content.right };
  }));
  for (const stage of stages) {
    expect(stage.contentLeft, stage.label ?? '').toBeGreaterThanOrEqual(stage.left);
    expect(stage.contentRight, stage.label ?? '').toBeLessThanOrEqual(stage.right);
  }
}
test.beforeAll(async () => {
  const result = await build({ root: fileURLToPath(new URL('../../../', import.meta.url)), configFile: false, logLevel: 'error',
    // Use the same SHA implementation that Next provides to these client components.
    resolve: { alias: {
      '../state/workflow-store': fileURLToPath(new URL('../src/test-utils/execute-acceptance-workflow.tsx', import.meta.url)),
      '../state/capability-store': fileURLToPath(new URL('../src/test-utils/execute-acceptance-workflow.tsx', import.meta.url)),
      '../state/uniswap-liquidity-store': fileURLToPath(new URL('../src/test-utils/execute-acceptance-workflow.tsx', import.meta.url)),
      '../state/solana-liquidity-store': fileURLToPath(new URL('../src/test-utils/execute-acceptance-workflow.tsx', import.meta.url)),
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
      lib: { entry: fileURLToPath(new URL('../src/test-utils/execute-acceptance-harness.tsx', import.meta.url)), name: 'FloFiExecuteAcceptance', formats: ['iife'] } } });
  const outputs = Array.isArray(result) ? result : [result];
  const entry = outputs.flatMap(output => 'output' in output ? output.output : []).find(output => output.type === 'chunk' && output.isEntry);
  if (!entry || entry.type !== 'chunk') throw new Error('Acceptance component bundle missing');
  bundle = entry.code;
});
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const NativeObserver = ResizeObserver;
    window.ResizeObserver = class extends NativeObserver {
      constructor(callback: ResizeObserverCallback) { super((entries, observer) => setTimeout(() => callback(entries, observer), 200)); }
    };
    const add = window.addEventListener.bind(window);
    window.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => {
      if (!listener) return;
      if (type !== 'resize') return add(type, listener, options);
      add(type, event => setTimeout(() => typeof listener === 'function' ? listener.call(window, event) : listener.handleEvent(event), 200), options);
    }) as typeof window.addEventListener;
  });
  const errors: string[] = []; browserErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/app');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  const styles = await page.locator('head link[rel="stylesheet"]').evaluateAll(links => links.map(link => link.outerHTML).join(''));
  const fontClasses = await page.locator('html').getAttribute('class');
  await page.clock.install({ time: reviewNow });
  await page.route('**/__ux005-acceptance.js', route => route.fulfill({ contentType: 'application/javascript; charset=utf-8', body: bundle }));
  // A fresh document avoids leaving the Next shell's mounted roots and effects alive.
  await page.route('**/__ux005-acceptance', route => route.fulfill({ contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html class="${fontClasses ?? ''}" data-theme="light"><head><meta charset="utf-8">${styles}</head><body><div class="app-shell"><main class="main" aria-label="Execution workspace"><div id="acceptance-root"></div></main></div><script src="/__ux005-acceptance.js"></script></body></html>` }));
  await page.goto('/__ux005-acceptance');
  await page.evaluate(() => (window as unknown as { FloFiExecuteAcceptance: { mount(element: HTMLElement): void } }).FloFiExecuteAcceptance.mount(document.getElementById('acceptance-root')!));
  await expect.poll(async () => errors.length > 0 || await page.locator('.execution-summary').count() > 0).toBe(true);
  expect(errors).toEqual([]);
  await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toBeEnabled();
  await page.waitForFunction(() => Boolean(window.flofiExecuteAcceptance));
});
test.afterEach(({ page }) => { expect(browserErrors.get(page)).toEqual([]); });

test('Dark authorization attention follows real approval, invalidation and expiry without changing readiness', async ({ page }) => {
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  const execute = page.getByRole('button', { name: 'Execute workflow', exact: true });
  await expect(execute).toBeEnabled();
  await expect(page.locator('.execution-authorization-attention')).toHaveCount(0);
  for (const change of ['unapproved', 'wallet'] as const) {
    await page.evaluate(value => window.flofiExecuteAcceptance.transition(value), change);
    await expect(execute).toBeDisabled();
    await expect(page.locator('.execution-authorization-attention')).toHaveCSS('background-color', 'rgb(51, 39, 15)');
    await expect(page.locator('.execution-authorization-attention')).toHaveCSS('color', 'rgb(245, 185, 74)');
    await expect(page.locator('.simulation-validity strong')).toHaveCSS('color', 'rgb(245, 185, 74)');
    await page.evaluate(() => window.flofiExecuteAcceptance.transition('valid'));
    await expect(execute).toBeEnabled();
    await expect(page.locator('.execution-authorization-attention')).toHaveCount(0);
  }
  await page.clock.setSystemTime(reviewNow + 120_001);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.execution-authorization-attention')).toHaveText('Expired');
  await expect(page.locator('.simulation-validity')).toHaveCSS('background-color', 'rgb(51, 39, 15)');
  await expect(page.locator('.simulation-validity strong')).toHaveCSS('color', 'rgb(245, 185, 74)');
  await expect(execute).toHaveCSS('color', 'rgb(164, 171, 184)');
  await expect(execute).toHaveCSS('opacity', '1');
  await expect(execute).toBeDisabled();
  expect((await page.evaluate(() => window.flofiExecuteAcceptance.counts())).executed).toBe(0);
  await page.screenshot({ path: '.tmp/ux007-team3-authorization-dark.png', fullPage: true });
});

test('execution starts only on an explicit native click and cannot be repeated', async ({ page }) => {
  const execute = page.getByRole('button', { name: 'Execute workflow', exact: true });
  expect((await page.evaluate(() => window.flofiExecuteAcceptance.counts())).executed).toBe(0);
  await execute.focus(); await execute.press('Enter');
  await expect(execute).toBeDisabled(); await expect(page.getByRole('complementary', { name: 'Execution Summary' })).toContainText('Execution already started');
  expect((await page.evaluate(() => window.flofiExecuteAcceptance.counts())).executed).toBe(1);
});
test('expiry updates readiness without navigation and is rechecked at the click boundary', async ({ page }) => {
  const execute = page.getByRole('button', { name: 'Execute workflow', exact: true });
  await page.clock.setSystemTime(reviewNow + 120_001);
  await execute.click(); expect((await page.evaluate(() => window.flofiExecuteAcceptance.counts())).executed).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(execute).toBeDisabled(); await expect(page.getByRole('complementary', { name: 'Execution Summary' })).toContainText('Simulation expired');
  await page.getByRole('button', { name: 'Simulate again', exact: true }).click();
  expect((await page.evaluate(() => window.flofiExecuteAcceptance.counts())).simulated).toBe(1);
});
test('authorization, wallet, network and workflow transitions stay fail-closed', async ({ page }) => {
  const execute = page.getByRole('button', { name: 'Execute workflow', exact: true });
  for (const change of ['unapproved', 'blocked', 'wallet', 'network', 'unknown', 'workflow'] as const) {
    await page.evaluate(() => window.flofiExecuteAcceptance.transition('valid'));
    await expect(execute).toBeEnabled();
    await page.evaluate(value => window.flofiExecuteAcceptance.transition(value), change);
    await expect(execute).toBeDisabled();
    if (change === 'wallet') await expect(page.locator('.execution-summary')).toContainText('0x2222…2222');
    if (change === 'network') { await expect(page.locator('.execution-summary')).toContainText('Arbitrum'); await expect(page.locator('.execution-summary')).toContainText('Mainnet'); }
    if (change === 'unknown') { await expect(page.locator('.execution-summary')).toContainText('Unknown network'); await expect(page.locator('.execution-summary')).not.toContainText('Mainnet'); }
  }
  expect((await page.evaluate(() => window.flofiExecuteAcceptance.counts())).executed).toBe(0);
});
for (const theme of ['light', 'dark']) test(`${theme} plan, brand icons and responsive workspace`, async ({ page }) => {
  await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
  await expect(page.locator('.execute-heading')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Run your workflow', exact: true })).toHaveCount(0);
  await expect(page.getByText('Check the plan and connected wallet before starting.', { exact: true })).toHaveCount(0);
  const graph = page.getByRole('region', { name: 'Execution workflow graph', exact: true });
  await expect(graph).toHaveAttribute('data-viewport', 'fitted');
  await expect(graph.locator('.composer-amount')).toHaveText('100 USDC');
  await expect(graph.locator('.composer-card input,.composer-card select')).toHaveCount(0);
  for (const label of ['Advanced Settings', 'Delete', 'Duplicate', 'Undo', 'Redo']) await expect(graph.getByRole('button', { name: label, exact: true })).toHaveCount(0);
  expect(await graph.locator('img.brand-icon').evaluateAll(images => images.every(image => getComputedStyle(image).filter === 'none'))).toBe(true);
  const iconSize = await page.locator('.execution-summary img.brand-icon').evaluate(image => ({ width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height, filter: getComputedStyle(image).filter }));
  expect(iconSize).toEqual({ width: 18, height: 18, filter: 'none' });
  const canvas = page.locator('.simulation-workflow-canvas');
  await expect(canvas.getByRole('button', { name: 'Back to Build', exact: true })).toBeVisible();
  await expect(canvas.getByRole('button', { name: 'Execute workflow', exact: true })).toBeVisible();
  await expect(page.locator('.execution-summary').getByRole('button', { name: 'Execute workflow', exact: true })).toHaveCount(0);
  const ctaStyle = await page.getByRole('button', { name: 'Execute workflow', exact: true }).evaluate(button => ({ height: button.getBoundingClientRect().height, radius: getComputedStyle(button).borderRadius }));
  expect(ctaStyle.height).toBeGreaterThanOrEqual(42); expect(ctaStyle.radius).toBe('7px');
  for (const width of [1440, 1280, 1024, 820, 768, 390, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    // CSS resizes before React Flow's resize handlers commit the navigator mode.
    // Wait for the read-only canvas's existing 1024/400px modes to match its actual
    // pane, then keep every geometry assertion below independent and unchanged.
    await expect.poll(() => graph.evaluate(element => {
      const pane = element.querySelector<HTMLElement>('.react-flow')!;
      const navigator = element.querySelector<HTMLElement>('.canvas-navigator')!;
      return navigator.dataset.compact === String(pane.offsetWidth < 1024)
        && navigator.dataset.narrow === String(pane.offsetWidth < 400);
    }), { message: 'Canvas navigator has consumed the current pane resize' }).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const spacing = await page.locator('.execute-workspace').evaluate(element => {
      const main = element.closest('main')!;
      return { top: element.getBoundingClientRect().top, gridTop: element.querySelector('.execute-workspace-grid')!.getBoundingClientRect().top, contentTop: main.getBoundingClientRect().top + parseFloat(getComputedStyle(main).paddingTop) };
    });
    expect(spacing.gridTop).toBe(spacing.top); expect(spacing.top).toBe(spacing.contentTop);
    const plan = await page.getByRole('region', { name: 'Execution plan', exact: true }).boundingBox();
    const summary = await page.getByRole('complementary', { name: 'Execution Summary' }).boundingBox();
    expect(plan).not.toBeNull(); expect(summary).not.toBeNull();
    expect(plan!.y).toBe(spacing.gridTop);
    if (width > 900) expect(plan!.x + plan!.width).toBeLessThan(summary!.x);
    else expect(plan!.y + plan!.height).toBeLessThan(summary!.y);
    await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toBeEnabled();
    const boxes = await canvas.evaluate(element => {
      const rect = (el: Element) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
      const back = [...element.querySelectorAll('button')].find(b => b.textContent === 'Back to Build')!;
      const execute = [...element.querySelectorAll('button')].find(b => b.textContent === 'Execute workflow')!;
      return { back: rect(back), execute: rect(execute), surface: rect(element.querySelector('.flow-surface')!), controls: rect(element.querySelector('.canvas-navigator')!), footer: rect(element.querySelector('.canvas-foot')!), attribution: rect(element.querySelector('.react-flow__attribution')!) };
    });
    console.log('LAYOUT-DIAGNOSTIC', JSON.stringify({ width, boxes, environment: await page.evaluate(() => ({ dpr: devicePixelRatio, innerWidth, fonts: document.fonts.status, flowWidth: document.querySelector('.react-flow')!.getBoundingClientRect().width, compact: document.querySelector('.canvas-navigator')?.getAttribute('data-compact'), animations: document.getAnimations().length })) }));
    expect(boxes.back.left).toBeLessThan(boxes.execute.left); expect(boxes.back.right).toBeLessThanOrEqual(boxes.execute.left);
    expect(Math.abs(boxes.back.top - boxes.execute.top)).toBeLessThan(2);
    expect(boxes.controls.right <= boxes.back.left || boxes.controls.bottom <= boxes.back.top, JSON.stringify({ width, boxes })).toBe(true);
    expect(boxes.back.left).toBeGreaterThan(boxes.surface.left);
    expect(boxes.execute.bottom).toBeLessThan(boxes.footer.top); expect(boxes.execute.bottom).toBeLessThan(boxes.attribution.top);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: `.tmp/ux005e-canvas-${theme}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Back to Build', exact: true }).click();
  expect((await page.evaluate(() => window.flofiExecuteAcceptance.counts())).edited).toBe(1);
  expect((await page.evaluate(() => window.flofiExecuteAcceptance.counts())).executed).toBe(0);
});

test('the real shell preserves Build and embedded Review while Execute stays read-only and idle', async ({ page }) => {
  await page.addInitScript(() => {
    const requests: string[] = [];
    Object.assign(window, { executeWorkspaceRequests: requests, ethereum: {
      isMetaMask: true,
      async request({ method }: { method: string }) {
        requests.push(method);
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return ['0x1111111111111111111111111111111111111111'];
        if (method === 'eth_chainId') return '0x14a34';
        throw Error(`Unexpected wallet method: ${method}`);
      }, on() {}, removeListener() {},
    } });
  });
  await page.goto('/app');
  // This provider already exposes an account. Wait for the shared wallet's passive reuse;
  // the transient Connect button disappears during hydration.
  await expect(page.locator('.build009-wallet-info')).toBeVisible();
  await page.getByRole('button', { name: 'Add swap', exact: true }).click(); await configureCanvasAction(page, '2.5');
  await page.getByRole('button', { name: 'Simulate fees', exact: true }).click();
  await expect(page.locator('#simulation-review')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Review', exact: true })).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.locator('.execute-heading')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your Workflow', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Execution Summary', exact: true })).toBeVisible();
  const graph = page.getByRole('region', { name: 'Execution workflow graph', exact: true });
  await expect(graph).toHaveAttribute('data-viewport', 'fitted');
  await expect(graph.locator('.composer-amount')).toHaveText('2.5 USDC');
  await expect(graph.locator('.composer-card input,.composer-card select')).toHaveCount(0);
  await expect(page.locator('.execution-summary')).toContainText('Base Sepolia');
  await expect(page.locator('.execution-summary')).toContainText('Testnet');
  await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toBeDisabled();
  await expect(page.locator('#simulation-review')).toHaveCount(0);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    await expect(page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Execute', exact: true })).toHaveClass('selected');
    for (const width of [1440, 1024, 768, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const spacing = await page.locator('.execute-workspace').evaluate(element => {
        const main = element.closest('main')!;
        return { top: element.querySelector('.execute-workspace-grid')!.getBoundingClientRect().top, contentTop: main.getBoundingClientRect().top + parseFloat(getComputedStyle(main).paddingTop) };
      });
      expect(spacing.top).toBe(spacing.contentTop);
      await expectStageNavigationFits(page);
      await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toBeDisabled();
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(await page.evaluate(() => (window as unknown as { executeWorkspaceRequests: string[] }).executeWorkspaceRequests.filter(method => /send|sign/i.test(method)))).toEqual([]);
  await page.getByRole('button', { name: 'Back to Simulate', exact: true }).click(); await expect(page.locator('#simulation-review')).toBeVisible();
  await page.setViewportSize({ width: 320, height: 900 }); await expectStageNavigationFits(page);
  await page.getByRole('button', { name: 'Back to Build', exact: true }).click();
  await expectStageNavigationFits(page);
  await expect(page.locator('.build-flow-surface .composer-card')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Source amount (USDC)', exact: true })).toHaveValue('2.5');
});

// Lifecycle acceptance uses real record shapes and native DOM interactions, without RPC submission.
test('synchronous repeated clicks cannot duplicate a request before runtime state catches up', async ({ page }) => {
  await page.evaluate(() => { window.flofiExecuteAcceptance.holdStart(); const button = [...document.querySelectorAll('button')].find(b => b.textContent === 'Execute workflow')!; button.click(); button.click(); });
  expect((await page.evaluate(() => window.flofiExecuteAcceptance.counts())).executed).toBe(1);
  await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toBeDisabled();
});
test('approval, submitted action and confirmation remain ordered with explicit continuation', async ({ page }) => {
  await page.evaluate(() => window.flofiExecuteAcceptance.lifecycle('approval-pending'));
  const plan = page.getByRole('region', { name: 'Execution plan', exact: true });
  await expect(plan).toContainText('Approve USDC'); await expect(plan).toContainText('Pending confirmation'); await expect(plan).toContainText('Waiting');
  await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Execution in progress', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Check status', exact: true })).toHaveClass('primary');
  await page.evaluate(() => window.flofiExecuteAcceptance.lifecycle('approval-confirmed'));
  const next = page.getByRole('button', { name: 'Continue to swap', exact: true }); await expect(next).toBeEnabled();
  expect((await page.evaluate(() => window.flofiExecuteAcceptance.counts())).executed).toBe(0);
  await page.evaluate(() => { const button = [...document.querySelectorAll('button')].find(b => b.textContent === 'Continue to swap')!; button.click(); button.click(); });
  expect((await page.evaluate(() => window.flofiExecuteAcceptance.counts())).executed).toBe(1);
  await expect(next).toHaveCount(0);
  await page.evaluate(() => window.flofiExecuteAcceptance.lifecycle('swap-pending')); await expect(plan).toContainText('Pending confirmation');
  await page.evaluate(() => window.flofiExecuteAcceptance.lifecycle('swap-confirmed')); await expect(plan).toContainText('Confirmed');
  await expect(page.locator('.execution-summary')).toContainText('1 of 1');
  await expect(page.locator('.execution-summary')).toContainText('Execution completed');
  await expect(page.getByRole('button', { name: 'Return to Build', exact: true })).toBeEnabled();
});
test('failure, uncertainty and restored execution never regain the initial Execute CTA', async ({ page }) => {
  for (const state of ['failed', 'uncertain', 'restored'] as const) {
    await page.evaluate(value => window.flofiExecuteAcceptance.lifecycle(value), state);
    await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toHaveCount(0);
    if (state === 'failed') await expect(page.locator('.execution-summary')).toContainText('Execution failed');
    if (state === 'uncertain') { await expect(page.locator('.execution-summary')).toContainText('Execution status unresolved'); await expect(page.getByRole('button', { name: /Retry|Check confirmation|Continue to/ })).toHaveCount(0); }
    if (state === 'restored') await expect(page.getByRole('region', { name: 'Execution plan', exact: true })).toContainText('No new request has been sent');
  }
  expect((await page.evaluate(() => window.flofiExecuteAcceptance.counts())).executed).toBe(0);
});

for (const theme of ['light', 'dark']) test(`${theme} final evidence, actual values, copy and secondary technical records`, async ({ page }) => {
  await page.evaluate(value => { document.documentElement.dataset.theme = value; window.flofiExecuteAcceptance.evidence('reconciled'); }, theme);
  const summary = page.getByRole('complementary', { name: 'Execution result summary' });
  await expect(summary).toContainText('Execution completed'); await expect(summary).toContainText('0.0003 ETH'); await expect(summary).toContainText('1 step reconciled');
  const plan = page.getByRole('region', { name: 'Execution plan', exact: true });
  await expect(plan).toContainText('Actual received'); await expect(plan).toContainText('0.0243 WETH');
  await expect(plan).toContainText('0.025 WETH'); await expect(plan).toContainText('Planned'); await expect(plan).toContainText('Actual');
  await expect(plan).toContainText('Approval transaction'); await expect(plan).toContainText('Action transaction');
  const details = page.locator('.execute-technical'); await expect(details).not.toHaveAttribute('open', '');
  await expect(page.getByText('Current execution record', { exact: true })).not.toBeVisible();
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async writeText(value: string) { Object.assign(window, { copiedExecutionIdentifier: value }); } } }); });
  await plan.getByRole('button', { name: `Copy transaction ${'0x' + 'b'.repeat(64)}`, exact: true }).click();
  await expect(plan.getByRole('button', { name: `Copy transaction ${'0x' + 'b'.repeat(64)}`, exact: true })).toHaveText('Copied');
  expect(await page.evaluate(() => (window as unknown as { copiedExecutionIdentifier: string }).copiedExecutionIdentifier)).toBe('0x' + 'b'.repeat(64));
  await page.getByText('View technical details', { exact: true }).click();
  await expect(page.getByText('Current execution record', { exact: true })).toBeVisible(); await expect(details).toContainText('acceptance-evidence');
  for (const width of [1280, 820, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await plan.locator('img.brand-icon').evaluateAll(images => images.every(image => getComputedStyle(image).filter === 'none'))).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 1000 }); await page.screenshot({ path: `.tmp/ux005e-result-${theme}.png`, fullPage: true });
  await expect(page.getByRole('button', { name: /Retry|Continue to|Execute workflow/ })).toHaveCount(0);
  expect((await page.evaluate(() => window.flofiExecuteAcceptance.counts())).executed).toBe(0);
});

test('bridge source evidence does not claim destination settlement before reconciliation', async ({ page }) => {
  await page.evaluate(() => window.flofiExecuteAcceptance.evidence('bridge-pending'));
  const plan = page.getByRole('region', { name: 'Execution plan', exact: true });
  await expect(plan).toContainText('Source transaction'); await expect(plan).toContainText('Executed input');
  await expect(plan.locator('.execution-step-context img.brand-icon')).toHaveCount(2);
  expect(await plan.locator('.execution-step-context img.brand-icon').evaluateAll(images => images.map(image => ({ width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height, filter: getComputedStyle(image).filter })))).toEqual([{ width: 18, height: 18, filter: 'none' }, { width: 18, height: 18, filter: 'none' }]);
  await expect(plan).not.toContainText('Actual received'); await expect(page.locator('.execution-summary')).not.toContainText('Execution completed');
  await page.evaluate(() => window.flofiExecuteAcceptance.evidence('bridge-reconciled'));
  await expect(plan).toContainText('Destination transaction'); await expect(plan).toContainText('Reconciled'); await expect(plan).toContainText('4.89 USDC');
  await expect(plan.getByRole('link', { name: 'View transaction' })).toHaveCount(2);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    await page.setViewportSize({ width: 820, height: 900 }); await page.getByText('View technical details', { exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByText('View technical details', { exact: true }).click();
  }
});
test('signed order IDs and long provider references stay distinct from transaction hashes', async ({ page }) => {
  await page.evaluate(() => window.flofiExecuteAcceptance.evidence('cow-pending'));
  const plan = page.getByRole('region', { name: 'Execution plan', exact: true });
  await expect(plan).toContainText('Order ID'); await expect(plan).toContainText('Settlement pending');
  await expect(plan).toContainText('Orderbook reports bought'); await expect(plan).toContainText('await settlement verification');
  await expect(plan).not.toContainText('Scripted received');
  await expect(plan).not.toContainText('Action transaction'); await expect(plan.getByRole('link', { name: 'View transaction' })).toHaveCount(0);
  await expect(page.locator('.execution-summary')).not.toContainText('Execution completed');
  await page.evaluate(() => window.flofiExecuteAcceptance.evidence('cow-reconciled'));
  await expect(plan).toContainText('Reconciled'); await expect(page.locator('.execution-summary')).toContainText('No public settlement or funds are observed');
  await expect(plan).toContainText('Scripted received'); await expect(plan).toContainText('0.0243 WETH');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    await page.setViewportSize({ width: 390, height: 900 }); await page.getByText('View technical details', { exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByText('View technical details', { exact: true }).click();
  }
  await expect(page.getByRole('button', { name: /Retry|Execute workflow/ })).toHaveCount(0);
  expect((await page.evaluate(() => window.flofiExecuteAcceptance.counts())).executed).toBe(0);
});
test('partial, declined, attention and recovered results retain their actual step truth', async ({ page }) => {
  await page.evaluate(() => window.flofiExecuteAcceptance.evidence('partial'));
  await expect(page.locator('.execution-summary')).toContainText('Execution partially completed'); await expect(page.locator('.execution-summary')).toContainText('1 of 2');
  await expect(page.locator('.execution-step').nth(0)).toContainText('Reconciled'); await expect(page.locator('.execution-step').nth(1)).toContainText('Transaction reverted');
  await expect(page.locator('.execution-summary')).not.toContainText('Execution completed');
  await page.evaluate(() => window.flofiExecuteAcceptance.evidence('declined'));
  await expect(page.locator('.execution-summary')).toContainText('Transaction not submitted'); await expect(page.locator('.execution-plan')).toContainText('Wallet confirmation was declined');
  await expect(page.locator('.execution-plan')).not.toContainText('Action transaction');
  await page.evaluate(() => window.flofiExecuteAcceptance.evidence('attention'));
  await expect(page.locator('.execution-summary')).toContainText('Execution completed with attention');
  await page.evaluate(() => window.flofiExecuteAcceptance.evidence('recovered'));
  await expect(page.locator('.execution-summary')).toContainText('2 of 2'); await expect(page.locator('.execution-summary')).toContainText('1 step recovered');
  await expect(page.locator('.execution-evidence-recovered')).toHaveText('Recovered');
  await expect(page.getByRole('button', { name: /Retry|Execute workflow|Continue to/ })).toHaveCount(0);
  expect((await page.evaluate(() => window.flofiExecuteAcceptance.counts())).executed).toBe(0);
});
for (const theme of ['light', 'dark']) test(`${theme} execution timeline, long hashes and stacked widths`, async ({ page }) => {
  await page.evaluate(value => { document.documentElement.dataset.theme = value; window.flofiExecuteAcceptance.lifecycle('swap-pending'); }, theme);
  for (const width of [1440, 1280, 1024, 820, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const plan = await page.getByRole('region', { name: 'Execution plan', exact: true }).boundingBox();
    const summary = await page.getByRole('complementary', { name: 'Execution Summary' }).boundingBox();
    if (width > 900) expect(plan!.x + plan!.width).toBeLessThan(summary!.x); else expect(plan!.y + plan!.height).toBeLessThan(summary!.y);
    const brandStyle = await page.locator('.execution-step-context .brand-icon').evaluate(image => ({ filter: getComputedStyle(image).filter, width: image.getBoundingClientRect().width }));
    expect(brandStyle).toEqual({ filter: 'none', width: 18 });
    await expect(page.getByRole('button', { name: 'Check status', exact: true })).toBeVisible();
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: `.tmp/ux005e-recovery-${theme}.png`, fullPage: true });
});

test('wallet, network, workflow and expiry invalidate a next request without discarding recorded progress', async ({ page }) => {
  for (const value of ['wallet', 'network', 'workflow', 'disconnect'] as const) {
    await page.evaluate(() => { window.flofiExecuteAcceptance.transition('valid'); window.flofiExecuteAcceptance.lifecycle('approval-confirmed'); });
    await expect(page.getByRole('button', { name: 'Continue to swap', exact: true })).toBeEnabled();
    await page.evaluate(change => window.flofiExecuteAcceptance.binding(change), value);
    await expect(page.getByRole('button', { name: 'Continue to swap', exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Execution plan', exact: true })).toContainText('Approve USDC');
    await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toHaveCount(0);
  }
  await page.evaluate(() => { window.flofiExecuteAcceptance.transition('valid'); window.flofiExecuteAcceptance.lifecycle('approval-confirmed'); });
  await expect(page.getByRole('button', { name: 'Continue to swap', exact: true })).toBeEnabled();
  await page.clock.setSystemTime(reviewNow + 120_001);
  await page.getByRole('button', { name: 'Continue to swap', exact: true }).click();
  expect((await page.evaluate(() => window.flofiExecuteAcceptance.counts())).executed).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: 'Continue to swap', exact: true })).toHaveCount(0);
});

test('status checks are explicit, locked and can confirm the recorded run without resubmission', async ({ page }) => {
  await page.evaluate(() => window.flofiExecuteAcceptance.lifecycle('restored'));
  const check = page.getByRole('button', { name: 'Check status', exact: true });
  await expect(check).toBeEnabled();
  await page.evaluate(() => { const button = [...document.querySelectorAll('button')].find(b => b.textContent === 'Check status')!; button.click(); button.click(); });
  expect((await page.evaluate(() => window.flofiExecuteAcceptance.counts())).checked).toBe(1);
  await expect(page.getByRole('button', { name: 'Checking status…', exact: true })).toBeDisabled();
  await expect(page.locator('.execution-summary')).toContainText('Checking execution status');
  await expect(page.locator('.execution-timeline')).toContainText('Checking status');
  await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toHaveCount(0);
  await page.clock.resume();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    await page.screenshot({ path: `.tmp/ux005e-checking-${theme}.png`, fullPage: true, animations: 'disabled', timeout: 10000 });
  }
  await page.evaluate(() => window.flofiExecuteAcceptance.finishCheck());
  await expect(page.locator('.execution-summary')).toContainText('Execution completed');
  await expect(page.locator('.execution-summary')).toContainText('1 of 1');
  expect((await page.evaluate(() => window.flofiExecuteAcceptance.counts())).executed).toBe(0);
});
test('an unresolved or unsuccessful check preserves uncertainty and never offers retry', async ({ page }) => {
  for (const outcome of ['uncertain', 'error'] as const) {
    await page.evaluate(value => { window.flofiExecuteAcceptance.transition('valid'); window.flofiExecuteAcceptance.lifecycle('restored'); window.flofiExecuteAcceptance.checkOutcome(value); }, outcome);
    await page.getByRole('button', { name: 'Check status', exact: true }).click();
    await page.evaluate(() => window.flofiExecuteAcceptance.finishCheck());
    if (outcome === 'uncertain') await expect(page.locator('.execution-summary')).toContainText('Execution status unresolved');
    else { await expect(page.locator('.execution-summary')).toContainText('Unable to check execution status'); await expect(page.locator('.execution-timeline')).toContainText('Pending confirmation'); }
    await expect(page.getByRole('button', { name: /Retry|Try again|Execute workflow/ })).toHaveCount(0);
  }
  expect((await page.evaluate(() => window.flofiExecuteAcceptance.counts())).executed).toBe(0);
});
test('remount after reload keeps the same pending record and its confirmed approval', async ({ page }) => {
  await page.evaluate(() => window.flofiExecuteAcceptance.lifecycle('restored'));
  await page.reload();
  await page.evaluate(() => (window as unknown as { FloFiExecuteAcceptance: { mount(element: HTMLElement): void } }).FloFiExecuteAcceptance.mount(document.getElementById('acceptance-root')!));
  await expect(page.locator('.execution-timeline')).toContainText('Approve USDC');
  await expect(page.locator('.execution-timeline')).toContainText('Pending confirmation');
  await expect(page.locator('.execution-summary')).toContainText('Current execution restored');
  await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toHaveCount(0);
  expect((await page.evaluate(() => window.flofiExecuteAcceptance.counts())).executed).toBe(0);
});

test('wallet interaction, submission and confirmation show only recorded lifecycle truth', async ({ page }) => {
  await page.evaluate(() => window.flofiExecuteAcceptance.lifecycle('wallet'));
  await expect(page.locator('.execution-summary')).toContainText('Waiting for wallet…');
  await expect(page.locator('.execution-summary')).toContainText('Confirm or decline the reviewed request');
  await expect(page.locator('.execution-timeline')).toContainText('Confirm in wallet');
  await expect(page.getByRole('button', { name: /Continue to|Execute workflow|Check status|Retry/ })).toHaveCount(0);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    await page.screenshot({ path: `.tmp/ux005e-wallet-${theme}.png`, fullPage: true });
  }
  await page.evaluate(() => window.flofiExecuteAcceptance.lifecycle('submitting'));
  await expect(page.locator('.execution-summary')).toContainText('Submitting transaction…');
  await expect(page.locator('.execution-summary')).toContainText('Confirmation is not yet known');
  await expect(page.locator('.execution-timeline')).toContainText('Submitting');
  await expect(page.locator('.execution-timeline')).not.toContainText('Action transaction');
  await page.evaluate(() => window.flofiExecuteAcceptance.lifecycle('submitted'));
  await expect(page.locator('.execution-timeline')).toContainText('Transaction submitted');
  await page.evaluate(() => window.flofiExecuteAcceptance.lifecycle('swap-pending'));
  await expect(page.locator('.execution-timeline')).toContainText('Pending confirmation');
  await expect(page.locator('.execution-timeline')).toContainText('Planned');
  await page.evaluate(() => window.flofiExecuteAcceptance.lifecycle('swap-confirmed'));
  await expect(page.locator('.execution-summary')).toContainText('Execution completed');
  await expect(page.locator('.execution-timeline')).not.toContainText('Actual received');
  await expect(page.getByRole('group', { name: 'Planned and actual values' })).toHaveCount(0);
  await expect(page.locator('.execution-summary')).not.toContainText('Known network cost');
  expect((await page.evaluate(() => window.flofiExecuteAcceptance.counts())).executed).toBe(0);
});

test('safe status checks and continuation each have one primary action', async ({ page }) => {
  await page.evaluate(() => window.flofiExecuteAcceptance.lifecycle('restored'));
  const summary = page.locator('.execution-summary');
  await expect(summary.locator('button.primary')).toHaveCount(1);
  await expect(summary.getByRole('button', { name: 'Check status', exact: true })).toHaveClass('primary');
  await expect(summary).not.toContainText('Authorization');
  await page.getByRole('button', { name: 'Check status', exact: true }).click();
  await expect(summary.getByRole('button', { name: 'Checking status…', exact: true })).toBeDisabled();
  await expect(summary.locator('button.primary')).toHaveCount(1);
  await page.evaluate(() => window.flofiExecuteAcceptance.finishCheck());
  await expect(summary.getByRole('button', { name: 'Return to Build', exact: true })).toHaveClass('primary');
  await page.evaluate(() => { window.flofiExecuteAcceptance.transition('valid'); window.flofiExecuteAcceptance.lifecycle('approval-confirmed'); });
  await expect(summary.locator('button.primary')).toHaveCount(1);
  await expect(summary.getByRole('button', { name: 'Continue to swap', exact: true })).toHaveClass('primary');
  expect((await page.evaluate(() => window.flofiExecuteAcceptance.counts())).executed).toBe(0);
});

test('technical details, transaction links and copy confirmation work with the keyboard', async ({ page }) => {
  await page.evaluate(() => window.flofiExecuteAcceptance.evidence('reconciled'));
  const disclosure = page.locator('.execute-technical summary');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    await disclosure.focus(); await disclosure.press('Enter');
    await expect(page.locator('.execute-technical')).toHaveAttribute('open', '');
    expect(await disclosure.evaluate(element => ({ style: getComputedStyle(element).outlineStyle, width: getComputedStyle(element).outlineWidth }))).toEqual({ style: 'solid', width: '2px' });
    await disclosure.press('Space'); await expect(page.locator('.execute-technical')).not.toHaveAttribute('open', '');
  }
  const hash = '0x' + 'b'.repeat(64);
  const plan = page.getByRole('region', { name: 'Execution plan', exact: true });
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async writeText(value: string) { Object.assign(window, { copiedExecutionIdentifier: value }); } } }); });
  const copy = plan.getByRole('button', { name: `Copy transaction ${hash}`, exact: true });
  await copy.focus(); await copy.press('Enter');
  await expect(copy).toHaveText('Copied'); await expect(plan.getByRole('status').filter({ hasText: 'Action transaction copied.' })).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { copiedExecutionIdentifier: string }).copiedExecutionIdentifier)).toBe(hash);
  await copy.press('Tab'); const link = plan.getByRole('link', { name: 'View transaction' }).last(); await expect(link).toBeFocused();
  expect(await link.evaluate(element => getComputedStyle(element).outlineWidth)).toBe('2px');
  await expect(link).toHaveAttribute('href', new RegExp(`/tx/${hash}$`));
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect((await page.evaluate(() => window.flofiExecuteAcceptance.counts())).executed).toBe(0);
});

test('copy fallback and long workflow names stay inside their containers in both themes', async ({ page }) => {
  await page.evaluate(() => { window.flofiExecuteAcceptance.workflowName('A workflow with an unusually long name ' + 'w'.repeat(180)); window.flofiExecuteAcceptance.evidence('bridge-reconciled'); });
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async writeText() { throw Error('Clipboard unavailable'); } } }); });
  const plan = page.getByRole('region', { name: 'Execution plan', exact: true });
  await plan.getByRole('button', { name: /Copy Provider reference/ }).click();
  await expect(plan.getByRole('status').filter({ hasText: 'Copy unavailable.' })).toHaveCount(1);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    for (const width of [1280, 820, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.screenshot({ path: `.tmp/ux005e-long-values-${theme}.png`, fullPage: true });
  }
  await page.evaluate(() => window.flofiExecuteAcceptance.transition('valid'));
  await expect(page.getByRole('region', { name: 'Execution workflow graph', exact: true })).toHaveAttribute('data-viewport', 'fitted');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await page.evaluate(() => window.flofiExecuteAcceptance.counts())).executed).toBe(0);
});

test('primary Execute copy stays human-readable across progress, recovery and result states', async ({ page }) => {
  const assertProductCopy = async () => {
    await expect(page.locator('.execute-heading')).toHaveCount(0);
    const visible = await page.locator('.execute-workspace').innerText();
    expect(visible).not.toMatch(/\b(artifact|canonical|runtime|journal|projection|digest|payload|schema|internal|synthetic|mock|debug|cursor|envelope)\b/i);
    await expect(page.getByRole('button', { name: /Retry|Try again/ })).toHaveCount(0);
  };
  await assertProductCopy();
  for (const state of ['wallet', 'submitting', 'submitted', 'approval-confirmed', 'restored', 'uncertain', 'failed'] as const) {
    await page.evaluate(value => window.flofiExecuteAcceptance.lifecycle(value), state); await assertProductCopy();
  }
  for (const state of ['reconciled', 'partial', 'declined', 'attention', 'recovered', 'bridge-pending', 'bridge-reconciled', 'cow-pending', 'cow-reconciled'] as const) {
    await page.evaluate(value => window.flofiExecuteAcceptance.evidence(value), state); await assertProductCopy();
  }
  expect((await page.evaluate(() => window.flofiExecuteAcceptance.counts())).executed).toBe(0);
});
