// SPDX-License-Identifier: AGPL-3.0-only
// Credentials: public wallet references through the canonical selector, and the secure card-provider gate. MOCKED wallets only.
import { test, expect, chooseWallet } from './fixtures';
import { installMultichainWallets, promptingCalls, WALLET_ACCOUNTS } from './wallet-fixtures';
import type { Page } from '@playwright/test';

const STORAGE = 'flofi.credentials.v1';
const cards = (page: Page) => page.locator('.workspace-wallet-card');
const stored = (page: Page) => page.evaluate(key => localStorage.getItem(key) ?? '', STORAGE);
async function addWallet(page: Page, name: string, ecosystem: 'Ethereum' | 'Solana') {
  await page.getByRole('button', { name: 'Add wallet', exact: true }).click();
  await expect(page.locator('dialog.wallet-selector[open]').getByRole('heading', { name: 'Add a wallet' })).toBeVisible();
  await chooseWallet(page, name, ecosystem);
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: Add wallet uses the canonical selector and saves distinct public references for every ecosystem`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(value => {
      localStorage.setItem('flofi.theme', value);
      const copied: string[] = [];
      Object.defineProperty(window, 'copiedAddresses', { get: () => copied });
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { copied.push(text); } } });
    }, theme);
    await installMultichainWallets(page); await page.goto('/app/credentials');
    await expect(page.getByRole('heading', { name: 'Credentials', level: 1 })).toBeVisible();
    await expect(page.getByText('No wallets yet', { exact: true })).toBeVisible();
    // Opening Add wallet never launches a wallet; Escape returns focus to the button.
    const add = page.getByRole('button', { name: 'Add wallet', exact: true });
    // focus() does not wait for the server-rendered shell to become interactive.
    await expect(page.locator('.app-shell')).not.toHaveAttribute('inert', '');
    await add.focus(); await page.keyboard.press('Enter');
    await expect(page.locator('dialog.wallet-selector[open]')).toBeVisible();
    expect(await promptingCalls(page)).toEqual([]);
    await page.keyboard.press('Escape'); await expect(add).toBeFocused();

    await addWallet(page, 'MetaMask', 'Ethereum');
    await expect(cards(page)).toHaveCount(1);
    await addWallet(page, 'Phantom', 'Solana');
    await addWallet(page, 'Rabby Wallet', 'Ethereum');
    await expect(cards(page)).toHaveCount(3);
    await expect(page.locator('#credentials-wallets + .workspace-count')).toHaveText('3');
    const metaMask = page.getByRole('article', { name: 'MetaMask, Ethereum' }), phantom = page.getByRole('article', { name: 'Phantom, Solana' });
    const rabby = page.getByRole('article', { name: 'Rabby Wallet, Ethereum' });
    await expect(metaMask).toContainText('MetaMask · Ethereum'); await expect(metaMask).toContainText('Saved');
    await expect(metaMask.locator('code')).toHaveAttribute('title', WALLET_ACCOUNTS.metaMask);
    await expect(phantom).toContainText('Phantom · Solana'); await expect(phantom).toContainText('Solana Devnet'); await expect(phantom).toContainText('Active');
    await expect(phantom.locator('code')).toHaveAttribute('title', WALLET_ACCOUNTS.phantomSolana);
    await expect(rabby).toContainText('Active'); await expect(rabby.locator('code')).toHaveAttribute('title', WALLET_ACCOUNTS.rabby);
    await expect(rabby).toHaveCSS('background-color', theme === 'dark' ? 'rgb(28, 32, 41)' : 'rgb(255, 255, 255)');

    // Adding wallets only connected them: no signature, transaction or authorization request reached any wallet.
    expect(await promptingCalls(page)).toEqual([{ wallet: 'MetaMask', method: 'eth_requestAccounts' }, { wallet: 'Phantom Solana', method: 'standard:connect' },
      { wallet: 'Rabby Wallet', method: 'eth_requestAccounts' }]);
    const saved = JSON.parse(await stored(page)) as { wallets: Record<string, unknown>[]; cards: unknown[] };
    expect(saved.wallets.map(wallet => Object.keys(wallet).sort())).toEqual(Array(3).fill(['addedAt', 'address', 'ecosystem', 'id', 'label', 'lastNetwork', 'providerKey', 'providerName']));
    expect(await stored(page)).not.toMatch(/private|seed|mnemonic|secret|signature/i);

    // Rename (Escape cancels, Enter saves), copy and the absence of any key reveal.
    await rabby.getByRole('button', { name: 'Rename Rabby Wallet' }).click();
    await rabby.getByRole('textbox', { name: 'Wallet name' }).fill('Should not stick'); await page.keyboard.press('Escape');
    await expect(rabby).toContainText('Rabby Wallet · Ethereum');
    await rabby.getByRole('button', { name: 'Rename Rabby Wallet' }).click();
    await rabby.getByRole('textbox', { name: 'Wallet name' }).fill('Trading'); await page.keyboard.press('Enter');
    const trading = page.getByRole('article', { name: 'Trading, Ethereum' });
    await expect(trading.getByRole('heading', { name: 'Trading' })).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('Wallet renamed.');
    await trading.getByRole('button', { name: 'Copy Trading address' }).click();
    expect(await page.evaluate(() => (window as unknown as { copiedAddresses: string[] }).copiedAddresses)).toEqual([WALLET_ACCOUNTS.rabby]);
    await expect(page.getByRole('button', { name: /reveal|private key|seed/i })).toHaveCount(0);

    // Removing the active EVM wallet removes FloFi's reference and ends the session; other credentials stay.
    await trading.getByRole('button', { name: 'Remove Trading' }).click();
    await expect(trading.getByRole('group', { name: 'Remove Trading' })).toContainText('the wallet and its assets are not affected');
    await trading.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(cards(page)).toHaveCount(2);
    await expect(page.locator('.build009-wallet-info')).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('removed from FloFi. Your wallet and its funds are unchanged.');
    expect(JSON.parse(await stored(page)).wallets).toHaveLength(2);
    expect(errors).toEqual([]);
  });
}

test('Connect activates a saved wallet only after an explicit click, through exactly its provider', async ({ page }) => {
  await installMultichainWallets(page); await page.goto('/app/credentials');
  await addWallet(page, 'MetaMask', 'Ethereum');
  await addWallet(page, 'Phantom', 'Ethereum');
  const metaMask = page.getByRole('article', { name: 'MetaMask, Ethereum' });
  await expect(metaMask).toContainText('Saved');
  const before = (await promptingCalls(page)).length;
  await metaMask.getByRole('button', { name: 'Connect MetaMask' }).click();
  await expect(metaMask).toContainText('Active');
  expect((await promptingCalls(page)).slice(before)).toEqual([{ wallet: 'MetaMask', method: 'eth_requestAccounts' }]);
  await expect(page.getByRole('article', { name: 'Phantom, Ethereum' })).toContainText('Saved');
  await metaMask.getByRole('button', { name: 'Disconnect MetaMask' }).click();
  await expect(metaMask).toContainText('Saved');
  await expect(page.getByRole('button', { name: 'Connect Wallet', exact: true })).toBeVisible();
});

test('Add card opens only the secure-provider gate: no card fields, nothing stored, prerequisite stated', async ({ page }) => {
  await page.goto('/app/credentials');
  const add = page.getByRole('button', { name: 'Add card', exact: true });
  await add.click();
  const dialog = page.getByRole('dialog', { name: 'Add a card' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('status')).toContainText('Secure card entry isn’t available yet.'.replace('’', "'"));
  await expect(dialog.getByRole('status')).toContainText('no card provider is connected to FloFi yet');
  await expect(dialog.locator('input, textarea, select, iframe')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0); await expect(add).toBeFocused();
  expect(await stored(page)).toBe('');
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))).not.toMatch(/\d{13,19}|cvv|cvc/i);
  await expect(page.getByText('No payment provider connected', { exact: true })).toBeVisible();
  await expect(page.getByText(/PixBlock/)).toHaveCount(0);
});
