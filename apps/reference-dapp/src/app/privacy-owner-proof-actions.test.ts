// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { serializeTransaction, toBase64 } from '@defi-workflow-engine/reference-compiler';
import { readOwnerProofRpc, broadcastOwnerDeposit } from './privacy-owner-proof-actions';
const m = vi.hoisted(() => ({ read: vi.fn(async () => 'actual upstream value'), send: vi.fn() }));
vi.mock('@cloak.dev/sdk', async original => ({ ...await original<object>(), createCloakRpc: () => ({
  getGenesisHash: () => ({ send: m.read }), sendTransaction: () => ({ send: m.send }),
}) }));
describe('owner-proof server bridge', () => {
  it('returns actual upstream public data without substituting a genesis identity', async () => {
    expect(await readOwnerProofRpc('getGenesisHash', [])).toBe('actual upstream value');
  });
  it.each(['sendTransaction', 'requestAirdrop', 'constructor', '__proto__', 'signTransaction'])('denies %s in the read bridge', async method => {
    await expect(readOwnerProofRpc(method, [])).rejects.toThrow('CLOAK_OWNER_PROOF_READ_RPC_DENIED'); expect(m.send).not.toHaveBeenCalled();
  });
  it('denies oversized requests and a signed transaction in simulation', async () => {
    await expect(readOwnerProofRpc('getGenesisHash', ['x'.repeat(16001)])).rejects.toThrow('CLOAK_OWNER_PROOF_READ_RPC_DENIED');
    await expect(readOwnerProofRpc('simulateTransaction', [toBase64(serializeTransaction(new Uint8Array(64).fill(1), new Uint8Array([128])))]))
      .rejects.toThrow('CLOAK_OWNER_PROOF_SIGNED_SIMULATION_DENIED');
  });
  it('has no broadcast without separately admitted owner enablement', async () => {
    await expect(broadcastOwnerDeposit(null as never, '')).rejects.toThrow('CLOAK_OWNER_PROOF_DISABLED'); expect(m.send).not.toHaveBeenCalled();
  });
});
