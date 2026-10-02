// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-RH-001 independent read-only network verifier. It establishes, from the chain alone, that a
 * provider serves the expected EVM network at a fresh head, and that each expected contract is present
 * or absent at that head. Absence matters too: code appearing at a canonical address on a testnet where
 * no canonical deployment exists means the decision gate must be re-run. Only allowlisted read methods
 * can be called; nothing is signed or sent, and the result is an observation, never evidence.
 */
import { keccak_256 } from '@noble/hashes/sha3.js';
import { toHex } from '@defi-workflow-engine/reference-compiler';

export const NETWORK_READ_METHODS = Object.freeze(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode'] as const);
export type NetworkReadMethod = typeof NETWORK_READ_METHODS[number];
export type NetworkRpc = (method: NetworkReadMethod, params: readonly unknown[]) => Promise<unknown>;
export type ExpectedCode = { readonly name: string; readonly address: string; readonly expect: 'PRESENT' | 'ABSENT' };
export type NetworkExpectation = { readonly chainId: number; readonly maximumHeadAgeSeconds: number;
  readonly maximumClockSkewSeconds: number; readonly code: readonly ExpectedCode[] };
export type NetworkFinding = { readonly code: 'CODE_MISSING' | 'UNEXPECTED_CODE'; readonly name: string; readonly address: string };
export type ObservedCode = ExpectedCode & { readonly observed: 'PRESENT' | 'ABSENT'; readonly codeBytes: number; readonly codeHash: string | null };
export type NetworkVerification = {
  readonly status: 'VERIFIED' | 'MISMATCH'; readonly chainId: number;
  readonly head: { readonly number: number; readonly hash: string; readonly timestamp: number; readonly ageSeconds: number };
  readonly contracts: readonly ObservedCode[]; readonly findings: readonly NetworkFinding[];
};

function fail(code: string): never { throw new Error(code); }
const ADDRESS = /^0x[0-9a-f]{40}$/;
const HASH = /^0x[0-9a-f]{64}$/;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;
function quantity(value: unknown): number {
  if (typeof value !== 'string' || !QUANTITY.test(value.toLowerCase())) fail('RPC_RESPONSE_INVALID');
  const result = Number.parseInt(value, 16);
  if (!Number.isSafeInteger(result)) fail('RPC_RESPONSE_INVALID');
  return result;
}
function hexBytes(value: unknown): Uint8Array {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) fail('RPC_RESPONSE_INVALID');
  const out = new Uint8Array((value.length - 2) / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(value.slice(2 + 2 * i, 4 + 2 * i), 16);
  return out;
}
/** The allowlist. A network transport should call this immediately before any egress. */
export function assertNetworkReadMethod(method: string): asserts method is NetworkReadMethod {
  if (!(NETWORK_READ_METHODS as readonly string[]).includes(method)) fail('READ_ONLY_METHOD_REQUIRED');
}
function guarded(rpc: NetworkRpc): NetworkRpc {
  return (method, params) => { assertNetworkReadMethod(method); return rpc(method, params); };
}
function checkExpectation(expectation: NetworkExpectation): void {
  if (!Number.isSafeInteger(expectation.chainId) || expectation.chainId < 1) fail('EXPECTATION_INVALID');
  if (!(expectation.maximumHeadAgeSeconds > 0) || !(expectation.maximumClockSkewSeconds >= 0)) fail('EXPECTATION_INVALID');
  const seen = new Set<string>();
  for (const item of expectation.code) {
    if (!ADDRESS.test(item.address) || seen.has(item.address) || !['PRESENT', 'ABSENT'].includes(item.expect)) fail('EXPECTATION_INVALID');
    seen.add(item.address);
  }
}

/** Fails closed (throws) on a wrong chain, malformed data, a stale or future head; reports code mismatches as findings. */
export async function verifyNetworkState(transport: NetworkRpc, expectation: NetworkExpectation, now: () => number): Promise<NetworkVerification> {
  checkExpectation(expectation);
  const rpc = guarded(transport);
  const chainId = quantity(await rpc('eth_chainId', []));
  if (chainId !== expectation.chainId) fail('WRONG_CHAIN');
  const block = await rpc('eth_getBlockByNumber', ['latest', false]);
  if (!block || typeof block !== 'object' || Array.isArray(block)) fail('RPC_RESPONSE_INVALID');
  const { number, hash, timestamp } = block as Record<string, unknown>;
  if (typeof hash !== 'string' || !HASH.test(hash)) fail('RPC_RESPONSE_INVALID');
  const head = { number: quantity(number), hash, timestamp: quantity(timestamp) };
  const nowSeconds = Math.floor(now() / 1000);
  if (head.timestamp > nowSeconds + expectation.maximumClockSkewSeconds) fail('CLOCK_SKEW');
  const ageSeconds = Math.max(0, nowSeconds - head.timestamp);
  if (ageSeconds > expectation.maximumHeadAgeSeconds) fail('STALE_HEAD');
  const contracts: ObservedCode[] = [];
  for (const item of expectation.code) {
    // Pinned to the observed head so every code read describes the same canonical state.
    const code = hexBytes(await rpc('eth_getCode', [item.address, { blockHash: head.hash, requireCanonical: true }]));
    contracts.push({ ...item, observed: code.length ? 'PRESENT' : 'ABSENT', codeBytes: code.length,
      codeHash: code.length ? toHex(keccak_256(code)) : null });
  }
  const findings: NetworkFinding[] = contracts.filter(item => item.observed !== item.expect).map(item =>
    ({ code: item.expect === 'PRESENT' ? 'CODE_MISSING' : 'UNEXPECTED_CODE', name: item.name, address: item.address }));
  return { status: findings.length ? 'MISMATCH' : 'VERIFIED', chainId, head: { ...head, ageSeconds }, contracts, findings };
}
