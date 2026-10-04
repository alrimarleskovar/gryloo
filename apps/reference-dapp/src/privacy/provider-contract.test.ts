// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { pubkeyToFieldElement, toAddress } from '@cloak.dev/sdk';
import { CLOAK_RUNTIME } from './cloak-adapter';
import { assertCloakAuth, assertCloakBoundRequest, bytesBase64, cloakSwapExternalDataHash, CLOAK_ROUTING_DISCLOSURE,
  prepareCloakAuth, type CloakProperties, type CloakSwapRequest } from './provider-contract';
const fieldBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!, v => parseInt(v, 16));
const hex = (n: bigint) => n.toString(16).padStart(64, '0');
async function fixture() {
  const now = Date.now(), p: CloakProperties = { provider: 'cloak', owner: '11111111111111111111111111111111',
    genesisHash: CLOAK_RUNTIME.genesisHash, programId: CLOAK_RUNTIME.programId, inputMint: CLOAK_RUNTIME.nativeMint,
    outputMint: CLOAK_RUNTIME.usdcMint, grossInputLamports: '20000000', recipientAta: '11111111111111111111111111111111',
    minimumOutput: '1000000', maximumProtocolFeeLamports: '5060000', privateChange: { commitment: hex(10n), amount: '10000000', mint: CLOAK_RUNTIME.nativeMint },
    inputNullifiers: [hex(11n), hex(12n)], refundPublicKey: hex(13n), refundBlinding: hex(14n), slippageBps: 50,
    reviewedAt: now, expiresAt: now + 60_000, routing: CLOAK_ROUTING_DISCLOSURE };
  const b = new Uint8Array(264); b.set(fieldBytes(hex(1n)));
  new DataView(b.buffer).setBigInt64(32, -20_000_000n, true);
  [await cloakSwapExternalDataHash(p), pubkeyToFieldElement(toAddress(p.inputMint)), 11n, 12n, 10n, 15n, 16n]
    .forEach((n, i) => b.set(fieldBytes(hex(n)), 40 + i * 32));
  const body: CloakSwapRequest = { proof_bytes: bytesBase64(new Uint8Array(256)), public_inputs: bytesBase64(b),
    output_mint: p.outputMint, recipient_ata: p.recipientAta, recipient: p.owner, min_output_amount: p.minimumOutput,
    max_fee: p.maximumProtocolFeeLamports, slippage_bps: p.slippageBps, encrypted_notes: ['synthetic-encrypted-note'],
    refund_pubkey: bytesBase64(fieldBytes(p.refundPublicKey)), refund_blinding: bytesBase64(fieldBytes(p.refundBlinding)), route_retry_attempts: 0, swap_max_retries: 1 };
  return { p, body, now };
}
describe('provider-managed Cloak property authorization (no financial execution)', () => {
  it('binds the supported request to the actual SDK preimage and discloses provider-managed routing', async () => {
    const { p, body, now } = await fixture();
    const auth = await prepareCloakAuth(p, body, now);
    await expect(assertCloakAuth(p, body, auth, now)).resolves.toBeUndefined();
    expect(p.routing).toEqual({ routingProvider: 'Jupiter via Cloak', exactDexRoute: 'provider-managed and not authorization-bound' });
  });
  it.each(['output_mint', 'recipient_ata', 'recipient', 'min_output_amount', 'max_fee', 'slippage_bps', 'refund_pubkey', 'refund_blinding',
    'route_retry_attempts', 'swap_max_retries', 'public_inputs', 'proof_bytes', 'encrypted_notes'])('rejects changed authenticated %s before signing', async key => {
    const { p, body, now } = await fixture(); const auth = await prepareCloakAuth(p, body, now);
    await expect(assertCloakAuth(p, { ...body, [key]: 'changed' }, auth, now)).rejects.toThrow();
  });
  it.each(['route', 'route_hash', 'unsigned_transaction', 'manifest_hash'])('rejects invented authorization-bound %s', async key => {
    const { p, body, now } = await fixture();
    await expect(assertCloakBoundRequest(p, { ...body, [key]: 'invented' }, now)).rejects.toThrow('CLOAK_BOUND_REQUEST_CHANGED');
  });
  it.each([32, 40, 72, 104, 136, 168])('rejects changed proof-bound public input at byte %i', async offset => {
    const { p, body, now } = await fixture(); const b = Uint8Array.from(atob(body.public_inputs), c => c.charCodeAt(0)); b[offset] = b[offset]! ^ 1;
    await expect(assertCloakBoundRequest(p, { ...body, public_inputs: bytesBase64(b) }, now)).rejects.toThrow('CLOAK_PROOF_PROPERTIES_CHANGED');
  });
  it('fails closed on fallback, wrong network, missing private change and stale review', async () => {
    const { p, body, now } = await fixture();
    for (const bad of [{ ...p, provider: 'jupiter' }, { ...p, genesisHash: 'changed' }, { ...p, privateChange: { ...p.privateChange, amount: '0' } }])
      await expect(assertCloakBoundRequest(bad as CloakProperties, body, now)).rejects.toThrow();
    await expect(assertCloakBoundRequest(p, body, p.expiresAt)).rejects.toThrow('CLOAK_REVIEW_EXPIRED');
  });
  it('rejects different program, nonce, issued-at and digest even for a valid property body', async () => {
    const { p, body, now } = await fixture(); const auth = await prepareCloakAuth(p, body, now);
    for (const changed of [{ ...auth, auth_nonce: '0'.repeat(36) }, { ...auth, auth_issued_at: String(Number(auth.auth_issued_at) + 1) },
      { ...auth, sender: CLOAK_RUNTIME.usdcMint }, { ...auth, message: new TextEncoder().encode(new TextDecoder().decode(auth.message).replace(p.programId, p.owner)) }])
      await expect(assertCloakAuth(p, body, changed, now)).rejects.toThrow('CLOAK_RELAY_AUTH_CHANGED');
  });
});
