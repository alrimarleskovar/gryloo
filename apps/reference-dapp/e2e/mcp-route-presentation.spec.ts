// SPDX-License-Identifier: AGPL-3.0-only
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { connectViaBrowser, mcpClient } from './mcp-fixtures';

const enabled = process.env.GRYLOO_MCP_E2E === 'EMBEDDED_LOOPBACK_ONLY';
const unknownSecret = `flofi_hs_${'A'.repeat(43)}`;
const stages = (page: Page) => page.getByRole('navigation', { name: 'Workflow stages' });
async function expectDedicatedRoute(page: Page, label: string) {
  await expect(page.locator('.app-shell')).toHaveCount(1);
  await expect(page.getByRole('main', { name: label, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'FloFi home' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await expect(stages(page)).toHaveCount(0);
  await expect(page.locator('.build-flow-surface,.execute-workspace,.dashboard-workspace')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('MCP_OAUTH_NOT_ENABLED');
}

test.describe(`MCP route presentation (OAuth ${enabled ? 'enabled' : 'disabled'})`, () => {
  for (const fragment of ['', '#incomplete', '#%E0%A4%A', `#${unknownSecret}`]) {
    test(`invalid /approve${fragment} has its own state page`, async ({ page }) => {
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(`/approve${fragment}`);
      await expect(page.getByRole('heading', { name: 'Open this link from your assistant' })).toBeVisible();
      await expectDedicatedRoute(page, 'Approval');
      expect(errors).toEqual([]);
    });
  }
  test('connections without an account has its own state page', async ({ page }) => {
    await page.goto('/connections');
    await expect(page.getByRole('heading', { name: 'Connect FloFi from your assistant' })).toBeVisible();
    await expectDedicatedRoute(page, 'Connections');
  });
  test('server-rendered approval and connections never expose the product workspace', async ({ request }) => {
    for (const path of ['/approve', '/connections']) {
      const response = await request.get(path);
      expect(response.status()).toBe(200);
      const html = await response.text();
      expect(html).toContain('mcp-route-state');
      expect(html).not.toContain('aria-label="Workflow stages"');
      expect(html).not.toContain('MCP_OAUTH_NOT_ENABLED');
    }
  });
  for (const path of ['/approve', '/connections']) {
    test(`${path} returns to the existing FloFi workspace`, async ({ page }) => {
      await page.goto(path);
      await page.getByRole('link', { name: 'Go to FloFi', exact: true }).click();
      await expect(page).toHaveURL(/\/$/);
      await expect(stages(page)).toBeVisible();
      await expect(page.locator('.app-shell')).toHaveCount(1);
      await expect(page.locator('.mcp-route-main')).toHaveCount(0);
    });
  }
  for (const theme of ['light', 'dark']) {
    test(`${theme} MCP states retain FloFi preferences and fit narrow screens`, async ({ page }) => {
      await page.addInitScript(value => localStorage.setItem('flofi.theme', value), theme);
      for (const [path, label] of [['/approve', 'Approval'], ['/connections', 'Connections']]) {
        await page.goto(path!);
        await expect(page.getByRole('link', { name: 'Go to FloFi', exact: true })).toBeVisible();
        await expectDedicatedRoute(page, label!);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        for (const width of [1440, 768, 390, 320]) {
          await page.setViewportSize({ width, height: 900 });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          await expect(page.getByRole('link', { name: 'Go to FloFi', exact: true })).toBeInViewport();
        }
      }
    });
  }
  test('a failed approval lookup resolves to a friendly state', async ({ page }) => {
    await page.route('**/approve', route => route.request().headers()['next-action'] && route.request().postData()?.includes(unknownSecret)
      ? route.abort('failed') : route.continue());
    await page.goto(`/approve#${unknownSecret}`);
    await expect(page.getByRole('heading', { name: 'Open this link from your assistant' })).toBeVisible();
    await expectDedicatedRoute(page, 'Approval');
  });

  if (enabled) {
    async function issueApproval(page: Page) {
      const client = mcpClient(page.context().request, (await connectViaBrowser(page, page.context().request)).accessToken);
      const composed = await client.tool('compose_strategy', { strategy: { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '1' } });
      expect(composed).toMatchObject({ ok: true });
      const approval = await client.tool('request_user_approval', { strategy: composed.strategy, workflowHash: composed.workflowHash });
      expect(approval).toMatchObject({ ok: true, status: 'PENDING' });
      return String(approval.approvalUrl);
    }
    test('valid approval exposes the existing workspace only after server validation', async ({ page }) => {
      const url = await issueApproval(page), secret = new URL(url).hash.slice(1);
      let release!: () => void;
      const ready = new Promise<void>(resolve => { release = resolve; });
      await page.route('**/approve', async route => {
        if (route.request().headers()['next-action'] && route.request().postData()?.includes(secret)) await ready;
        await route.continue();
      });
      try {
        await page.goto(url);
        await expect(page.getByRole('heading', { name: 'Opening your approval' })).toBeVisible();
        await expectDedicatedRoute(page, 'Approval');
      } finally { release(); }
      await expect(page.getByRole('region', { name: 'External proposal' })).toContainText('Nothing is authorized yet.');
      await expect(stages(page)).toBeVisible();
      await expect(page.locator('.app-shell')).toHaveCount(1);
      await expect(page.locator('.mcp-route-main')).toHaveCount(0);
      expect(page.url()).not.toContain(secret);
      expect(await page.evaluate(() => sessionStorage.getItem('flofi.approval.secret'))).toBe(secret);
      // Leaving a validated approval resets its gate before another approval is resolved.
      await stages(page).getByRole('button', { name: 'Dashboard', exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.getByRole('region', { name: 'External proposal' })).toHaveCount(0);
      await page.evaluate(() => { sessionStorage.removeItem('flofi.approval.secret'); history.pushState(null, '', '/approve'); });
      await expect(page.getByRole('heading', { name: 'Open this link from your assistant' })).toBeVisible();
      await expectDedicatedRoute(page, 'Approval');
    });
    test('an explicit invalid fragment cannot reopen a stored valid approval', async ({ page }) => {
      await page.goto(await issueApproval(page));
      await expect(stages(page)).toBeVisible();
      await page.goto('/approve#incomplete');
      await expect(page.getByRole('heading', { name: 'Open this link from your assistant' })).toBeVisible();
      await expectDedicatedRoute(page, 'Approval');
    });
    test('a superseded approval lookup cannot expose the workspace', async ({ page }) => {
      const url = await issueApproval(page), secret = new URL(url).hash.slice(1);
      let release!: () => void;
      const ready = new Promise<void>(resolve => { release = resolve; });
      const response = page.waitForResponse(result => result.request().postData()?.includes(secret) === true);
      await page.route('**/approve', async route => {
        if (route.request().headers()['next-action'] && route.request().postData()?.includes(secret)) await ready;
        await route.continue();
      });
      try {
        await page.goto(url);
        await expect(page.getByRole('heading', { name: 'Opening your approval' })).toBeVisible();
        // Change the fragment in the same document while the valid lookup is pending.
        // This exercises the gate's request generation rather than cancelling it by navigation.
        await page.evaluate(() => { window.location.hash = 'incomplete'; });
        await expect(page.getByRole('heading', { name: 'Open this link from your assistant' })).toBeVisible();
      } finally { release(); }
      await response;
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expectDedicatedRoute(page, 'Approval');
      await expect(page.getByRole('region', { name: 'External proposal' })).toHaveCount(0);
    });
    test('connections with a consented account stays in its dedicated route', async ({ page }) => {
      await connectViaBrowser(page, page.context().request);
      await page.goto('/connections');
      await expect(page.getByRole('region', { name: 'Connections', exact: true })).toContainText(/Account mcpacct_[a-z2-7]{26}/);
      await expectDedicatedRoute(page, 'Connections');
      await expect(page.getByRole('button', { name: 'Ethereum wallet', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Solana wallet', exact: true })).toBeVisible();
    });
    test('withdrawn approval has a dedicated unavailable state', async ({ page }) => {
      const url = await issueApproval(page);
      await page.goto('/connections');
      await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Connections', exact: true })).toContainText('REVOKED');
      await page.goto(url);
      await expect(page.getByRole('heading', { name: 'This approval is no longer available' })).toBeVisible();
      await expectDedicatedRoute(page, 'Approval');
    });
  }
});
