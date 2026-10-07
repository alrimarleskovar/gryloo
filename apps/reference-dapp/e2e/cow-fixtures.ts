// SPDX-License-Identifier: AGPL-3.0-only
/** Disposable Node-side signer exposed as an injected EIP-1193 test wallet; no browser key or public RPC. */
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { cowCancellationDigest, cowOrderDigest, type CowOrder } from '@defi-workflow-engine/reference-compiler';
import { signCowDisposable } from '@defi-workflow-engine/reference-executor';
import { test as guarded, expect, openProposalReview } from './fixtures';

export type CowWallet = { readonly owner: string; readonly calls: { method: string; params: unknown[] }[];
  chain: string; account: string; reject: boolean };
export const cowPanel = (page: Page, stage: 'simulation' | 'execution') =>
  page.getByRole('region', { name: 'CoW signed-intent ' + stage });
export async function stage(page: Page, name: 'Build' | 'Simulate' | 'Execute'): Promise<void> {
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name, exact: true }).click();
  if (name === 'Execute') {
    const details = page.locator('.execute-technical');
    await expect(details).toBeVisible();
    if (!(await details.evaluate(element => (element as HTMLDetailsElement).open))) await details.locator('> summary').click();
  }
}
export const openTechnicalDetails = (page: Page) =>
  page.locator('.simulation-technical > summary').click();
export async function authorCowSwap(page: Page): Promise<void> {
  await stage(page, 'Build');
  if (!(await page.getByLabel('Direction').isVisible())) await page.getByText('Advanced action setup', { exact: true }).click();
  await page.getByLabel('Direction').selectOption('WETH_TO_USDC');
  await page.getByLabel('Input amount (required)').fill('1');
  await page.getByLabel('Slippage in bps (required)').fill('100');
  await page.getByLabel('Enable CoW signed intent for this swap').check();
  await page.getByRole('button', { name: 'Review swap proposal' }).click();
  await openProposalReview(page);
  await page.getByRole('button', { name: 'Apply proposal' }).click();
}
export async function installCowWallet(page: Page): Promise<CowWallet> {
  const key = randomBytes(32);
  const owner = signCowDisposable('0x' + '1'.repeat(64), key).owner;
  const wallet: CowWallet = { owner, calls: [], chain: '0x2105', account: owner, reject: false };
  await page.exposeFunction('__cowWalletRequest', async (input: { method: string; params?: unknown[] }) => {
    const params = input.params ?? [];
    wallet.calls.push({ method: input.method, params });
    if (input.method === 'eth_chainId') return wallet.chain;
    if (input.method === 'eth_requestAccounts' || input.method === 'eth_accounts') return [wallet.account];
    if (input.method !== 'eth_signTypedData_v4') throw new Error('UNSUPPORTED_LOCAL_WALLET_METHOD');
    if (wallet.reject) throw new Error('DISPOSABLE_WALLET_REJECTED');
    if (params[0] !== wallet.owner || typeof params[1] !== 'string') throw new Error('LOCAL_WALLET_ACCOUNT_MISMATCH');
    const typed = JSON.parse(params[1]) as { primaryType: string; domain: { chainId: number; verifyingContract: string };
      message: CowOrder | { orderUids: string[] } };
    if (typed.domain.chainId !== 8453 || typed.domain.verifyingContract.toLowerCase() !== '0x9008d19f58aabd9ed0d60971565aa8510560ab41')
      throw new Error('LOCAL_WALLET_DOMAIN_MISMATCH');
    const digest = typed.primaryType === 'Order' ? cowOrderDigest(typed.message as CowOrder)
      : typed.primaryType === 'OrderCancellations' ? cowCancellationDigest((typed.message as { orderUids: string[] }).orderUids[0]!)
      : null;
    if (!digest) throw new Error('LOCAL_WALLET_TYPE_INVALID');
    return signCowDisposable(digest, key).signature;
  });
  await page.addInitScript(() => {
    (window as Window & { ethereum?: unknown }).ethereum = {
      isGrylooCowLocalWallet: true,
      request: (input: { method: string; params?: unknown[] }) =>
        (window as Window & { __cowWalletRequest?: (input: unknown) => Promise<unknown> }).__cowWalletRequest?.(input),
    };
  });
  return wallet;
}
const runtime = process.env.GRYLOO_COW_RUNTIME;
export const test = guarded.extend<{ cowWallet: CowWallet }>({
  cowWallet: async ({ page }, use) => {
    if (!runtime?.startsWith('/tmp/') && !runtime?.startsWith('/home/runner/work/_temp/') && !runtime?.startsWith(join(tmpdir(), '/')))
      throw new Error('GRYLOO_COW_RUNTIME must be a disposable test directory');
    rmSync(join(runtime, 'cow'), { recursive: true, force: true });
    const wallet = await installCowWallet(page);
    await use(wallet);
  },
});
export { expect };
export async function prepareCow(page: Page, scenario: string): Promise<void> {
  await authorCowSwap(page);
  await stage(page, 'Simulate');
  await openTechnicalDetails(page);
  const panel = cowPanel(page, 'simulation');
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Connect disposable local wallet' }).click();
  await expect(panel.locator('.wallet-chip')).toBeVisible();
  await panel.getByLabel('Scripted outcome').selectOption(scenario);
  await panel.getByRole('button', { name: /Prepare CoW quote/ }).click();
  await expect(panel.locator('[data-cow-state]')).toHaveText('REVIEWED');
}
