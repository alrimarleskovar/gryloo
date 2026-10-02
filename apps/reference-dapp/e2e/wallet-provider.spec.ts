// SPDX-License-Identifier: AGPL-3.0-only
// Wallet calls and execution below are MOCKED loopback fixtures; no extension, signing or public submission.
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { lendingRpc, resetLending, LENDING_OWNER } from './lending-fixtures';

type Request = { provider: string; method: string; params?: unknown[] };
type Controls = { requests: Request[]; announceMetaMask(): void; emit(provider: string, event: string, value: unknown): void;
  listenerCount(provider: string, event: string): number };
async function install(page: Page, mode: 'legacy' | 'eip6963' | 'late', locked = false) {
  await page.exposeFunction('grylooLendingTestRpc', lendingRpc);
  await page.addInitScript(({ owner, mode, locked }) => {
    const requests: Request[] = [], listeners = new Map<string, Map<string, Set<(...args: unknown[]) => void>>>();
    const w = window as unknown as { ethereum: unknown; walletProviderTest: Controls; grylooLendingTestRpc(method: string, params: unknown[]): Promise<unknown> };
    let connected = !locked, chain = '0x14a34';
    const emit = (provider: string, event: string, value: unknown) => {
      if (provider === 'MetaMask' && event === 'chainChanged') chain = String(value);
      for (const listener of listeners.get(provider)?.get(event) ?? []) listener(value);
    };
    function wallet(name: string) {
      const events = new Map<string, Set<(...args: unknown[]) => void>>(); listeners.set(name, events);
      return {
        isMetaMask: mode === 'legacy' || name === 'Brave', isBraveWallet: name === 'Brave',
        async request(input: { method: string; params?: unknown[] }): Promise<unknown> {
          requests.push({ provider: name, ...input });
          if (input.method === 'eth_accounts') return connected || name === 'Brave' ? [owner] : [];
          if (input.method === 'eth_requestAccounts') { connected = true; return [owner]; }
          if (input.method === 'eth_chainId') return name === 'Brave' ? '0xb626' : chain;
          if (input.method === 'wallet_switchEthereumChain') { emit(name, 'chainChanged', (input.params?.[0] as { chainId: string }).chainId); return null; }
          if (name !== 'MetaMask') throw Error('BRAVE_OWNER_REQUEST_FORBIDDEN');
          if (input.method === 'eth_getTransactionCount') return w.grylooLendingTestRpc(input.method, input.params ?? []);
          if (input.method === 'eth_sendTransaction') return w.grylooLendingTestRpc('MOCK_submit', [{
            ...input.params?.[0] as Record<string, unknown>, nonce: await w.grylooLendingTestRpc('eth_getTransactionCount', [owner, 'pending']),
          }]);
          throw Error('MOCK_WALLET_METHOD_DENIED');
        },
        on(event: string, listener: (...args: unknown[]) => void) { const group = events.get(event) ?? new Set(); group.add(listener); events.set(event, group); },
        removeListener(event: string, listener: (...args: unknown[]) => void) { events.get(event)?.delete(listener); },
      };
    }
    const brave = wallet('Brave'), metaMask = wallet('MetaMask');
    const announce = (provider: typeof metaMask, rdns: string) => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: { provider, info: { rdns, uuid: rdns === 'io.metamask' ? '9b445307-7284-45be-83a4-40028c516438' : 'ad01df39-a885-46c3-97e8-fd3b71b2cfa5', name: rdns, icon: 'data:image/png;base64,' } },
    }));
    w.ethereum = mode === 'legacy' ? { ...brave, providers: [brave, metaMask] } : brave;
    if (mode !== 'legacy') window.addEventListener('eip6963:requestProvider', () => {
      announce(brave, 'com.brave.wallet'); if (mode !== 'late') announce(metaMask, 'io.metamask');
    });
    w.walletProviderTest = { requests, announceMetaMask: () => announce(metaMask, 'io.metamask'), emit,
      listenerCount: (provider, event) => listeners.get(provider)?.get(event)?.size ?? 0 };
  }, { owner: LENDING_OWNER, mode, locked });
}
const controls = (page: Page) => page.evaluate(() => (window as unknown as { walletProviderTest: Controls }).walletProviderTest.requests);
const panel = (page: Page) => page.getByRole('region', { name: 'Lending composition' });
const walletLabel = `Wallet: ${LENDING_OWNER.slice(0, 6)}…${LENDING_OWNER.slice(-4)} · Base Sepolia`;
test.beforeEach(async () => { await resetLending(); });

for (const mode of ['legacy', 'eip6963'] as const) {
  test(`${mode}: top bar and lending execution use MetaMask Base Sepolia instead of aggregate Brave`, async ({ page }) => {
    await install(page, mode); await page.goto('/');
    await expect(page.getByText(walletLabel, { exact: true })).toBeVisible();
    await page.getByText('Advanced action setup', { exact: true }).click();
    await page.getByRole('form', { name: 'Compose lending' }).getByRole('button', { name: 'Review lending proposal' }).click();
    await page.getByRole('button', { name: 'Apply proposal' }).click(); await page.getByRole('button', { name: 'Continue to Simulate' }).click();
    await page.getByRole('button', { name: 'Simulate lending composition', exact: true }).click(); await expect(panel(page)).toContainText('Expected output:');
    await page.getByRole('button', { name: 'Review lending composition', exact: true }).click(); await page.getByRole('button', { name: 'Accept composed Review' }).click();
    await panel(page).getByRole('button', { name: 'Execute pool approval', exact: true }).click(); await expect(panel(page)).toContainText('POOL_APPROVAL: reconciled');
    const requests = await controls(page);
    expect(requests.every(request => request.provider === 'MetaMask')).toBe(true);
    expect(requests.map(request => request.method)).toEqual(expect.arrayContaining(['eth_accounts', 'eth_chainId', 'eth_getTransactionCount', 'eth_sendTransaction']));
    expect(requests.filter(request => request.method === 'eth_sendTransaction')).toHaveLength(1);
    expect(requests.filter(request => request.method === 'eth_requestAccounts')).toHaveLength(0);
    expect(await page.evaluate(() => (window as unknown as { walletProviderTest: Controls }).walletProviderTest.listenerCount('MetaMask', 'chainChanged'))).toBe(1);
    expect(await page.evaluate(() => (window as unknown as { walletProviderTest: Controls }).walletProviderTest.listenerCount('Brave', 'chainChanged'))).toBe(0);
  });
}
test('connect and network switching use the same EIP-6963 MetaMask provider', async ({ page }) => {
  await install(page, 'eip6963', true); await page.goto('/'); await page.getByRole('button', { name: 'Connect Wallet', exact: true }).click();
  await expect(page.getByText(walletLabel, { exact: true })).toBeVisible();
  await page.getByText('Advanced action setup', { exact: true }).click(); await page.getByText('Base → Arbitrum → WETH', { exact: true }).click();
  await page.getByLabel('Source amount (USDC)').fill('1'); await page.getByRole('button', { name: 'Review Base → Arbitrum bridge → WETH swap' }).click();
  await page.getByRole('button', { name: 'Apply proposal' }).click(); await page.getByRole('button', { name: 'Switch to Base (8453)' }).click();
  await expect(page.getByText(`Wallet: ${LENDING_OWNER.slice(0, 6)}…${LENDING_OWNER.slice(-4)} · Base (8453)`, { exact: true })).toBeVisible();
  const requests = await controls(page);
  expect(requests.every(request => request.provider === 'MetaMask')).toBe(true);
  expect(requests.filter(request => request.method === 'eth_requestAccounts')).toHaveLength(1);
  expect(requests.filter(request => request.method === 'wallet_switchEthereumChain')).toEqual([{ provider: 'MetaMask', method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] }]);
});
test('late MetaMask discovery rebinds listeners and ignores the old Brave wallet events', async ({ page }) => {
  await install(page, 'late'); await page.goto('/');
  await expect(page.getByText(`Wallet: ${LENDING_OWNER.slice(0, 6)}…${LENDING_OWNER.slice(-4)} · Robinhood Chain Testnet (46630)`, { exact: true })).toBeVisible();
  await page.evaluate(() => (window as unknown as { walletProviderTest: Controls }).walletProviderTest.announceMetaMask());
  await expect(page.getByText(walletLabel, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { walletProviderTest: Controls }).walletProviderTest.listenerCount('Brave', 'accountsChanged'))).toBe(0);
  await page.evaluate(() => { const test = (window as unknown as { walletProviderTest: Controls }).walletProviderTest;
    test.emit('Brave', 'chainChanged', '0x1'); test.emit('Brave', 'accountsChanged', []); });
  await expect(page.getByText(walletLabel, { exact: true })).toBeVisible();
  await page.evaluate(() => (window as unknown as { walletProviderTest: Controls }).walletProviderTest.emit('MetaMask', 'accountsChanged', []));
  await expect(page.getByRole('button', { name: 'Connect Wallet', exact: true })).toBeVisible();
});
test('without an injected provider, existing no-wallet behavior remains', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Connect Wallet', exact: true }).click();
  await expect(page.locator('.wallet-toast[role="alert"]')).toContainText('No wallet found. Install or enable a browser wallet.');
  await expect(page.locator('.build009-wallet-info')).toHaveCount(0);
});
