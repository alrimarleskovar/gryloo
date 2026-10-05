// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CLOUD-PARITY-001: the reference app served on the EMBEDDED PostgreSQL runtime — the path a Vercel deployment runs — with the
 * MOCKED loopback Robinhood chain (never a public network or a broadcast; the scripted wallet's only "broadcast" is the harness).
 * The server has no journal directory: every run, attempt and economic intent must live in the disposable loopback database.
 */
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { createDatabase } from '@defi-workflow-engine/cloud-runtime';
import { installTransferWallet, sendRequests, transferHarnessRpc, TRANSFER_OWNER as owner, type TransferWalletOptions } from './robinhood-transfer-fixtures';

const region = (page: Page) => page.getByRole('region', { name: 'Robinhood Testnet transfer' });
const execute = (page: Page) => region(page).getByRole('button', { name: 'Execute', exact: true }).click();
// The stage navigation (not a call-to-action label) so the suite does not depend on presentation copy.
const stage = (page: Page, name: 'Simulate' | 'Execute') => page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name, exact: true }).click();
/** Each test starts its MOCKED chain at its own owner nonce: economic intents are durable across tests on PostgreSQL. */
async function reset(nonce: number) {
  if (process.env.GRYLOO_CLOUD_RUNTIME_E2E !== 'EMBEDDED_LOOPBACK_ONLY' || !process.env.FLOFI_E2E_DATABASE_URL) throw new Error('MOCK_RESET_DENIED');
  await transferHarnessRpc('MOCK_reset', [{ nonce }]);
  return async () => Number(BigInt(await transferHarnessRpc('eth_getTransactionCount', [owner, 'latest']) as string)) - nonce;
}
async function authorAndReview(page: Page, options: TransferWalletOptions = {}) {
  await installTransferWallet(page, options); await page.goto('/');
  await page.getByText('Advanced action setup', { exact: true }).click();
  const form = page.getByRole('form', { name: 'Create Robinhood transfer' });
  await form.getByLabel('Transfer amount (test ETH)').fill('0.000001');
  await form.getByRole('button', { name: 'Review transfer proposal' }).click();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await stage(page, 'Simulate');
  await page.getByRole('button', { name: 'Simulate transfer', exact: true }).click();
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
  await page.getByRole('button', { name: 'Accept transfer review' }).click();
  await expect(region(page).getByRole('button', { name: 'Execute', exact: true })).toBeVisible();
}
async function latestRun() {
  const db = createDatabase({ connectionString: process.env.FLOFI_E2E_DATABASE_URL!, maxConnections: 1 });
  try {
    const run = (await db.query<{ tenant_id: string; run_id: string; status: string; provenance: string; owner_account: string }>(`SELECT tenant_id, run_id, status, provenance,
      owner_account FROM execution_runs WHERE flow = 'robinhood-transfer' ORDER BY updated_at DESC LIMIT 1`)).rows[0]!;
    const attempts = (await db.query<{ state: string; transaction_hash: string | null; reconciled: boolean }>(`SELECT state, transaction_hash, reconciled
      FROM execution_attempts WHERE run_id = $1`, [run.run_id])).rows;
    return { run, attempts };
  } finally { await db.close(); }
}

test('Simulate → Review → one owner-signed transfer → reconciled Result, all state in PostgreSQL', async ({ page, networkGuard }) => {
  const broadcasts = await reset(40), errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await authorAndReview(page);
  await expect(region(page)).toContainText('Nonce40');
  expect(await broadcasts()).toBe(0);
  await execute(page);
  await expect(page.getByRole('link', { name: 'Download Evidence Bundle' })).toBeVisible();
  await expect(region(page)).toContainText('Evidence state: MOCKED / RECONCILED');
  expect(await broadcasts()).toBe(1);
  expect(await sendRequests(page)).toHaveLength(1);
  const { run, attempts } = await latestRun();
  expect(run).toMatchObject({ tenant_id: 'default', status: 'RECONCILED', provenance: 'MOCKED', owner_account: owner.toLowerCase() });
  expect(attempts).toEqual([{ state: 'CONFIRMED', transaction_hash: expect.stringMatching(/^0x[0-9a-f]{64}$/), reconciled: true }]);
  expect(errors).toEqual([]);
  networkGuard.assertClean();
});
test('a lost wallet response is reconciled from PostgreSQL after a reload, with no second submission', async ({ page }) => {
  const broadcasts = await reset(50);
  await authorAndReview(page, { uncertain: true }); await execute(page);
  await expect(region(page)).toContainText('The wallet result is uncertain. Flofi will not submit again');
  expect(await broadcasts()).toBe(1);
  await page.reload();
  await stage(page, 'Execute');
  await region(page).getByRole('button', { name: 'Observe existing transaction' }).click();
  await expect(page.getByRole('link', { name: 'Download Evidence Bundle' })).toBeVisible();
  await expect(region(page).getByRole('button', { name: 'Execute', exact: true })).toHaveCount(0);
  expect(await broadcasts()).toBe(1);
  const { run, attempts } = await latestRun();
  expect(run.status).toBe('RECONCILED');
  expect(attempts.map(a => a.state)).toEqual(['CONFIRMED']);
});
