// SPDX-License-Identifier: AGPL-3.0-only
/** Cloak 0.2.5's actual property contract. An exact Jupiter route is deliberately absent. */
import { buildRelayAuthPreimage, canonicalJson, poseidonHash, pubkeyToLimbs, pubkeyToFieldElement,
  toAddress, TRANSACT_SWAP_AUTH_FIELDS, REQUEST_AUTH_MAX_AGE_SECONDS, type RelayAuthPreimage } from '@cloak.dev/sdk';
import { CLOAK_RUNTIME } from './cloak-adapter';
import { CLOAK_ROUTING_DISCLOSURE } from './disclosure';

export { CLOAK_ROUTING_DISCLOSURE } from './disclosure';
export type CloakProperties = {
  provider: 'cloak'; owner: string; genesisHash: string; programId: string; inputMint: string; outputMint: string;
  grossInputLamports: string; recipientAta: string; minimumOutput: string; maximumProtocolFeeLamports: string;
  privateChange: { commitment: string; amount: string; mint: string };
  inputNullifiers: string[]; refundPublicKey: string; refundBlinding: string;
  slippageBps: number; reviewedAt: number; expiresAt: number; routing: typeof CLOAK_ROUTING_DISCLOSURE;
};
export type CloakSwapRequest = Record<string, unknown> & { proof_bytes: string; public_inputs: string;
  output_mint: string; recipient_ata: string; recipient: string; min_output_amount: string; max_fee: string;
  refund_pubkey: string; refund_blinding: string; slippage_bps: number; encrypted_notes: string[];
  route_retry_attempts: 0; swap_max_retries: 1 };
const fail = (code: string): never => { throw new Error(code); };
const uint = (s: unknown) => typeof s === 'string' && /^(?:0|[1-9][0-9]{0,19})$/.test(s) && BigInt(s) < 1n << 64n;
const field = (s: unknown) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
export const bytesBase64 = (b: Uint8Array) => btoa(Array.from(b, c => String.fromCharCode(c)).join(''));
export const fieldHex = (n: bigint) => n.toString(16).padStart(64, '0');
const readField = (b: Uint8Array) => BigInt('0x' + Array.from(b, v => v.toString(16).padStart(2, '0')).join(''));
export function decodeExactBase64(s: unknown, length: number): Uint8Array {
  if (typeof s !== 'string' || s.length > 1_048_576) fail('CLOAK_BOUND_PAYLOAD_INVALID');
  let b: Uint8Array;
  try { b = Uint8Array.from(atob(s as string), c => c.charCodeAt(0)); } catch { return fail('CLOAK_BOUND_PAYLOAD_INVALID'); }
  if (b.length !== length || bytesBase64(b) !== s) fail('CLOAK_BOUND_PAYLOAD_INVALID');
  return b;
}
export function validateCloakProperties(p: CloakProperties, now: number): void {
  if (p.provider !== 'cloak') fail('PRIVACY_PUBLIC_FALLBACK_DENIED');
  if (p.genesisHash !== CLOAK_RUNTIME.genesisHash || p.programId !== CLOAK_RUNTIME.programId ||
      p.inputMint !== CLOAK_RUNTIME.nativeMint || p.outputMint !== CLOAK_RUNTIME.usdcMint) fail('CLOAK_NETWORK_OR_ASSET_CHANGED');
  toAddress(p.owner); toAddress(p.recipientAta);
  if (![p.grossInputLamports, p.minimumOutput, p.maximumProtocolFeeLamports, p.privateChange.amount].every(uint) ||
      BigInt(p.grossInputLamports) <= 0n || BigInt(p.grossInputLamports) > 50_000_000n ||
      BigInt(p.minimumOutput) <= 0n || BigInt(p.maximumProtocolFeeLamports) >= BigInt(p.grossInputLamports) ||
      BigInt(p.privateChange.amount) <= 0n || p.privateChange.mint !== p.inputMint || !field(p.privateChange.commitment) ||
      p.inputNullifiers.length < 1 || p.inputNullifiers.length > 2 || !p.inputNullifiers.every(field) ||
      new Set(p.inputNullifiers).size !== p.inputNullifiers.length || !field(p.refundPublicKey) || !field(p.refundBlinding) ||
      p.inputNullifiers.some(n => /^0+$/.test(n)) || /^0+$/.test(p.refundPublicKey) || /^0+$/.test(p.refundBlinding) ||
      !Number.isInteger(p.slippageBps) || p.slippageBps < 1 || p.slippageBps > 500 ||
      canonicalJson(p.routing) !== canonicalJson(CLOAK_ROUTING_DISCLOSURE)) fail('CLOAK_REVIEWED_PROPERTIES_INVALID');
  if (![p.reviewedAt, p.expiresAt, now].every(Number.isSafeInteger) || p.reviewedAt > now || p.expiresAt <= now ||
      p.expiresAt - p.reviewedAt > 60_000) fail('CLOAK_REVIEW_EXPIRED');
}

/** Same Poseidon domain/limb order as SDK 0.2.5 computeSwapExtDataHash. No invented route hash. */
export async function cloakSwapExternalDataHash(p: CloakProperties): Promise<bigint> {
  const [mintLo, mintHi] = pubkeyToLimbs(p.outputMint), [ataLo, ataHi] = pubkeyToLimbs(p.recipientAta);
  return poseidonHash([0x434c4b5357415031n, mintHi, mintLo, ataHi, ataLo, BigInt(p.minimumOutput),
    BigInt(p.grossInputLamports), BigInt('0x' + p.refundPublicKey), BigInt('0x' + p.refundBlinding), BigInt(p.maximumProtocolFeeLamports)]);
}

/** Reject unsupported extra fields; compare actual proof public inputs with reviewed economics and private commitments. */
export async function assertCloakBoundRequest(pInput: CloakProperties, bodyInput: CloakSwapRequest, now: number): Promise<void> {
  const p = structuredClone(pInput), body = structuredClone(bodyInput); validateCloakProperties(p, now);
  if (Object.keys(body).some(k => !TRANSACT_SWAP_AUTH_FIELDS.includes(k as typeof TRANSACT_SWAP_AUTH_FIELDS[number])) ||
      body.output_mint !== p.outputMint || body.recipient_ata !== p.recipientAta || body.recipient !== p.owner ||
      body.min_output_amount !== p.minimumOutput || body.max_fee !== p.maximumProtocolFeeLamports || body.slippage_bps !== p.slippageBps ||
      body.route_retry_attempts !== 0 || body.swap_max_retries !== 1 ||
      body.dexes != null || body.exclude_dexes != null || body.close_timed_out != null || body.retry_request_id != null ||
      body.sender !== undefined && body.sender !== p.owner || !Array.isArray(body.encrypted_notes) || body.encrypted_notes.length !== 1 ||
      typeof body.encrypted_notes[0] !== 'string' || body.encrypted_notes[0].length > 2048) fail('CLOAK_BOUND_REQUEST_CHANGED');
  decodeExactBase64(body.proof_bytes, 256);
  const b = decodeExactBase64(body.public_inputs, 264), v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (v.getBigInt64(32, true) !== -BigInt(p.grossInputLamports) ||
      readField(b.slice(72, 104)) !== pubkeyToFieldElement(toAddress(p.inputMint)) ||
      readField(b.slice(40, 72)) !== await cloakSwapExternalDataHash(p) ||
      fieldHex(readField(decodeExactBase64(body.refund_pubkey, 32))) !== p.refundPublicKey ||
      fieldHex(readField(decodeExactBase64(body.refund_blinding, 32))) !== p.refundBlinding ||
      p.inputNullifiers.some((n, i) => fieldHex(readField(b.slice(104 + i * 32, 136 + i * 32))) !== n) ||
      fieldHex(readField(b.slice(168, 200))) !== p.privateChange.commitment)
    fail('CLOAK_PROOF_PROPERTIES_CHANGED');
  // Local proof verification must separately establish root, padding, conservation and chain-note integrity.
}

export async function cloakRequestDigest(body: CloakSwapRequest, owner: string): Promise<string> {
  const view = Object.fromEntries(TRANSACT_SWAP_AUTH_FIELDS.map(k => [k, k === 'sender' ? owner : body[k] ?? null]));
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(view)));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
export async function prepareCloakAuth(p: CloakProperties, body: CloakSwapRequest, now: number): Promise<RelayAuthPreimage> {
  await assertCloakBoundRequest(p, body, now);
  // Stamp at review time, not at a later retry. This never claims a deadline on eventual settlement.
  const preimage = buildRelayAuthPreimage('/transact_swap', toAddress(p.programId), body, toAddress(p.owner),
    Math.floor(p.reviewedAt / 1000), TRANSACT_SWAP_AUTH_FIELDS);
  await assertCloakAuth(p, body, preimage, now); return preimage;
}
export async function assertCloakAuth(p: CloakProperties, body: CloakSwapRequest, auth: RelayAuthPreimage, now: number): Promise<void> {
  await assertCloakBoundRequest(p, body, now);
  const parts = new TextDecoder('utf-8', { fatal: true }).decode(auth.message).split('\n');
  const issuedAt = Number(auth.auth_issued_at);
  if (parts.length !== 6 || parts[0] !== 'CLOAK_RELAY_REQUEST_AUTH_V1' || parts[1] !== '/transact_swap' ||
      parts[2] !== p.programId || parts[3] !== auth.auth_nonce || parts[4] !== auth.auth_issued_at ||
      auth.sender !== p.owner || !/^[a-f0-9-]{36}$/.test(auth.auth_nonce) || !Number.isSafeInteger(issuedAt) ||
      issuedAt !== Math.floor(p.reviewedAt / 1000) || now >= (issuedAt + REQUEST_AUTH_MAX_AGE_SECONDS) * 1000 ||
      parts[5] !== await cloakRequestDigest(body, p.owner)) fail('CLOAK_RELAY_AUTH_CHANGED');
}
