import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { browserPayloadHash } from '../src/payload-digest.js';
import { buildModeAPair, decodeUnsignedPayload, fromHex, payloadIdentity, toHex, verifyModeAPair } from '../src/payload.js';
const vector = JSON.parse(readFileSync(new URL('../../../tests/compatibility/v1/mode-a-payload-vectors.json', import.meta.url), 'utf8'));
const context = { owner: vector.owner, tokenIn: vector.tokenIn, tokenOut: vector.tokenOut,
  amountIn: 1_000_000n, amountOutMinimum: 100_000_000_000_000n, fee: 500 as const,
  deadline: 1_790_000_180n, nonce: 0n };

describe('exact EIP-1559 Mode A payload pair', () => {
  it('builds, decodes and hashes the independent frozen vectors', async () => {
    const pair = buildModeAPair({ ...context, approveGasLimit: 60_000n, swapGasLimit: 250_000n, maxFeePerGas: 3_000_000n });
    expect(toHex(pair.approveBytes)).toBe(vector.approve.unsignedHex);
    expect(toHex(pair.swapBytes)).toBe(vector.swap.unsignedHex);
    for (const [bytes, fixture] of [[pair.approveBytes, vector.approve], [pair.swapBytes, vector.swap]] as const) {
      expect(payloadIdentity(bytes)).toEqual({ payloadHash: fixture.payloadHash, signingHash: fixture.signingHash });
      expect(await browserPayloadHash(bytes)).toBe(fixture.payloadHash);
      expect(decodeUnsignedPayload(bytes).chainId).toBe(31337);
    }
    expect(verifyModeAPair(pair.approveBytes, pair.swapBytes, context).swap.nonce).toBe(1n);
  });
  it('rejects chain, value, access list, calldata and fee tampering before the wallet', () => {
    const approve = fromHex(vector.approve.unsignedHex);
    const swap = fromHex(vector.swap.unsignedHex);
    expect(() => verifyModeAPair(approve, swap, { ...context, amountIn: 1_000_001n })).toThrow();
    expect(() => verifyModeAPair(approve, swap, { ...context, owner: '0x0000000000000000000000000000000000000001' })).toThrow();
    expect(() => verifyModeAPair(approve, swap, { ...context, fee: 3000 })).toThrow();
    const unknownTarget = swap.slice(); unknownTarget[20] ^= 1;
    expect(() => verifyModeAPair(approve, unknownTarget, context)).toThrow();
    const trailing = Uint8Array.of(...swap, 0);
    expect(() => decodeUnsignedPayload(trailing)).toThrow();
  });
});
