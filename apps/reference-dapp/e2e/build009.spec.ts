// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, applyPendingProposal, chooseWallet, openSimulationDetails } from './fixtures';
const OWNER = '0x1111111111111111111111111111111111111111';
test('BUILD-009 passive wallet restoration and read-only quote cannot grant production execution', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(owner => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    let chain = '0x2105';
    let account = owner;
    let accountRequests = 0;
    const emit = (event: string, value: unknown) => { for (const listener of listeners.get(event) ?? []) listener(value); };
    Object.defineProperty(window, '__build009WalletTest', { value: { get accountRequests() { return accountRequests; },
      changeAccount(value: string) { account = value; emit('accountsChanged', [value]); },
      changeChain(value: string) { chain = value; emit('chainChanged', value); },
      disconnect() { emit('disconnect', { code: 4900 }); } } });
    Object.defineProperty(window, 'ethereum', { configurable: true, value: {
      request: async ({ method, params }: { method: string; params?: { chainId: string }[] }) => {
        if (method === 'eth_requestAccounts') { accountRequests += 1; return [account]; }
        if (method === 'eth_accounts') return [account];
        if (method === 'eth_chainId') return chain;
        if (method === 'wallet_switchEthereumChain') { chain = params?.[0]?.chainId ?? chain; emit('chainChanged', chain); return null; }
        throw new Error('BUILD-009 unexpected wallet method: ' + method);
      },
      on(event: string, listener: (...args: unknown[]) => void) { const list = listeners.get(event) ?? new Set(); list.add(listener); listeners.set(event, list); },
      removeListener(event: string, listener: (...args: unknown[]) => void) { listeners.get(event)?.delete(listener); },
    } });
  }, OWNER);
  await page.goto('/');
  await expect(page.getByText('EVM Default: 0x1111…1111 · Base (8453)')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __build009WalletTest: { accountRequests: number } }).__build009WalletTest.accountRequests)).toBe(0);
  await page.getByText('Advanced action setup', { exact: true }).click();
  await page.getByText('Base → Arbitrum → WETH', { exact: true }).click();
  await page.getByLabel('Source amount (USDC)').fill('1');
  await page.getByLabel('Bridge slippage (bps)').fill('50');
  await page.getByLabel('Arbitrum swap slippage (bps)').fill('50');
  await page.getByRole('button', { name: 'Review Base → Arbitrum bridge → WETH swap' }).click();
  await applyPendingProposal(page);
  await expect(page.getByText('Workflow network: Base (8453)', { exact: true })).toBeVisible();
  await expect(page.getByText('EVM Default: 0x1111…1111 · Base (8453)')).toBeVisible();
  await page.getByRole('button', { name: 'Simulate', exact: true }).click();
  await openSimulationDetails(page);
  const panel = page.getByRole('region', { name: 'Base to Arbitrum bridge and swap' });
  await panel.getByRole('button', { name: 'Get live Base → Arbitrum LI.FI bridge quote' }).click();
  await expect(panel.locator('[data-build009-state]')).toContainText('BRIDGE_QUOTED', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  // The old direct-demo partial lifecycle is covered by domain/build009-run.test.ts.
  // Production Execute requires a supported simulation and shared Review/Manifest.
  await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Authorize MOCKED bridge Manifest', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Rehearse MOCKED source submission', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Download Evidence Bundle' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('EVM Default: 0x1111…1111 · Base (8453)')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __build009WalletTest: { accountRequests: number } }).__build009WalletTest.accountRequests)).toBe(0);
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Download Evidence Bundle' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect Wallet' })).toBeVisible();
});

test('BUILD-009 switches back to Base and invalidates quote on chain/account/provider change', async ({ page }) => {
  test.setTimeout(100_000);
  await page.addInitScript(owner => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    let chain = '0xa4b1'; let account = owner;
    const emit = (event: string, value: unknown) => { for (const listener of listeners.get(event) ?? []) listener(value); };
    Object.defineProperty(window, '__build009WalletTest', { value: {
      changeChain(value: string) { chain = value; emit('chainChanged', value); },
      changeAccount(value: string) { account = value; emit('accountsChanged', [value]); },
      disconnect() { emit('disconnect', { code: 4900 }); },
    } });
    Object.defineProperty(window, 'ethereum', { configurable: true, value: {
      request: async ({ method, params }: { method: string; params?: { chainId: string }[] }) => {
        if (method === 'eth_requestAccounts') return [account];
        if (method === 'eth_chainId') return chain;
        if (method === 'wallet_switchEthereumChain') { chain = params?.[0]?.chainId ?? chain; emit('chainChanged', chain); return null; }
        throw new Error('Unexpected wallet method: ' + method);
      },
      on(event: string, listener: (...args: unknown[]) => void) { const list = listeners.get(event) ?? new Set(); list.add(listener); listeners.set(event, list); },
      removeListener(event: string, listener: (...args: unknown[]) => void) { listeners.get(event)?.delete(listener); },
    } });
  }, OWNER);
  await page.goto('/');
  await page.getByText('Advanced action setup', { exact: true }).click();
  await page.getByText('Base → Arbitrum → WETH', { exact: true }).click();
  await page.getByLabel('Source amount (USDC)').fill('1');
  await page.getByRole('button', { name: 'Review Base → Arbitrum bridge → WETH swap' }).click();
  await applyPendingProposal(page);
  await page.getByRole('button', { name: 'Connect Wallet' }).click();
  await chooseWallet(page, 'Browser wallet');
  await expect(page.getByRole('button', { name: 'Switch to Base (8453)' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to Base (8453)' }).click();
  await expect(page.getByText('EVM Default: 0x1111…1111 · Base (8453)')).toBeVisible();
  await page.getByRole('button', { name: 'Simulate', exact: true }).click();
  await openSimulationDetails(page);
  const panel = page.getByRole('region', { name: 'Base to Arbitrum bridge and swap' });
  await panel.getByRole('button', { name: 'Get live Base → Arbitrum LI.FI bridge quote' }).click();
  await expect(panel.locator('[data-build009-state]')).toContainText('BRIDGE_QUOTED', { timeout: 30_000 });
  await page.evaluate(() => (window as unknown as { __build009WalletTest: { changeChain(value: string): void } }).__build009WalletTest.changeChain('0xa4b1'));
  await expect(panel.locator('[data-build009-state]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Switch to Base (8453)' }).click();
  await panel.getByRole('button', { name: 'Get live Base → Arbitrum LI.FI bridge quote' }).click();
  await expect(panel.locator('[data-build009-state]')).toContainText('BRIDGE_QUOTED', { timeout: 30_000 });
  await page.evaluate(() => (window as unknown as { __build009WalletTest: { changeAccount(value: string): void } }).__build009WalletTest.changeAccount('0x2222222222222222222222222222222222222222'));
  await expect(panel.locator('[data-build009-state]')).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { __build009WalletTest: { disconnect(): void } }).__build009WalletTest.disconnect());
  await expect(page.getByRole('button', { name: 'Connect Wallet' })).toBeVisible();
});
