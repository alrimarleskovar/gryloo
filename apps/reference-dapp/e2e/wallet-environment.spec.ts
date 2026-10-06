// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

type WalletControls = {
  setChain(chain: string): void; disconnect(): void;
  pauseSwitch(): void; releaseSwitch(result: 'switch' | 'reject' | 'unchanged'): void;
  requests: { method: string; params?: unknown[] }[];
};
async function installWallet(page: Page, connected = true, chain = '0x14a34') {
  await page.addInitScript(({ connected, chain }) => {
    const owner = '0x1111111111111111111111111111111111111111';
    const state = { connected, chain, pause: false };
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const requests: WalletControls['requests'] = [];
    let release: ((result: 'switch' | 'reject' | 'unchanged') => void) | undefined;
    const emit = (event: string, value: unknown) => { for (const listener of listeners.get(event) ?? []) listener(value); };
    const controls: WalletControls = {
      requests, setChain(value) { state.chain = value; emit('chainChanged', value); },
      disconnect() { state.connected = false; emit('accountsChanged', []); },
      pauseSwitch() { state.pause = true; }, releaseSwitch(result) { release?.(result); },
    };
    const provider = {
      on(event: string, listener: (...args: unknown[]) => void) { const group = listeners.get(event) ?? new Set(); group.add(listener); listeners.set(event, group); },
      removeListener(event: string, listener: (...args: unknown[]) => void) { listeners.get(event)?.delete(listener); },
      async request(input: { method: string; params?: unknown[] }) {
        requests.push(input);
        if (input.method === 'eth_accounts') return state.connected ? [owner] : [];
        if (input.method === 'eth_requestAccounts') { state.connected = true; return [owner]; }
        if (input.method === 'eth_chainId') return state.chain;
        if (input.method === 'wallet_switchEthereumChain') {
          const result = state.pause ? await new Promise<'switch' | 'reject' | 'unchanged'>(resolve => { release = resolve; }) : 'switch';
          state.pause = false;
          if (result === 'reject') throw Object.assign(new Error('User rejected network switch'), { code: 4001 });
          if (result === 'switch') controls.setChain((input.params?.[0] as { chainId: string }).chainId);
          return null;
        }
        throw new Error('Unexpected wallet method');
      },
    };
    Object.assign(window, { ethereum: provider, walletEnvironmentTest: controls });
  }, { connected, chain });
}
const setChain = (page: Page, chain: string) => page.evaluate(value => (window as unknown as { walletEnvironmentTest: WalletControls }).walletEnvironmentTest.setChain(value), chain);

test('header and Bridge use the actual EVM wallet chain, update live, and keep unknown chains neutral', async ({ page }) => {
  await installWallet(page); await page.goto('/');
  const indicator = page.locator('.header-environment-control'), environment = page.getByRole('combobox', { name: 'Environment', exact: true });
  await expect(environment).toHaveValue('PUBLIC_TESTNET');
  await page.getByRole('button', { name: 'Add bridge', exact: true }).click();
  const card = page.locator('.composer-card');
  await card.getByRole('textbox').fill('2.5');
  for (const [chain, mode, source, destination, solana] of [
    ['0x14a34', 'testnet', 'Base Sepolia', 'Arbitrum Sepolia', 'Solana Devnet'],
    ['0x66eee', 'testnet', 'Base Sepolia', 'Arbitrum Sepolia', 'Solana Devnet'],
    ['0x2105', 'mainnet', 'Base', 'Arbitrum', 'Solana'],
    ['0xa4b1', 'mainnet', 'Base', 'Arbitrum', 'Solana'],
  ] as const) {
    await setChain(page, chain);
    await expect(indicator).toHaveAttribute('data-environment', mode);
    await expect(environment).toHaveValue(mode === 'mainnet' ? 'MAINNET' : 'PUBLIC_TESTNET');
    await expect(indicator.locator('.header-mainnet-dot')).toHaveCount(mode === 'mainnet' ? 1 : 0);
    if (mode === 'mainnet') await expect(indicator.locator('.header-mainnet-dot')).toHaveCSS('background-color', 'rgb(34, 197, 94)');
    await expect(card.getByRole('button', { name: 'Configure source asset', exact: true })).toHaveAttribute('title', `USDC on ${source}`);
    await expect(card.getByRole('button', { name: 'Configure destination asset', exact: true })).toHaveAttribute('title', `USDC on ${destination}`);
    for (const [side, network] of [['source', source], ['destination', destination]] as const) {
      await card.getByRole('button', { name: `Configure ${side} asset`, exact: true }).click();
      const panel = page.getByRole('region', { name: `${side === 'source' ? 'Source' : 'Destination'} network picker`, exact: true });
      expect(await panel.getByRole('button').evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')))).toEqual([network, solana]);
      await expect(panel.getByRole('button', { name: network, exact: true })).toBeEnabled();
      await expect(panel.getByRole('button', { name: solana, exact: true })).toBeDisabled();
      await page.getByRole('button', { name: 'Hide bridge picker', exact: true }).click();
    }
    await expect(card.getByRole('textbox')).toHaveValue('2.5');
  }
  await card.getByRole('button', { name: 'Review amount', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Apply amount', exact: true })).toBeEnabled();
  await setChain(page, '0x14a34');
  await expect(card.getByRole('button', { name: 'Apply amount', exact: true })).toBeDisabled();
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
  await card.getByRole('button', { name: 'Review amount', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Apply amount', exact: true })).toBeEnabled();
  await setChain(page, '0x89');
  await expect(indicator).toHaveAttribute('data-environment', 'unknown');
  await expect(environment).toHaveValue(''); await expect(indicator.locator('.header-mainnet-dot')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Review amount', exact: true })).toBeDisabled();
  await expect(card.getByRole('button', { name: 'Apply amount', exact: true })).toBeDisabled();
  await expect(page.getByRole('group', { name: 'Wallet connection' })).toContainText('Other chain (0x89)');
  await card.getByRole('button', { name: 'Configure source asset', exact: true }).click();
  const unknown = page.getByRole('region', { name: 'Source network picker', exact: true });
  await expect(unknown.locator('button:enabled')).toHaveCount(0);
  await expect(unknown.getByRole('button', { name: 'Solana', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Hide bridge picker', exact: true }).click();
  await setChain(page, '0x2105'); await expect(indicator).toHaveAttribute('data-environment', 'mainnet');
  await expect(card.getByRole('button', { name: 'Apply amount', exact: true })).toBeDisabled();
  await card.getByRole('button', { name: 'Review amount', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Apply amount', exact: true })).toBeEnabled();
  await page.evaluate(() => (window as unknown as { walletEnvironmentTest: WalletControls }).walletEnvironmentTest.disconnect());
  await expect(environment).toHaveValue(''); await expect(indicator.locator('.header-mainnet-dot')).toHaveCount(0);
  await expect(environment).toBeDisabled();
  await expect(card.getByRole('button', { name: 'Review amount', exact: true })).toBeDisabled();
  await expect(card.getByRole('button', { name: 'Apply amount', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Connect Wallet', exact: true }).click();
  await expect(environment).toHaveValue('MAINNET');
  await expect(card.getByRole('button', { name: 'Apply amount', exact: true })).toBeDisabled();
});

test('Network control waits for actual wallet confirmation and never fabricates a successful switch', async ({ page }) => {
  await installWallet(page); await page.goto('/');
  const environment = page.getByRole('combobox', { name: 'Environment', exact: true }), dot = page.locator('.header-mainnet-dot');
  await expect(environment).toHaveValue('PUBLIC_TESTNET');
  for (const result of ['reject', 'unchanged', 'switch'] as const) {
    await page.evaluate(() => (window as unknown as { walletEnvironmentTest: WalletControls }).walletEnvironmentTest.pauseSwitch());
    await environment.selectOption('MAINNET');
    await expect(environment).toBeDisabled(); await expect(environment).toHaveValue('PUBLIC_TESTNET'); await expect(dot).toHaveCount(0);
    await page.evaluate(value => (window as unknown as { walletEnvironmentTest: WalletControls }).walletEnvironmentTest.releaseSwitch(value), result);
    await expect(environment).toBeEnabled();
    await expect(environment).toHaveValue(result === 'switch' ? 'MAINNET' : 'PUBLIC_TESTNET');
    await expect(dot).toHaveCount(result === 'switch' ? 1 : 0);
  }
  await environment.selectOption('PUBLIC_TESTNET');
  await expect(environment).toHaveValue('PUBLIC_TESTNET'); await expect(dot).toHaveCount(0);
  const requests = await page.evaluate(() => (window as unknown as { walletEnvironmentTest: WalletControls }).walletEnvironmentTest.requests);
  expect(requests.filter(request => request.method === 'wallet_switchEthereumChain').map(request => request.params)).toEqual([
    [{ chainId: '0x2105' }], [{ chainId: '0x2105' }], [{ chainId: '0x2105' }], [{ chainId: '0x14a34' }],
  ]);
  expect(requests.some(request => /sign|send|addEthereumChain/.test(request.method))).toBe(false);
});

test('a disconnected wallet is neutral until connection reports its actual network', async ({ page }) => {
  await installWallet(page, false, '0x2105'); await page.goto('/');
  const environment = page.getByRole('combobox', { name: 'Environment', exact: true });
  await expect(environment).toHaveValue(''); await expect(page.locator('.header-mainnet-dot')).toHaveCount(0);
  await page.getByRole('button', { name: 'Connect Wallet', exact: true }).click();
  await expect(environment).toHaveValue('MAINNET'); await expect(page.locator('.header-mainnet-dot')).toBeVisible();
});

for (const cluster of ['solana:devnet', 'solana:mainnet']) test(`${cluster} connected session drives the header and Bridge without inferring an environment from the workflow`, async ({ page }) => {
  await page.addInitScript(() => {
    const chains = ['solana:mainnet', 'solana:devnet'];
    const account = { address: '11111111111111111111111111111111', chains, features: ['solana:signTransaction'] };
    const wallet = { name: 'Environment test wallet', chains, accounts: [account], features: {
      'standard:connect': { connect: async () => ({ accounts: [account] }) },
      'solana:signTransaction': { signTransaction: async () => { throw new Error('Unexpected signing request'); } },
    } };
    window.addEventListener('wallet-standard:app-ready', event => (event as CustomEvent<{ register(wallet: unknown): void }>).detail.register(wallet));
  });
  await page.goto('/');
  await page.locator('#mock-prompt').fill(cluster === 'solana:mainnet' ? 'Swap 1 USDC to SOL on Solana' : 'Swap 0.1 SOL to devUSDC on Solana Devnet');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: 'Apply proposal', exact: true }).click();
  const environment = page.getByRole('combobox', { name: 'Environment', exact: true });
  await expect(environment).toHaveValue('');
  await page.getByRole('button', { name: 'Simular Fees', exact: true }).click();
  await page.getByRole('button', { name: 'Connect Solana wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Environment test wallet', exact: true }).click();
  const mainnet = cluster === 'solana:mainnet';
  await expect(environment).toHaveValue(mainnet ? 'MAINNET' : 'PUBLIC_TESTNET');
  await expect(environment).toBeDisabled();
  await expect(page.locator('.header-mainnet-dot')).toHaveCount(mainnet ? 1 : 0);
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await page.getByRole('button', { name: 'Add bridge', exact: true }).click();
  const card = page.locator('.composer-card').filter({ hasText: 'Router' });
  await card.getByRole('button', { name: 'Configure source asset', exact: true }).click();
  const networks = page.getByRole('region', { name: 'Source network picker', exact: true });
  await expect(networks.getByRole('button', { name: mainnet ? 'Base' : 'Base Sepolia', exact: true })).toBeEnabled();
  await expect(networks.getByRole('button', { name: mainnet ? 'Solana' : 'Solana Devnet', exact: true })).toBeDisabled();
});
