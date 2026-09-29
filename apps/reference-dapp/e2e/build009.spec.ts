// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
const OWNER = '0x1111111111111111111111111111111111111111';
test('BUILD-009 injected wallet, explicit chain switching, mocked partial completion and recovery', async ({ page }) => {
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
  await expect(page.getByText('Wallet: 0x1111…1111 · Base (8453)')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __build009WalletTest: { accountRequests: number } }).__build009WalletTest.accountRequests)).toBe(0);
  await page.getByText('Advanced action setup', { exact: true }).click();
  await page.getByText('Base → Arbitrum → WETH', { exact: true }).click();
  await page.getByLabel('Source amount (USDC)').fill('1');
  await page.getByLabel('Bridge slippage (bps)').fill('50');
  await page.getByLabel('Arbitrum swap slippage (bps)').fill('50');
  await page.getByRole('button', { name: 'Review Base → Arbitrum bridge → WETH swap' }).click();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await expect(page.getByText('Required: Base (8453)')).toBeVisible();
  await expect(page.getByText('Wallet: 0x1111…1111 · Base (8453)')).toBeVisible();
  await page.getByRole('button', { name: 'Simulate', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Base to Arbitrum bridge and swap' });
  await panel.getByRole('button', { name: 'Get live Base → Arbitrum LI.FI bridge quote' }).click();
  await expect(panel.locator('[data-build009-state]')).toContainText('BRIDGE_QUOTED', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await panel.getByRole('button', { name: 'Authorize MOCKED bridge Manifest' }).click();
  await panel.getByRole('button', { name: 'Rehearse MOCKED source submission' }).click();
  await expect(panel.locator('[data-build009-state]')).toContainText('BRIDGE_SOURCE_SUBMITTED');
  await panel.getByRole('button', { name: 'Check MOCKED source receipt' }).click();
  await panel.getByRole('button', { name: 'Check MOCKED bridge progress' }).click();
  await panel.getByRole('button', { name: 'Check MOCKED destination receipt' }).click();
  await panel.getByRole('button', { name: 'Reconcile MOCKED Arbitrum USDC balance' }).click();
  await expect(panel.locator('[data-build009-state]')).toContainText('PARTIAL_COMPLETION');
  const received = await panel.locator('[data-build009-received] strong').textContent();
  expect(received).toMatch(/^[1-9][0-9]*$/);
  await expect(page.getByText('Required: Arbitrum (42161)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Switch to Arbitrum (42161)' })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Wallet: 0x1111…1111 · Base (8453)')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __build009WalletTest: { accountRequests: number } }).__build009WalletTest.accountRequests)).toBe(0);
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  const recovered = page.getByRole('region', { name: 'Base to Arbitrum bridge and swap' });
  await expect(recovered.locator('[data-build009-state]')).toContainText('PARTIAL_COMPLETION');
  await expect(recovered).toContainText('recovered MOCKED journal');
  await page.getByRole('button', { name: 'Switch to Arbitrum (42161)' }).click();
  await expect(page.getByText('Wallet: 0x1111…1111 · Arbitrum (42161)')).toBeVisible();
  await recovered.getByRole('button', { name: 'Get fresh LI.FI destination quote from reconciled amount' }).click();
  await expect(recovered.locator('[data-build009-state]')).toContainText('SWAP_QUOTED', { timeout: 30_000 });
  await expect(recovered).toContainText(`input ${received} USDC units`);
  await recovered.getByRole('button', { name: 'Authorize fresh MOCKED swap Manifest' }).click();
  await recovered.getByRole('button', { name: 'Rehearse MOCKED destination swap' }).click();
  await recovered.getByRole('button', { name: 'Reconcile MOCKED WETH balance' }).click();
  await expect(recovered.locator('[data-build009-state]')).toContainText('SWAP_RECONCILED');
  await expect(recovered.locator('[data-build009-weth]')).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect/Reset (app only)' }).click();
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
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await page.getByRole('button', { name: 'Connect Wallet' }).click();
  await expect(page.getByRole('button', { name: 'Switch to Base (8453)' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to Base (8453)' }).click();
  await expect(page.getByText('Wallet: 0x1111…1111 · Base (8453)')).toBeVisible();
  await page.getByRole('button', { name: 'Simulate', exact: true }).click();
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
