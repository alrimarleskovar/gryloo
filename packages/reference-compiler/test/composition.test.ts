// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { compileComposition, buildCompositionMintCall, planCompositionMint } from '../src/composition.js';
import { LIQUIDITY_USDC, LIQUIDITY_WETH, LIQUIDITY_FACTORY, POSITION_MANAGER, Q96 } from '../src/liquidity.js';
const h = '0x' + 'a'.repeat(64), safe = '0x1111111111111111111111111111111111111111';
const profile = { chainId: 31337 as const, safe, roles: '0x2222222222222222222222222222222222222222',
  owner: '0x3333333333333333333333333333333333333333', executor: '0x4444444444444444444444444444444444444444',
  sourceBlockHash: h, safeCodeHash: h, rolesCodeHash: h, routerCodeHash: h, managerCodeHash: h, poolCodeHash: h,
  semanticWorkflowHash: h, quoteHash: h, artifactSetHash: h, simulationHash: h, policyHash: h, manifestHash: h };
const terms = { swap: { tokenIn: LIQUIDITY_USDC, tokenOut: LIQUIDITY_WETH, fee: 500 as const, recipient: safe,
  amountIn: 400_000_000n, amountOutMinimum: 10n ** 16n, sqrtPriceLimitX96: 0n as const, deadline: 1_790_000_000n },
  poolFee: 500 as const, tickLower: -10, tickUpper: 10, maxWETH: 10n ** 17n, maxUSDC: 200_000_000n,
  minWETH: 1n, minUSDC: 1n, totalUSDCBudget: 600_000_000n, mintDeadline: 1_790_000_000n };
const salt = '0x' + 'b'.repeat(64);
describe('finite swap to mint compiler', () => {
  it('installs separate exact swap and bounded mint roles through Safe', () => {
    const c = compileComposition(profile, terms, salt, { rolesOwnerIsSafe: true });
    expect(c.swapRoleKey).not.toBe(c.mintRoleKey); expect(c.swapAllowanceKey).not.toBe(c.mintAllowanceKey);
    expect(c.installation).toHaveLength(12);
    expect(c.installation.every(x => x.to === safe && x.data.startsWith('0x6a761202'))).toBe(true);
    expect(c.installation.find(x => x.label === 'Scope bounded mint parameters')?.data).toContain((terms.maxWETH + 1n).toString(16).padStart(64, '0'));
    expect(c.installation.find(x => x.label === 'Scope bounded mint parameters')?.data).toContain((terms.maxUSDC + 1n).toString(16).padStart(64, '0'));
    expect(c.revocation.map(x => x.label)).toContain('Remove executor mint role');
    const mint = buildCompositionMintCall(c, terms.maxWETH, terms.maxUSDC);
    expect(mint.to).toBe(profile.roles); expect(mint.mintData.startsWith('0x88316456')).toBe(true);
    expect(() => buildCompositionMintCall(c, terms.maxWETH + 1n, terms.maxUSDC)).toThrow();
  });
  it('derives deposits and residues from actual output and current range', () => {
    const pool = { sourceChainId: 8453 as const, executionChainId: 31337 as const, sourceBlockHash: h,
      sourceBlockNumber: 1, pool: '0x5555555555555555555555555555555555555555', factory: LIQUIDITY_FACTORY,
      positionManager: POSITION_MANAGER, token0: LIQUIDITY_WETH, token1: LIQUIDITY_USDC, fee: 500, tickSpacing: 10,
      tick: 0, sqrtPriceX96: Q96, poolCodeHash: h, positionManagerCodeHash: h, observedAtMs: 1000, expiresAtMs: 61000 };
    const p = planCompositionMint(terms, 2n * 10n ** 17n, 200_000_000n, pool, 2000);
    expect(p.desiredWETH).toBe(terms.maxWETH);
    expect(p.expectedWETHDeposit + p.residualWETH).toBe(2n * 10n ** 17n);
    expect(p.expectedUSDCDeposit + p.residualUSDC).toBe(200_000_000n);
    expect(() => planCompositionMint(terms, 0n, 200_000_000n, pool, 2000)).toThrow();
  });
});
