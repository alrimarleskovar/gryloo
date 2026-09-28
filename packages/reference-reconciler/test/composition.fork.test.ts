// SPDX-License-Identifier: AGPL-3.0-only
/** Read the deployed Safe/Roles identities directly before trusting any composed NFT claim. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { modeBCodeHash, LIQUIDITY_WETH, LIQUIDITY_USDC, POSITION_MANAGER } from '@defi-workflow-engine/reference-compiler';
const profilePath = process.env.GRYLOO_COMPOSITION_SMOKE_PROFILE;
describe('composition reconciliation closed-fork identity', () => {
  it.skipIf(!profilePath)('reads exact Safe, Roles, pool and Position Manager code at a canonical fork block', async () => {
    const profile = JSON.parse(readFileSync(profilePath!, 'utf8')) as { rpcUrl: string; chainId: number; safe: string;
      roles: string; safeCodeHash: string; rolesCodeHash: string; liquidity: { pool: string; poolCodeHash: string;
        managerCodeHash: string } };
    let id = 0;
    const rpc = async (method: string, params: unknown[] = []) => {
      const response = await fetch(profile.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), signal: AbortSignal.timeout(20_000) });
      const body = await response.json() as { result?: string | { hash: string }; error?: unknown };
      if (body.error || !('result' in body)) throw new Error(`COMPOSITION_FORK_${method}`);
      return body.result!;
    };
    expect(await rpc('eth_chainId')).toBe('0x7a69');
    const head = await rpc('eth_getBlockByNumber', ['latest', false]) as { hash: string };
    for (const [address, expected, algorithm] of [[profile.safe, profile.safeCodeHash, 'keccak'],
      [profile.roles, profile.rolesCodeHash, 'keccak'], [profile.liquidity.pool, profile.liquidity.poolCodeHash, 'sha256'],
      [POSITION_MANAGER, profile.liquidity.managerCodeHash, 'sha256']] as const) {
      const code = await rpc('eth_getCode', [address, { blockHash: head.hash, requireCanonical: true }]) as string;
      const digest = algorithm === 'keccak' ? modeBCodeHash(code) :
        '0x' + createHash('sha256').update(Buffer.from(code.slice(2), 'hex')).digest('hex');
      expect(digest).toBe(expected);
    }
    const pool = profile.liquidity.pool;
    const token0 = await rpc('eth_call', [{ to: pool, data: '0x0dfe1681' }, { blockHash: head.hash, requireCanonical: true }]) as string;
    const token1 = await rpc('eth_call', [{ to: pool, data: '0xd21220a7' }, { blockHash: head.hash, requireCanonical: true }]) as string;
    expect('0x' + token0.slice(-40)).toBe(LIQUIDITY_WETH);
    expect('0x' + token1.slice(-40)).toBe(LIQUIDITY_USDC);
  });
});
