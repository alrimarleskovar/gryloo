// SPDX-License-Identifier: AGPL-3.0-only
// Wallet calls and execution below are MOCKED loopback fixtures; no extension, signing or public submission.
import { test, expect, chooseWallet, openProposalReview, openSimulationDetails } from './fixtures';
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
const walletLabel = `EVM Default: ${LENDING_OWNER.slice(0, 6)}…${LENDING_OWNER.slice(-4)} · Base Sepolia`;
async function approveAndExecutePoolApproval(page: Page) {
  await openSimulationDetails(page);
  await page.getByRole('button', { name: 'Simulate lending composition', exact: true }).click();
  await expect(panel(page)).toContainText('Expected output:');
  expect((await controls(page)).filter(request => request.method === 'eth_sendTransaction')).toHaveLength(0);
  await expect(page.getByRole('button', { name: 'Approve & Continue', exact: true }),
    await page.locator('.review-validity').innerText()).toBeEnabled();
  await page.getByRole('button', { name: 'Approve & Continue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review approved', exact: true })).toBeVisible();
  expect((await controls(page)).filter(request => request.method === 'eth_sendTransaction')).toHaveLength(0);
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Execute', exact: true }).click();
  await page.getByRole('button', { name: 'Execute workflow', exact: true }).click();
  await expect(page.locator('.execution-operation.execution-state-confirmed')).toHaveCount(1);
}
test.beforeEach(async () => { await resetLending(); });

for (const mode of ['legacy', 'eip6963'] as const) {
  test(`${mode}: top bar and lending execution use MetaMask Base Sepolia instead of aggregate Brave`, async ({ page }) => {
    await install(page, mode); await page.goto('/app');
    await expect(page.getByText(walletLabel, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Add Supply → Borrow → Swap', exact:true }).click();
    await openProposalReview(page); await page.getByRole('button', { name: 'Apply proposal' }).click(); await page.getByRole('button', { name: 'Simulate fees' }).click();
    await approveAndExecutePoolApproval(page);
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
  await install(page, 'eip6963', true); await page.goto('/app'); await page.getByRole('button', { name: 'Connect Wallet', exact: true }).click();
  // The selector is open and no wallet has been asked for accounts yet; Brave is never offered.
  expect((await controls(page)).filter(request => request.method === 'eth_requestAccounts')).toHaveLength(0);
  await expect(page.locator('dialog.wallet-selector').getByRole('button', { name: /Brave/ })).toHaveCount(0);
  await chooseWallet(page, 'io.metamask');
  await expect(page.getByText(walletLabel, { exact: true })).toBeVisible();
  await page.getByText('Advanced action setup', { exact: true }).click(); await page.getByText('Base → Arbitrum → WETH', { exact: true }).click();
  await page.getByLabel('Source amount (USDC)').fill('1'); await page.getByRole('button', { name: 'Review Base → Arbitrum bridge → WETH swap' }).click();
  await openProposalReview(page); await page.getByRole('button', { name: 'Apply proposal' }).click(); await page.getByRole('button', { name: 'Switch to Base (8453)' }).click();
  await expect(page.getByText(`EVM Default: ${LENDING_OWNER.slice(0, 6)}…${LENDING_OWNER.slice(-4)} · Base (8453)`, { exact: true })).toBeVisible();
  const requests = await controls(page);
  expect(requests.every(request => request.provider === 'MetaMask')).toBe(true);
  expect(requests.filter(request => request.method === 'eth_requestAccounts')).toHaveLength(1);
  expect(requests.filter(request => request.method === 'wallet_switchEthereumChain')).toEqual([{ provider: 'MetaMask', method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] }]);
});
test('late MetaMask discovery rebinds listeners and ignores the old Brave wallet events', async ({ page }) => {
  await install(page, 'late'); await page.goto('/app');
  await expect(page.getByText('No compatible wallet. Enable MetaMask or Rabby for this site and refresh; Brave Wallet cannot be used.', { exact: true })).toBeVisible();
  await expect(page.locator('.build009-wallet-info')).toHaveCount(0);
  expect(await controls(page)).toEqual([]);
  await page.evaluate(() => (window as unknown as { walletProviderTest: Controls }).walletProviderTest.announceMetaMask());
  await expect(page.getByText(walletLabel, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { walletProviderTest: Controls }).walletProviderTest.listenerCount('Brave', 'accountsChanged'))).toBe(0);
  await page.evaluate(() => { const test = (window as unknown as { walletProviderTest: Controls }).walletProviderTest;
    test.emit('Brave', 'chainChanged', '0x1'); test.emit('Brave', 'accountsChanged', []); });
  await expect(page.getByText(walletLabel, { exact: true })).toBeVisible();
  await page.evaluate(() => (window as unknown as { walletProviderTest: Controls }).walletProviderTest.emit('MetaMask', 'accountsChanged', []));
  await expect(page.getByRole('button', { name: 'Connect Wallet', exact: true })).toBeVisible();
});
test('without an injected provider, the selector says so truthfully and connects nothing', async ({ page }) => {
  await page.goto('/app'); await page.getByRole('button', { name: 'Connect Wallet', exact: true }).click();
  const selector = page.locator('dialog.wallet-selector[open]');
  await expect(selector.getByRole('status')).toHaveText('No wallet detected in this browser. Install or enable a wallet extension, then refresh.');
  await expect(selector.getByRole('listitem', { name: 'MetaMask on Ethereum, not detected' })).toBeVisible();
  await expect(selector.getByRole('listitem', { name: 'Phantom on Solana, not detected' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(selector).toHaveCount(0);
  await expect(page.locator('.build009-wallet-info')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connect Wallet', exact: true })).toBeFocused();
});

// Real Rabby lifecycle: it announces io.rabby (at injection and on request) and also injects a separate window.ethereum
// proxy that claims isMetaMask. Only the announced provider may receive owner requests; there is no MetaMask here.
test('Rabby: EIP-6963 io.rabby announcement drives the wallet, never its window.ethereum proxy', async ({ page }) => {
  await page.exposeFunction('grylooLendingTestRpc', lendingRpc);
  await page.addInitScript(({ owner }) => {
    const requests: Request[] = [];
    const w = window as unknown as { ethereum: unknown; walletProviderTest: { requests: Request[] }; grylooLendingTestRpc(method: string, params: unknown[]): Promise<unknown> };
    let connected = false;
    const rabby = { isRabby: true, isMetaMask: false,
      async request(input: { method: string; params?: unknown[] }): Promise<unknown> {
        requests.push({ provider: 'Rabby', ...input });
        if (input.method === 'eth_accounts') return connected ? [owner] : [];
        if (input.method === 'eth_requestAccounts') { connected = true; return [owner]; }
        if (input.method === 'eth_chainId') return '0x14a34';
        if (input.method === 'eth_getTransactionCount') return w.grylooLendingTestRpc(input.method, input.params ?? []);
        if (input.method === 'eth_sendTransaction') return w.grylooLendingTestRpc('MOCK_submit', [{
          ...input.params?.[0] as Record<string, unknown>, nonce: await w.grylooLendingTestRpc('eth_getTransactionCount', [owner, 'pending']),
        }]);
        throw Error('MOCK_WALLET_METHOD_DENIED');
      },
      on() { /* no wallet events in this journey */ }, removeListener() { /* no wallet events in this journey */ } };
    w.ethereum = { isRabby: true, isMetaMask: true, async request(input: { method: string }) {
      requests.push({ provider: 'RabbyProxy', ...input }); throw Error('RABBY_PROXY_MUST_NOT_BE_USED'); }, on() { /* unused */ }, removeListener() { /* unused */ } };
    const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: Object.freeze({ provider: rabby, info: { rdns: 'io.rabby', uuid: '6f1d6b2e-5c3b-4f3a-9d0e-1a2b3c4d5e6f', name: 'Rabby Wallet', icon: 'data:image/png;base64,' } }),
    }));
    window.addEventListener('eip6963:requestProvider', announce);
    announce();
    w.walletProviderTest = { requests };
  }, { owner: LENDING_OWNER });
  await page.goto('/app');
  await page.getByRole('button', { name: 'Connect Wallet' }).click();
  // Only silent reads may precede the owner's choice; no account request reaches any wallet.
  expect((await controls(page)).filter(request => !['eth_accounts', 'eth_chainId'].includes(request.method))).toEqual([]);
  await chooseWallet(page, 'Rabby Wallet');
  await expect(page.getByText(walletLabel, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add Supply → Borrow → Swap', exact: true }).click();
  await openProposalReview(page); await page.getByRole('button', { name: 'Apply proposal' }).click(); await page.getByRole('button', { name: 'Simulate fees' }).click();
  await approveAndExecutePoolApproval(page);
  const requests = await controls(page);
  expect(requests.filter(request => request.provider === 'RabbyProxy')).toEqual([]);
  expect(requests.filter(request => request.method === 'eth_sendTransaction').map(request => request.provider)).toEqual(['Rabby']);
});
