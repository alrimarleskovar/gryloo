// SPDX-License-Identifier: AGPL-3.0-only
/** Durable, browser-independent one-call worker. The driver is a local test signer, never an owner key. */
import { readFile } from 'node:fs/promises';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { encodeUnsignedPayload, rlpDecode, rlpEncode, rlpInteger, rlpList, toHex, fromHex } from '@defi-workflow-engine/reference-compiler';
import { writeExtendingFile } from './file-store.js';

export type ModeBWorkerEvent = { readonly state: 'RESERVED' | 'SUBMITTING' | 'PENDING' | 'INCONCLUSIVE' | 'REVERTED' | 'CONFIRMED';
  readonly executionId: string; readonly permissionHash: string; readonly transactionHash: string | null; readonly at: string; readonly code?: string };
export type ModeBWorkerJob = { readonly executionId: string; readonly permissionHash: string;
  readonly to: string; readonly data: string; readonly from: string; readonly expiresAt: number };
export type ModeBDriver = { readonly chainId: () => Promise<number>;
  readonly permissionActive: () => Promise<boolean>; readonly allowanceRemaining: () => Promise<bigint>;
  readonly sendExact: (call: { readonly from: string; readonly to: string; readonly data: string; readonly value: '0x0' }) => Promise<string>;
  readonly receipt: (hash: string) => Promise<null | { readonly status: 0 | 1 }>;
  readonly now: () => Promise<number> };
const transactionHash = (value: string): boolean => /^0x[0-9a-f]{64}$/.test(value);
const validate = (bytes: Uint8Array): void => {
  const text = new TextDecoder().decode(bytes);
  if (!text.endsWith('\n')) throw new Error('MODE_B_JOURNAL_CORRUPT');
  const events = text.trimEnd().split('\n').map(line => JSON.parse(line) as ModeBWorkerEvent);
  if (!events.length || events[0]?.state !== 'RESERVED') throw new Error('MODE_B_JOURNAL_CORRUPT');
  for (const [index, event] of events.entries()) {
    if (!event || !/^exec-[0-9a-f]{24}$/.test(event.executionId) || !transactionHash(event.permissionHash) ||
      (event.transactionHash !== null && !transactionHash(event.transactionHash)) ||
      (index && (event.executionId !== events[0]?.executionId || event.permissionHash !== events[0]?.permissionHash))) throw new Error('MODE_B_JOURNAL_CORRUPT');
  }
};
export function createModeBWorker(path: string, job: ModeBWorkerJob, driver: ModeBDriver) {
  const bytes = new TextEncoder();
  let tail: Promise<void> = Promise.resolve();
  async function events(): Promise<ModeBWorkerEvent[]> {
    try { const value = await readFile(path); validate(value); return new TextDecoder().decode(value).trimEnd().split('\n').map(line => JSON.parse(line) as ModeBWorkerEvent); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  async function append(event: ModeBWorkerEvent): Promise<void> {
    let prior = new Uint8Array();
    try { prior = await readFile(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const next = bytes.encode(new TextDecoder().decode(prior) + JSON.stringify(event) + '\n');
    await writeExtendingFile(path, next, validate);
  }
  async function run(): Promise<ModeBWorkerEvent> {
    const history = await events();
    const prior = history.at(-1);
    if (prior && (prior.executionId !== job.executionId || prior.permissionHash !== job.permissionHash)) throw new Error('MODE_B_JOURNAL_BINDING_CHANGED');
    const emit = async (state: ModeBWorkerEvent['state'], hash: string | null = prior?.transactionHash ?? null, code?: string) => {
      const event = { state, executionId: job.executionId, permissionHash: job.permissionHash, transactionHash: hash, at: new Date().toISOString(), ...(code ? { code } : {}) };
      await append(event); return event;
    };
    if (prior?.state === 'CONFIRMED' || prior?.state === 'REVERTED' || prior?.state === 'INCONCLUSIVE') return prior;
    if (prior?.state === 'SUBMITTING') return emit('INCONCLUSIVE'); // unknown send: never blindly retry
    if (prior?.state === 'PENDING') {
      if (!prior.transactionHash) return emit('INCONCLUSIVE');
      const receipt = await driver.receipt(prior.transactionHash);
      if (!receipt) return prior;
      return emit(receipt.status === 1 ? 'CONFIRMED' : 'REVERTED', prior.transactionHash);
    }
    if (!prior) await emit('RESERVED');
    if (await driver.chainId() !== 31337 || await driver.now() > job.expiresAt || !await driver.permissionActive() ||
      await driver.allowanceRemaining() !== 1n) return emit('INCONCLUSIVE');
    await emit('SUBMITTING');
    let hash: string;
    try { hash = await driver.sendExact({ from: job.from, to: job.to, data: job.data, value: '0x0' }); }
    catch (error) {
      const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,63}$/.test(error.message) ? error.message : 'MODE_B_SEND_UNKNOWN';
      return emit('INCONCLUSIVE', null, code);
    }
    if (!transactionHash(hash)) return emit('INCONCLUSIVE');
    return emit('PENDING', hash);
  }
  return { run: () => {
    const result = tail.then(run);
    tail = result.then(() => undefined, () => undefined);
    return result;
  }, events };
}

/** Sign exactly one chain-31337, zero-value Roles call with a disposable local test key. */
export function signModeBLocalTransaction(input: { readonly expectedExecutor: string; readonly to: string; readonly data: string;
  readonly nonce: bigint; readonly gasLimit: bigint; readonly maxFeePerGas: bigint }, key: Uint8Array): { readonly raw: string; readonly hash: string } {
  if (key.length !== 32 || !secp256k1.utils.isValidSecretKey(key)) throw new Error('MODE_B_LOCAL_KEY_INVALID');
  const signer = toHex(keccak_256(secp256k1.getPublicKey(key, false).subarray(1)).subarray(12));
  if (signer !== input.expectedExecutor.toLowerCase()) throw new Error('MODE_B_LOCAL_SIGNER_MISMATCH');
  const unsigned = encodeUnsignedPayload({ chainId: 31337, nonce: input.nonce, maxPriorityFeePerGas: 1_000_000n,
    maxFeePerGas: input.maxFeePerGas, gasLimit: input.gasLimit, to: input.to, value: 0n, data: fromHex(input.data), accessList: [] });
  const sig = secp256k1.Signature.fromBytes(secp256k1.sign(keccak_256(unsigned), key,
    { prehash: false, format: 'recovered' }), 'recovered');
  const body = rlpEncode([...rlpList(rlpDecode(unsigned.subarray(1))), rlpInteger(BigInt(sig.recovery!)), rlpInteger(sig.r), rlpInteger(sig.s)]);
  const raw = new Uint8Array(1 + body.length); raw[0] = 2; raw.set(body, 1);
  return { raw: toHex(raw), hash: toHex(keccak_256(raw)) };
}
