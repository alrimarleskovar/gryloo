// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-ETHEREUM-001: Aave V3 WBTC Supply on Ethereum Sepolia through the injected wallet, on the MOCKED loopback harness
 * (`/ethereum-sepolia` reserve). Wallet network safety: the reviewed chain is 0xaa36a7; a wallet on Base Sepolia, on
 * Ethereum Mainnet, or moved after Review never receives a transaction request; switching is explicit and never signs.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { installSupplyWallet, resetSupplyHarness, reviewSupply, SUPPLY_OWNER, supplySendCount } from './supply-fixtures';

const ROUTE = '/ethereum-sepolia' as const;
const WBTC = '0x29f2d40b0605204364af54ec677bd022da425d03', POOL = '0x6ae43d3271ff6888e7fc43fd7321a503ff738951';
type WalletRequest = { method: string; params?: unknown[] };
const requests = (page: Page) => page.evaluate(() => (window as unknown as { supplyWalletRequests: WalletRequest[] }).supplyWalletRequests);
const region = (page: Page) => page.getByRole('region', { name: 'Aave Supply' });

async function authorWbtcSupply(page: Page) {
  await page.goto('/'); await page.getByRole('button', { name: 'Add supply', exact: true }).click();
  const form = page.getByRole('form', { name: 'Create Supply' });
  await form.getByLabel('Supply network').selectOption('Ethereum Sepolia');
  await form.getByLabel('Supply amount (WBTC)').fill('0.001'); await form.getByLabel('Supply beneficiary').fill(SUPPLY_OWNER);
  await form.getByRole('button', { name: 'Add Supply', exact: true }).click();
  await expect(page.locator('.react-flow__node[data-id="node-002"]')).toContainText('0.001 WBTC · Ethereum Sepolia');
}
async function executeAll(page: Page) {
  await region(page).getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Execute Supply', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Execute Supply', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download Evidence Bundle' })).toBeVisible();
}

test.beforeEach(async () => { await resetSupplyHarness({}, ROUTE); });

test('WBTC Supply on Ethereum Sepolia: Build → Simulate → Review → Execute through the injected wallet on 0xaa36a7', async ({ page }) => {
  const pageErrors: string[] = []; page.on('pageerror', error => pageErrors.push(error.message));
  await installSupplyWallet(page, { chain: '0xaa36a7', route: ROUTE });
  await authorWbtcSupply(page); await reviewSupply(page);
  await expect(region(page)).toContainText('Ethereum Sepolia');
  expect(await supplySendCount(page)).toBe(0);
  await executeAll(page);
  const sent = (await requests(page)).filter(r => r.method === 'eth_sendTransaction').map(r => r.params![0] as { chainId: string; to: string; from: string; value: string });
  expect(sent.map(tx => [tx.chainId, tx.to, tx.from, tx.value])).toEqual([['0xaa36a7', WBTC, SUPPLY_OWNER, '0x0'], ['0xaa36a7', POOL, SUPPLY_OWNER, '0x0']]);
  const href = await page.getByRole('link', { name: 'Download Evidence Bundle' }).getAttribute('href');
  const evidence = JSON.parse(decodeURIComponent(href!.split(',')[1]!)) as { bundle: { environment: string; outcome: string } };
  expect(evidence.bundle).toMatchObject({ environment: 'MOCKED', outcome: 'RECONCILED' });
  expect(pageErrors).toEqual([]);
});

for (const [label, chain] of [['Base Sepolia', '0x14a34'], ['Ethereum Mainnet', '0x1']] as const)
  test(`a wallet on ${label} during an Ethereum Sepolia Review fails closed and never touches Mainnet`, async ({ page }) => {
    await installSupplyWallet(page, { chain, route: ROUTE });
    await authorWbtcSupply(page); await reviewSupply(page);
    await expect(region(page).getByRole('button', { name: 'Switch wallet to Ethereum Sepolia' })).toBeVisible();
    await region(page).getByRole('button', { name: 'Execute', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Switch your wallet to Ethereum Sepolia' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download Evidence Bundle' })).toHaveCount(0);
    const seen = await requests(page);
    expect(seen.filter(r => r.method === 'eth_sendTransaction')).toEqual([]);
    expect(seen.filter(r => r.method === 'wallet_addEthereumChain')).toEqual([]);
    expect(seen.filter(r => r.method === 'wallet_switchEthereumChain' && (r.params?.[0] as { chainId: string }).chainId !== '0xaa36a7')).toEqual([]);
  });

test('switching is explicit, adds Ethereum Sepolia only from known parameters on 4902, and never signs', async ({ page }) => {
  await installSupplyWallet(page, { chain: '0x14a34', route: ROUTE, switching: 'UNKNOWN' });
  await authorWbtcSupply(page); await reviewSupply(page);
  await region(page).getByRole('button', { name: 'Switch wallet to Ethereum Sepolia' }).click();
  await expect(region(page).getByRole('button', { name: 'Switch wallet to Ethereum Sepolia' })).toHaveCount(0);
  const seen = await requests(page), switching = seen.slice(seen.findIndex(r => r.method === 'wallet_switchEthereumChain'));
  expect(switching.slice(0, 4).map(r => r.method)).toEqual(['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain', 'eth_chainId']);
  expect(switching[1]!.params![0]).toMatchObject({ chainId: '0xaa36a7', chainName: 'Ethereum Sepolia', nativeCurrency: { decimals: 18 },
    blockExplorerUrls: ['https://sepolia.etherscan.io'] });
  expect(seen.filter(r => r.method === 'eth_sendTransaction')).toEqual([]);
  // The switched wallet then executes the reviewed calls on 0xaa36a7 only.
  await executeAll(page);
  expect(await supplySendCount(page)).toBe(2);
});

test('a wallet moved to Base Sepolia after Review fails closed before any request', async ({ page }) => {
  await installSupplyWallet(page, { chain: '0xaa36a7', route: ROUTE });
  await authorWbtcSupply(page); await reviewSupply(page);
  await page.evaluate(() => (window as unknown as { setSupplyWalletChain: (chain: string) => void }).setSupplyWalletChain('0x14a34'));
  await region(page).getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Switch your wallet to Ethereum Sepolia' })).toBeVisible();
  expect(await supplySendCount(page)).toBe(0);
});
