// SPDX-License-Identifier: AGPL-3.0-only
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { createMockedSolanaWallet } from '@defi-workflow-engine/reference-compiler';
import { chooseSolanaWallet, installSolanaWallet } from './jupiter-fixtures';

/** MOCKED Solana Devnet loopback only. The wallet's disposable key lives only in this test process's memory. */
export async function resetDevnetHarness(options: Record<string, unknown> = {}, funding: { lamports?: string; devUsdc?: string } = {}) {
  if (process.env.GRYLOO_SOLANA_DEVNET_E2E !== 'MOCKED_LOOPBACK_ONLY' || !process.env.GRYLOO_SOLANA_DEVNET_JOURNAL?.startsWith(join(tmpdir(), 'gryloo-demo001-'))) throw new Error('MOCK_RESET_DENIED');
  await rm(process.env.GRYLOO_SOLANA_DEVNET_JOURNAL, { recursive: true, force: true });
  const wallet = createMockedSolanaWallet();
  await devnetControl({ action: 'reset', owner: wallet.owner, options, ...funding });
  return wallet;
}
export async function devnetControl(body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch('http://127.0.0.1:8552/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return (await response.json() as { result: unknown }).result;
}
/** A multi-cluster wallet, like common Wallet Standard Solana wallets. */
export const installDevnetWallet = (page: Page, wallet: ReturnType<typeof createMockedSolanaWallet>, behavior: Parameters<typeof installSolanaWallet>[2] = {}) =>
  installSolanaWallet(page, wallet, { chains: ['solana:mainnet', 'solana:devnet'], ...behavior });
export const devnetPanel = (page: Page) => page.getByRole('region', { name: 'Solana Devnet swap' });
export async function authorDevnetSwap(page: Page, via: 'canvas' | 'chat' = 'canvas') {
  await page.goto('/');
  if (via === 'chat') {
    await page.locator('#mock-prompt').fill('Swap 10 test USDC to test SOL on Solana Devnet');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
  } else {
    await page.getByText('Advanced action setup').click();
    await page.locator('#swap-network').selectOption('SOLANA_DEVNET');
    const form = page.getByRole('form', { name: 'Create Solana Devnet swap' });
    await form.getByLabel('From token').selectOption('SOL'); await form.getByLabel('To token').selectOption('devUSDC');
    await form.getByLabel('Amount').fill('0.1');
    await form.getByRole('button', { name: 'Review swap proposal' }).click();
  }
  await page.getByRole('button', { name: 'Apply proposal' }).click();
}
export async function reviewDevnetSwap(page: Page) {
  await page.getByRole('button', { name: 'Simular Fees' }).click();
  await chooseSolanaWallet(devnetPanel(page));
  await devnetPanel(page).getByRole('button', { name: 'Simulate swap' }).click();
  await devnetPanel(page).getByRole('definition').filter({ hasText: '→ expected' }).waitFor();
  await page.getByRole('button', { name: 'Review swap', exact: true }).click();
  await devnetPanel(page).getByRole('button', { name: 'Accept swap review' }).click();
}
