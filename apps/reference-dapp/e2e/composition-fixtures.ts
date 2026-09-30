// SPDX-License-Identifier: AGPL-3.0-only
/** Guarded local-only composition browser fixtures. The disposable key stays in the Node test process. */
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { fromHex } from '@defi-workflow-engine/reference-compiler';
import { signModeBLocalTransaction } from '@defi-workflow-engine/reference-executor';
import { test, expect } from './fixtures';
export { test, expect };
const profilePath = process.env.GRYLOO_COMPOSITION_PROFILE;
const keysPath = process.env.GRYLOO_COMPOSITION_EXECUTOR_KEY_FILE;
export const compositionEnabled = Boolean(profilePath && keysPath);
export type Profile = { rpcUrl: string; owner: string; safe: string; executor: string; journalDir: string; environment: 'MOCKED' | 'FORK_REPRODUCED'; liquidity: { pool: string } };
export function profile(): Profile {
  if (!profilePath) throw new Error('COMPOSITION_TEST_PROFILE_REQUIRED');
  const value = JSON.parse(readFileSync(profilePath, 'utf8')) as Profile;
  if (value.rpcUrl !== 'http://127.0.0.1:18545' || !['MOCKED', 'FORK_REPRODUCED'].includes(value.environment)) throw new Error('COMPOSITION_TEST_PROFILE_INVALID');
  return value;
}
export async function fork(method: string, params: unknown[] = []): Promise<unknown> {
  const response = await fetch(profile().rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20_000) });
  const body = await response.json() as { result?: unknown; error?: { message?: string } };
  if (!response.ok || body.error || !('result' in body)) throw new Error(`COMPOSITION_TEST_RPC_${method}:${body.error?.message ?? response.status}`);
  return body.result;
}
export async function snapshot() {
  const base = await fork('evm_snapshot');
  const p = profile();
  for (const name of readdirSync(p.journalDir)) rmSync(join(p.journalDir, name), { recursive: true, force: true });
  return async () => { await fork('evm_revert', [base]);
    for (const name of readdirSync(p.journalDir)) rmSync(join(p.journalDir, name), { recursive: true, force: true }); };
}
export async function injectWallet(page: Page) {
  if (!keysPath) throw new Error('COMPOSITION_TEST_KEYS_REQUIRED');
  const p = profile(), privateKey = fromHex((JSON.parse(readFileSync(keysPath, 'utf8')) as { owner: string }).owner);
  const requests: { to: string; data: string }[] = [];
  await page.context().exposeFunction('__grylooCompositionWallet', async (method: string, params: unknown[]) => {
    if (method === 'eth_chainId') return '0x7a69';
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [p.owner];
    if (method === 'eth_getTransactionCount') return Number(BigInt(await fork(method, params) as string));
    if (method !== 'eth_sendTransaction') throw new Error(`COMPOSITION_TEST_WALLET_${method}`);
    const tx = params[0] as { from: string; to: string; data: string; value: string; chainId: string; nonce: string; gas: string };
    expect(tx.from.toLowerCase()).toBe(p.owner);
    expect(tx.chainId).toBe('0x7a69');
    expect(BigInt(tx.value)).toBe(0n);
    const block = await fork('eth_getBlockByNumber', ['latest', false]) as { baseFeePerGas: string };
    const signed = signModeBLocalTransaction({ expectedExecutor: p.owner, to: tx.to, data: tx.data,
      nonce: BigInt(tx.nonce), gasLimit: BigInt(tx.gas), maxFeePerGas: BigInt(block.baseFeePerGas) * 2n + 1_000_000n }, privateKey);
    requests.push({ to: tx.to, data: tx.data });
    return await fork('eth_sendRawTransaction', [signed.raw]);
  });
  await page.context().addInitScript(() => {
    const bridge = (window as unknown as { __grylooCompositionWallet: (method: string, params: unknown[]) => Promise<unknown> }).__grylooCompositionWallet;
    Object.defineProperty(window, 'ethereum', { configurable: false, value: Object.freeze({
      request: ({ method, params }: { method: string; params?: unknown[] }) => bridge(method, params ?? []),
    }) });
  });
  return { requests, dispose: () => privateKey.fill(0) };
}
export async function authorComposition(page: Page) {
  const p = profile();
  const slot = await fork('eth_call', [{ to: p.liquidity.pool, data: '0x3850c7bd' }, 'latest']) as string;
  const tickBits = Number(BigInt('0x' + slot.slice(66, 130)) & 0xffffffn);
  const tick = tickBits >= 0x800000 ? tickBits - 0x1000000 : tickBits;
  const center = Math.floor(tick / 10) * 10;
  await page.goto('/');
  await page.getByText('Advanced action setup', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review swap → position composition' })).toBeVisible();
  await page.getByLabel('Describe a mock edit or Base swap').fill(`compose swap 400 USDC to WETH slippage 100 bps then mint maximum 0.1 WETH and 200 USDC minimum 0.000001 WETH and 0.001 USDC ticks ${center - 100} to ${center + 100} safe ${p.safe}`);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await expect(page.getByText('WETH output reference')).toBeVisible();
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Simulate', exact: true }).click();
  await page.getByRole('button', { name: 'Show technical details' }).click();
  const panel = page.getByRole('region', { name: 'Mode B swap to liquidity composition' });
  await panel.getByRole('button', { name: 'Prepare chained review' }).click();
  await expect(panel).toContainText('Permission hash', { timeout: 30_000 });
  return panel;
}
