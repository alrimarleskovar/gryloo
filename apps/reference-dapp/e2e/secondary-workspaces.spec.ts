// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { installSupplyWallet, SUPPLY_OWNER } from './supply-fixtures';
import { configureCanvasAction } from './composer-authoring-fixtures';
import { selectSettingsTheme } from './settings-fixtures';
import type { Page } from '@playwright/test';

const workspaces = ['Credentials', 'Agents', 'Passkeys'] as const;
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}
async function navigateWorkspace(page: Page, label: typeof workspaces[number]) {
  await page.locator('.navigation-trigger').click();
  await page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('link', { name: label, exact: true }).click();
  await expect(page).toHaveURL(`/app/${label.toLowerCase()}`);
  await expect(page.getByRole('heading', { name: label, level: 1 })).toBeVisible();
  await expect(page.locator('.navigation-drawer')).toBeHidden();
}
async function stageGeometry(page: Page) {
  return page.evaluate(() => Object.fromEntries(['.top-bar', 'main', '.canvas', '.canvas-head', '.flow-surface', '.canvas-foot', '.canvas-primary-action', '.canvas-navigator', '.copilot', '.simulation-summary', '.execution-plan', '.summary-bar'].map(selector => {
    const element = document.querySelector(`main ${selector}`) ?? document.querySelector(selector);
    if (!element) return [selector, null];
    const { x, y, width, height } = element.getBoundingClientRect();
    return [selector, { x, y, width, height }];
  })));
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} real workspace routes share public wallet context and keep future controls inert`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.addInitScript(value => {
      localStorage.setItem('flofi.theme', value);
      const state = window as unknown as { copiedAddresses: string[]; credentialCalls: string[]; shellMarker: string };
      state.copiedAddresses = []; state.credentialCalls = []; state.shellMarker = '';
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (address: string) => { state.copiedAddresses.push(address); } } });
      for (const method of ['create', 'get'] as const) Object.defineProperty(navigator.credentials, method, { configurable: true, value: async () => { state.credentialCalls.push(method); return null; } });
    }, theme);
    await installSupplyWallet(page); await page.goto('/');
    await expect(page.locator('.build009-wallet-info')).toBeVisible();
    await page.evaluate(() => { (window as unknown as { shellMarker: string }).shellMarker = 'persistent-shell'; });
    const stages = page.getByRole('navigation', { name: 'Workflow stages' });
    for (const label of workspaces) {
      await navigateWorkspace(page, label);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.getByRole('banner')).toHaveCount(1);
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('group', { name: 'Wallet connection' })).toContainText('0x1111…1111');
      await expect(stages.locator('[aria-current=page]')).toHaveCount(0);
      for (const stage of ['Dashboard', 'Build', 'Simulate', 'Execute']) await expect(stages.getByRole('button', { name: stage, exact: true })).toBeVisible();
      await page.locator('.navigation-trigger').click();
      const navigation = page.getByRole('navigation', { name: 'Workspace navigation' });
      await expect(navigation.getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(navigation.locator('[aria-current=page]')).toHaveCount(1);
      await page.keyboard.press('Escape');
      await expect(page.locator('.navigation-trigger')).toBeFocused();
      expect(await page.evaluate(() => (window as unknown as { shellMarker: string }).shellMarker)).toBe('persistent-shell');
    }
    await navigateWorkspace(page, 'Credentials');
    await expect(page.getByRole('heading', { name: 'Wallets', exact: true })).toBeVisible();
    await expect(page.locator('.workspace-count')).toHaveText('1');
    await expect(page.locator('.workspace-wallet-card')).toHaveCount(1);
    await expect(page.locator('.workspace-wallet-card')).toContainText('EVM · External wallet');
    await expect(page.locator('.workspace-wallet-card')).toContainText('Base Sepolia');
    await expect(page.locator('.workspace-wallet-address code')).toHaveAttribute('title', SUPPLY_OWNER);
    await expect(page.locator('.workspace-wallet-address code')).toHaveCSS('font-family', /IBM Plex Mono/);
    const copy = page.getByRole('button', { name: 'Copy Connected wallet address' });
    await copy.focus(); await copy.press('Enter');
    await expect(copy).toHaveCSS('outline-style', 'solid');
    await expect(page.getByRole('status')).toHaveText('Address copied.');
    expect(await page.evaluate(() => (window as unknown as { copiedAddresses: string[] }).copiedAddresses)).toEqual([SUPPLY_OWNER]);
    for (const label of ['Add wallet', 'Add funds', 'Reveal key', 'Delete', 'Add card', 'Add secret']) await expect(page.getByRole('button', { name: label, exact: true })).toBeDisabled();
    expect(await page.getByRole('main').innerText()).not.toMatch(/0x[0-9a-f]{64}|balance|MPC|private key:/i);
    await expect(page.locator('input[type=password]')).toHaveCount(0);
    await navigateWorkspace(page, 'Agents');
    for (const provider of ['Claude', 'ChatGPT']) await expect(page.getByRole('button', { name: `Connect with ${provider}` })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Connect with Grok' })).toHaveCount(0);
    await expect(page.locator('.workspace-count')).toHaveText('0 active');
    await expect(page.getByText('No agent clients yet.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create client', exact: true })).toHaveCount(2);
    for (const button of await page.getByRole('button', { name: 'Create client', exact: true }).all()) await expect(button).toBeDisabled();
    await navigateWorkspace(page, 'Passkeys');
    const passkey = page.getByRole('switch', { name: 'Unlock with a passkey' });
    await expect(passkey).toBeVisible(); await expect(passkey).toBeDisabled(); await expect(passkey).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText('Turn on to add a passkey.', { exact: true })).toBeVisible();
    await expect(page.getByText('No passkeys yet. Add one to get started.', { exact: true })).toBeVisible();
    const storageBefore = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
    await passkey.evaluate(element => (element as HTMLButtonElement).click());
    await expect(passkey).toHaveAttribute('aria-checked', 'false');
    expect(await page.evaluate(() => (window as unknown as { credentialCalls: string[] }).credentialCalls)).toEqual([]);
    expect(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }))).toEqual(storageBefore);
    expect(await page.evaluate(() => (window as unknown as { supplyWalletRequests: { method: string }[] }).supplyWalletRequests.filter(request => /requestAccounts|send|sign|switch|addEthereumChain/i.test(request.method)))).toEqual([]);
    await page.goBack(); await expect(page).toHaveURL('/app/agents');
    await page.goForward(); await expect(page).toHaveURL('/app/passkeys');
    await page.locator('.navigation-trigger').click();
    await expect(page.getByRole('link', { name: 'Passkeys', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await selectSettingsTheme(page, theme === 'light' ? 'dark' : 'light');
    await selectSettingsTheme(page, theme);
    await page.getByRole('button', { name: 'Settings', exact: true }).press('Escape');
    await stages.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await expect(page).toHaveURL('/app/dashboard');
    await expect(page.getByRole('main', { name: 'Dashboard', exact: true })).toBeVisible();
    await stages.getByRole('button', { name: 'Build', exact: true }).click();
    await expect(page).toHaveURL('/'); await expect(page.locator('.canvas-empty-mascot')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test(`${theme} direct workspace routes fit responsive widths with shared header and theme surfaces`, async ({ page }, testInfo) => {
    const errors = watchErrors(page);
    await page.addInitScript(value => localStorage.setItem('flofi.theme', value), theme);
    await installSupplyWallet(page);
    for (const label of workspaces) {
      const response = await page.goto(`/app/${label.toLowerCase()}`);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', { name: label, level: 1 })).toBeVisible();
      await expect(page.locator('.build009-wallet-info')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      for (const width of [320, 375, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expect(page.getByRole('combobox', { name: 'Environment', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
        await expect(page.locator('.navigation-trigger')).toBeInViewport();
        await expect(page.locator('.secondary-workspace-heading')).toHaveCSS('font-family', /Outfit/);
        const surfaces = page.locator('.workspace-empty, .workspace-connect-panel, .workspace-passkey-control');
        for (const surface of await surfaces.all()) await expect(surface).toHaveCSS('background-color', theme === 'dark' ? 'rgb(21, 24, 31)' : 'rgb(255, 255, 255)');
        if (label === 'Credentials') {
          await expect(page.locator('.workspace-wallet-card')).toHaveCSS('background-color', theme === 'dark' ? 'rgb(28, 32, 41)' : 'rgb(255, 255, 255)');
          const columns = await page.locator('.workspace-wallet-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
          expect(columns).toBe(width <= 800 ? 1 : 2);
        }
        await page.locator('.navigation-trigger').click();
        await expect(page.getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
        await page.keyboard.press('Escape');
        await expect(page.locator('.navigation-trigger')).toBeFocused();
        if (width === 320 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`${label.toLowerCase()}-${theme}-${width}.png`), fullPage: true });
      }
    }
    expect(errors).toEqual([]);
  });

  test(`${theme} secondary navigation preserves workflow data and stage geometry`, async ({ page }, testInfo) => {
    const errors = watchErrors(page);
    await page.addInitScript(value => localStorage.setItem('flofi.theme', value), theme);
    await installSupplyWallet(page); await page.goto('/');
    await expect(page.locator('.build009-wallet-info')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.getByRole('button', { name: 'Add supply', exact: true }).click(); await configureCanvasAction(page, '1');
    const measurements: Record<string, Awaited<ReturnType<typeof stageGeometry>>> = {};
    const stages = page.getByRole('navigation', { name: 'Workflow stages' });
    for (const width of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [index, stage] of ['Build', 'Simulate', 'Execute'].entries()) {
        await stages.getByRole('button', { name: stage, exact: true }).click();
        await expect(stages.getByRole('button', { name: stage, exact: true })).toHaveAttribute('aria-current', 'page');
        await page.evaluate(() => window.scrollTo(0, 0));
        const before = await stageGeometry(page);
        measurements[`${width}-${stage}`] = before;
        await navigateWorkspace(page, workspaces[index]!);
        await stages.getByRole('button', { name: stage, exact: true }).click();
        await expect(page).toHaveURL('/');
        await expect(stages.getByRole('button', { name: stage, exact: true })).toHaveAttribute('aria-current', 'page');
        await page.evaluate(() => window.scrollTo(0, 0));
        expect(await stageGeometry(page)).toEqual(before);
        await expect(page.locator('.canvas-navigator')).toBeVisible();
        await expect(page.locator('.dark-spotlight')).toHaveCSS('pointer-events', 'none');
        await expect(page.locator('.react-flow__pane')).toHaveCSS('cursor', new RegExp(`flofi-mascot-cursor${theme === 'dark' ? '-dark' : ''}\\.png.*29 3, default`));
        if (stage === 'Build') {
          await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
          await expect(page.locator('.composer-card input')).toHaveValue('1');
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
    await testInfo.attach('workflow-geometry', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
    expect(errors).toEqual([]);
  });
}

test('Credentials without a connected wallet has a truthful empty state and zero records', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/app/credentials');
  await expect(page.getByRole('heading', { name: 'Credentials', level: 1 })).toBeVisible();
  await expect(page.locator('.workspace-count')).toHaveText('0');
  await expect(page.getByText('No connected wallets', { exact: true })).toBeVisible();
  await expect(page.locator('.workspace-wallet-card')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add wallet', exact: true })).toBeDisabled();
  expect(await page.getByRole('main').innerText()).not.toMatch(/0x[0-9a-f]|balance|private key|MPC/i);
  expect(errors).toEqual([]);
});
