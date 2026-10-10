// SPDX-License-Identifier: AGPL-3.0-only
/** Browser-side refusal and recovery checks; contract bypasses run in mode-b.fork.test.ts. */
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { authorSwap } from './mode-a-fixtures';
const profilePath = process.env.GRYLOO_MODE_B_PROFILE;
test.skip(!profilePath, 'The pinned local Mode B fork is required');
const profile = () => JSON.parse(readFileSync(profilePath!, 'utf8')) as { owner: string; journalDir: string; rpcUrl: string };
async function prepare(page: import('@playwright/test').Page) {
  await page.goto('/__engineering');
  await authorSwap(page, 'WETH_TO_USDC', '1', '100');
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Simulate', exact: true }).click();
  await page.locator('.simulation-technical > summary').click();
  const panel = page.getByRole('region', { name: 'Finite Mode B authority' });
  await panel.getByRole('button', { name: /Simulate finite Mode B for revision/ }).click();
  await expect(panel).toContainText('Mode B permission', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Review finite Mode B permission' }).click();
  return page.getByRole('region', { name: 'Finite Mode B authority' });
}
test.beforeEach(() => {
  for (const entry of readdirSync(profile().journalDir)) rmSync(join(profile().journalDir, entry), { recursive: true, force: true });
});
test('wrong chain refuses owner connection before any transaction request', async ({ page, context }) => {
  let sends = 0;
  await context.exposeFunction('__modeBWrongChain', (method: string) => {
    if (method === 'eth_chainId') return '0x2105';
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [profile().owner];
    if (method === 'eth_sendTransaction') sends++;
    throw new Error('UNEXPECTED_WALLET_METHOD');
  });
  await context.addInitScript(() => Object.defineProperty(window, 'ethereum', { value: Object.freeze({
    request: ({ method }: { method: string }) => (window as unknown as { __modeBWrongChain: (m: string) => unknown }).__modeBWrongChain(method),
  }) }));
  const panel = await prepare(page);
  await panel.getByRole('button', { name: 'Connect local owner wallet' }).click();
  await expect(panel.getByRole('alert')).toContainText('WALLET_WRONG_CHAIN');
  expect(sends).toBe(0);
  await expect(panel.getByRole('button', { name: /Request owner signature/ })).toBeDisabled();
});
test('semantic revision change retires the reviewed installation', async ({ page, context }) => {
  let sends = 0;
  await context.exposeFunction('__modeBWalletNoSend', (method: string) => {
    if (method === 'eth_chainId') return '0x7a69';
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [profile().owner];
    if (method === 'eth_sendTransaction') sends++;
    throw new Error('UNEXPECTED_WALLET_METHOD');
  });
  await context.addInitScript(() => Object.defineProperty(window, 'ethereum', { value: Object.freeze({
    request: ({ method }: { method: string }) => (window as unknown as { __modeBWalletNoSend: (m: string) => unknown }).__modeBWalletNoSend(method),
  }) }));
  const panel = await prepare(page);
  await panel.getByRole('button', { name: 'Connect local owner wallet' }).click();
  await panel.getByRole('button', { name: 'I reviewed the finite permission and signatures' }).click();
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Build', exact: true }).click();
  await page.locator('.flow-card').nth(1).click();
  await page.locator('.inspector').getByLabel('Slippage (bps)', { exact: true }).fill('50');
  await page.getByRole('button', { name: 'Review slippage change' }).click();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Execute', exact: true }).click();
  const retired = page.getByRole('region', { name: 'Finite Mode B authority' });
  await expect(retired).toContainText('Semantic revision changed');
  await expect(retired.getByRole('button', { name: /Request owner signature/ })).toBeDisabled();
  expect(sends).toBe(0);
});
test('unknown wallet result freezes the owner step without a second send', async ({ page, context }) => {
  let sends = 0;
  await context.exposeFunction('__modeBUnknownWallet', (method: string) => {
    if (method === 'eth_chainId') return '0x7a69';
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [profile().owner];
    if (method === 'eth_getTransactionCount') return '0x0';
    if (method === 'eth_sendTransaction') { sends++; throw new Error('RESPONSE_LOST'); }
    throw new Error('UNEXPECTED_WALLET_METHOD');
  });
  await context.addInitScript(() => Object.defineProperty(window, 'ethereum', { value: Object.freeze({
    request: ({ method }: { method: string }) => (window as unknown as { __modeBUnknownWallet: (m: string) => unknown }).__modeBUnknownWallet(method),
  }) }));
  const panel = await prepare(page);
  await panel.getByRole('button', { name: 'Connect local owner wallet' }).click();
  await panel.getByRole('button', { name: 'I reviewed the finite permission and signatures' }).click();
  await panel.getByRole('button', { name: /Request owner signature 1/ }).click();
  await expect(panel.getByRole('alert').last()).toContainText('Wallet result is unknown');
  await expect(panel.getByRole('button', { name: /Request owner signature 1/ })).toBeDisabled();
  expect(sends).toBe(1);
});
