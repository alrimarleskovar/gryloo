// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { buildLiquidityPayload, LIQUIDITY_WETH, POSITION_MANAGER } from '@defi-workflow-engine/reference-compiler';
import { toHex } from '@defi-workflow-engine/reference-compiler';
import { verifyLiquidityBrowserPayload } from './liquidity-eip1193';
const call = { kind: 'APPROVE' as const, token: LIQUIDITY_WETH, amount: 100n };
const owner = '0x1111111111111111111111111111111111111111';
function fixture() {
  const payload = buildLiquidityPayload(call, { nonce: 2n, gasLimit: 150000n, maxFeePerGas: 3000000n });
  return { bytes: toHex(payload.bytes), payloadHash: payload.payloadHash, owner, operation: 'APPROVE_WETH', nonce: '2',
    gasLimit: '150000', maxFeePerGas: '3000000' };
}
describe('independent browser wallet request', () => {
  it('recomputes the hash and request from the exact reviewed bytes', async () => {
    const result = await verifyLiquidityBrowserPayload(fixture(), call);
    expect(result.target).toBe(LIQUIDITY_WETH);
    expect(result.request.chainId).toBe('0x7a69');
    expect(result.request.data.slice(0, 10)).toBe('0x095ea7b3');
  });
  it('rejects changed target, spender, amount, nonce, gas or hash', async () => {
    const base = fixture();
    await expect(verifyLiquidityBrowserPayload({ ...base, payloadHash: '0x' + 'f'.repeat(64) }, call)).rejects.toThrow();
    await expect(verifyLiquidityBrowserPayload(base, { ...call, amount: 101n })).rejects.toThrow();
    await expect(verifyLiquidityBrowserPayload(base, { ...call, token: POSITION_MANAGER })).rejects.toThrow();
    await expect(verifyLiquidityBrowserPayload({ ...base, nonce: '3' }, call)).rejects.toThrow();
    await expect(verifyLiquidityBrowserPayload({ ...base, gasLimit: '150001' }, call)).rejects.toThrow();
  });
});
