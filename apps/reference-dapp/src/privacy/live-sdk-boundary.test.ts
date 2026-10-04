// SPDX-License-Identifier: AGPL-3.0-only
/** Actual SDK request-auth behavior, without proving, wallet signing, network or submission. */
import { describe, expect, it } from 'vitest';
import * as sdk from '@cloak.dev/sdk';
import { CLOAK_RUNTIME, assertCloakFinancialExecutionAvailable } from './cloak-adapter';

const owner = '11111111111111111111111111111111';
const request = () => ({ proof_bytes: btoa('synthetic proof'), public_inputs: btoa('synthetic public inputs'),
  output_mint: CLOAK_RUNTIME.usdcMint, recipient_ata: owner, recipient: owner, min_output_amount: '1000000',
  max_fee: '5060000', slippage_bps: 50, dexes: ['Raydium CLMM'], exclude_dexes: [],
  route_retry_attempts: 0, swap_max_retries: 1, encrypted_notes: [], risk_quote: null,
  refund_pubkey: btoa('synthetic refund public key'), refund_blinding: btoa('synthetic refund blinding') });
const signedDigest = (body: Record<string, unknown>, fields: readonly string[] = sdk.TRANSACT_SWAP_AUTH_FIELDS) =>
  new TextDecoder().decode(sdk.buildRelayAuthPreimage('/transact_swap', sdk.CLOAK_PROGRAM_ID, body, sdk.toAddress(owner), 1_791_123_200, fields).message)
    .split('\n').at(-1);

describe('published Cloak 0.2.5 live boundary: exact reviewed route is not authenticated', () => {
  it.each(['route_id', 'route_hash', 'route', 'quote', 'unsigned_transaction', 'manifest_hash'])('does not bind an added %s field in the actual relay signature digest', field => {
    const body = request();
    expect(signedDigest({ ...body, [field]: 'reviewed-value' })).toBe(signedDigest({ ...body, [field]: 'altered-after-review' }));
    expect(sdk.TRANSACT_SWAP_AUTH_FIELDS).not.toContain(field);
  });
  it.each(['min_output_amount', 'max_fee', 'recipient_ata', 'output_mint', 'proof_bytes', 'public_inputs'])('does bind supported %s, distinguishing economic/proof guarantees from exact routing', field => {
    const body = request();
    expect(signedDigest(body)).not.toBe(signedDigest({ ...body, [field]: 'altered-after-review' }));
  });
  it('cannot add route hashing only on the client without departing from the relay auth agreement', () => {
    const body = { ...request(), route_hash: '0x' + 'a'.repeat(64) };
    expect(signedDigest(body, [...sdk.TRANSACT_SWAP_AUTH_FIELDS, 'route_hash'])).not.toBe(signedDigest(body));
  });
  it('publishes swap execution and separate artifact loading but no prepare-only swap/proof export', () => {
    expect(typeof sdk.swapUtxo).toBe('function'); expect(typeof sdk.loadVerifiedCircuitArtifacts).toBe('function');
    // These are absence assertions, never guessed calls or feature implementations.
    const exports = sdk as unknown as Record<string, unknown>;
    expect(exports.prepareSwap).toBeUndefined(); expect(exports.prepareSwapUtxo).toBeUndefined();
    expect(exports.generateTransactionProof).toBeUndefined(); expect(exports.computeSwapExtDataHash).toBeUndefined();
    expect(() => assertCloakFinancialExecutionAvailable()).toThrow('CLOAK_VERIFIED_EXECUTION_BOUNDARY_UNAVAILABLE');
  });
});
