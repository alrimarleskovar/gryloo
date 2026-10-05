// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
/** Synthetic Wallet Standard injection, explicitly not an installed Phantom extension. No signing is possible. */
async function testPhantom(page: Page) {
  await page.addInitScript(() => {
    const owner = '6NTyfs83wzEo7WkkhTuNSxXiyYM9x73icbdtQWVbhaRy';
    const callbacks = new Set<(e: object) => void>();
    const state = { connects: 0, signatures: 0, messages: 0, account: owner, rejectConnect: false,
      change(address: string | null) { state.account = address ?? ''; wallet.accounts = address ? [account(address)] : [];
        for (const cb of [...callbacks]) cb({ accounts: wallet.accounts }); } };
    const account = (address: string) => ({ address, chains: ['solana:mainnet'], features: ['solana:signMessage', 'solana:signTransaction'] });
    const wallet = { name: 'Phantom', chains: ['solana:mainnet', 'solana:devnet'], accounts: [] as ReturnType<typeof account>[], features: {
      'standard:connect': { connect: async () => { state.connects++; if (state.rejectConnect) throw { code: 4001 };
        wallet.accounts = state.account ? [account(state.account)] : []; return { accounts: wallet.accounts }; } },
      'standard:disconnect': { disconnect: async () => state.change(null) },
      'standard:events': { on: (_e: string, cb: (e: object) => void) => { callbacks.add(cb); return () => callbacks.delete(cb); } },
      'solana:signTransaction': { signTransaction: async () => { state.signatures++; throw new Error('TEST_SIGNATURE_FORBIDDEN'); } },
      'solana:signMessage': { signMessage: async () => { state.messages++; throw new Error('TEST_MESSAGE_FORBIDDEN'); } },
    } };
    Object.assign(window, { phantom: { solana: { isPhantom: true } }, __flofiPhantomTest: state });
    window.addEventListener('wallet-standard:app-ready', e => (e as CustomEvent<{ register(w: object): void }>).detail.register(wallet));
  });
}
test('isolated mainnet deposit page starts without a wallet or provider request and cannot sign', async ({ page }) => {
  const providerRequests: string[] = [];
  page.on('request', req => { if (/api\.cloak\.ag|api\.mainnet-beta\.solana\.com|storage\.googleapis\.com/.test(req.url())) providerRequests.push(req.url()); });
  await page.goto('/privacy/mainnet-proof');
  await expect(page.getByText('MAINNET PROOF / REAL EXECUTION — OWNER CONTROLLED', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Financial actions disabled');
  await expect(page.getByText('6NTyfs83wzEo7WkkhTuNSxXiyYM9x73icbdtQWVbhaRy', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign and submit ONE reviewed 0.01 SOL Cloak deposit' })).toHaveCount(0);
  expect(providerRequests).toEqual([]);
});
test('test-only injected Phantom connects without signing and rejects another owner after reload', async ({ page }) => {
  test.skip(process.env.CLOAK_OWNER_PROOF_BROWSER_READONLY !== '1');
  // The wallet is synthetic; genesis is observed from the genuine fixed upstream mainnet RPC.
  await testPhantom(page);
  await page.goto('/privacy/mainnet-proof');
  await expect(page.getByText('Wallet Standard Phantom: Detected.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Connect Phantom — public key only' }).click();
  await expect(page.getByText('PHANTOM CONNECTION: PASS — connected owner matches exactly.', { exact: true })).toBeVisible();
  await expect(page.getByText('FloFi execution network: Solana MAINNET', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect Phantom and invalidate Review' }).click();
  await expect(page.getByText('PHANTOM CONNECTION: NOT VERIFIED.', { exact: false })).toBeVisible();
  await page.evaluate(() => { (window as unknown as { __flofiPhantomTest: { rejectConnect: boolean } }).__flofiPhantomTest.rejectConnect = true; });
  await page.getByRole('button', { name: 'Connect Phantom — public key only' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'CLOAK_WALLET_REQUEST_REJECTED' })).toHaveText('CLOAK_WALLET_REQUEST_REJECTED — no submission or automatic retry');
  expect(await page.evaluate(() => (window as unknown as { __flofiPhantomTest: { connects: number } }).__flofiPhantomTest.connects)).toBe(2);
  await page.reload();
  await expect(page.getByText('PHANTOM CONNECTION: NOT VERIFIED.', { exact: false })).toBeVisible();
  await page.evaluate(() => (window as unknown as { __flofiPhantomTest: { change(a: string): void } }).__flofiPhantomTest.change('So11111111111111111111111111111111111111112'));
  await page.getByRole('button', { name: 'Connect Phantom — public key only' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'CLOAK_DEPOSIT_OWNER_CHANGED' })).toHaveText('CLOAK_DEPOSIT_OWNER_CHANGED');
  const calls = await page.evaluate(() => { const s = (window as unknown as { __flofiPhantomTest: { connects: number; signatures: number; messages: number } }).__flofiPhantomTest;
    return { connects: s.connects, signatures: s.signatures, messages: s.messages }; });
  expect(calls).toEqual({ connects: 1, signatures: 0, messages: 0 });
});
test('genuine browser SDK deposit preparation with public read-only mainnet traffic and NO wallet signing', async ({ page }) => {
  test.skip(process.env.CLOAK_OWNER_PROOF_BROWSER_READONLY !== '1' || !process.env.CLOAK_VERIFIED_CIRCUITS_DIRECTORY);
  test.setTimeout(180000);
  const circuits = process.env.CLOAK_VERIFIED_CIRCUITS_DIRECTORY!, forbidden: string[] = [];
  const networkFailures: string[] = [];
  page.on('requestfailed', request => networkFailures.push(`${new URL(request.url()).hostname}: ${request.failure()?.errorText}`));
  const wasm = await readFile(join(circuits, 'transaction_js/transaction.wasm')), zkey = await readFile(join(circuits, 'transaction_final.zkey'));
  await testPhantom(page);
  await page.addInitScript(() => {
    // Synthetic test vault only. The real owner must obtain a real persistent-storage grant.
    Object.defineProperty(navigator.storage, 'persisted', { value: async () => true });
    Object.defineProperty(navigator.storage, 'persist', { value: async () => true });
  });
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname === 'storage.googleapis.com') {
      if (url.pathname.endsWith('/transaction_js/transaction.wasm')) return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, body: wasm });
      if (url.pathname.endsWith('/transaction_final.zkey')) return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, body: zkey });
    }
    if (url.hostname === 'api.cloak.ag' && request.method() === 'GET') return route.continue();
    if (url.hostname === 'api.mainnet-beta.solana.com') {
      if (request.method() === 'OPTIONS') return route.continue();
      const body = request.postDataJSON() as { method: string };
      if (!/send|requestAirdrop/i.test(body.method)) return route.continue();
    }
    forbidden.push(url.toString()); return route.abort();
  });
  await page.goto('/privacy/mainnet-proof');
  await page.getByRole('button', { name: 'Connect Phantom — public key only' }).click();
  await expect(page.getByText('PHANTOM CONNECTION: PASS — connected owner matches exactly.', { exact: true })).toBeVisible();
  await page.getByLabel('Local vault passphrase').fill('synthetic browser deposit vault only');
  await page.getByRole('button', { name: 'Unlock durable local vault' }).click();
  await page.getByRole('button', { name: 'Prepare 0.01 SOL deposit — no signature' }).click();
  const review = page.getByRole('heading', { name: 'Preflight → Review → bound Manifest' });
  await expect(review.or(page.getByRole('alert').filter({ hasText: 'CLOAK_' }))).toBeVisible({ timeout: 120000 });
  if (!await review.isVisible()) throw new Error('Read-only preparation failed: ' + await page.getByRole('alert').filter({ hasText: 'CLOAK_' }).innerText() + '; ' + networkFailures.join(', '));
  await expect(page.getByRole('button', { name: 'Sign and submit ONE reviewed 0.01 SOL Cloak deposit' })).toBeDisabled();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export encrypted deposit recovery backup' }).click();
  const file = await download; await file.saveAs('.turbo/privacy-owner-deposit-browser-backup.json');
  const backup = await readFile('.turbo/privacy-owner-deposit-browser-backup.json', 'utf8');
  expect(backup).not.toContain('viewingKeyNk'); expect(backup).not.toContain('outputUtxos'); expect(forbidden).toEqual([]);
  await page.getByRole('checkbox', { name: 'I reviewed this exact deposit' }).check();
  await page.evaluate(() => (window as unknown as { __flofiPhantomTest: { change(a: string): void } }).__flofiPhantomTest.change('So11111111111111111111111111111111111111112'));
  await expect(review).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: 'CLOAK_OWNER_CHANGED' })).toContainText('CLOAK_OWNER_CHANGED');
  await expect(page.getByRole('button', { name: 'Sign and submit ONE reviewed 0.01 SOL Cloak deposit' })).toHaveCount(0);
  await page.reload(); await page.getByLabel('Local vault passphrase').fill('synthetic browser deposit vault only');
  await page.getByRole('button', { name: 'Unlock durable local vault' }).click();
  await page.getByRole('button', { name: 'Inspect finalized mainnet and reconcile saved note' }).click();
  await expect(page.getByRole('status')).toContainText(['Financial actions disabled']);
  await expect(page.getByText('RECOVERY_REQUIRED', { exact: true })).toBeVisible();
  expect(forbidden).toEqual([]);
});
