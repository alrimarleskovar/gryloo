// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { reviewOwner } from '../src/test-utils/review-fixture';

// The real workspace, projections and shell run against explicit, isolated deferred reads.
// Server reads and wallet signing are replaced only in this browser fixture bundle.
let bundle: string;
const other = '0x' + '2'.repeat(40), errors = new WeakMap<Page, string[]>();
test.beforeAll(async () => {
  const compiled = '../node_modules/next/dist/compiled/', aliases: Record<string, string> = {};
  for (const [name, path] of Object.entries({ 'node:crypto': 'crypto-browserify/index.js', buffer: 'buffer/index.js', 'node:buffer': 'buffer/index.js', stream: 'stream-browserify/index.js', events: 'events/events.js', string_decoder: 'string_decoder/string_decoder.js', util: 'util/util.js', vm: 'vm-browserify/index.js', process: 'process/browser.js' })) {
    aliases[name] = fileURLToPath(new URL(`${compiled}${path}`, import.meta.url));
  }
  const result = await build({ root: fileURLToPath(new URL('../../../', import.meta.url)), configFile: false, logLevel: 'error', resolve: { alias: aliases },
    plugins: [{ name: 'isolated-dashboard-acceptance-reads', enforce: 'pre',
      resolveId(id) {
        if (id.endsWith('/app/dashboard-action')) return '\0dashboard-acceptance-reads';
        if (id.endsWith('/state/build009-wallet-store')) return '\0dashboard-acceptance-wallet';
        if (id.endsWith('/app/wallet-session-action')) return '\0dashboard-acceptance-signing';
      },
      load(id) {
        if (id === '\0dashboard-acceptance-reads') return 'export const dashboardSnapshot = account => window.flofiWorkspaceAcceptance.read(account, null); export const dashboardRunDetail = (account, runId) => window.flofiWorkspaceAcceptance.read(account, runId);';
        if (id === '\0dashboard-acceptance-wallet') return 'export const useBuild009Wallet = () => ({}); export const injected = () => null;';
        if (id === '\0dashboard-acceptance-signing') return 'export const walletSignInChallenge = () => { throw new Error("Unexpected fixture signing"); }; export const walletSignIn = walletSignInChallenge;';
      },
    }],
    define: { 'process.env.NODE_ENV': '"production"', __dirname: '"/"', global: 'globalThis' },
    build: { write: false, minify: false, rolldownOptions: { transform: { inject: { Buffer: ['buffer', 'Buffer'], process: 'process' } } },
      lib: { entry: fileURLToPath(new URL('../src/test-utils/dashboard-workspace-acceptance-harness.tsx', import.meta.url)), name: 'FloFiFinalDashboardAcceptance', formats: ['iife'] } } });
  const entry = (Array.isArray(result) ? result : [result]).flatMap(output => 'output' in output ? output.output : []).find(output => output.type === 'chunk' && output.isEntry);
  if (!entry || entry.type !== 'chunk') throw new Error('Final Dashboard acceptance bundle missing');
  bundle = entry.code;
});
async function theme(page: Page, value: 'light' | 'dark') {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: `${value === 'light' ? 'Light' : 'Dark'} theme`, exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', value);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
}
async function mount(page: Page, details = false) {
  await page.evaluate(value => {
    const main = document.querySelector<HTMLElement>('.main')!;
    for (const child of Array.from(main.children)) (child as HTMLElement).style.display = 'none';
    const root = document.createElement('div'); main.append(root);
    const acceptance = (window as unknown as { FloFiFinalDashboardAcceptance: { mount(element: HTMLElement): void; mountDetails(element: HTMLElement): void } }).FloFiFinalDashboardAcceptance;
    acceptance[value ? 'mountDetails' : 'mount'](root);
  }, details);
}
const workspace = (page: Page) => page.locator('.main > div:visible .dashboard-workspace');
async function reads(page: Page, count: number) {
  await expect.poll(() => page.evaluate(() => window.flofiWorkspaceAcceptance.requests().length)).toBe(count);
}
test.beforeEach(async ({ page }) => {
  const found: string[] = []; errors.set(page, found); page.on('pageerror', error => found.push(error.message));
  await page.goto('/app/dashboard'); await theme(page, 'light');
  await page.route('**/__ux006e-acceptance.js', route => route.fulfill({ contentType: 'application/javascript', body: bundle }));
  await page.addScriptTag({ url: '/__ux006e-acceptance.js' }); await mount(page); await reads(page, 1);
});
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });

test('loading and refresh never present a misleading empty account; source and verification states stay distinct', async ({ page }) => {
  const index = workspace(page);
  await expect(index.getByRole('status')).toContainText('Loading execution history');
  await expect(index.getByRole('heading', { name: 'No workflows executed yet', exact: true })).toHaveCount(0);
  await page.evaluate(() => window.flofiWorkspaceAcceptance.respond(0, 'owned'));
  await expect(index.getByRole('link', { name: 'View Swap run fixture-detail-run', exact: true })).toBeVisible();
  await index.getByRole('button', { name: 'Refresh history', exact: true }).click(); await reads(page, 2);
  await expect(index.getByRole('status')).toContainText('Loading execution history');
  await expect(index.getByRole('heading', { name: 'No workflows executed yet', exact: true })).toHaveCount(0);
  await page.evaluate(() => window.flofiWorkspaceAcceptance.respond(1, 'unavailable'));
  await expect(index.getByRole('status')).toContainText('Execution history temporarily unavailable');
  await index.getByRole('button', { name: 'Refresh history', exact: true }).click(); await reads(page, 3);
  await page.evaluate(() => window.flofiWorkspaceAcceptance.respond(2, 'verify'));
  await expect(index.getByRole('button', { name: 'Verify wallet for history', exact: true })).toBeVisible();
  await expect(index.getByRole('heading', { name: 'No workflows executed yet', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.flofiWorkspaceAcceptance.requests().every(request => request.account === '0x1111111111111111111111111111111111111111'))).toBe(true);
});

test('wallet changes immediately hide loaded history and ignore late responses from previous owners', async ({ page }) => {
  const index = workspace(page), run = index.getByRole('link', { name: 'View Swap run fixture-detail-run', exact: true });
  await page.evaluate(() => window.flofiWorkspaceAcceptance.respond(0, 'owned')); await expect(run).toBeVisible();
  await page.evaluate(value => window.flofiWorkspaceAcceptance.wallet(value), other); await reads(page, 2);
  await expect(run).toHaveCount(0); await expect(index.getByRole('status')).toContainText('Loading execution history');
  await page.evaluate(value => window.flofiWorkspaceAcceptance.wallet(value), reviewOwner); await reads(page, 3);
  // The existing same-owner cache can be shown again after returning to that wallet.
  await expect(run).toBeVisible();
  const owned = await index.innerText();
  await page.evaluate(() => window.flofiWorkspaceAcceptance.respond(1, 'unrelated'));
  expect(await index.innerText()).toBe(owned);
  await page.evaluate(() => window.flofiWorkspaceAcceptance.respond(2, 'owned')); await expect(run).toBeVisible();
  await page.evaluate(value => window.flofiWorkspaceAcceptance.wallet(value), other); await reads(page, 4);
  await page.evaluate(() => window.flofiWorkspaceAcceptance.respond(3, 'unrelated'));
  await expect(run).toHaveCount(0); await expect(index.getByRole('heading', { name: 'No workflows executed yet', exact: true })).toBeVisible();
  await page.evaluate(() => window.flofiWorkspaceAcceptance.wallet(null));
  await expect(index.getByRole('status')).toContainText('Connect your wallet');
  await expect(index.locator('.dashboard-run-card')).toHaveCount(0);
  expect(await page.evaluate(() => window.flofiWorkspaceAcceptance.requests().length)).toBe(4);
});

test('saved detail responses cannot leak amounts, evidence or owner identifiers across wallet changes', async ({ page }) => {
  const detail = workspace(page);
  await page.evaluate(() => window.flofiWorkspaceAcceptance.respond(0, 'owned'));
  await detail.getByRole('link', { name: 'View Swap run fixture-detail-run', exact: true }).click(); await reads(page, 2);
  await page.evaluate(() => window.flofiWorkspaceAcceptance.respond(1, 'owned'));
  await expect(detail.locator('.execution-plan')).toContainText('0.0243 WETH');
  await expect(detail.getByRole('button', { name: /^(Retry|Execute workflow|Open current execution)$/ })).toHaveCount(0);
  await page.evaluate(value => window.flofiWorkspaceAcceptance.wallet(value), other); await reads(page, 3);
  await expect(detail.getByRole('heading', { name: 'Loading execution…', exact: true })).toBeVisible();
  await expect(detail.locator('.execution-plan')).toHaveCount(0);
  await page.evaluate(() => window.flofiWorkspaceAcceptance.respond(2, 'unrelated'));
  await expect(detail.getByRole('heading', { name: 'Execution details temporarily unavailable', exact: true })).toBeVisible();
  expect(await detail.innerText()).not.toMatch(/0\.0243|fixture-evidence-bundle|11111111/);
  await detail.getByRole('button', { name: 'Reload details', exact: true }).click(); await reads(page, 4);
  await page.evaluate(() => window.flofiWorkspaceAcceptance.respond(3, 'not-found'));
  await expect(detail.getByRole('heading', { name: 'Run not found', exact: true })).toBeVisible();
  await expect(detail).toContainText('This execution is unavailable for the connected wallet');
  expect(await detail.innerText()).not.toMatch(/0\.0243|fixture-evidence-bundle|11111111/);
  await page.evaluate(() => window.flofiWorkspaceAcceptance.wallet(null));
  await expect(detail.getByRole('heading', { name: 'Connect the wallet used for this execution', exact: true })).toBeVisible();
});

test('current-run navigation remains a read-only path to Execute and survives unavailable saved history', async ({ page }) => {
  const index = workspace(page);
  await page.evaluate(() => { window.flofiWorkspaceAcceptance.respond(0, 'unavailable'); window.flofiWorkspaceAcceptance.current(); });
  await expect(index.locator('.dashboard-current')).toContainText('In progress');
  await index.locator('.dashboard-current').getByRole('link').click();
  await expect(index.locator('.dashboard-detail-heading')).toContainText('CURRENT EXECUTION');
  await index.getByRole('button', { name: 'Open current execution', exact: true }).click();
  expect(await page.evaluate(() => window.flofiWorkspaceAcceptance.navigation())).toEqual(['/app/dashboard/runs/fixture-detail-run', 'Execute']);
  await index.getByRole('button', { name: 'Back to Dashboard' }).click(); await reads(page, 2);
  await expect(index.locator('.dashboard-current')).toContainText('In progress');
  await page.evaluate(() => window.flofiWorkspaceAcceptance.respond(1, 'unavailable'));
  await expect(index.getByRole('status')).toContainText('Execution history temporarily unavailable');
  await expect(index.locator('.dashboard-current')).toBeVisible();
  await index.getByRole('button', { name: 'Build workflow', exact: true }).click();
  expect(await page.evaluate(() => window.flofiWorkspaceAcceptance.navigation())).toEqual(['/app/dashboard/runs/fixture-detail-run', 'Execute', '/app/dashboard', 'Build']);
});

for (const value of ['light', 'dark'] as const) test(`${value} long recorded amounts, costs, provider references, orders and technical details fit acceptance widths`, async ({ page }) => {
  await mount(page, true); await theme(page, value);
  const detail = workspace(page);
  for (const mode of ['completed', 'bridge-completed', 'cow-pending'] as const) {
    await page.evaluate(value => { window.flofiRunDetailAcceptance.show(value); window.flofiRunDetailAcceptance.longTitle(); window.flofiRunDetailAcceptance.longValues(); }, mode);
    await expect(detail.locator('.dashboard-detail-heading h1')).toContainText('OwnerDefinedWorkflowName');
    await expect(detail.locator('.execution-plan')).toContainText('9'.repeat(60));
    for (const width of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(detail.getByRole('button', { name: 'Back to Dashboard' })).toBeVisible();
    }
    const disclosure = detail.getByText('View technical details', { exact: true });
    await disclosure.focus();
    if (await detail.locator('details').getAttribute('open') !== null) await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(detail.locator('details')).toHaveAttribute('open', '');
    await page.setViewportSize({ width: 320, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(detail.getByRole('button', { name: /^(Execute workflow|Retry|Continue execution)$/ })).toHaveCount(0);
    if (mode === 'bridge-completed') {
      await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { Object.assign(window, { finalAcceptanceCopy: value }); } } }));
      await detail.locator('.execution-plan').getByRole('button', { name: /^Copy Provider reference/ }).first().click();
      expect(await page.evaluate(() => (window as unknown as { finalAcceptanceCopy: string }).finalAcceptanceCopy)).toBe('fixture-provider-deposit'.repeat(32));
    }
    await page.screenshot({ style: 'nextjs-portal{display:none}', path: `.tmp/ux006e-long-${mode}-${value}-320.png`, fullPage: true });
  }
});
