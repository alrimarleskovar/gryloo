// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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
test('genuine browser SDK deposit preparation with public read-only mainnet traffic and NO wallet signing', async ({ page }) => {
  test.skip(process.env.CLOAK_OWNER_PROOF_BROWSER_READONLY !== '1' || !process.env.CLOAK_VERIFIED_CIRCUITS_DIRECTORY);
  test.setTimeout(180000);
  const circuits = process.env.CLOAK_VERIFIED_CIRCUITS_DIRECTORY!, forbidden: string[] = [];
  const networkFailures: string[] = [];
  page.on('requestfailed', request => networkFailures.push(`${new URL(request.url()).hostname}: ${request.failure()?.errorText}`));
  const wasm = await readFile(join(circuits, 'transaction_js/transaction.wasm')), zkey = await readFile(join(circuits, 'transaction_final.zkey'));
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
  await page.reload(); await page.getByLabel('Local vault passphrase').fill('synthetic browser deposit vault only');
  await page.getByRole('button', { name: 'Unlock durable local vault' }).click();
  await page.getByRole('button', { name: 'Inspect finalized mainnet and reconcile saved note' }).click();
  await expect(page.getByRole('status')).toContainText(['Financial actions disabled']);
  await expect(page.getByText('RECOVERY_REQUIRED', { exact: true })).toBeVisible();
  expect(forbidden).toEqual([]);
});
