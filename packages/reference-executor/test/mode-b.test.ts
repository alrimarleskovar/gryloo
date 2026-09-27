// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { toHex } from '@defi-workflow-engine/reference-compiler';
import { decodeSignedTransaction } from '../../reference-reconciler/src/raw-transaction.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createModeBWorker, signModeBLocalTransaction, type ModeBDriver } from '../src/mode-b.js';

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const target = '0x7063d50cbafc8872af48b3169dc43a03decb49a1';
const hash = '0x' + 'a'.repeat(64);
const job = { executionId: 'exec-' + 'b'.repeat(24), permissionHash: hash, to: target,
  data: '0x12345678', from: '0x' + 'c'.repeat(40), expiresAt: 1000 };
const path = async () => { const dir = await mkdtemp(join(tmpdir(), 'gryloo-mode-b-test-')); dirs.push(dir); return join(dir, 'worker.jsonl'); };
function driver(send: () => Promise<string>, receipt: () => Promise<null | { status: 0 | 1 }>): ModeBDriver {
  return { chainId: async () => 31337, permissionActive: async () => true, allowanceRemaining: async () => 1n,
    now: async () => 100, sendExact: send, receipt };
}
describe('finite local worker', () => {
  it('fsyncs reservation before send and resumes a pending receipt after restart without a second effect', async () => {
    const journal = await path();
    let sends = 0;
    const first = createModeBWorker(journal, job, driver(async () => {
      sends++;
      const text = await readFile(journal, 'utf8');
      expect(text).toContain('"state":"RESERVED"');
      expect(text).toContain('"state":"SUBMITTING"');
      return hash;
    }, async () => null));
    expect((await first.run()).state).toBe('PENDING');
    const restarted = createModeBWorker(journal, job, driver(async () => { sends++; return hash; }, async () => ({ status: 1 })));
    expect((await restarted.run()).state).toBe('CONFIRMED');
    expect((await restarted.run()).state).toBe('CONFIRMED');
    expect(sends).toBe(1);
  });
  it('never resubmits after an unknown send result', async () => {
    const journal = await path();
    let sends = 0;
    const first = createModeBWorker(journal, job, driver(async () => { sends++; throw new Error('RPC_LOST'); }, async () => null));
    expect((await first.run()).state).toBe('INCONCLUSIVE');
    const restarted = createModeBWorker(journal, job, driver(async () => { sends++; return hash; }, async () => null));
    expect((await restarted.run()).state).toBe('INCONCLUSIVE');
    expect(sends).toBe(1);
  });
  it('signs only the reviewed executor identity on chain 31337 and zero value', () => {
    let key: Uint8Array;
    do { key = randomBytes(32); } while (!secp256k1.utils.isValidSecretKey(key));
    const executor = toHex(keccak_256(secp256k1.getPublicKey(key, false).subarray(1)).subarray(12));
    const input = { expectedExecutor: executor, to: target, data: '0x12345678', nonce: 2n, gasLimit: 100_000n, maxFeePerGas: 2_000_000n };
    const signed = signModeBLocalTransaction(input, key);
    const decoded = decodeSignedTransaction(Uint8Array.from(Buffer.from(signed.raw.slice(2), 'hex')), signed.hash);
    expect(decoded.signer).toBe(executor);
    expect(decoded.unsigned.chainId).toBe(31337);
    expect(decoded.unsigned.to).toBe(target);
    expect(decoded.unsigned.value).toBe(0n);
    expect(() => signModeBLocalTransaction({ ...input, expectedExecutor: job.from }, key)).toThrow('MODE_B_LOCAL_SIGNER_MISMATCH');
    key.fill(0);
  });
});
