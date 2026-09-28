// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileComposition, LIQUIDITY_USDC, LIQUIDITY_WETH, LIQUIDITY_FACTORY, POSITION_MANAGER, Q96 } from '@defi-workflow-engine/reference-compiler';
import { createCompositionWorker, type CompositionWorkerDriver } from '../src/composition.js';
const h = '0x' + 'a'.repeat(64), safe = '0x1111111111111111111111111111111111111111';
const profile = { chainId: 31337 as const, safe, roles: '0x2222222222222222222222222222222222222222',
  owner: '0x3333333333333333333333333333333333333333', executor: '0x4444444444444444444444444444444444444444',
  sourceBlockHash: h, safeCodeHash: h, rolesCodeHash: h, routerCodeHash: h, managerCodeHash: h, poolCodeHash: h,
  semanticWorkflowHash: h, quoteHash: h, artifactSetHash: h, simulationHash: h, policyHash: h, manifestHash: h };
const terms = { swap: { tokenIn: LIQUIDITY_USDC, tokenOut: LIQUIDITY_WETH, fee: 500 as const, recipient: safe,
  amountIn: 400_000_000n, amountOutMinimum: 1n, sqrtPriceLimitX96: 0n as const, deadline: 1_790_000_000n },
  poolFee: 500 as const, tickLower: -10, tickUpper: 10, maxWETH: 10n ** 17n, maxUSDC: 200_000_000n,
  minWETH: 1n, minUSDC: 1n, totalUSDCBudget: 600_000_000n, mintDeadline: 1_790_000_000n };
const compiled = compileComposition(profile, terms, '0x' + 'b'.repeat(64), { rolesOwnerIsSafe: true });
const pool = { sourceChainId: 8453 as const, executionChainId: 31337 as const, sourceBlockHash: h,
  sourceBlockNumber: 1, pool: '0x5555555555555555555555555555555555555555', factory: LIQUIDITY_FACTORY,
  positionManager: POSITION_MANAGER, token0: LIQUIDITY_WETH, token1: LIQUIDITY_USDC, fee: 500,
  tickSpacing: 10, tick: 0, sqrtPriceX96: Q96, poolCodeHash: h, positionManagerCodeHash: h,
  observedAtMs: 1_000, expiresAtMs: 61_000 };
const job = { executionId: 'exec-' + '1'.repeat(24), compiled, terms, executor: profile.executor, expiresAt: 60 };
describe('fixed two-step durable worker', () => {
  it('never resends a confirmed step across restart and requires swap reconciliation before mint', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gryloo-composition-'));
    try {
      const path = join(dir, 'journal.jsonl');
      const sent: string[] = [];
      const swapReconciled = false;
      const driver: CompositionWorkerDriver = { chainId: async () => 31337, now: async () => 2,
        permissionActive: async () => true, allowanceRemaining: async () => 1n,
        sendExact: async step => { sent.push(step); return step === 'SWAP' ? '0x' + '1'.repeat(64) : '0x' + '2'.repeat(64); },
        receipt: async () => ({ status: 1 }),
        reconcileSwap: async () => swapReconciled ? { outcome: 'RECONCILED', actualWETH: 2n * 10n ** 17n, safeUSDC: 200_000_000n, pool }
          : { outcome: 'INCONCLUSIVE' },
        reconcileMint: async () => ({ outcome: 'RECONCILED', tokenId: 7n }),
      };
      const first = createCompositionWorker(path, job, driver);
      expect((await first.run()).state).toBe('PENDING');
      expect(sent).toEqual(['SWAP']);
      expect((await createCompositionWorker(path, job, driver).run()).state).toBe('INCONCLUSIVE');
      expect(sent).toEqual(['SWAP']);
      // Unknown/inconclusive outcome freezes progression until explicit owner recovery.
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('advances to mint only after independent swap reconciliation and finishes once', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gryloo-composition-'));
    try {
      const path = join(dir, 'journal.jsonl'), sent: string[] = [];
      const driver: CompositionWorkerDriver = { chainId: async () => 31337, now: async () => 2,
        permissionActive: async () => true, allowanceRemaining: async () => 1n,
        sendExact: async step => { sent.push(step); return step === 'SWAP' ? '0x' + '1'.repeat(64) : '0x' + '2'.repeat(64); },
        receipt: async () => ({ status: 1 }),
        reconcileSwap: async () => ({ outcome: 'RECONCILED', actualWETH: 2n * 10n ** 17n, safeUSDC: 200_000_000n, pool }),
        reconcileMint: async () => ({ outcome: 'RECONCILED', tokenId: 7n }),
      };
      expect((await createCompositionWorker(path, job, driver).run()).step).toBe('SWAP');
      expect((await createCompositionWorker(path, job, driver).run()).step).toBe('MINT');
      expect((await createCompositionWorker(path, job, driver).run()).state).toBe('RECONCILED');
      expect(sent).toEqual(['SWAP', 'MINT']);
      expect((await createCompositionWorker(path, job, driver).run()).state).toBe('RECONCILED');
      expect(sent).toEqual(['SWAP', 'MINT']);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
