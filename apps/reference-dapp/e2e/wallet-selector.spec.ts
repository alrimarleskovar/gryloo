// SPDX-License-Identifier: AGPL-3.0-only
// Canonical multichain wallet selector. Wallets are MOCKED in-page providers; nothing signs, sends or leaves loopback.
import { test, expect, chooseWallet } from './fixtures';
import { installMultichainWallets, promptingCalls, WALLET_ACCOUNTS, walletCalls } from './wallet-fixtures';
import type { Page } from '@playwright/test';

const selector = (page: Page) => page.locator('dialog.wallet-selector[open]');
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
async function open(page: Page) {
  await page.getByRole('button', { name: 'Connect Wallet', exact: true }).click();
  await expect(selector(page)).toBeVisible();
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: Connect Wallet lists every detected wallet with its ecosystem and invokes none of them`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(value => localStorage.setItem('flofi.theme', value), theme);
    await installMultichainWallets(page); await page.goto('/app');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await open(page);
    const dialog = selector(page);
    await expect(dialog.getByRole('heading', { name: 'Connect a wallet', level: 2 })).toBeVisible();
    // Detected first (alphabetical, ecosystem shown), then the catalogue of wallets this browser does not expose.
    expect(await dialog.locator('[data-wallet-option]').evaluateAll(options => options.map(option => option.getAttribute('aria-label'))))
      .toEqual(['MetaMask on Ethereum', 'Phantom on Ethereum', 'Phantom on Solana', 'Rabby Wallet on Ethereum']);
    for (const name of ['Coinbase Wallet on Ethereum, not detected', 'Backpack on Solana, not detected', 'Solflare on Solana, not detected'])
      await expect(dialog.getByRole('listitem', { name })).toContainText('Not detected');
    await expect(dialog.getByRole('button', { name: 'Phantom on Solana' }).locator('img')).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/);
    expect(await dialog.innerText()).not.toMatch(/EIP-?6963|EIP-?1193|Wallet Standard|rdns/i);
    await expect(dialog).toHaveCSS('background-color', theme === 'dark' ? 'rgb(21, 24, 31)' : 'rgb(255, 255, 255)');
    expect(await promptingCalls(page)).toEqual([]);
    // Escape and clicking outside both close without connecting; focus returns to the trigger.
    await page.keyboard.press('Escape');
    await expect(selector(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Connect Wallet', exact: true })).toBeFocused();
    await open(page);
    await page.mouse.click(8, 8);
    await expect(selector(page)).toHaveCount(0);
    expect(await promptingCalls(page)).toEqual([]);
    await expect(page.locator('.build009-wallet-info')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('keyboard choice connects exactly the chosen EVM wallet and the header names it', async ({ page }) => {
  await installMultichainWallets(page); await page.goto('/app');
  await open(page);
  const options = selector(page).locator('[data-wallet-option]');
  await expect(options.first()).toBeFocused();
  await page.keyboard.press('End'); await expect(options.last()).toBeFocused();
  await page.keyboard.press('ArrowDown'); await expect(options.first()).toBeFocused();
  await page.keyboard.press('ArrowUp'); await expect(selector(page).getByRole('button', { name: 'Rabby Wallet on Ethereum' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(selector(page)).toHaveCount(0);
  await expect(page.getByText(`Wallet: ${short(WALLET_ACCOUNTS.rabby)} · Base Sepolia`, { exact: true })).toBeVisible();
  await expect(page.locator('.header-wallet-provider')).toHaveAttribute('title', 'Rabby Wallet');
  expect(await promptingCalls(page)).toEqual([{ wallet: 'Rabby Wallet', method: 'eth_requestAccounts' }]);
  await expect(page.getByRole('combobox', { name: 'Environment', exact: true })).toHaveText('Testnet');
});

test('Phantom on Solana and Phantom on Ethereum are separate choices with separate identities', async ({ page }) => {
  await installMultichainWallets(page); await page.goto('/app');
  await open(page);
  await chooseWallet(page, 'Phantom', 'Solana');
  // Only the Solana provider was asked; the header shows the Solana account on Devnet (testnet first).
  expect(await promptingCalls(page)).toEqual([{ wallet: 'Phantom Solana', method: 'standard:connect' }]);
  await expect(page.locator('.header-wallet')).toContainText(`Solana wallet: ${WALLET_ACCOUNTS.phantomSolana.slice(0, 6)}…${WALLET_ACCOUNTS.phantomSolana.slice(-4)} · Testnet`);
  await expect(page.locator('.header-wallet-provider')).toHaveAttribute('title', 'Phantom');
  // Disconnecting the Solana session ends it in FloFi and in the wallet; then Phantom on Ethereum is a different identity.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect Wallet', exact: true })).toBeVisible();
  await open(page);
  await chooseWallet(page, 'Phantom', 'Ethereum');
  await expect(page.getByText(`Wallet: ${short(WALLET_ACCOUNTS.phantomEvm)} · Base Sepolia`, { exact: true })).toBeVisible();
  expect(await promptingCalls(page)).toEqual([{ wallet: 'Phantom Solana', method: 'standard:connect' }, { wallet: 'Phantom Solana', method: 'standard:disconnect' },
    { wallet: 'Phantom EVM', method: 'eth_requestAccounts' }]);
  expect((await walletCalls(page)).some(call => call.wallet === 'MetaMask' && call.method === 'eth_requestAccounts')).toBe(false);
});

test('a remembered wallet is highlighted first but never opened by Connect Wallet', async ({ page }) => {
  await installMultichainWallets(page); await page.goto('/app');
  await open(page); await chooseWallet(page, 'Rabby Wallet');
  await expect(page.locator('.build009-wallet-info')).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.reload();
  // After an explicit disconnect, a reload does not silently reconnect the wallet.
  await expect(page.getByRole('button', { name: 'Connect Wallet', exact: true })).toBeVisible();
  await expect(page.locator('.build009-wallet-info')).toHaveCount(0);
  await open(page);
  const first = selector(page).locator('[data-wallet-option]').first();
  await expect(first).toHaveAttribute('aria-label', 'Rabby Wallet on Ethereum');
  await expect(first).toContainText('Last used');
  expect(await promptingCalls(page)).toEqual([]);
  await page.keyboard.press('Escape');
  expect(await promptingCalls(page)).toEqual([]);
});

for (const width of [320, 768]) test(`selector fits and stays usable at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 720 });
  await installMultichainWallets(page); await page.goto('/app');
  await open(page);
  const box = (await selector(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(8); expect(box.x + box.width).toBeLessThanOrEqual(width - 8);
  expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(720);
  await expect(selector(page).getByRole('button', { name: 'MetaMask on Ethereum' })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await chooseWallet(page, 'MetaMask');
  await expect(page.locator('.build009-wallet-info')).toBeVisible();
});
