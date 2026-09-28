// SPDX-License-Identifier: AGPL-3.0-only
/** Browser-only local 31337 profile; the existing closed replay webServer supplies all source reads. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as forkTest, expect, forkRpc } from './mode-a-fixtures';
import { LIQUIDITY_FACTORY, LIQUIDITY_USDC, LIQUIDITY_WETH, POSITION_MANAGER } from '@defi-workflow-engine/reference-compiler';
export { expect, forkRpc };
export type LiquidityFixture = { owner: string; pool: string; tick: number; lower: number; upper: number; journalDir: string };
const addressWord = (value: string) => value.slice(2).padStart(64, '0');
const word = (value: number) => BigInt(value).toString(16).padStart(64, '0');
const pin = (value: string) => `0x${createHash('sha256').update(Buffer.from(value.slice(2), 'hex')).digest('hex')}`;
export const test = forkTest.extend<{ liquidity: LiquidityFixture }>({
  liquidity: async ({ fork }, use) => {
    const runtime = process.env.GRYLOO_MODE_A_RUNTIME;
    const profilePath = process.env.GRYLOO_LIQUIDITY_PROFILE;
    const journalDir = process.env.GRYLOO_LIQUIDITY_JOURNAL;
    if (!runtime || !profilePath || !journalDir || process.env.GRYLOO_LIQUIDITY !== 'fork') throw new Error('LIQUIDITY_E2E_ENV_REQUIRED');
    const base = JSON.parse(readFileSync(join(runtime, 'profile.json'), 'utf8'));
    const head = await forkRpc('eth_getBlockByNumber', ['latest', false]) as { hash: string };
    const at = { blockHash: head.hash, requireCanonical: true };
    const rawPool = await forkRpc('eth_call', [{ to: LIQUIDITY_FACTORY,
      data: `0x1698ee82${addressWord(LIQUIDITY_WETH)}${addressWord(LIQUIDITY_USDC)}${word(500)}` }, at]) as string;
    if (!/^0x[0-9a-f]{64}$/.test(rawPool)) throw new Error('LIQUIDITY_POOL_INVALID');
    const pool = `0x${rawPool.slice(-40)}`;
    const targets = { pool, manager: POSITION_MANAGER, factory: LIQUIDITY_FACTORY, usdc: LIQUIDITY_USDC, weth: LIQUIDITY_WETH };
    const pins: Record<string, string> = {};
    for (const [name, target] of Object.entries(targets)) {
      const code = await forkRpc('eth_getCode', [target, at]) as string;
      if (!/^0x(?:[0-9a-f]{2})+$/.test(code)) throw new Error(`LIQUIDITY_${name}_CODE_MISSING`);
      pins[`${name}CodeHash`] = pin(code);
    }
    const slot = await forkRpc('eth_call', [{ to: pool, data: '0x3850c7bd' }, at]) as string;
    if (!/^0x[0-9a-f]{448}$/.test(slot)) throw new Error('LIQUIDITY_SLOT_INVALID');
    const signed = BigInt(`0x${slot.slice(66, 130)}`) & ((1n << 24n) - 1n);
    const tick = Number(signed >= (1n << 23n) ? signed - (1n << 24n) : signed);
    const center = Math.floor(tick / 10) * 10;
    const lower = center - 100, upper = center + 100;
    rmSync(journalDir, { recursive: true, force: true }); mkdirSync(journalDir, { recursive: true, mode: 0o700 });
    writeFileSync(profilePath, `${JSON.stringify({ ...base, liquidity: { pool, fee: 500, ...pins } })}\n`, { mode: 0o600 });
    await use({ owner: fork.fixture.owner, pool, tick, lower, upper, journalDir });
  },
});
export async function authorLiquidity(page: import('@playwright/test').Page, fixture: LiquidityFixture): Promise<void> {
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Build', exact: true }).click();
  const form = page.getByRole('form', { name: 'Create or edit Base liquidity proposal' });
  await form.getByLabel('Maximum WETH').fill('0.1');
  await form.getByLabel('Maximum USDC').fill('200');
  await form.getByLabel('Minimum WETH received or deposited').fill('0');
  await form.getByLabel('Minimum USDC received or deposited').fill('0');
  await form.getByLabel('Lower tick').fill(String(fixture.lower));
  await form.getByLabel('Upper tick').fill(String(fixture.upper));
  await form.getByLabel('Position NFT recipient').fill(fixture.owner);
  await form.getByRole('button', { name: 'Review position proposal' }).click();
  await expect(page.getByText('Review proposed edit')).toBeVisible();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await expect(page.getByRole('region', { name: 'Workflow graph' }).getByText('WETH/USDC v3 position')).toBeVisible();
}
