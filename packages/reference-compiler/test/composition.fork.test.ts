// SPDX-License-Identifier: AGPL-3.0-only
/** Real Safe 1.4.1/Roles 2.1.0 direct boundary on closed 31337 fork. The one-use target is a labeled local STOP stub. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileComposition, buildCompositionMintCall } from '../src/composition.js';
import { LIQUIDITY_USDC, LIQUIDITY_WETH, POSITION_MANAGER, encodeLiquidityCall } from '../src/liquidity.js';
import { modeBCodeHash } from '../src/mode-b.js';
const path = process.env.GRYLOO_COMPOSITION_SMOKE_PROFILE;
describe('direct pinned Roles mint bounds on closed Base fork', () => {
  it.skipIf(!path)('rejects one-unit over caps and changed tuple fields; consumes one mint call only once', async () => {
    const profile = JSON.parse(readFileSync(path!, 'utf8')) as { rpcUrl: string; safe: string; roles: string; owner: string;
      executor: string; sourceBlockHash: string; safeCodeHash: string; rolesCodeHash: string };
    let id = 0;
    const rpc = async (method: string, params: unknown[] = []): Promise<unknown> => {
      const response = await fetch(profile.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), signal: AbortSignal.timeout(20_000) });
      const body = await response.json() as { result?: unknown; error?: { message?: string; data?: string } };
      if (!response.ok || body.error) throw new Error(`${method}:${body.error?.message ?? response.status}:${body.error?.data ?? ''}`);
      return body.result as never;
    };
    const snap = await rpc('evm_snapshot');
    try {
      expect(modeBCodeHash(await rpc('eth_getCode', [profile.safe, 'latest']))).toBe(profile.safeCodeHash);
      expect(modeBCodeHash(await rpc('eth_getCode', [profile.roles, 'latest']))).toBe(profile.rolesCodeHash);
      const head = await rpc('eth_getBlockByNumber', ['latest', false]);
      const deadline = BigInt(head.timestamp) + 3600n, h = '0x' + '1'.repeat(64);
      const p = { chainId: 31337 as const, ...profile, semanticWorkflowHash: h, quoteHash: h,
        simulationHash: h, artifactSetHash: h, policyHash: h, manifestHash: h, routerCodeHash: h,
        managerCodeHash: h, poolCodeHash: h };
      const terms = { swap: { tokenIn: LIQUIDITY_USDC, tokenOut: LIQUIDITY_WETH, recipient: profile.safe,
        fee: 500 as const, amountIn: 400_000_000n, amountOutMinimum: 1n, sqrtPriceLimitX96: 0n as const, deadline },
        poolFee: 500 as const, tickLower: -197510, tickUpper: -197310, maxWETH: 100_000_000_000_000_000n,
        maxUSDC: 200_000_000n, minWETH: 1n, minUSDC: 1n, totalUSDCBudget: 600_000_000n, mintDeadline: deadline };
      const moduleEnabled = BigInt(await rpc('eth_call', [{ to: profile.safe, data: '0x2d9ad53d' + profile.roles.slice(2).padStart(64, '0') }, 'latest'])) === 1n;
      const compiled = compileComposition(p, terms, '0x' + '3'.repeat(64), { rolesOwnerIsSafe: true, moduleEnabled });
      await rpc('anvil_impersonateAccount', [profile.owner]);
      await rpc('anvil_impersonateAccount', [profile.executor]);
      const send = async (from: string, to: string, data: string) => {
        const hash = await rpc('eth_sendTransaction', [{ from, to, data, value: '0x0', gas: '0x4c4b40' }]);
        for (let attempt = 0; attempt < 100; attempt++) {
          const receipt = await rpc('eth_getTransactionReceipt', [hash]);
          if (receipt) return receipt as { status: string };
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        throw new Error('RECEIPT_MISSING');
      };
      for (const tx of compiled.installation) expect((await send(profile.owner, tx.to, tx.data)).status, tx.label).toBe('0x1');
      const base = buildCompositionMintCall(compiled, 50_000_000_000_000_000n, 100_000_000n);
      const call = (weth: bigint, usdc: bigint, recipient = profile.safe, lower = -197510) => {
        const bytes = encodeLiquidityCall({ kind: 'MINT', token0: LIQUIDITY_WETH, token1: LIQUIDITY_USDC, fee: 500,
          tickLower: lower, tickUpper: -197310, amount0Desired: weth, amount1Desired: usdc, amount0Min: 1n,
          amount1Min: 1n, recipient, deadline });
        return '0x' + base.data.slice(2).replace(base.mintData.slice(2), Buffer.from(bytes.data).toString('hex'));
      };
      const rejects = async (data: string) => {
        await expect(rpc('eth_call', [{ from: profile.executor, to: profile.roles, data, gas: '0x4c4b40' }, 'latest']))
          .rejects.toThrow('0xd0a9bf58'); // Roles ConditionViolation(uint8,bytes32)
      };
      await rejects(call(terms.maxWETH + 1n, 100_000_000n));
      await rejects(call(50_000_000_000_000_000n, terms.maxUSDC + 1n));
      await rejects(call(50_000_000_000_000_000n, 100_000_000n, profile.owner));
      await rejects(call(50_000_000_000_000_000n, 100_000_000n, profile.safe, -197520));
      await rejects(base.data.replace(LIQUIDITY_WETH.slice(2).padStart(64, '0'), LIQUIDITY_USDC.slice(2).padStart(64, '0')));
      await rejects(base.data.replace(POSITION_MANAGER.slice(2).padStart(64, '0'), profile.safe.slice(2).padStart(64, '0')));
      await rejects(base.data.replace(base.mintData.slice(2, 10), '00000000'));
      // A local STOP stub isolates Roles call count; this is MOCKED target behavior, not a liquidity result.
      await rpc('anvil_setCode', [POSITION_MANAGER, '0x00']);
      const beforeContention = await rpc('evm_snapshot');
      await rpc('evm_setAutomine', [false]);
      try {
        const nonce = BigInt(await rpc('eth_getTransactionCount', [profile.executor, 'pending']));
        const hashes = [];
        for (let i = 0; i < 2; i++) hashes.push(await rpc('eth_sendTransaction', [{ from: profile.executor, to: profile.roles,
          data: base.data, value: '0x0', gas: '0x4c4b40', nonce: '0x' + (nonce + BigInt(i)).toString(16) }]));
        await rpc('evm_mine');
        const receipts = await Promise.all(hashes.map(hash => rpc('eth_getTransactionReceipt', [hash])));
        expect(receipts.map(receipt => receipt.status)).toEqual(['0x1', '0x0']);
      } finally { await rpc('evm_setAutomine', [true]); }
      await rejects(base.data);
      await rpc('evm_revert', [beforeContention]);
      expect((await send(profile.owner, compiled.revocation[1]!.to, compiled.revocation[1]!.data)).status).toBe('0x1');
      await expect(rpc('eth_call', [{ from: profile.executor, to: profile.roles, data: base.data, gas: '0x4c4b40' }, 'latest']))
        .rejects.toThrow();
    } finally { await rpc('evm_revert', [snap]); }
  }, 120_000);
});
