// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { compileModeB } from '../src/mode-b.js';
const safe = '0xefd6d9fde78f6371c752ae171417aa48c372ca51';
const roles = '0x7063d50cbafc8872af48b3169dc43a03decb49a1';
const owner = '0x06033e064fb5515b2ca030e650ee6289e28d9c60';
const executor = '0xa671534ceaa58a67b6f826d5f0188b97faa1e643';
const weth = '0x4200000000000000000000000000000000000006';
const usdc = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const digest = '0x' + 'a'.repeat(64);
const profile = { chainId: 31337 as const, safe, roles, owner, executor, safeCodeHash: digest, rolesCodeHash: digest,
  semanticWorkflowHash: digest, quoteHash: digest, simulationHash: digest, sourceBlockHash: digest };
const swap = { tokenIn: weth, tokenOut: usdc, fee: 500 as const, recipient: safe, amountIn: 1_000_000_000_000_000_000n,
  amountOutMinimum: 1_000_000n, sqrtPriceLimitX96: 0n as const, deadline: 1_790_000_180n };
const salt = '0x' + 'b'.repeat(64);
describe('Safe-owned Roles authority compiler', () => {
  it('keeps all Roles admin calls under Safe ownership and signs no executor transaction', () => {
    const result = compileModeB(profile, swap, salt, { rolesOwnerIsSafe: true, moduleEnabled: true });
    expect(result.installation).toHaveLength(5);
    expect(result.installation.every(step => step.to === safe && step.data.startsWith('0x6a761202'))).toBe(true);
    expect(result.revocation.every(step => step.to === safe && step.data.startsWith('0x6a761202'))).toBe(true);
    expect(result.permission.rolesOwner).toBe(safe);
    expect(result.permission.cumulativeBudget).toBe(swap.amountIn.toString());
    expect(result.executorCall.to).toBe(roles);
    expect(result.executorCall.value).toBe('0x0');
  });
  it('requires an explicit transfer when Roles is initially owned by the disposable owner', () => {
    const result = compileModeB(profile, swap, salt, { moduleEnabled: true });
    expect(result.installation[0]).toMatchObject({ to: roles, from: owner });
    expect(result.installation[0]?.data.slice(0, 10)).toBe('0xf2fde38b');
    expect(result.installation.slice(1).every(step => step.to === safe)).toBe(true);
  });
  it('invalidates the permission commitment when an exact limit or source changes', () => {
    const first = compileModeB(profile, swap, salt);
    expect(compileModeB(profile, { ...swap, amountIn: swap.amountIn + 1n }, salt).permissionHash).not.toBe(first.permissionHash);
    expect(compileModeB({ ...profile, sourceBlockHash: '0x' + 'c'.repeat(64) }, swap, salt).permissionHash).not.toBe(first.permissionHash);
  });
});
